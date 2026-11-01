#!/usr/bin/env node
/**
 * L-browser (SOFT) — the Playwright lane. Two claims, and the first one decides
 * whether the second may be read as evidence at all:
 *
 *   1. THE PREMISE. `browser_probe` must be recorded as observed in
 *      `.ci/probe.json`. Until then the lane is CANNOT VERIFY with the cure
 *      named: `npx playwright install chromium` (TD-0001). The browsers are NOT
 *      downloaded on this machine, so this is the lane's state today.
 *   2. THE GLOBE. No test in an e2e artifact may come from a file outside the
 *      declared e2e shape — `e2e/CHQ-<nnn>/S<n>_<slug>.spec.ts`. A run that
 *      collected somebody else's file is a run about something nobody asked for.
 *
 *     node tools/gates/lights/browser.mjs
 *
 * Zero dependencies, Node 22 ESM. The module contract lives in `./_shared.mjs`.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY THIS LIGHT DECLARES NO `premises`
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `premises: ['playwright']` would make `run.mjs` refuse this light before `run`
 * is called, with `node_modules/.bin/playwright does not exist` as the whole
 * detail. But that binary IS installed here and the lane is still unusable: what
 * is missing is the browser DOWNLOAD, which no path on disk states and which
 * only a probe can report. Declaring the wrong premise would therefore trade a
 * precise refusal for a misleading one, so the premise is asked for by name
 * through `premise(readProbe(…), 'browser_probe')` — the ONE reader of that
 * record — and this light's own detail names the cure.
 *
 * The plan writes the test as `readProbe().data.browser_probe !== 'pass'`. The
 * MEASURED record shape is `{ probes: { browser_probe: { observed: true, … } } }`
 * (tools/gates/lib/probe.mjs), and `premise()` is what reads it, returning
 * `pass` / `fail` / `cannot-verify` where a `'pass'` string comparison would
 * have collapsed three states into two. The three are different and all three
 * are reported: no record at all, a record saying the browsers are absent, and a
 * record saying they are there.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * SOFT, AND WHAT THAT DOES AND DOES NOT MEAN
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Soft is a property of the SEVERITY: `run.mjs` blocks only on
 * `severity === 'hard'`, so this light reports and never stops a commit. It is
 * NOT a licence to call an unproven lane green — `pass` here still requires the
 * probe. A soft light that answered `pass` because it could not check would be
 * the exact sentence this repository refuses: "never ran" is not green.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT IS READ, AND WHY NOT "THE NEWEST RUN"
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `../lib/run-dir.mjs` hands out no "latest" artifact on purpose, so this light
 * does not ask for one: it enumerates EVERY run directory under `.ci/runs` and
 * judges each e2e artifact it finds, naming the directory in every finding. That
 * is the opposite of a newest-glob — nothing is selected, everything is read.
 *
 * It also reads the path the committed `playwright.config.ts` gives its own JSON
 * reporter, because that path is NOT inside a run directory
 * (`playwright.config.ts:12-15` names a fixed `.ci/runs/latest-e2e/`), so a run
 * driven by `pnpm exec playwright test` writes there and no run-directory scan
 * would ever see it. The literal is read back from `scanSource`'s literals map —
 * the only place a string's text still exists after masking — never by a regex
 * over raw source, where a path inside a comment would count. Whether a fixed
 * directory is legitimate at all is L-artifacts' question, not this light's;
 * here it is simply another place an artifact can be.
 *
 * TWO CHANNELS, AND WHO READS WHICH. The JUnit XML is the artifact of record and
 * is read by `readJUnit` + `filesIn` from `../lib/junit-xml.mjs`. The JSON is the
 * second channel and is read HERE, because `readVitestJson` refuses it by
 * design: Playwright's JSON report has no `testResults` array — it is a
 * `{ suites: [{ file, specs, suites }] }` tree. That shape is UNVERIFIED on this
 * machine (the lane has never run), so `e2eJsonFiles` accepts both shapes, says
 * which one it recognised, and reports `shape: 'unknown'` rather than reading an
 * empty file list as "no foreign file".
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { filesIn, readJUnit } from '../lib/junit-xml.mjs';
import { premise, readProbe } from '../lib/probe.mjs';
import { RUNS_ROOT } from '../lib/run-dir.mjs';
import { TEST_DIR, classify } from '../lib/test-file-patterns.mjs';
import { projectState } from '../lib/test-project.mjs';
import { readVitestJson } from '../lib/vitest-json.mjs';
import { baseRev, repoRoot } from '../lib/git.mjs';
import { normalizeResult, normRel, readPremises, relPosix, scanSource, under } from './_shared.mjs';

export const id = 'L-browser';
export const severity = 'soft';

/** The probe that lifts this lane out of CANNOT VERIFY. The same name the
 * wrapper uses (tools/gates/run.mjs:126). */
export const BROWSER_PREMISE = 'browser_probe';

/** The cure, in the words the plan requires. */
export const BROWSER_CURE = 'playwright browsers not installed — npx playwright install chromium (TD-0001)';

/** The artifact names the wrapper writes for this lane (tools/gates/run.mjs:729). */
export const E2E_ARTIFACTS = Object.freeze({ junit: 'e2e.junit.xml', json: 'e2e.json' });

/** The committed config whose own reporter paths are read for the scan. */
export const CONFIG_REL = 'playwright.config.ts';

/** The shape a path must have to be an e2e case file: `classify` answers it, and
 * this is the form it answers with. */
export const E2E_FORM = 'e2e-test';

const SHOWN = 6;
const list = (xs, shown = SHOWN) => {
  const a = [...xs];
  return a.length <= shown ? a.join(', ') : `${a.slice(0, shown).join(', ')} and ${String(a.length - shown)} more`;
};

/**
 * Every run directory under `.ci/runs`, sorted by name. → { dirs, problems }
 *
 * `walk` in `./_shared.mjs` cannot be used here: it skips every `.`-prefixed
 * segment (`SELF_HIDDEN`), and `.ci` is one — which is correct for a walk over
 * judged SOURCE and useless for reading machine state. This is a plain
 * `readdirSync` of one directory, and it never recurses: a run directory's
 * artifacts are flat beside its `run.json`.
 */
export function runDirs(root) {
  const abs = join(root, RUNS_ROOT);
  if (!existsSync(abs)) return { dirs: [], problems: [], exists: false };
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch (e) {
    return { dirs: [], problems: [`${RUNS_ROOT}: unreadable directory: ${String(e.message)} — a run nobody can list is never clean`], exists: true };
  }
  const dirs = entries
    .filter((d) => d.isDirectory())
    .map((d) => `${RUNS_ROOT}/${d.name}`)
    .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { dirs, problems: [], exists: true };
}

/**
 * The `.ci/…` paths a committed config declares as its own reporter output.
 * → { paths, problems }
 *
 * Read from `scanSource`'s literals, so a path inside a comment or a template
 * substitution is not mistaken for a declaration. Only `.ci/`-rooted literals
 * are returned: this light is looking for artifacts, not for every string.
 */
export function declaredArtifactPaths(root, rel = CONFIG_REL) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return { paths: [], problems: [`${rel}: does not exist — the e2e lane has no committed config`] };
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (e) {
    return { paths: [], problems: [`${rel}: unreadable (${String(e.message)})`] };
  }
  let scan;
  try {
    scan = scanSource(text);
  } catch (e) {
    return { paths: [], problems: [`${rel}: could not be masked (${String(e.message)}) — nothing is claimed about its declared paths`] };
  }
  const problems = scan.problems.map((p) => `${rel}: ${p}`);
  const paths = [];
  for (const lit of scan.literals.values()) {
    if (lit.isLiteral !== true) continue;
    const v = normRel(lit.value);
    if (v !== null && under(v, '.ci')) paths.push(v);
  }
  return { paths: [...new Set(paths)].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)), problems };
}

/**
 * The test FILES a JSON e2e report is about. → { shape, files, problems }
 *
 * `shape` is `'playwright'`, `'vitest'` or `'unknown'`, and `'unknown'` is never
 * reported as an empty file list: a reader that cannot recognise a report must
 * say so, or "no foreign file" would mean "I read nothing".
 *
 * Playwright's shape is UNVERIFIED here — the lane has never run on this machine
 * (TD-0001) — and is taken from its documented JSON reporter: a tree of
 * `suites`, each carrying `file` plus nested `suites`/`specs`. The vitest shape
 * IS measured, and `readVitestJson` is the reader for it, so that branch adds no
 * second opinion.
 */
export function e2eJsonFiles(path) {
  if (!existsSync(path)) return { shape: 'absent', files: [], problems: [`no such file: ${path}`] };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { shape: 'unknown', files: [], problems: [`${path}: unreadable (${String(e.message)})`] };
  }
  let j;
  try {
    j = JSON.parse(text);
  } catch (e) {
    return { shape: 'unknown', files: [], problems: [`${path}: not JSON (${String(e.message)})`] };
  }

  if (Array.isArray(j?.testResults)) {
    const read = readVitestJson(path);
    return {
      shape: 'vitest',
      files: read.files?.map((f) => String(f.name)) ?? [],
      problems: read.ok ? [] : [`${path}: ${String(read.reason)}`],
    };
  }

  if (Array.isArray(j?.suites)) {
    const files = new Set();
    const visit = (node) => {
      if (node === null || typeof node !== 'object') return;
      if (typeof node.file === 'string' && node.file.trim() !== '') files.add(node.file);
      for (const key of ['suites', 'specs']) if (Array.isArray(node[key])) for (const child of node[key]) visit(child);
    };
    for (const s of j.suites) visit(s);
    return { shape: 'playwright', files: [...files].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)), problems: [] };
  }

  return {
    shape: 'unknown',
    files: [],
    problems: [
      `${path}: neither a Vitest report (no "testResults" array) nor a Playwright report (no "suites" array) — the file list is UNKNOWN, not empty, so no claim is made about which files this run collected`,
    ],
  };
}

/**
 * Is this path an e2e case file? → null when it is, else the reason it is not.
 * `classify` in `../lib/test-file-patterns.mjs` is the one reader of the shape;
 * this only decides WHICH spelling of the path to hand it, and turns the answer
 * into a sentence.
 *
 * THREE SPELLINGS, because the reporters do not agree and only one of them is
 * measured. Vitest's JSON `file` is ABSOLUTE (measured, scratchpad §10) and is
 * relativised against the repository root. The JUnit `classname` is relative to
 * the repository root (measured, §11). Playwright's JSON `file` is documented as
 * relative to the config's own root, which for `testDir: './e2e'` would make a
 * case read `CHQ-001/S1_x.spec.ts` — UNVERIFIED here, since the lane has never
 * run on this machine. So a path that is not already under `e2e/` is ALSO tried
 * with that prefix, and the reason says both spellings were tried. Guessing one
 * way would either miss every foreign file or report every legitimate one.
 */
export function foreignReason(root, rel) {
  const raw = String(rel ?? '');
  const p = isAbsolute(raw) ? relPosix(root, raw) : normRel(raw);
  if (p === null || p === '' || p.startsWith('..'))
    return `${raw || '(empty)'} is not a path inside this repository — a report naming a file outside the tree cannot be checked against the declared glob`;

  const candidates = under(p, TEST_DIR.e2e) ? [p] : [p, `${TEST_DIR.e2e}/${p}`];
  for (const c of candidates) if (classify(c).form === E2E_FORM) return null;

  const judged = candidates.map((c) => `${c} is form "${classify(c).form}"`).join(' and ');
  return `${judged} — none is "${E2E_FORM}"; the declared shape is ${TEST_DIR.e2e}/CHQ-<nnn>/S<n>_<slug>.spec.ts`;
}

export function run(ctx = {}) {
  const root = ctx.root ?? process.cwd();

  const probe = readProbe({ root });
  const p = premise(probe, BROWSER_PREMISE);

  // ---- the tree: what there is to run at all
  const tree = projectState({ root, project: 'e2e' });
  const treeNote = !tree.dirExists
    ? `${TEST_DIR.e2e}/ does not exist, so there is no e2e case to collect and nothing a run could be about yet`
    : `${TEST_DIR.e2e}/: ${String(tree.fileCount)} file(s), ${String(tree.staticCount)} declared case(s) (${tree.state})`;

  // ---- the artifacts: every run directory, plus what the config declares
  const runs = runDirs(root);
  const declared = declaredArtifactPaths(root);
  const unknowns = [...runs.problems, ...declared.problems];

  const jsonPaths = [
    ...runs.dirs.map((d) => `${d}/${E2E_ARTIFACTS.json}`),
    ...declared.paths.filter((x) => x.endsWith('.json')),
  ];
  const junitPaths = [
    ...runs.dirs.map((d) => `${d}/${E2E_ARTIFACTS.junit}`),
    ...declared.paths.filter((x) => x.endsWith('.xml')),
  ];

  const problems = [];
  const readFrom = [];

  for (const rel of new Set(jsonPaths)) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    const r = e2eJsonFiles(abs);
    readFrom.push(`${rel} (json, ${r.shape})`);
    unknowns.push(...r.problems.map((x) => `${rel}: ${x.replace(`${abs}: `, '')}`));
    if (r.shape === 'unknown') continue;
    for (const f of r.files) {
      const why = foreignReason(root, f);
      if (why !== null) problems.push(`${rel}: a test came from a file the glob does not cover — ${why}`);
    }
  }

  for (const rel of new Set(junitPaths)) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    const x = readJUnit(abs);
    readFrom.push(`${rel} (junit)`);
    if (!x.ok) {
      unknowns.push(`${rel}: ${String(x.reason)}`);
      continue;
    }
    for (const f of filesIn(x)) {
      const why = foreignReason(root, f);
      if (why !== null) problems.push(`${rel}: a <testcase classname> names a file the glob does not cover — ${why}`);
    }
  }

  const where = readFrom.length === 0 ? 'no e2e artifact exists anywhere under .ci/runs or at the path the config declares' : `read ${list(readFrom)}`;
  const scanned =
    `${String(runs.dirs.length)} run directory(ies) under ${RUNS_ROOT}` +
    (runs.exists ? '' : ' (the directory does not exist — nothing has been run of record here)') +
    (declared.paths.length ? `; ${CONFIG_REL} declares ${list(declared.paths)}` : '');

  const head = `${treeNote} · ${scanned} · ${where}`;

  // The premise decides whether anything read above may be CITED. A finding on an
  // artifact produced without an observed probe is printed — it is information —
  // but it is not evidence, and the status stays cannot-verify so nobody quotes
  // it as a verdict about the lane.
  if (p.verdict !== 'pass') {
    const note =
      problems.length === 0
        ? ''
        : ` · also seen, and NOT evidence while the probe is unobserved: ${problems.join(' · ')}`;
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail: `${BROWSER_CURE} — ${p.reason} · ${head}${note}${unknowns.length ? ` · ${unknowns.join(' · ')}` : ''}`,
    };
  }

  if (problems.length > 0)
    return { id, severity, status: 'fail', detail: [`${p.reason} · ${head}`, ...problems, ...unknowns].join(' · ') };

  // The probe is observed and no artifact names a foreign file — but if there is
  // no artifact at all there is also nothing the second claim was checked
  // against, so that is cannot-verify and not a pass.
  if (readFrom.length === 0)
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail: `${p.reason}, but ${head} — the probe lifts the lane and there is still no artifact to read, so the glob claim has nothing to stand on`,
    };

  return { id, severity, status: unknowns.length > 0 ? 'cannot-verify' : 'pass', detail: [`${p.reason} · ${head}`, ...unknowns].join(' · ') };
}

// ------------------------------------------------------------------------- cli

/**
 * `node tools/gates/lights/browser.mjs` — the command a spec's `## Lights` row
 * cites. One row, the pack's vocabulary, the pack's exit rule: a HARD light that
 * is not `pass` exits 1, a SOFT one reports and exits 0 — which is this light,
 * so an unobserved probe is readable and never blocking. A refusal names the
 * cure, never a stack trace.
 *
 * Unlike the range-based lights this one needs no HEAD for its own claims: it
 * reads a probe record, the tree and the artifacts. `readProbe` does pin its
 * record to `git show HEAD:pnpm-lock.yaml`, so in a repository with no commit it
 * reports the record as stale with that named as the reason — which is the
 * correct answer, and is why there is no refusal here.
 */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rr = repoRoot();
  if (!rr.ok) {
    console.error(`[${id}] REFUSED: not a git work tree (${rr.reason}) — the probe record is pinned to the committed lockfile, which is read through git.`);
    process.exit(1);
  }
  const b = baseRev('main', { cwd: rr.root });
  let returned;
  try {
    returned = run({ root: rr.root, mb: b.rev, rangeKind: b.kind, allow: [], mode: 'all', thin: false, premises: readPremises(rr.root), base: 'main', tolerate: false });
  } catch (e) {
    returned = { status: 'cannot-verify', detail: `threw: ${String(e?.message ?? e).split('\n')[0]}` };
  }
  const row = normalizeResult({ id, severity }, returned);
  console.log('| id | severity | status | detail |');
  console.log(`| ${row.id} | ${row.severity} | ${row.status === 'cannot-verify' ? 'CANNOT VERIFY' : row.status} | ${row.detail.replaceAll('|', '¦')} |`);
  process.exit(row.severity === 'hard' && row.status !== 'pass' ? 1 : 0);
}
