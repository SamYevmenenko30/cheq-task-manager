// `n/a` against CANNOT VERIFY — decided from the SOURCES, never from an artifact.
//
// The rule this module exists for (rule 3 of the pipeline): a set whose files carry no `it(` or
// `test(` call site at all is `n/a` — it is NOT launched and it is NOT green. A set that DOES
// carry cases while the artifact reports `tests="0"` is CANNOT VERIFY: the run matched nothing,
// and a filter is not a proof. Deciding `n/a` from the artifact would make "the runner found
// nothing" indistinguishable from "there was nothing to find", which is exactly the confusion
// that lets an empty suite read as a pass.
//
// So: `projectState()` reads only the tree. `artifactVerdict()` is the only function here that is
// allowed to look at a count from an artifact, and it can return `n/a`, `cannot-verify` or
// `judgeable` — never `green`. Whether a judgeable run passed is the JUnit reader's business.
//
// Zero dependencies: node:fs and node:path only.
//
// The project table below is a DECLARATION, measured against the configs on 2026-11-01:
//   core      vitest.config.ts:20  root ./packages/core  node   include test/**/*.test.ts
//   core-dom  vitest.config.ts:32  root ./packages/core  jsdom  include test/**/*.test.ts
//   api       vitest.config.ts:41  root ./apps/api       node   include test/**/*.test.ts
//   web       vitest.config.ts:47  root ./apps/web       jsdom  include test/**/*.test.{ts,tsx}
//   e2e       playwright.config.ts:10  testDir ./e2e
// This module does not parse vitest.config.ts — a gate does not parse the language it judges, and
// a second reader of the same fact is a second answer waiting to happen. L-orphans is the light
// that compares this table against the config; if they ever disagree, that light is the one that
// says so.
//
// `core-dom` is a PROJECT, not a kind: it runs the same files as `core` in jsdom, and the pair is
// the parity lane L-env-parity diffs case by case. kindOf() never returns 'core-dom'.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

import { listCases } from './test-cases.mjs';
import { classify, KINDS } from './test-file-patterns.mjs';

/** Every runnable project, keyed by the name passed to `--project` (or the Playwright lane). */
export const PROJECTS = Object.freeze({
  core: { kind: 'core', dir: 'packages/core/test', extensions: ['.test.ts'], runner: 'vitest', environment: 'node' },
  'core-dom': { kind: 'core', dir: 'packages/core/test', extensions: ['.test.ts'], runner: 'vitest', environment: 'jsdom' },
  api: { kind: 'api', dir: 'apps/api/test', extensions: ['.test.ts'], runner: 'vitest', environment: 'node' },
  web: { kind: 'web', dir: 'apps/web/test', extensions: ['.test.ts', '.test.tsx'], runner: 'vitest', environment: 'jsdom' },
  e2e: { kind: 'e2e', dir: 'e2e', extensions: ['.spec.ts'], runner: 'playwright', environment: 'chromium' },
});

export const PROJECT_NAMES = Object.keys(PROJECTS);

/** The projects that run a kind's files. core has two (node and jsdom); e2e has one. */
export function projectsOfKind(kind) {
  return PROJECT_NAMES.filter((p) => PROJECTS[p].kind === kind);
}

/** The kind a project runs. Throws on an unknown project name — that is a programming error. */
export function kindOfProject(project) {
  const p = PROJECTS[project];
  if (p === undefined) {
    throw new TypeError(`unknown project "${project}" — known: ${PROJECT_NAMES.join(', ')}`);
  }
  return p.kind;
}

function walk(root, rel, acc) {
  let entries;
  try {
    entries = readdirSync(join(root, rel), { withFileTypes: true });
  } catch (err) {
    acc.unreadable.push(`${rel}: ${err.code ?? err.message}`);
    return;
  }
  for (const e of entries.toSorted((x, y) => (x.name < y.name ? -1 : 1))) {
    const child = rel === '' ? e.name : posix.join(rel, e.name);
    if (e.isSymbolicLink()) {
      acc.skipped.push(`${child} (symlink, not followed)`);
      continue;
    }
    if (e.isDirectory()) {
      // The ONLY reasons a path is skipped: node_modules, and a segment Unity-style hidden by a
      // leading dot (e.g. the gitignored /e2e/.auth/, .gitignore:28). Both are REPORTED in
      // `skippedDirs` rather than silently dropped, so L-visible can check them against its
      // manifest instead of trusting this walk.
      if (e.name === 'node_modules' || e.name.startsWith('.')) {
        acc.skipped.push(child);
        continue;
      }
      walk(root, child, acc);
      continue;
    }
    if (e.isFile()) acc.files.push(child);
  }
}

/**
 * The state of one runnable project, read from the tree alone.
 *
 * @param {{root?: string, project: string}} arg root defaults to process.cwd()
 * @returns {{
 *   project: string, kind: string, runner: string, environment: string,
 *   dir: string, dirExists: boolean,
 *   files: Array<{path: string, form: string, expected: number|null, resolved: number,
 *                 unresolved: number, skipped: number, names: string[], note: string|null,
 *                 unparsable: string[]}>,
 *   expectedByFile: Record<string, string[]>,
 *   fileCount: number, staticCount: number, resolvedCount: number, unresolvedCount: number,
 *   benchCount: number,
 *   expected: number|null,
 *   state: 'n/a'|'has-cases',
 *   runnable: boolean,
 *   unclassified: Array<{path: string, reason: string}>,
 *   ignoredFiles: string[], skippedDirs: string[], unreadable: string[],
 *   reasons: string[]
 * }}
 */
export function projectState({ root = process.cwd(), project } = {}) {
  const cfg = PROJECTS[project];
  if (cfg === undefined) {
    throw new TypeError(`unknown project "${project}" — known: ${PROJECT_NAMES.join(', ')}`);
  }

  const acc = { files: [], skipped: [], unreadable: [] };
  let dirExists = false;
  try {
    dirExists = statSync(join(root, cfg.dir)).isDirectory();
  } catch {
    dirExists = false;
  }
  if (dirExists) walk(join(root, cfg.dir), '', acc);

  const files = [];
  const unclassified = [];
  const ignoredFiles = [];
  const reasons = [];
  let staticCount = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;
  let benchCount = 0;
  let derivable = true;
  const expectedByFile = {};

  for (const rel of acc.files) {
    const repoPath = posix.join(cfg.dir, rel);
    const collected = cfg.extensions.some((ext) => rel.endsWith(ext));
    const info = classify(repoPath);

    if (info.form === 'unclassified-test' || info.form === 'invalid') {
      unclassified.push({ path: repoPath, reason: info.reason ?? 'unclassified' });
      derivable = false;
      continue;
    }
    if (!collected) {
      // Support files, fixtures and anything else the runner does not collect. They hold no
      // cases of their own; a `describe` in a support file is imported, not collected.
      ignoredFiles.push(repoPath);
      continue;
    }

    let text = '';
    try {
      text = readFileSync(join(root, cfg.dir, rel), 'utf8');
    } catch (err) {
      unclassified.push({ path: repoPath, reason: `unreadable: ${err.code ?? err.message}` });
      derivable = false;
      continue;
    }

    const listed = listCases(text, { file: repoPath });
    staticCount += listed.counts.sites;
    resolvedCount += listed.counts.resolved;
    unresolvedCount += listed.counts.unresolved;
    benchCount += listed.benches.length;
    if (listed.expected === null) derivable = false;
    expectedByFile[repoPath] = listed.names;
    files.push({
      path: repoPath,
      form: info.form,
      expected: listed.expected,
      resolved: listed.counts.resolved,
      unresolved: listed.counts.unresolved,
      skipped: listed.counts.skipped,
      names: listed.names,
      note: listed.note,
      unparsable: listed.unparsable,
    });
    if (listed.note !== null) reasons.push(listed.note);
    if (listed.counts.sites === 0) {
      // A collected file with no case in it is its own trap: somebody believes it covers
      // something. It is named here rather than quietly contributing zero.
      reasons.push(`${repoPath} is collected by the ${project} project and holds no it( or test( call site`);
    }
  }

  if (!dirExists) reasons.push(`${cfg.dir} does not exist`);
  if (unclassified.length > 0) {
    reasons.push(
      `${unclassified.length} file(s) under ${cfg.dir} match no declared form — ` +
        'CANNOT VERIFY (test-file-patterns.mjs names the cure for each)',
    );
  }
  if (benchCount > 0) {
    reasons.push(`${benchCount} bench() site(s) are present and are not cases (vitest run does not execute them)`);
  }

  const state = staticCount === 0 ? 'n/a' : 'has-cases';
  if (state === 'n/a') {
    reasons.push(
      `no it( or test( call site under ${cfg.dir} — the ${project} project is n/a: it is not ` +
        'launched and it is not green (rule 3)',
    );
  }

  return {
    project,
    kind: cfg.kind,
    runner: cfg.runner,
    environment: cfg.environment,
    dir: cfg.dir,
    dirExists,
    files,
    expectedByFile,
    fileCount: files.length,
    staticCount,
    resolvedCount,
    unresolvedCount,
    benchCount,
    expected: derivable && state === 'has-cases' ? resolvedCount : null,
    state,
    runnable: state === 'has-cases',
    unclassified,
    ignoredFiles,
    skippedDirs: acc.skipped,
    unreadable: acc.unreadable,
    reasons,
  };
}

/** Every project's state in one object, for the `ready` block and the lights. */
export function allProjectStates({ root = process.cwd(), projects = PROJECT_NAMES } = {}) {
  const out = {};
  for (const p of projects) out[p] = projectState({ root, project: p });
  return out;
}

/** Projects a runner should actually be launched for. An `n/a` project is never launched. */
export function runnableProjects({ root = process.cwd(), projects = PROJECT_NAMES } = {}) {
  return projects.filter((p) => projectState({ root, project: p }).runnable);
}

/**
 * Whether an artifact's case count may be judged at all for this project. It NEVER returns green:
 * `judgeable` only means the artifact is about the right thing and the JUnit reader may proceed.
 *
 * @param {object} state the result of projectState()
 * @param {{tests?: number|null, present?: boolean}} artifact counts read from the JUnit XML
 * @returns {{status: 'n/a'|'cannot-verify'|'judgeable', detail: string}}
 */
export function artifactVerdict(state, artifact = {}) {
  const { tests = null, present = artifact.tests !== undefined && artifact.tests !== null } = artifact;

  if (state.state === 'n/a') {
    return {
      status: 'n/a',
      detail:
        `${state.project}: no it( or test( call site under ${state.dir} — not launched, not green` +
        (state.benchCount > 0 ? `; ${state.benchCount} bench() site(s) present` : ''),
    };
  }
  if (state.unclassified.length > 0) {
    return {
      status: 'cannot-verify',
      detail: `${state.project}: ${state.unclassified.length} file(s) under ${state.dir} match no declared form — ${state.unclassified[0].path}: ${state.unclassified[0].reason}`,
    };
  }
  if (!present || tests === null) {
    return {
      status: 'cannot-verify',
      detail: `${state.project}: ${state.staticCount} case site(s) in the sources and no artifact to read — a missing artifact is never green`,
    };
  }
  if (tests === 0) {
    return {
      status: 'cannot-verify',
      detail: `${state.project}: ${state.staticCount} case site(s) in the sources, tests="0" in the artifact — the run matched nothing (filter, project name or include)`,
    };
  }
  if (state.expected !== null && tests !== state.expected) {
    return {
      status: 'cannot-verify',
      detail: `${state.project}: the sources enumerate ${state.expected} case(s), the artifact ran ${tests} — a filter is not a proof`,
    };
  }
  if (state.expected === null) {
    return {
      status: 'cannot-verify',
      detail: `${state.project}: the case count is not derivable from the sources (${state.reasons.join('; ')}) — the artifact's ${tests} cannot be checked against anything`,
    };
  }
  return {
    status: 'judgeable',
    detail: `${state.project}: ${tests} case(s) ran and the sources enumerate ${state.expected}`,
  };
}

/** Kinds, re-exported so a caller needs one import for the vocabulary. */
export { KINDS };
