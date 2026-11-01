/**
 * probes/gates.mjs — the five executable gates and the one orchestrator, each
 * judged by PLANTING the defect it exists for and reading what it says about it.
 *
 * Zero dependencies. The contract this group is written against lives in
 * `./_harness.mjs`; read its header first. Nothing here re-implements a fixture,
 * a spawner or an assertion: `scratchRepo` / `writeWorkspace` / `runGate` /
 * `runLight` are the harness's, and `assert` is the only way a probe fails.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * A PROBE THAT ASSERTS ONLY THE EXIT CODE IS USELESS — AND SO IS ONE THAT READS
 * AN EXIT CODE NOBODY PRODUCED
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Every probe below reads the gate's TEXT as well as its status, because the
 * harness's ledger demands it and because the ledger is right: a gate that died
 * on an unresolved import exits non-zero too. Each assertion message therefore
 * carries the gate's own output — `assertStatus` / `assertOut` do that for free.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE SYMLINK TRAP, MEASURED 2026-11-01 — WHY NO FIXTURE HERE CARRIES THE GATE
 * SCRIPT IT IS ABOUT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Six of the seven executable gates guard their entry point with
 *
 *     process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
 *
 * `runGate` resolves the script against the fixture FIRST (`join(cwd, script)`)
 * and hands the child that ABSOLUTE path. On macOS `mkdtemp` lives under
 * `/var → /private/var`, so the child is started as
 * `/var/folders/…/tools/gates/spec-gate.mjs` while `import.meta.url` is the
 * realpath `/private/var/folders/…`. The two strings differ, the guard is false,
 * and the gate RUNS NOTHING: exit 0, no output. Measured on this machine, three
 * ways — the same fixture answered `""` for the absolute path and the full
 * `[spec-gate] ✓ …` for the realpath and for the repository's own copy.
 *
 * That shape reads as "the gate passed", which is the one answer a probe must
 * never invent, and the harness's own self-probe does not catch it because
 * `lights/run.mjs` is the one gate with NO main guard. So every probe here runs
 * the REPOSITORY's copy of the gate it judges, against a fixture `cwd`: the
 * fixtures below deliberately do not hold `tools/gates/*.mjs`, which is what
 * makes `runGate` fall through to `REPO_ROOT`. A gate's own `./lib/*.mjs`
 * imports then resolve beside it, in the repository, which is the same code a
 * copy would have carried.
 *
 * The cure belongs in `_harness.mjs` (one `realpathSync` on the resolved path)
 * or in each guard, and it is reported rather than applied here: this file owns
 * no gate and no harness.
 *
 * `ready.mjs` is the exception that proves the rule: it spawns its children by
 * RELATIVE argv from the repository root it chdir'd into, and a relative
 * `process.argv[1]` resolves against the child's own physical cwd, so the guard
 * holds. Its fixture therefore carries STUB children (the plan's own design for
 * group 9) and not the real gates.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT EACH FIXTURE COSTS, AND WHY red-check's IS THE ONE THAT INSTALLS
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `test-guard` and `spec-gate` read git and text only, so their fixtures are a
 * `git init` and a few files. `status` is read as a MODULE (`report({ root })`
 * returns the lines) — there is no terminal to parse. `run.mjs` refuses before
 * it spawns anything, so its forbidden-flag probes need no fixture at all and
 * run against this repository.
 *
 * TWO THINGS THESE PROBES MEASURED THAT THE PLAN HAD WRONG OR MISSING, both
 * written down beside the probe that found them rather than only here:
 *   - `@cheq/core` imported from INSIDE `packages/core` RESOLVES (Node's
 *     self-reference through the `exports` map, which `moduleResolution:
 *     bundler` reads too), so the plan's probe for "TS2307 naming a workspace
 *     package" would have been a probe about a green test. `@cheq/api` — a
 *     package the importer does not declare — is the shape that produces the
 *     diagnostic. See `PACKAGE_IMPORT_CASE`.
 *   - `spec-gate` ACCEPTS a `spec-approved:` trailer on the very commit that
 *     changed the spec, which rule 14 (AGENTS.md:432-434) says is not an
 *     approval. The probe that names it is RED on purpose, and its message
 *     carries the cause and the cure; the fix belongs to that gate, not here.
 *
 * `red-check` is different in kind: it adds a detached worktree at the base and
 * installs it from the BASE lockfile, because an uninstalled base resolves
 * nothing and would report a clean sweep of reds having verified nothing. That
 * install is a premise of the gate, so a probe cannot stub it; measured here, it
 * is seconds from a warm store with `--prefer-offline`. Each red-check probe
 * therefore gets ONE fixture and ONE run that judges several planted files at
 * once — the gate reports per file, so one run carries several verdicts without
 * any of them covering another.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { EMPTY_TREE } from '../lib/git.mjs';
import { PENDING_IMPLEMENTATION_PREFIX, STANDING_LIGHTS, parseSpec } from '../lib/spec-parse.mjs';
import { codeOnly } from '../lib/test-cases.mjs';
import { byCodepoint } from '../lights/_shared.mjs';
import { FORBIDDEN, e2eArgv, lintArgv, typesArgv, vitestArgv } from '../run.mjs';
import { TOLERANCE_FLAG, toleranceArgv } from '../ready.mjs';
import { report as statusReport } from '../status.mjs';
import {
  REPO_ROOT,
  assert,
  assertLight,
  assertNotOut,
  assertOut,
  assertStatus,
  havePremise,
  keepScratch,
  linkNodeModules,
  probe,
  runGate,
  runLight,
  scratchRepo,
  skipped,
  writeWorkspace,
} from './_harness.mjs';

export const title = 'the five gates and the orchestrator, each against a planted defect';

// ───────────────────────────────────────────────────────────────────── fixtures

/**
 * The trees a fixture copies. `docs` is not decoration: `L-tsc` refuses a
 * `skipLibCheck` whose tech-debt entry it cannot read, and `spec-gate` checks
 * `deferred: TD-nnnn` against `docs/tech-debt/`, so a fixture without `docs`
 * fails for a reason that has nothing to do with the planted defect.
 */
const SKELETON_TREES = Object.freeze(['packages', 'apps', 'e2e', 'docs']);

/** The workspace packages whose own `node_modules` a fixture needs symlinked. */
const DEP_PACKAGES = Object.freeze(['apps/api', 'apps/web']);

/**
 * This repository's committed skeleton in a throwaway repo, WITHOUT
 * `tools/gates/*.mjs` — see THE SYMLINK TRAP above.
 */
function skeleton(label, { trees = SKELETON_TREES, lock = true, commit = 'chore: scaffold' } = {}) {
  const r = scratchRepo({ label });
  writeWorkspace(r, { lock, commit: false, trees });
  if (commit !== false) {
    r.commit(commit);
    // The scaffold commit is the base every range below is taken from, and that
    // is not a convenience. `isTestFile` is TRUE for a skeleton fixture, so a
    // range starting at the empty tree carries `packages/core/test/skeleton/*`
    // as added test files — and spec-gate would then read every fixture as "this
    // range entered the test phase". The range must begin where the scaffold
    // ends, which is also what `ready` derives for itself.
    r.base = r.head();
  }
  return r;
}

/**
 * The real toolchain, reached by symlink and never by an install.
 *
 * The ROOT `node_modules` alone is not enough, and the harness says so: pnpm's
 * per-package trees are gitignored, so `apps/api` cannot resolve `fastify` and
 * `apps/web` cannot resolve `react` from the root install. A fixture missing
 * them makes `tsc` red in two of three projects, which any probe about types
 * would then read as its own planted defect.
 */
function linkToolchain(r) {
  const root = linkNodeModules(r);
  assert(root.linked, `the fixture must reach the toolchain without an install: ${root.reason}`);
  for (const pkg of DEP_PACKAGES) {
    const src = join(REPO_ROOT, pkg, 'node_modules');
    if (!existsSync(src)) continue;
    const target = join(r.dir, pkg, 'node_modules');
    if (existsSync(target)) continue;
    mkdirSync(join(r.dir, pkg), { recursive: true });
    symlinkSync(src, target);
  }
}

/** `.ci/` of a probe's own making is machine state in tmp; it is removed with the fixture. */
function dropCi(path) {
  if (keepScratch()) return;
  rmSync(path, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────── the spec text

/**
 * `## Lights` generated from the ONE registry, never typed out: a spec fixture
 * carrying a hand-copied table would drift from `STANDING_LIGHTS` and fail every
 * spec-gate probe for a reason nobody planted. The severity column is the
 * declared one where there is one, `hard` where the registry leaves it null —
 * which is what `severityOf` reads back.
 */
const LIGHTS_TABLE = [
  '| id | kind | check | severity | title |',
  '|---|---|---|---|---|',
  ...STANDING_LIGHTS.map(
    (l) => `| ${l.id} | rule | \`node tools/gates/lights/${l.id.replace(/^L-/, '')}.mjs\` | ${l.severity ?? 'hard'} | ${l.title} |`,
  ),
].join('\n');

const VISION = 'A task carries a due date.\nThe list shows the overdue ones first.';

/**
 * `check:` is `TODO` only while the spec is unapproved (rule 11, re-bound to the
 * approval): the moment a `spec-approved:` trailer exists, every live S must
 * name a classified test file that exists at HEAD. So the approval probes build
 * their spec with the path, and the fixture writes that file.
 */
const s1 = (check = 'TODO') =>
  [
    '- **S1** Given a task whose due date is in the past, when the list is ordered, then that task comes first.',
    `  - kind: core · home: @cheq/core · verify: tsc-noemit + vitest-core · check: ${check}`,
    '  - inputs: due_date=differs, timezone=invariant',
  ].join('\n');

const S1 = s1();
const CHECK_PATH = 'packages/core/test/CHQ-001/S1_names-itself.test.ts';

const AC_BOTH = [
  '| Vision § | Assertions | Planned home | Notes |',
  '|---|---|---|---|',
  '| §1 A task carries a due date. | S1 | @cheq/core | |',
  '| §2 The list shows the overdue ones first. | — | out of scope: the view comes later | |',
].join('\n');

/**
 * A spec that spec-gate passes, with every part overridable by name. A `null`
 * part DROPS its section, which is how the fail-closed probe plants an absent
 * `## Open questions` without hand-writing a second whole spec.
 *
 * Verified against the real gate: the defaults below exit 0 with
 * `✓ 1 spec(s) checked: CHQ-001 r1 (1 live S, unapproved)`.
 */
const section = (titleText, body) => (body === null ? '' : `## ${titleText}\n\n${body}\n\n`);

function spec(parts = {}) {
  const p = {
    id: 'CHQ-001',
    heading: 'SPEC: CHQ-001 — a task carries a due date',
    revision: '1 — first draft',
    vision: VISION,
    premise: '- the repository has no task model yet (packages/core/src/index.ts:1)',
    assertions: S1,
    acMap: AC_BOTH,
    crossPackage: '- none',
    nonGoals: '- none',
    lights: LIGHTS_TABLE,
    openQuestions: '- none',
    answered: '- none',
    syrup: '- none',
    contradictions: '- none',
    appendix: '- none',
    tail: '',
    ...parts,
  };
  return (
    `# ${p.heading}\n\n` +
    'Author of this spec: Probe Fixture, 2026-01-01\n' +
    `Revision: ${p.revision}\n\n` +
    section('Vision (verbatim)', p.vision) +
    section('Premise check', p.premise) +
    section('Assertions', p.assertions) +
    section('AC map', p.acMap) +
    section('Cross-package effects', p.crossPackage) +
    section('Non-goals', p.nonGoals) +
    section('Lights', p.lights) +
    section('Open questions', p.openQuestions) +
    section('Answered questions', p.answered) +
    section('Syrup', p.syrup) +
    section('Contradictions with the project as it stands', p.contradictions) +
    section('Appendix: implementation notes', p.appendix) +
    p.tail
  );
}

const SPEC_PATH = 'docs/specs/CHQ-001.md';

/** A fixture holding the skeleton plus one spec, each in its own commit. → the handle. */
function specFixture(label, specBody, { commit = 'docs(spec): CHQ-001' } = {}) {
  const r = skeleton(label);
  r.write(SPEC_PATH, specBody);
  r.commit(commit);
  return r;
}

/** spec-gate over a fixture, from the scaffold commit so the spec's whole life is in range. */
const specGate = (r, args = []) =>
  runGate('tools/gates/spec-gate.mjs', ['--since', String(r.base ?? EMPTY_TREE), ...args], { cwd: r.dir });

// ──────────────────────────────────────────────────────────────── test sources

const header = "import { describe, expect, it } from 'vitest';\n";

/** A spec test that passes anywhere: the marker module names itself. */
const GREEN_CASE = `${header}
import { CORE_PACKAGE } from '../../src/index.ts';

describe('S1_names_itself', () => {
  it('S1: the core package names itself', () => {
    expect(CORE_PACKAGE).toBe('@cheq/core');
  });
});
`;

/** An honest assertion failure: the Given exists, the Then does not hold. */
const RED_CASE = `${header}
import { CORE_PACKAGE } from '../../src/index.ts';

describe('S2_due_window', () => {
  it('S2: the ordering module is named', () => {
    expect(CORE_PACKAGE).toBe('@cheq/ordering');
  });
});
`;

/** Signature 1: the module exists, the export does not (TypeError at run time). */
const MISSING_EXPORT_CASE = `${header}
import { completeTask } from '../../src/index.ts';

describe('S3_missing_export', () => {
  it('S3: completing a task returns the task', () => {
    expect(completeTask('a')).toBe('a');
  });
});
`;

/** Signature 2: a name nobody imported and nobody wrote (ReferenceError). */
const MISSING_NAME_CASE = `${header}
describe('S4_missing_name', () => {
  it('S4: the window is computed', () => {
    expect(dueWindow(0)).toBe(0);
  });
});
`;

/** Signature 3: the module itself is not written yet (Cannot find module). */
const MISSING_MODULE_CASE = `${header}
import { order } from '../../src/scheduling/schedule.ts';

describe('S5_missing_module', () => {
  it('S5: the schedule orders the list', () => {
    expect(order([])).toEqual([]);
  });
});
`;

/** Not red at all: a case that never executes. */
const TODO_CASE = `${header}
describe('S6_todo', () => {
  it.todo('S6: the overdue ones come first');
});
`;

/**
 * Not red either: a bare specifier naming a workspace package that this package
 * does not depend on is TS2307 `not-installed` — the signature of a worktree
 * nobody installed, which must never read as a missing symbol.
 *
 * MEASURED 2026-11-01, and it corrects an assumption: `@cheq/core` imported
 * from INSIDE `packages/core` does resolve and the case PASSES, because a
 * package with an `exports` map may reference ITSELF by name (Node's
 * self-reference), and `moduleResolution: bundler` reads the same map. The plan
 * named `@cheq/core` for this probe; the probe would have been about a green
 * test instead. A package the importer does not declare — here `@cheq/api` —
 * is the shape that actually produces the diagnostic.
 */
const PACKAGE_IMPORT_CASE = `${header}
import { API_PACKAGE } from '@cheq/api';

describe('S7_package_import', () => {
  it('S7: the api package is reachable from core', () => {
    expect(API_PACKAGE).toBe('@cheq/api');
  });
});
`;

/** A legal test path that declares no case at all: the run collects nothing. */
const NO_CASE = '// A placed spec test with no case in it yet.\nexport {};\n';

/**
 * `GREEN_CASE` with ONE case added and nothing else touched — written out rather
 * than produced by a `replace`, because a fixture whose braces do not close
 * makes the gate report "the run has no new case", which is a true statement
 * about a broken fixture and no statement at all about the gate.
 */
const GAINED_CASE = `${header}
import { CORE_PACKAGE } from '../../src/index.ts';

describe('S1_names_itself', () => {
  it('S1: the core package names itself', () => {
    expect(CORE_PACKAGE).toBe('@cheq/core');
  });

  it('S1: and the name is scoped', () => {
    expect(CORE_PACKAGE.startsWith('@cheq/')).toBe(true);
  });
});
`;

const SUPPORT_HELPER = `// A branch-added helper of the core package.
export const alwaysTrue = (): boolean => true;
`;

const SUPPORT_GREEN_CASE = `${header}
import { alwaysTrue } from '../support/fake-truth.ts';

describe('S9_support_green', () => {
  it('S9: the helper answers true', () => {
    expect(alwaysTrue()).toBe(true);
  });
});
`;

const CASE_DIR = 'packages/core/test/CHQ-001';

// ──────────────────────────────────────────────────────────────── red-check

/**
 * One red-check run over one planted fixture. → `{ r, res, base, ciRoot }`
 *
 * `CHEQ_CI_ROOT` keeps the base worktree beside the fixture in tmp rather than
 * beside this repository; `dropCi` removes it. The gate is handed `--since
 * <base sha>`, so the range is exactly the branch commit.
 */
function redCheck(label, { baseFiles = {}, branchFiles = {}, specBody = spec() } = {}) {
  const r = skeleton(label, { commit: false });
  r.write(SPEC_PATH, specBody);
  for (const [path, text] of Object.entries(baseFiles)) r.write(path, text);
  r.commit('chore: scaffold, the spec and the base tests');
  const base = r.head();
  for (const [path, text] of Object.entries(branchFiles)) r.write(path, text);
  r.commit('test: the planted cases');
  const ciRoot = `${r.dir}-ci`;
  const res = runGate('tools/gates/red-check.mjs', ['--since', String(base)], { cwd: r.dir, env: { CHEQ_CI_ROOT: ciRoot } });
  return { r, res, base, ciRoot };
}

/** The install is a premise of red-check, not a step in it: without it, SKIP by name. */
function installable(ctx) {
  if (!havePremise(ctx, 'node_modules'))
    return `premise "node_modules" absent: ${ctx.premises.node_modules.rel} does not exist — ${ctx.premises.node_modules.cure}; red-check installs its base worktree from the store this tree filled`;
  return null;
}

/** The sentence red-check prints when the install itself refused — never a verdict about a test. */
const INSTALL_REFUSED = /the base worktree is not installed|pnpm install --frozen-lockfile exited|pnpm could not be spawned/;

// ───────────────────────────────────────────────────────────────── ready stubs

/**
 * A stub child of `ready.mjs` that writes the MACHINE SUMMARY ready reads and
 * exits with the code the probe asked for.
 *
 * Stubbing the children is the plan's own design for this group, and it is what
 * makes the orchestration probeable: `ready` decides a step's status from the
 * child's exit code and the child's `summary.json` and from nothing else, so a
 * child that disagrees with itself on purpose is the only way to see which of
 * the two wins.
 */
function runDirStub(label, { code = 0, verdict = 'pass', writeSummary = true } = {}) {
  return [
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "const stamp = new Date().toISOString().replace(/[:.]/g, '-');",
    `const dir = '.ci/runs/' + stamp + '-${label}';`,
    'mkdirSync(dir, { recursive: true });',
    `writeFileSync(dir + '/run.json', JSON.stringify({ argv: process.argv.slice(1), exitCode: ${String(code)}, head: null, treeClean: true, verdict: 'green' }, null, 2));`,
    writeSummary
      ? `writeFileSync(dir + '/summary.json', JSON.stringify({ gate: '${label}', verdict: '${verdict}', counts: { stub: 1 }, warnings: [], details: [] }, null, 2));`
      : "console.log('[stub] this child writes NO summary.json');",
    `console.log('[${label}-stub] argv: ' + process.argv.slice(2).join(' '));`,
    `process.exit(${String(code)});`,
    '',
  ].join('\n');
}

/** The one child that takes its summary PATH as a flag. */
function summaryFlagStub(name, { code = 0, verdict = 'pass' } = {}) {
  return [
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "import { dirname } from 'node:path';",
    'const argv = process.argv.slice(2);',
    "const i = argv.indexOf('--summary');",
    'if (i !== -1 && argv[i + 1] !== undefined) {',
    '  mkdirSync(dirname(argv[i + 1]), { recursive: true });',
    `  writeFileSync(argv[i + 1], JSON.stringify({ gate: '${name}', verdict: '${verdict}', counts: { stub: 1 }, warnings: [], details: [] }, null, 2));`,
    '}',
    `console.log('[${name}-stub] argv: ' + argv.join(' '));`,
    `process.exit(${String(code)});`,
    '',
  ].join('\n');
}

/** The lights pack writes no summary: its exit status IS its verdict, and ready says so. */
function lightsStub({ code = 0 } = {}) {
  return [
    "console.log('[lights-stub] argv: ' + process.argv.slice(2).join(' '));",
    "console.log('| id | severity | status | detail |');",
    "console.log('|---|---|---|---|');",
    "console.log('| L-tsc | hard | pass | a stub table, transcribed by ready |');",
    `process.exit(${String(code)});`,
    '',
  ].join('\n');
}

/** The `--quick` child set: three stubs, each green unless a probe says otherwise. */
function quickStubs({ lights = {}, specGateOpts = {}, testGuard = {} } = {}) {
  return {
    'tools/gates/lights/run.mjs': lightsStub(lights),
    'tools/gates/spec-gate.mjs': runDirStub('spec-gate', specGateOpts),
    'tools/gates/test-guard.mjs': summaryFlagStub('test-guard', testGuard),
  };
}

/** A fixture whose `tools/gates/` holds stubs only, plus a spec so the block has facts. */
function readyFixture(label, stubs) {
  const r = skeleton(label, { commit: false });
  r.write(SPEC_PATH, spec());
  for (const [path, text] of Object.entries(stubs)) r.write(path, text);
  r.commit('chore: scaffold, a spec and the stub children');
  return r;
}

const ready = (r, args) => runGate('tools/gates/ready.mjs', args, { cwd: r.dir });

// ───────────────────────────────────────────────────────── run.mjs literals

/**
 * One literal per forbidden shape. The regexes cannot be turned back into flags,
 * so the flags are written here — and the first probe asserts that EVERY entry
 * of `FORBIDDEN` is matched by one of them, so a shape added later fails this
 * file instead of going unprobed.
 */
const FORBIDDEN_LITERALS = Object.freeze([
  '--watch',
  '-w',
  '--passWithNoTests',
  '--passWithNoTests=true',
  '-u',
  '--update',
  '--bail',
  '--silent',
  '-t',
  '--testNamePattern',
  '--retry=2',
  '--reporter=json',
  '--outputFile=x.xml',
  '--outputFile.junit=x.xml',
  '--project=core',
  '--type-aware',
]);

// ───────────────────────────────────────────────────────────────────── probes

export const probes = [
  // ══════════════════════════════════════════════════════════ red-check (group 4)

  probe('red-check: a new test GREEN on the base fails the gate, naming the file AND the case — and a red sibling does not cover it', (ctx) => {
    const absent = installable(ctx);
    if (absent !== null) return skipped(absent);
    const planted = redCheck('rc-green', {
      branchFiles: { [`${CASE_DIR}/S1_names-itself.test.ts`]: GREEN_CASE, [`${CASE_DIR}/S2_due-window.test.ts`]: RED_CASE },
    });
    try {
      assertNotOut(planted.res, INSTALL_REFUSED, 'red-check over two planted files: the base worktree must install, or nothing below is about a test');
      assertStatus(planted.res, 1, 'a new test that passes on the base');
      assertOut(planted.res, /✗ GREEN ON BASE: packages\/core\/test\/CHQ-001\/S1_names-itself\.test\.ts/, 'the green file must be named');
      assertOut(planted.res, /"S1_names_itself > S1: the core package names itself"/, 'the green CASE must be named, not only its file');
      assertOut(planted.res, /✓ red on base: packages\/core\/test\/CHQ-001\/S2_due-window\.test\.ts/, 'the honest assertion failure in the same run must read red on base');
      assertOut(planted.res, /every case failed on an assertion/, 'an assertion failure is the strong red, and the gate says which kind it read');
    } finally {
      dropCi(planted.ciRoot);
      planted.r.cleanup();
    }
    return null;
  }),

  probe('red-check: the three measured crash signatures all read crash-red (weaker), never plain red', (ctx) => {
    const absent = installable(ctx);
    if (absent !== null) return skipped(absent);
    const planted = redCheck('rc-crash', {
      branchFiles: {
        [`${CASE_DIR}/S3_missing-export.test.ts`]: MISSING_EXPORT_CASE,
        [`${CASE_DIR}/S4_missing-name.test.ts`]: MISSING_NAME_CASE,
        [`${CASE_DIR}/S5_missing-module.test.ts`]: MISSING_MODULE_CASE,
      },
    });
    try {
      assertNotOut(planted.res, INSTALL_REFUSED, 'red-check over the three crash signatures: the base worktree must install first');
      assertOut(planted.res, /crash-red \(weaker[^)]*\): packages\/core\/test\/CHQ-001\/S3_missing-export\.test\.ts/, 'a TypeError from an absent export is crash-red, not red');
      assertOut(planted.res, /crash-red \(weaker[^)]*\): packages\/core\/test\/CHQ-001\/S4_missing-name\.test\.ts/, 'a ReferenceError from a name nobody wrote is the SECOND measured absence signature');
      assertOut(planted.res, /crash-red \(weaker[^)]*\): packages\/core\/test\/CHQ-001\/S5_missing-module\.test\.ts/, 'a module that is not written yet is crash-red');
      assertOut(planted.res, /not written yet|never loaded on the base/, 'the gate must say in words that it read an absence rather than an assertion');
      assertNotOut(planted.res, /✓ red on base: packages\/core\/test\/CHQ-001\/S[345]_/, 'none of the three may be promoted to the strong red: a crash cannot tell a vacuous case from a real one');
      // Weaker is still red, so the gate passes on these three alone.
      assertStatus(planted.res, 0, 'three crash-red files and nothing else');
    } finally {
      dropCi(planted.ciRoot);
      planted.r.cleanup();
    }
    return null;
  }),

  probe('red-check: a case that never ran, an uninstalled package import and a file with no case are CANNOT VERIFY, never red', (ctx) => {
    const absent = installable(ctx);
    if (absent !== null) return skipped(absent);
    const planted = redCheck('rc-cv', {
      branchFiles: {
        [`${CASE_DIR}/S6_todo.test.ts`]: TODO_CASE,
        [`${CASE_DIR}/S7_package-import.test.ts`]: PACKAGE_IMPORT_CASE,
        [`${CASE_DIR}/S8_no-case.test.ts`]: NO_CASE,
      },
    });
    try {
      assertNotOut(planted.res, INSTALL_REFUSED, 'red-check over three not-red shapes: the base worktree must install first');
      assertStatus(planted.res, 1, 'three files none of which was proven red');
      assertOut(planted.res, /S6_todo\.test\.ts.*(\.skip or \.todo|did not execute|skipped)/s, 'an `it.todo` is a case that never ran — CANNOT VERIFY, and never red');
      assertOut(planted.res, /S7_package-import\.test\.ts/, 'the package-import file must be named');
      assertOut(planted.res, /the worktree is not installed/, 'TS2307 naming a workspace PACKAGE is an unresolved install, not a missing symbol — an uninstalled base must never read as "the whole feature is pending"');
      assertOut(planted.res, /@cheq\/api/, 'the specifier that did not resolve must be named');
      assertOut(planted.res, /S8_no-case\.test\.ts/, 'the file that declares no case must be named');
      assertOut(planted.res, /failed to collect|No test suite found|tests="0"|no case/, 'a run that collected nothing is CANNOT VERIFY — never ran is not red');
      assertOut(planted.res, /CANNOT VERIFY/, 'the gate must print the CANNOT VERIFY block, which blocks exactly like a green');
    } finally {
      dropCi(planted.ciRoot);
      planted.r.cleanup();
    }
    return null;
  }),

  probe('red-check: a branch-added test/support helper that manufactures green is staged, printed, and still fails the gate', (ctx) => {
    const absent = installable(ctx);
    if (absent !== null) return skipped(absent);
    const planted = redCheck('rc-support', {
      branchFiles: {
        'packages/core/test/support/fake-truth.ts': SUPPORT_HELPER,
        [`${CASE_DIR}/S9_support-green.test.ts`]: SUPPORT_GREEN_CASE,
      },
    });
    try {
      assertNotOut(planted.res, INSTALL_REFUSED, 'red-check over a staged support helper: the base worktree must install first');
      assertStatus(planted.res, 1, 'a new test made green by a helper the same branch added');
      assertOut(planted.res, /staged for packages\/core\/test\/CHQ-001\/S9_support-green\.test\.ts: .*packages\/core\/test\/support\/fake-truth\.ts/, 'the staged list is printed on every run, and it must carry the branch-added helper');
      assertOut(planted.res, /✗ GREEN ON BASE: packages\/core\/test\/CHQ-001\/S9_support-green\.test\.ts/, 'a helper cannot launder a green: the file is still green on the base');
      assertOut(planted.res, /"S9_support_green > S9: the helper answers true"/, 'the case that passed must be named');
    } finally {
      dropCi(planted.ciRoot);
      planted.r.cleanup();
    }
    return null;
  }),

  probe('red-check: a new CASE in a modified test file, green on the base, fails by case name', (ctx) => {
    const absent = installable(ctx);
    if (absent !== null) return skipped(absent);
    const base = `${CASE_DIR}/S1_names-itself.test.ts`;
    const planted = redCheck('rc-modified', { baseFiles: { [base]: GREEN_CASE }, branchFiles: { [base]: GAINED_CASE } });
    try {
      assertNotOut(planted.res, INSTALL_REFUSED, 'red-check over a modified file: the base worktree must install first');
      assertStatus(planted.res, 1, 'a modified test file whose NEW case passes on the base');
      assertOut(planted.res, /1 modified file\(s\) with new case\(s\)|modified file/, 'the gate must say it judged a modified file per case');
      assertOut(planted.res, /new case\(s\) PASSED on the base/, 'the verdict is about the NEW case, not about the file as a whole');
      assertOut(planted.res, /"S1_names_itself > S1: and the name is scoped"/, 'the new case must be named — its old sibling being green on the base is its right');
      assertNotOut(planted.res, /"S1_names_itself > S1: the core package names itself" PASSED/, "the file's pre-existing case is not a violation and must not be reported as one");
    } finally {
      dropCi(planted.ciRoot);
      planted.r.cleanup();
    }
    return null;
  }),

  // ══════════════════════════════════════════════════════════ test-guard (group 5)

  probe('test-guard: an undeclared edit of an established test fails, and the same edit with a per-file trailer passes', () => {
    const file = `${CASE_DIR}/S1_names-itself.test.ts`;
    const undeclared = scratchRepo({ label: 'tg-undeclared' });
    undeclared.write(file, GREEN_CASE);
    undeclared.commit('test: the established case');
    const base = undeclared.head();
    undeclared.write(file, GREEN_CASE.replace('@cheq/core', '@cheq/ordering'));
    undeclared.commit('fix: the assertion was wrong');
    const bad = runGate('tools/gates/test-guard.mjs', ['--since', String(base)], { cwd: undeclared.dir });
    assertStatus(bad, 1, 'an established test rewritten with no declaration');
    assertOut(bad, /modified established spec-test packages\/core\/test\/CHQ-001\/S1_names-itself\.test\.ts/, 'the gate must name the file and the form it classified it as');
    assertOut(bad, /spec-conflict: <file> — <why/, 'the refusal must print the declaration the author owes');
    undeclared.cleanup();

    const declared = scratchRepo({ label: 'tg-declared' });
    declared.write(file, GREEN_CASE);
    declared.commit('test: the established case');
    const base2 = declared.head();
    declared.write(file, GREEN_CASE.replace('@cheq/core', '@cheq/ordering'));
    declared.commit(`fix: the assertion was wrong\n\nspec-conflict: ${file} — the base asserted the old package name`);
    const good = runGate('tools/gates/test-guard.mjs', ['--since', String(base2)], { cwd: declared.dir });
    assertStatus(good, 0, 'the same edit, declared per file at column zero');
    assertOut(good, /every guarded change is declared per file/, 'the green path must say how the change was waived');
    declared.cleanup();
  }),

  probe('test-guard: a trailer naming ANOTHER file waives nothing, and a mid-sentence mention is a named near-miss', () => {
    const file = `${CASE_DIR}/S1_names-itself.test.ts`;
    const r = scratchRepo({ label: 'tg-wrong-file' });
    r.write(file, GREEN_CASE);
    r.write(`${CASE_DIR}/S2_due-window.test.ts`, RED_CASE);
    r.commit('test: two established cases');
    const base = r.head();
    r.write(file, GREEN_CASE.replace('@cheq/core', '@cheq/ordering'));
    r.commit(`fix: the assertion was wrong\n\nspec-change: ${CASE_DIR}/S2_due-window.test.ts — the other file entirely`);
    const res = runGate('tools/gates/test-guard.mjs', ['--since', String(base)], { cwd: r.dir });
    assertStatus(res, 1, 'a declaration that names a file this commit did not touch');
    assertOut(res, /S1_names-itself\.test\.ts/, 'the violated file must still be named');
    assertOut(res, /matches none of the|waives nothing/, 'the trailer that matched nothing must be printed, on the red path as well as the green one');
    r.cleanup();

    const prose = scratchRepo({ label: 'tg-mention' });
    prose.write(file, GREEN_CASE);
    prose.commit('test: the established case');
    const base2 = prose.head();
    prose.write(file, GREEN_CASE.replace('@cheq/core', '@cheq/ordering'));
    prose.commit(`fix: the assertion was wrong\n\nI would write spec-conflict: ${file} — but this is a sentence, not a declaration.`);
    const res2 = runGate('tools/gates/test-guard.mjs', ['--since', String(base2)], { cwd: prose.dir });
    assertStatus(res2, 1, 'the same words inside a sentence');
    assertOut(res2, /is not a declaration/, 'the near-miss must be NAMED, so "I declared it" and "the gate read it" cannot diverge in silence');
    assertOut(res2, /BEGIN its own line/, 'the note must say what the form is');
    prose.cleanup();
  }),

  probe('test-guard: a CR-terminated trailer still declares — the one form that needs --cleanup=verbatim', () => {
    const file = `${CASE_DIR}/S1_names-itself.test.ts`;
    const r = scratchRepo({ label: 'tg-crlf' });
    r.write(file, GREEN_CASE);
    r.commit('test: the established case');
    const base = r.head();
    r.write(file, GREEN_CASE.replace('@cheq/core', '@cheq/ordering'));
    r.commit(`fix: the assertion was wrong\r\n\r\nspec-conflict: ${file} — written on a CRLF machine\r\n`, { verbatim: true });
    const body = r.git(['log', '-1', '--format=%B']).stdout;
    assert(body.includes('CRLF machine\r'), `the fixture must actually carry the CR, or this probe is about nothing: ${JSON.stringify(body)}`);
    const res = runGate('tools/gates/test-guard.mjs', ['--since', String(base)], { cwd: r.dir });
    assertStatus(res, 0, 'a declaration whose line ends in CR');
    assertOut(res, /every guarded change is declared per file/, 'a CR at the end of the line must not cost the author the declaration');
    r.cleanup();
  }),

  probe('test-guard: a token matching TWO violated files is an error, not a waiver for both', () => {
    const r = scratchRepo({ label: 'tg-ambiguous' });
    const core = `${CASE_DIR}/S1_names-itself.test.ts`;
    const api = 'apps/api/test/CHQ-001/S1_names-itself.test.ts';
    r.write(core, GREEN_CASE);
    r.write(api, GREEN_CASE);
    r.commit('test: the same case name in two packages');
    const base = r.head();
    r.write(core, GREEN_CASE.replace('@cheq/core', '@cheq/ordering'));
    r.write(api, GREEN_CASE.replace('@cheq/core', '@cheq/ordering'));
    r.commit('fix: both assertions were wrong\n\nspec-conflict: S1_names-itself.test.ts — one token for two files');
    const res = runGate('tools/gates/test-guard.mjs', ['--since', String(base)], { cwd: r.dir });
    assertStatus(res, 1, 'a basename token that matches a test in two packages');
    assertOut(res, /matches 2 changed files/, 'the gate must count the files the token hit');
    assertOut(res, /write the repo-relative path of the ONE file it is about/, 'the cure must be printed');
    assertOut(res, /An ambiguous token waives nothing/, 'an ambiguous token must not amnesty either file');
    r.cleanup();
  }),

  probe('test-guard: a rewritten snapshot and a deleted snapshot are each a violation of their own', () => {
    const r = scratchRepo({ label: 'tg-snapshots' });
    const kept = 'apps/web/test/CHQ-001/__snapshots__/S1_screen.test.tsx.snap';
    const gone = 'apps/web/test/CHQ-001/__snapshots__/S2_screen.test.tsx.snap';
    r.write(kept, "exports['S1_screen > renders 1'] = `<div />`;\n");
    r.write(gone, "exports['S2_screen > renders 1'] = `<span />`;\n");
    r.commit('test: two established snapshots');
    const base = r.head();
    r.write(kept, "exports['S1_screen > renders 1'] = `<div class=\"new\" />`;\n");
    r.rm(gone);
    r.commit('chore: refresh the snapshots');
    const res = runGate('tools/gates/test-guard.mjs', ['--since', String(base)], { cwd: r.dir });
    assertStatus(res, 1, 'a snapshot rewritten by the tool and another deleted');
    assertOut(res, /rewritten snapshot apps\/web\/test\/CHQ-001\/__snapshots__\/S1_screen\.test\.tsx\.snap/, '`vitest -u` replaces the ASSERTION, so a rewritten snapshot is a guarded change');
    assertOut(res, /replaced the assertion, not the code/, 'the message must say why a snapshot counts as a test');
    assertOut(res, /deleted snapshot apps\/web\/test\/CHQ-001\/__snapshots__\/S2_screen\.test\.tsx\.snap/, 'a deleted snapshot is its own violation, not the same one twice');
    r.cleanup();
  }),

  probe('test-guard: a commit touching only docs/specs and its own new test is NOT mixed — isImpl is positive', () => {
    const r = scratchRepo({ label: 'tg-isimpl' });
    const file = `${CASE_DIR}/S1_names-itself.test.ts`;
    r.write('packages/core/src/index.ts', "export const CORE_PACKAGE = '@cheq/core';\n");
    r.commit('chore: scaffold');
    const base = r.head();
    r.write(file, GREEN_CASE);
    r.commit('test: CHQ-001 S1 red first');
    r.write(SPEC_PATH, spec());
    r.write('pnpm-lock.yaml', 'lockfileVersion: 9.0\n');
    r.write(file, GREEN_CASE.replace('S1: the core', 'S1: the very core'));
    r.commit('docs(spec): CHQ-001 revision 2, and the case title with it');
    const res = runGate('tools/gates/test-guard.mjs', ['--since', String(base)], { cwd: r.dir });
    assertStatus(res, 0, 'a commit that edits a branch-added test beside docs/specs and the lockfile, and NO src/');
    assertOut(res, /no change to an established or branch-added guarded file ✓|every guarded change is declared/, 'a negative isImpl would read docs/specs and pnpm-lock.yaml as implementation and call this commit mixed');
    assertNotOut(res, /mixed commit/, 'nothing under packages|apps */src/* was touched, so there is no mixed commit to report');
    r.cleanup();
  }),

  // ══════════════════════════════════════════════════════════ spec-gate (group 6)

  probe('spec-gate: an open question blocks the TEST phase and only warns while no test is touched', () => {
    const r = specFixture('sg-open', spec({ openQuestions: '- Q1: does an overdue task stay overdue after it is completed?' }), {
      commit: 'docs(spec): CHQ-001 with one open question',
    });
    const drafting = specGate(r);
    assertStatus(drafting, 0, 'an open question and no test file in range');
    assertOut(drafting, /WARNING .*open question\(s\) and no test file was touched — spec drafting may continue/, 'spec drafting must be allowed to continue, loudly');

    r.write(`${CASE_DIR}/S1_names-itself.test.ts`, GREEN_CASE);
    r.commit('test: CHQ-001 S1');
    const phase = specGate(r);
    assertStatus(phase, 1, 'the same open question once a test file is added');
    assertOut(phase, /the test phase is blocked until each is answered/, 'the gate must say which phase it blocked and why');
    assertOut(phase, /Q1/, 'the question that blocks must be named');
    r.cleanup();
  }),

  probe('spec-gate: an ABSENT `## Open questions` is CANNOT VERIFY and a DUPLICATE heading is unparsable — an absent section is not an empty one', () => {
    const missing = specFixture('sg-missing', spec({ openQuestions: null }));
    const res = specGate(missing);
    assertStatus(res, 1, 'a spec with no `## Open questions` section at all');
    assertOut(res, /CANNOT VERIFY/, 'a section nobody wrote is not an empty list: fail closed');
    assertOut(res, /`## Open questions` is absent — an absent section is not an empty one/, 'the finding must name the section and the rule');
    missing.cleanup();

    const dup = specFixture('sg-duplicate', spec({ tail: '## Open questions\n\n- Q9: pasted into the appendix\n' }));
    const res2 = specGate(dup);
    assertStatus(res2, 1, 'a second `## Open questions` heading pasted into the appendix');
    assertOut(res2, /duplicate section/, 'a duplicate heading is named, never silently merged or preferred');
    dup.cleanup();
  }),

  probe('spec-gate: a spec with no live assertion contracts nothing, and an uncovered Vision § is a silent absence', () => {
    const empty = specFixture('sg-no-live', spec({ assertions: '- ~~S1~~ withdrawn: the vision turned out to be a question', acMap: AC_BOTH.replace('| S1 |', '| — |').replace('@cheq/core |', 'deferred: TD-0001 |') }));
    const res = specGate(empty);
    assertStatus(res, 1, 'a spec whose only assertion is withdrawn');
    assertOut(res, /a spec with no live assertion contracts nothing/, 'the gate must refuse a spec that promises nothing');
    empty.cleanup();

    const uncovered = specFixture(
      'sg-uncovered',
      spec({
        acMap: ['| Vision § | Assertions | Planned home | Notes |', '|---|---|---|---|', '| §1 A task carries a due date. | S1 | @cheq/core | |'].join('\n'),
      }),
    );
    const res2 = specGate(uncovered);
    assertStatus(res2, 1, 'an AC map that leaves the second Vision sentence out');
    assertOut(res2, /no row names §2/, 'the uncovered § must be named by number');
    assertOut(res2, /no silent absences/, 'the rule must be quoted, because it is the most expensive one to lose');
    uncovered.cleanup();
  }),

  probe('spec-gate: a Yn is quoted from the Vision or it fails, and a Yn filed as a question fails too', () => {
    const reworded = specFixture('sg-syrup', spec({ syrup: '- **Y1** "the overdue list should feel immediate" · carrier: screen' }));
    const res = specGate(reworded);
    assertStatus(res, 1, 'a Yn nobody can find in the Vision');
    assertOut(res, /Y1: /, 'the syrup item must be named');
    assertOut(res, /a Yn is quoted from `## Vision \(verbatim\)`, never written/, 'the rule must be printed with the cure');
    reworded.cleanup();

    const quoted = specFixture('sg-syrup-ok', spec({ syrup: '- **Y1** "The list shows the overdue ones first." · carrier: screen' }));
    const ok = specGate(quoted);
    assertStatus(ok, 0, 'a Yn copied from the Vision character for character');
    assertOut(ok, /✓ 1 spec\(s\) checked/, 'a verbatim Yn must cost nothing');
    quoted.cleanup();

    const misfiled = specFixture('sg-syrup-question', spec({ openQuestions: '- **Y1** "The list shows the overdue ones first." · carrier: screen' }));
    const bad = specGate(misfiled);
    assertStatus(bad, 1, 'a Yn filed under `## Open questions`');
    assertOut(bad, /Y1|Yn/, 'the misfiled item must be named');
    misfiled.cleanup();
  }),

  probe('spec-gate: `blocked: Q1` is checked PER QUESTION — an answered Q1 beside an open Q2 is still a park on nothing', () => {
    const r = specFixture(
      'sg-blocked',
      spec({
        openQuestions: '- Q2: which timezone decides "today"?',
        answered: '- Q1: does completing a task clear it from the overdue list? → yes (owner, 2026-01-01): the list is about work left',
        acMap: [
          '| Vision § | Assertions | Planned home | Notes |',
          '|---|---|---|---|',
          '| §1 A task carries a due date. | S1 | @cheq/core | |',
          '| §2 The list shows the overdue ones first. | — | blocked: Q1 | |',
        ].join('\n'),
      }),
    );
    const res = specGate(r);
    assertStatus(res, 1, 'a row parked on Q1 while Q1 is answered and Q2 is open');
    assertOut(res, /parked on Q1, which is not open any more \(open: Q2\)/, 'the per-question check must name both the dead park and the live question');
    assertOut(res, /re-home this row now that it has an answer/, 'the cure must be printed');
    r.cleanup();
  }),

  probe('spec-gate: a hand-typed `verify:` fails and the message prints the value to write', () => {
    const r = specFixture('sg-verify', spec({ assertions: S1.replace('verify: tsc-noemit + vitest-core', 'verify: vitest 5.0.5 (core)') }));
    const res = specGate(r);
    assertStatus(res, 1, 'a `verify:` typed by hand, with a version in it');
    assertOut(res, /S1: /, 'the assertion must be named');
    assertOut(res, /tsc-noemit \+ vitest-core/, 'the message must print the derived value the author should write');
    r.cleanup();
  }),

  probe('spec-gate --require-approved: an absent, an indented and a foreign-id trailer approve nothing; a later one approves; an edit after it is stale', () => {
    const r = skeleton('sg-approval');
    r.write(SPEC_PATH, spec({ assertions: s1(CHECK_PATH) }));
    r.write(CHECK_PATH, GREEN_CASE);
    r.commit('docs(spec): CHQ-001 and the file its check: names');
    const unapproved = specGate(r, ['--require-approved', 'CHQ-001']);
    assertStatus(unapproved, 1, 'no approval trailer anywhere in history');
    assertOut(unapproved, /is not approved — a trailer inside prose, quoted or indented, is not one/, 'the refusal must say what does NOT count');
    assertOut(unapproved, /git commit --allow-empty/, 'the refusal must print the command that signs it');

    r.commit('docs(spec): CHQ-001 approved\n\n  spec-approved: CHQ-001 owner 2026-01-02');
    const indented = specGate(r, ['--require-approved', 'CHQ-001']);
    assertStatus(indented, 1, 'an approval trailer indented by two spaces');
    assertOut(indented, /is not approved/, 'a trailer that does not begin its line declares nothing');

    r.commit('docs(spec): CHQ-002 approved\n\nspec-approved: CHQ-002 owner 2026-01-03');
    const otherId = specGate(r, ['--require-approved', 'CHQ-001']);
    assertStatus(otherId, 1, 'a trailer that signs ANOTHER spec id');
    assertOut(otherId, /is not approved/, "CHQ-002's signature must not approve CHQ-001");

    r.commit('docs(spec): CHQ-001 approved\n\nspec-approved: CHQ-001 owner 2026-01-04');
    const approved = specGate(r, ['--require-approved', 'CHQ-001']);
    assertStatus(approved, 0, 'a trailer at column zero of a commit after the spec’s last content change');
    assertOut(approved, /CHQ-001 is approved by owner on 2026-01-04/, 'the approval must be reported with who and when');

    r.write(
      SPEC_PATH,
      spec({
        assertions: s1(CHECK_PATH),
        revision: '2 — one more sentence of premise',
        premise: '- the repository has no task model yet (packages/core/src/index.ts:1)\n- and no ordering either',
      }),
    );
    r.commit('docs(spec): CHQ-001 revision 2');
    const stale = specGate(r, ['--require-approved', 'CHQ-001']);
    assertStatus(stale, 1, 'an edit landed after the approval');
    assertOut(stale, /STALE APPROVAL: CHQ-001 was approved by owner on 2026-01-04 \([0-9a-f]{7,}\), and the spec changed 1 time\(s\) after that/, 'the gate must say the approval went stale, by whom it was given and which commit broke it');
    assertOut(stale, /re-sign the text as it stands: git commit --allow-empty/, 'the cure must be a command the author can run');
    r.cleanup();
  }),

  probe('spec-gate --require-approved: a trailer in the SAME commit as the spec edit does not approve it — rule 14 says AFTER', () => {
    const r = skeleton('sg-selfsign');
    r.write(SPEC_PATH, spec({ assertions: s1(CHECK_PATH) }));
    r.write(CHECK_PATH, GREEN_CASE);
    r.commit('docs(spec): CHQ-001 and the file its check: names');
    // The spec's last content change and its signature in ONE commit: the author
    // signs text nobody had read, which is the same self-approval the in-file
    // `spec-approved:` check refuses a few lines away in this gate.
    r.write(SPEC_PATH, spec({ assertions: s1(CHECK_PATH), revision: '2 — signed in the same breath' }));
    r.commit('docs(spec): CHQ-001 revision 2, approved\n\nspec-approved: CHQ-001 owner 2026-01-03');
    const res = specGate(r, ['--require-approved', 'CHQ-001']);
    assertStatus(
      res,
      1,
      'a `spec-approved:` trailer on the very commit that changed the spec. AGENTS.md:432-434 (rule 14) reads ' +
        '"beginning a line of a commit AFTER the spec\'s last content change — nothing else", and a commit is not after ' +
        'itself. The cause is in tools/gates/spec-gate.mjs:487-491: `editedAfter` is `commitsTouching(spec, ' +
        '"<approvalCommit>..HEAD")`, a range that EXCLUDES the approval commit, so a content change inside it is invisible ' +
        'and `approvalStatus` sees nothing stale. Cure: take the range from `<approvalCommit>^..HEAD`, or ask separately ' +
        'whether the approval commit itself touched the spec path. This probe is the defect, not the fixture: a self-signed ' +
        'spec is exactly what the trailer rule exists to prevent, and the gate reports it as approved',
    );
    assertOut(res, /STALE APPROVAL|is not approved/, 'the refusal must name the approval as stale or absent rather than report the spec as approved');
    r.cleanup();
  }),

  probe('spec-gate: once approved, a reworded live S fails — ids and their text are append-only', () => {
    const r = skeleton('sg-appendonly');
    r.write(SPEC_PATH, spec({ assertions: s1(CHECK_PATH) }));
    r.write(CHECK_PATH, GREEN_CASE);
    r.commit('docs(spec): CHQ-001 and the file its check: names');
    r.commit('docs(spec): CHQ-001 approved\n\nspec-approved: CHQ-001 owner 2026-01-02');
    const base = specGate(r, ['--require-approved', 'CHQ-001']);
    assertStatus(base, 0, 'the approved spec as it stands');
    assertOut(base, /is approved by owner/, 'the baseline of this probe must really be an approved spec');

    r.write(SPEC_PATH, spec({ assertions: s1(CHECK_PATH).replace('comes first', 'comes last') }));
    r.commit('docs(spec): CHQ-001 S1, reworded');
    const reworded = specGate(r, ['--require-approved', 'CHQ-001']);
    assertStatus(reworded, 1, 'the text of a live S changed after approval');
    assertOut(reworded, /S1 was reworded after approval/, 'the gate must name the assertion and the fact');
    assertOut(reworded, /bump `Revision:`, re-sign/, 'the cure must be printed');
    r.cleanup();
  }),

  probe('spec-gate: the SPEC template itself parses with EXACTLY ONE complaint, and it is the missing id', () => {
    const path = join(REPO_ROOT, 'docs/templates/SPEC.md');
    assert(existsSync(path), `docs/templates/SPEC.md does not exist — the template is what every spec is copied from, and this probe is the only thing that keeps it parsable`);
    const text = readFileSync(path, 'utf8');
    const parsed = parseSpec(text, { path: 'docs/templates/SPEC.md' });
    const complaints = parsed.unparsable.map((u) => `${String(u.line)}: ${u.text}`).toSorted(byCodepoint);
    assert(
      complaints.length === 1,
      `the template must yield exactly one unparsable entry — the deliberate CHQ-XXX placeholder — and it yielded ${complaints.length}:\n  ${complaints.join('\n  ') || '(none)'}`,
    );
    assert(
      /the SPEC heading names no CHQ-nnn id/.test(complaints[0]),
      `the one complaint must be the missing id (the template says so in a comment above its own heading); it was: ${complaints[0]}`,
    );
    assert(
      text.includes('EXACTLY ONE unparsable entry'),
      'the template must keep DECLARING this property beside its placeholder heading — a probe that asserts a property nobody wrote down is a probe about an accident',
    );
    // The other half of the drift check: the standing ids in the template and in
    // the registry are the same SET. Not the same order — `parseLights` reads the
    // table by id and spec-gate compares sets, so the template is free to group
    // the rows for a reader, and a probe that demanded one order would fail on a
    // tree where nothing is wrong.
    const inTemplate = [...text.matchAll(/^\| (L-[a-z-]+) \|/gm)].map((m) => m[1]).toSorted(byCodepoint);
    const registry = STANDING_LIGHTS.map((l) => l.id).toSorted(byCodepoint);
    assert(
      inTemplate.join(',') === registry.join(','),
      `docs/templates/SPEC.md ## Lights and STANDING_LIGHTS have drifted — every spec is copied from that table, so a missing row is a spec that fails for a reason nobody wrote.\n  template: ${inTemplate.join(', ')}\n  registry: ${registry.join(', ')}`,
    );
  }),

  // ══════════════════════════════════════════════════════════ run.mjs (groups 11–12)

  probe('run.mjs: every FORBIDDEN flag is REFUSED with its reason, and every entry of the list has a literal here', () => {
    const uncovered = FORBIDDEN.filter((f) => !FORBIDDEN_LITERALS.some((lit) => f.re.test(lit)));
    assert(
      uncovered.length === 0,
      `${uncovered.length} forbidden shape(s) have no literal in FORBIDDEN_LITERALS, so nothing probes them: ${uncovered.map((f) => String(f.re)).join(', ')} — add a flag that matches each`,
    );
    const refusals = FORBIDDEN_LITERALS.map((flag) => ({
      flag,
      res: runGate('tools/gates/run.mjs', ['test', '--kind', 'core', '--label', 'probe-forbidden', flag]),
    }));
    const wrongStatus = refusals.filter((x) => x.res.status !== 2);
    assert(
      wrongStatus.length === 0,
      `a forbidden flag must be REFUSED with exit 2 (cannot-verify); these exited otherwise: ${wrongStatus
        .map((x) => `${x.flag} → ${String(x.res.status)}: ${x.res.out.split('\n')[0]}`)
        .join(' | ')}`,
    );
    const silent = refusals.filter((x) => !new RegExp(`REFUSED: ${x.flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is refused: \\S`).test(x.res.out));
    assert(
      silent.length === 0,
      `each refusal must name the flag AND the reason it would break the run; these did not: ${silent.map((x) => `${x.flag} → ${JSON.stringify(x.res.out.slice(0, 160))}`).join(' | ')}`,
    );
    const verdicts = refusals.filter((x) => !/VERDICT=cannot-verify/.test(x.res.out));
    assert(
      verdicts.length === 0,
      `a refusal prints the machine line too — a run that printed no verdict reads as a crash, not a refusal; these did not: ${verdicts.map((x) => x.flag).join(', ')}`,
    );
  }),

  probe('run.mjs: the builders carry both DOTTED outputFile forms, the pinned flags, and the mixed form nowhere', () => {
    const argv = vitestArgv('core', { junit: '/abs/core.junit.xml', json: '/abs/core.json', filter: null });
    const joined = argv.join(' ');
    for (const needed of ['--outputFile.junit=/abs/core.junit.xml', '--outputFile.json=/abs/core.json', '--passWithNoTests=false', '--retry=0', '--no-file-parallelism', '--project']) {
      assert(argv.includes(needed) || joined.includes(needed), `vitestArgv must carry ${needed}; it built: ${joined}`);
    }
    assert(argv[argv.indexOf('--project') + 1] === 'core', `--project must be followed by the kind, so a spec of another kind cannot run under this label; it built: ${joined}`);
    assert(
      !/--outputFile=/.test(joined),
      `the MIXED form --outputFile= crashes vitest 5.0.5 before any test runs and writes no artefact (measured), so it must appear in no argv; vitestArgv built: ${joined}`,
    );
    const filtered = vitestArgv('core', { junit: '/a', json: '/b', filter: '^S1_' }).join(' ');
    assert(/--testNamePattern=\^S1_/.test(filtered), `--filter must reach the runner as its own name pattern (the count is reconciled afterwards); it built: ${filtered}`);
    const types = typesArgv('core').join(' ');
    assert(/--listFiles/.test(types) && /-p packages\/core\/tsconfig\.json/.test(types), `typesArgv must ask for --listFiles — zero diagnostics with zero inputs is CANNOT VERIFY, not green; it built: ${types}`);
    assert(lintArgv().includes('--type-aware'), `lintArgv must pass --type-aware: without it the type rules do not run and nothing says so (measured); it built: ${lintArgv().join(' ')}`);
    assert(/--reporter=junit/.test(e2eArgv().join(' ')), `e2eArgv must name a reporter; it built: ${e2eArgv().join(' ')}`);

    // And the same claim about the SOURCE, over code with comments and strings
    // masked: the mixed form is documented in this file's header on purpose, and
    // a token scan is the only way to tell that occurrence from a live one.
    const src = codeOnly(readFileSync(join(REPO_ROOT, 'tools/gates/run.mjs'), 'utf8'));
    assert(
      !src.includes('--outputFile='),
      'tools/gates/run.mjs carries the mixed --outputFile= form in CODE (not in a comment or a string) — it writes no artefact',
    );
  }),

  probe('run.mjs: a dirty tracked tree and a HEAD that is not --expect-head are both REFUSED, each naming what it found', () => {
    const r = skeleton('run-refuse');
    const head = r.head();
    const mismatch = runGate('tools/gates/run.mjs', ['test', '--kind', 'core', '--label', 'probe-head', '--expect-head', 'abcdef1'], { cwd: r.dir });
    if (/live watcher/.test(mismatch.out)) {
      r.cleanup();
      return skipped('a live vitest/vite/tsc --watch process on this machine makes run.mjs refuse before it reaches the checks this probe is about');
    }
    assertStatus(mismatch, 2, 'a --expect-head that is not the checked-out commit');
    assertOut(mismatch, /REFUSED: HEAD is [0-9a-f]{7}, --expect-head asked for abcdef1/, 'the refusal must print BOTH shas: "HEAD does not resolve" is a different fact from "HEAD is not the one asked for"');
    assertOut(mismatch, /VERDICT=cannot-verify head=[0-9a-f]{7}/, 'the machine line must carry the resolved head, not `none`');

    // The positive control for the pin, and it needs no install: with the head it
    // asked for, the run gets PAST `--expect-head` and refuses later, for another
    // named reason. Without this half the probe cannot tell a pin that works from
    // a wrapper that refuses everything.
    const ok = runGate('tools/gates/run.mjs', ['test', '--kind', 'core', '--label', 'probe-head', '--expect-head', String(head).slice(0, 7)], { cwd: r.dir });
    assertNotOut(ok, /--expect-head asked for/, 'the head it asked for is the head that is checked out, so the pin must let the run through');
    assertOut(ok, /REFUSED|dir=/, `the run must get past the pin and then say what it did next (exit ${String(ok.status)})`);

    r.write('packages/core/src/index.ts', "export const CORE_PACKAGE = '@cheq/ordering' as const;\n");
    const dirty = runGate('tools/gates/run.mjs', ['test', '--kind', 'core', '--label', 'probe-dirty'], { cwd: r.dir });
    assertStatus(dirty, 2, 'one tracked file modified under packages/');
    assertOut(dirty, /REFUSED: 1 tracked file\(s\) modified under packages\|apps\|e2e\|tools \(packages\/core\/src\/index\.ts\)/, 'the refusal must name the paths it found');
    assertOut(dirty, /the artefact would describe a tree no commit contains/, 'the refusal must say why a dirty tree is not a run of record');
    assertOut(dirty, /untracked files are not dirt/, 'the cure must keep planted fixtures legal — that is how the gates are probed');
    r.cleanup();
    return null;
  }),

  probe('run.mjs: the e2e lane without browser_probe is CANNOT VERIFY and exits 2, never 0', () => {
    const r = skeleton('run-e2e');
    const res = runGate('tools/gates/run.mjs', ['e2e', '--label', 'probe-e2e'], { cwd: r.dir });
    if (/live watcher/.test(res.out)) {
      r.cleanup();
      return skipped('a live watcher on this machine makes run.mjs refuse before it reaches the browser premise');
    }
    assertStatus(res, 2, 'the e2e lane with no .ci/probe.json');
    assertNotOut(res, /VERDICT=green/, 'a lane that never ran must never read green');
    assertOut(res, /CANNOT VERIFY \(playwright browsers not installed/, 'the lane must name the absent premise');
    assertOut(res, /VERDICT=cannot-verify/, 'the machine line must say cannot-verify, and the exit code must be 2 rather than 0');
    assertOut(res, /argv that WOULD run:/, 'the refusal must print the argv it did not spawn, because that argv has never been observed here (TD-0001)');
    r.cleanup();
    return null;
  }),

  // ══════════════════════════════════════════════════════════ status.mjs (group 13)

  probe('status.mjs: it answers before the first commit and says GIT_HEAD=none', () => {
    const r = scratchRepo({ label: 'st-nohead' });
    const lines = statusReport({ root: r.dir });
    const head = lines.find((l) => l.startsWith('GIT_HEAD='));
    assert(head !== undefined, `status printed no GIT_HEAD line on a repository with no commits; it printed:\n  ${lines.join('\n  ')}`);
    assert(
      head.startsWith('GIT_HEAD=none (HEAD does not resolve'),
      `GIT_HEAD must be \`none\` with the reason on a repository with no commits; it said: ${head}`,
    );
    assert(
      lines.length > 5,
      `the rest of the pre-flight must still report — a pre-flight that dies on the first absence tells you nothing about the others; it printed ${lines.length} line(s)`,
    );
    const lock = lines.find((l) => l.startsWith('LOCKFILE_CLEAN='));
    assert(
      lock !== undefined && /cannot-verify \(no commit in the repository/.test(lock),
      `with no commit there is no committed lock to compare, and that is cannot-verify rather than true; it said: ${String(lock)}`,
    );
    r.cleanup();
  }),

  probe('status.mjs: LOCKFILE_CLEAN goes red on a manifest that has drifted from the lock — the measured shape of this repository’s own breakage', () => {
    const r = skeleton('st-lock', { commit: false });
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    const declared = Object.keys(manifest.devDependencies ?? {});
    assert(declared.length > 0, 'this repository’s root package.json declares no devDependencies, so there is nothing for this probe to drop');
    delete manifest.devDependencies;
    r.write('package.json', `${JSON.stringify(manifest, null, 2)}\n`);
    r.commit('chore: scaffold with a root manifest that lost its devDependencies');

    const lines = statusReport({ root: r.dir });
    const lock = lines.find((l) => l.startsWith('LOCKFILE_CLEAN='));
    assert(lock !== undefined, `status printed no LOCKFILE_CLEAN line; it printed:\n  ${lines.join('\n  ')}`);
    assert(lock.startsWith('LOCKFILE_CLEAN=false ('), `a manifest with no devDependencies against a lock that lists ${declared.length} must read false; it said: ${lock}`);
    assert(
      new RegExp(`the lock's "\\." importer lists (${declared.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})@`).test(lock),
      `the line must name a dependency the lock has and the manifest does not — that is what makes it actionable; it said: ${lock}`,
    );
    assert(/ERR_PNPM_OUTDATED_LOCKFILE/.test(lock), `the line must say what breaks: --frozen-lockfile is the CI default and refuses on this; it said: ${lock}`);
    r.cleanup();
  }),

  probe('status.mjs: INSTALLED_LOCK catches a node_modules installed from a DIFFERENT lock than HEAD carries', (ctx) => {
    if (!havePremise(ctx, 'node_modules')) return skipped(`premise "node_modules" absent: ${ctx.premises.node_modules.rel} does not exist — ${ctx.premises.node_modules.cure}`);
    const r = skeleton('st-installed', { commit: false });
    // The lock this HEAD carries is not the lock the linked tree installed from:
    // one extra comment line is enough, because the comparison is a sha256 and
    // pnpm's own copy of what it installed from is the only evidence on disk.
    r.write('pnpm-lock.yaml', `# this HEAD carries a lock nobody installed from\n${readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8')}`);
    r.commit('chore: scaffold with an edited lock');
    linkNodeModules(r);

    const lines = statusReport({ root: r.dir });
    const installed = lines.find((l) => l.startsWith('INSTALLED_LOCK='));
    assert(installed !== undefined, `status printed no INSTALLED_LOCK line; it printed:\n  ${lines.join('\n  ')}`);
    assert(installed.startsWith('INSTALLED_LOCK=differs ('), `a tree installed from another lock must read \`differs\`; it said: ${installed}`);
    assert(
      /node_modules\/\.pnpm\/lock\.yaml is [0-9a-f]{12}/.test(installed) && /git show HEAD:pnpm-lock\.yaml is [0-9a-f]{12}/.test(installed),
      `the line must print BOTH digests, or nobody can tell which side moved; it said: ${installed}`,
    );
    assert(
      /Lockfile is up to date, resolution step is skipped/.test(installed),
      `the line must quote the measured answer that makes a successful install insufficient; it said: ${installed}`,
    );
    r.cleanup();
    return null;
  }),

  // ══════════════════════════════════════════════════════════ ready.mjs (groups 8–9, 11)

  probe('ready --quick: red-check and the runs of record are NOT RUN, and the header is READY when every child is', () => {
    const r = readyFixture('rd-quick', quickStubs());
    const res = ready(r, ['--quick']);
    assertStatus(res, 0, 'the --quick path with three green children');
    assertOut(res, /^READY$/m, 'the header is an AND over the children, and every child passed');
    assertOut(res, /red-check: not run in --quick \(red-check never runs in a hook/, 'the hook path must say red-check did not run, and why');
    assertOut(res, /tests of record: not run in --quick/, 'the runs of record must be named as not run rather than left out');
    assertOut(res, /not in the AND: red-check \(not run\), tests of record \(not run\)/, 'a step nothing promised must not read as a step that passed');
    assertOut(res, /mode: --quick \(the pre-commit path\)/, 'the block must say which path produced it');
    assertOut(res, new RegExp(`argv: tools/gates/lights/run\\.mjs --fast .*${TOLERANCE_FLAG}`), 'the tolerance must be visible in the argv the lights child was handed — a claim a reader can check against the run');
    r.cleanup();
  }),

  probe('ready: a child that exits non-zero is FAILED even when its own summary says pass — fail-closed, one-directional', () => {
    const r = readyFixture('rd-failclosed', quickStubs({ testGuard: { code: 1, verdict: 'pass' } }));
    const res = ready(r, ['--quick']);
    assertStatus(res, 1, 'a child that exits 1 while its summary claims to have passed');
    assertOut(res, /^NOT READY$/m, 'one failed blocking step must turn the header');
    assertOut(res, /test-guard: FAILED/, 'the step must be named with its status');
    assertOut(res, /exit 1/, 'the exit code the child actually produced must be reported');
    assertOut(res, /verdict=pass/, 'the summary must be READ — a header that ignored it would prove nothing about which of the two wins');
    assertOut(res, /1 of \d+ blocking step\(s\) are not PASSED/, 'the block must count the steps that turned the header');
    r.cleanup();
  }),

  probe('ready: the verdict comes from the machine summary, not from the child’s prose — `fail` with exit 0 FAILS, and a missing summary is CANNOT VERIFY', () => {
    const r = readyFixture('rd-summary', quickStubs({ specGateOpts: { code: 0, verdict: 'fail' } }));
    const res = ready(r, ['--quick']);
    assertStatus(res, 1, 'a child that exits 0 and declares `fail` in its summary');
    assertOut(res, /^NOT READY$/m, 'the summary alone must be able to turn the header');
    assertOut(res, /spec-gate: FAILED/, 'the step must be named');
    assertOut(res, /the child exited 0 and its own summary says "fail" — fail-closed/, 'the disagreement itself must be reported, not silently resolved');

    r.write('tools/gates/spec-gate.mjs', runDirStub('spec-gate', { code: 0, writeSummary: false }));
    r.commit('chore: the spec-gate stub writes no summary');
    const cv = ready(r, ['--quick']);
    assertStatus(cv, 1, 'a child that exits 0 and writes no machine summary at all');
    assertOut(cv, /spec-gate: CANNOT VERIFY/, 'a verdict nobody can read is not a verdict');
    assertOut(cv, /summary\.json/, 'the missing artefact must be named');
    assertNotOut(cv, /^READY$/m, 'CANNOT VERIFY blocks exactly like a failure');
    r.cleanup();
  }),

  probe('ready: the pending-implementation tolerance is written ONCE and travels on the --quick path only', () => {
    const src = readFileSync(join(REPO_ROOT, 'tools/gates/ready.mjs'), 'utf8');
    const occurrences = src.split(TOLERANCE_FLAG).length - 1;
    assert(
      occurrences === 1,
      `the flag literal ${TOLERANCE_FLAG} must appear EXACTLY ONCE in tools/gates/ready.mjs — a second literal is a second switch somebody can flip — and it appears ${occurrences} time(s)`,
    );
    const line = src.split('\n').find((l) => l.includes(TOLERANCE_FLAG));
    assert(
      /quick \?\s*\[[^\]]*\]\s*:\s*\[\]/.test(String(line)),
      `the one occurrence must be the \`quick ? [flag] : []\` ternary, so the tolerance is a function of the PATH and not of a caller's switch; the line is: ${String(line)}`,
    );
    assert(toleranceArgv(true).join(' ') === TOLERANCE_FLAG, `toleranceArgv(true) must carry the flag; it gave ${JSON.stringify(toleranceArgv(true))}`);
    assert(toleranceArgv(false).length === 0, `toleranceArgv(false) must be empty — the full run is the check of record and it has no tolerances; it gave ${JSON.stringify(toleranceArgv(false))}`);
    // Every call site, named: the definition, the one that derives the flag's
    // own name, and the one in main. Anything else would be a second path.
    const callArgs = [...src.matchAll(/toleranceArgv\(([^)]*)\)/g)].map((m) => m[1].trim());
    const unexpected = callArgs.filter((a) => !['quick', 'true', 'args.quick'].includes(a));
    assert(
      unexpected.length === 0,
      `toleranceArgv may only be called with \`args.quick\` (and \`true\`, to derive the flag's own name); these call sites pass something else: ${unexpected.join(', ')}`,
    );
    assert(
      callArgs.filter((a) => a === 'args.quick').length === 1,
      `there must be exactly ONE call site on the run path, and it must pass args.quick; the call sites are: ${callArgs.join(' | ')}`,
    );
  }),

  // ══════════════════════════════════════════════════════ the tolerance (group 10)

  probe('L-tsc: the tolerance is NARROW — a missing symbol inside a placed spec test carries the pending prefix', async (ctx) => {
    if (!havePremise(ctx, 'tsc')) return skipped(`premise "tsc" absent: ${ctx.premises.tsc.rel} does not exist — ${ctx.premises.tsc.cure}`);
    const r = skeleton('tol-pending', { commit: false });
    r.write(SPEC_PATH, spec());
    r.write(`${CASE_DIR}/S1_missing-export.test.ts`, MISSING_EXPORT_CASE);
    r.commit('test: CHQ-001 S1 before the implementation');
    linkToolchain(r);
    const row = await runLight('L-tsc', { root: r.dir, lightsFrom: REPO_ROOT, mb: null });
    assertLight(row, 'cannot-verify', /^pending implementation:/, 'a TS2305 inside a placed spec test is the normal state between the test phase and the implementation phase');
    assertLight(row, 'cannot-verify', /every strict run fails on this tree/, 'the detail must say that only the hook prints it as a warning');
    r.cleanup();
    return null;
  }),

  probe('L-tsc: and the tolerance stops there — a syntax error, an error in src, and an error in a NON-spec test carry no prefix', async (ctx) => {
    if (!havePremise(ctx, 'tsc')) return skipped(`premise "tsc" absent: ${ctx.premises.tsc.rel} does not exist — ${ctx.premises.tsc.cure}`);

    const syntax = skeleton('tol-syntax', { commit: false });
    syntax.write(SPEC_PATH, spec());
    syntax.write(`${CASE_DIR}/S1_syntax.test.ts`, `${header}\ndescribe('S1_syntax', () => {\n  it('S1: the list is ordered', ( => {\n    expect(1).toBe(1);\n  });\n});\n`);
    syntax.commit('test: CHQ-001 S1 with a syntax error');
    linkToolchain(syntax);
    const syntaxRow = await runLight('L-tsc', { root: syntax.dir, lightsFrom: REPO_ROOT, mb: null, tolerate: true });
    assert(
      syntaxRow.status !== 'pass' && !syntaxRow.detail.startsWith(PENDING_IMPLEMENTATION_PREFIX),
      `a syntax error is not a pending implementation and must carry no tolerable prefix; L-tsc read ${String(syntaxRow.status)}: ${syntaxRow.detail.slice(0, 300)}`,
    );
    assertLight(syntaxRow, syntaxRow.status, /TS1\d{3}|not pending implementation because/, 'the detail must name the diagnostic it refused to excuse');
    syntax.cleanup();

    const inSrc = skeleton('tol-src', { commit: false });
    inSrc.write(SPEC_PATH, spec());
    inSrc.write('packages/core/src/ordering.ts', 'export const order = (list: readonly string[]): number => list;\n');
    inSrc.commit('feat: an ordering module that does not typecheck');
    linkToolchain(inSrc);
    const srcRow = await runLight('L-tsc', { root: inSrc.dir, lightsFrom: REPO_ROOT, mb: null, tolerate: true });
    assert(
      !srcRow.detail.startsWith(PENDING_IMPLEMENTATION_PREFIX),
      `an error in packages/core/src is a BROKEN implementation, not an absent one; L-tsc read ${String(srcRow.status)}: ${srcRow.detail.slice(0, 300)}`,
    );
    assertLight(srcRow, 'fail', /packages\/core\/src\/ordering\.ts/, 'the detail must name the file in src that failed');
    inSrc.cleanup();

    const helper = skeleton('tol-helper', { commit: false });
    helper.write(SPEC_PATH, spec());
    helper.write('packages/core/test/support/fake-truth.ts', 'export const alwaysTrue = (): boolean => notWrittenYet();\n');
    helper.commit('test: a helper calling a function nobody wrote');
    linkToolchain(helper);
    const helperRow = await runLight('L-tsc', { root: helper.dir, lightsFrom: REPO_ROOT, mb: null, tolerate: true });
    assert(
      !helperRow.detail.startsWith(PENDING_IMPLEMENTATION_PREFIX),
      `a missing symbol in a SUPPORT file is outside the tolerance — only a placed spec test may be pending; L-tsc read ${String(helperRow.status)}: ${helperRow.detail.slice(0, 300)}`,
    );
    assertLight(helperRow, 'fail', /support\/fake-truth\.ts|outside a spec test/, 'the detail must say the diagnostic sits outside a spec test');
    helper.cleanup();
    return null;
  }),
];
