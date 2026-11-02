#!/usr/bin/env node
/**
 * red-check — a test file this branch ADDED must FAIL on the base, each one on its own; and every
 * CASE a modified test file GAINED must fail on the base too, each one by name.
 *
 * A test written before its code is the spec made executable. A new test that is already green on
 * the base guards nothing: it either restates behaviour the base already has or asserts nothing at
 * all. This gate is the negative proof — the same one gate-probes demands of a gate — applied to
 * feature tests, and it is the only gate here that runs the toolchain against a SECOND checkout.
 *
 * Zero dependencies, Node 22 ESM, `node:` builtins and `./lib/*.mjs` only. No gate parses
 * TypeScript: every question about types goes to `tsc` and the answer is read out of its log, and
 * every question about cases goes to `lib/test-cases.mjs` and to the artifact.
 *
 * Importing this module runs NOTHING. The gate starts only from `main()`, which the guard at the
 * bottom calls when the file is the process entry point — so gate-probes can import `parseArgs`,
 * `classifyRedReasons` or `symbolOf` and assert on them without a worktree appearing beside the
 * repository.
 *
 * ── METHOD ──────────────────────────────────────────────────────────────────────────────────────
 *
 * ONE detached worktree at the merge base, beside the repository, installed ONCE from the BASE
 * lockfile. Then, per file: reset the worktree to the base, stage that one file (plus the
 * branch-added support/fixtures of its own package, plus the opt-in contracts set), and run BOTH
 * channels of the run of record — `tsc --noEmit` for types and `jest` for behaviour, because the
 * transform strips types and typechecks nothing.
 *
 * The jest command is NOT built here. `jestArgv` / `jestEnv` in `./run.mjs` are the one builder of
 * the run of record, and this gate imports them and appends its own positional path filter: a second
 * builder of one command is a second answer waiting to diverge. Half of the artefact contract lives
 * in the ENVIRONMENT — jest-junit takes its output path from `JEST_JUNIT_OUTPUT_FILE`, never from a
 * flag — so `runTool` carries an env and every judged child records it as `envExtra`.
 *
 * Separate in both senses, and neither is a preference:
 *
 *  - ONE RUN PER FILE (`--isolate`, the default). In TypeScript the reason is stronger than in a
 *    compiled language: module singletons, `jest.mock`, fake timers and import order all leak
 *    between files that share a process, so a shared run lets one file manufacture another's verdict.
 *    `--group` is opt-in and is IGNORED, with a printed reason, below four files or whenever a
 *    support/fixture or contract file is staged.
 *  - ONE STAGING PER FILE, onto a tree reset to the base first. Whatever is staged runs at HEAD
 *    state inside a run that claims to be about the base, so the staged list is PRINTED on every
 *    run, confirmed against `git status` afterwards, and nothing survives into the next one.
 *
 * ── THE INSTALL IS A PREMISE, NOT A STEP ────────────────────────────────────────────────────────
 *
 * A base worktree that failed to install resolves NOTHING: every file then reports `TS2307` and
 * every suite reports `Cannot find package …`, and a gate that read those as red would report a
 * clean sweep of reds having verified nothing. So an install that does not succeed is CANNOT VERIFY
 * for every file on the route, never a run — and success alone is not enough: measured in this
 * toolchain, `pnpm install` once answered `Lockfile is up to date, resolution step is skipped` and
 * kept a stale tree. The gate therefore compares `sha256(git show <mergeBase>:pnpm-lock.yaml)`
 * against `sha256(<wt>/node_modules/.pnpm/lock.yaml)` — pnpm's own copy of the lockfile it
 * installed FROM, measured byte-identical to `pnpm-lock.yaml` on this healthy tree 2026-11-01
 * (both sha256 7e927c97…) — and a mismatch, or an absent copy, is CANNOT VERIFY with that reason.
 *
 * ── THE FILTER IS THE FILE PATH, AND THE CASES ARE SELECTED AFTERWARDS ──────────────────────────
 *
 * Jest's `-t` is a SUBSTRING match over the full case name with no anchor, so `-t 'adds a task'`
 * also matches `adds a task twice`; there is no `FullyQualifiedName~Ns.Class.` here. The run is
 * therefore filtered by the FILE PATH as a positional argument — which Jest reads as a regex over
 * the test path, not as a path — and the cases are selected AFTER the fact out of the artifact, by
 * exact equality against the names `lib/test-cases.mjs` enumerated from the source.
 *
 * MEASURED 2026-11-02 in this repository, all three with `--selectProjects core` (the first over one
 * planted file under `packages/core/test/`, removed again afterwards):
 *   jest … <one planted .test.ts>                → exit 1, ONE classname, repo-relative
 *   jest … packages/core/test/skeleton           → exit 0, TWO classnames
 *   jest … packages/core/test/NOBODY_WROTE_THIS  → exit 1, BOTH artefacts written,
 *                                                  `<testsuites tests="0">`, JSON total 0
 * The first says the repo-relative spelling is the right one to pass (the project's own `rootDir` is
 * `./packages/core`, and `classname` comes back repo-relative either way — `classNameTemplate:
 * '{filepath}'`). The second says the positional filter matches a path FRAGMENT: a file whose path
 * contains another's would be collected into the same process, which would quietly end the isolation
 * this gate promises — so every run compares the artifact's file set against the set it asked for and
 * reports a surplus as CANNOT VERIFY. The third is the fail-closed path arriving for free, and it is
 * why no `--passWithNoTests=false` is passed (Jest has no such flag to need): a pattern that matched
 * nothing exits NON-zero by itself and writes a well-formed report whose `tests="0"` `readJUnit`
 * already refuses.
 *
 * ONE PROJECT PER KIND. `--selectProjects <kind>` names the project whose `displayName` IS the kind,
 * so `core` is judged in the `node` environment only. `core-dom` runs the same files under `jsdom`
 * and is L-env-parity's lane, not this gate's: a spec test proven red here is proven red under node.
 *
 * ── WHAT COUNTS AS RED (the measured classification, lib/junit-xml.mjs + lib/tsc-log.mjs) ───────
 *
 *   ✓ red on base                                 `tsc` clean AND every case `AssertionError`.
 *   crash-red (weaker)                            `tsc` clean, and every case a measured "not
 *                                                 written yet" signature: `TypeError: … is not a
 *                                                 function`, `ReferenceError: … is not defined`,
 *                                                 `Error: Cannot find module …`.
 *   crash-red (weaker, PENDING IMPLEMENTATION)    `tsc` red, every diagnostic in the CLOSED
 *                                                 missing-symbol set AND located in a file this
 *                                                 run STAGED.
 *   ✗ GREEN ON BASE                               ANY case passed. One red case never covers a
 *                                                 green sibling, so the file AND the case are
 *                                                 named and the gate fails.
 *   CANNOT VERIFY                                 everything else, and it blocks exactly like a
 *                                                 green: `tests="0"`, a `.skip`/`.todo` among the
 *                                                 cases, a channel disagreement, `Cannot find
 *                                                 package …` (the worktree is not installed), a
 *                                                 diagnostic outside the set or outside a staged
 *                                                 file, a surplus file in the run, a name that DID
 *                                                 exist in the sources.
 *
 * ── WHAT THE JEST ARTEFACT DOES NOT CARRY (MEASURED 2026-11-02, and it costs this gate verdicts) ─
 *
 * The artefact's SHAPE is unchanged — `<testsuite name="<file>">`, `<testcase classname="<file>"
 * name="<describe> > <test>">` — which is what the readers in `lib/` know. Two things INSIDE it are
 * not, and both were measured by planting one assertion-red file and one file importing a module
 * nobody wrote, then reading both channels of the run with the readers themselves:
 *
 *  1. `<failure>` CARRIES NO `type` AND NO `message` ATTRIBUTE. jest-junit writes the text as the
 *     element BODY, whose first line is `<Type>: <message>`. Read from the attributes alone, every
 *     failure answered `{ reason: 'unknown' }` — so `classifyRedReasons` said CANNOT VERIFY and
 *     this gate could not print `✓ red on base` for anything at all. Fail-closed, but not a verdict
 *     about a test. CURED in `lib/junit-xml.mjs` (`splitFailureBody`, plus the measured
 *     `expect(` signature for this producer's assertions), which this gate reads and does not own.
 *  2. A FILE THAT FAILED TO COLLECT HAS NO ROW IN THE XML AT ALL. Vitest wrote one synthetic
 *     `<testcase>` per uncollected file; Jest omits the whole `<testsuite>` and counts it only in
 *     the JSON channel (`status: 'failed'`, `assertionResults: []`, and a `message` beginning
 *     `Test suite failed to run`). So `isCollectionFailure` has nothing to match and the XML of a
 *     run whose files all failed to collect is a bare `<testsuites tests="0">`, refused outright.
 *     That mattered more than it sounds: the commonest shape of the test phase — a new test
 *     importing what nobody has written — IS a collection failure under this runner, so the gate
 *     was answering CANNOT VERIFY to exactly the honest red tests it exists to accept.
 *
 *     CURED by reading the only channel that can name the file: `collectionReason` in
 *     `lib/jest-json.mjs` classifies its message into the same closed vocabulary `redReason` uses,
 *     `testChannel` maps one entry per staged file, and the caller classifies it through the same
 *     `classifyRedReasons`. The verdict is `crash-red` — the weaker one — never `red`, because a
 *     file that never loaded has proven no assertion. Measured signatures, 2026-11-02:
 *     `Could not locate module <spec>` for an absent module and
 *     `The requested module '<spec>' does not provide an export named '<name>'` for an absent
 *     export. A RELATIVE spec is this project's own unwritten module; a BARE one is an uninstalled
 *     package, which is `not-installed` and still blocks, because it says nothing about the test.
 *
 * The name check can only DISQUALIFY. `git grep -w` over every `packages/<pkg>/src` and
 * `apps/<app>/src` at BOTH revisions answers "did this name ever exist": if it DID, the red is a
 * regression and not an absent implementation, so the verdict drops to CANNOT VERIFY. The converse
 * is NOT a proof — lib/junit-xml.mjs:291-296 measured that the name in a `TypeError` is whatever
 * the expression was CALLED as, so a test that binds the symbol to a local first reports the
 * local's name. That is exactly why the label says `weaker` instead of `red`.
 *
 * ── A MODIFIED FILE IS JUDGED PER CASE ──────────────────────────────────────────────────────────
 *
 * Its old cases may be green on the base by right. So a modified test file runs TWICE: its HEAD
 * version staged over the base's own file, then the base version alone. A case of the first run
 * missing from the second is NEW (renames excluded via `caseDiff.renamed`), and every new case must
 * be red. When the base run yields no case, the new names come from the source diff instead and
 * that is PRINTED. A file that gained no case is printed and NOT run — a changed body, a removed or
 * a renamed case is test-guard's business and wants a `spec-change:`/`spec-conflict:` trailer.
 *
 * ── JURISDICTION ────────────────────────────────────────────────────────────────────────────────
 *
 * Exactly ONE set is outside it, and it is printed rather than passed over in silence: the skeleton
 * fixtures — `<package>/test/skeleton/<name>.test.ts`, which is what `lib/test-file-patterns.mjs`
 * `isSkeletonFixture` answers, and asking the one classifier beats writing a second glob here.
 * They are spec-less, green by design, and guarded by test-guard. THERE IS NO EXEMPTION TRAILER:
 * the base worktree is installed from the BASE lockfile and typechecked from BASE sources, so the
 * borrowed-dependency hole such a trailer would excuse cannot occur, and a green verdict here is
 * always about the test.
 *
 * UNVERIFIED, and refused rather than guessed: the `e2e` kind. Playwright is installed and its
 * browsers are not, so an added `e2e/CHQ-<nnn>/S<n>_<slug>.spec.ts` is reported CANNOT VERIFY with
 * the `browser_probe` premise quoted. No base run for that lane has ever been observed here, so
 * none is written.
 *
 * Usage: node tools/gates/red-check.mjs [--base <ref> | --since <sha>]
 *                                       [--kind core|api|web|all] [--isolate | --group]
 * Exit: 0 every file on the route proven red · 1 any green, any CANNOT VERIFY, or a refused
 * premise · 2 this is no repository, it has no commits, or the argv is wrong.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EMPTY_TREE,
  baseRev,
  diffNamesFiltered,
  existsAtRev,
  git,
  hasCommits,
  headSha,
  repoRoot,
  revParse,
  showAtRev,
  statusPorcelain,
} from './lib/git.mjs';
import { fileVerdict, filesIn, isCollectionFailure, readJUnit, redReason, toTri } from './lib/junit-xml.mjs';
import { premise, readProbe, sha256 } from './lib/probe.mjs';
import { artifactPath, makeRunDir, writeRunJson } from './lib/run-dir.mjs';
import { KINDS, PENDING_IMPLEMENTATION, VERDICT_LABELS, parseSpec } from './lib/spec-parse.mjs';
import { caseDiff, listCases } from './lib/test-cases.mjs';
import { KIND_ROOT, classify, isContract, isSkeletonFixture, isTestSupport, packageOf } from './lib/test-file-patterns.mjs';
import { classifyPending, classifyTs2307, readTsc } from './lib/tsc-log.mjs';
import { collectionReason, crossCheck, readJestJson } from './lib/jest-json.mjs';
import { CHILD_ENV, jestArgv, jestEnv } from './run.mjs';

// ───────────────────────────────────────────────────────────────────────────── vocabulary

/** The kinds this gate has a measured runner for. `e2e` is refused by name — see the header. */
export const JEST_KINDS = KINDS.filter((k) => k !== 'e2e');

/** Four files is the threshold `--group` needs; below it, one run per file costs nothing worth having. */
export const GROUP_MIN_FILES = 4;

/** The five labels this gate speaks, and the only ones it prints as a verdict about a file. */
export const LABELS = Object.freeze({
  red: '✓ red on base',
  green: '✗ GREEN ON BASE',
  crashRed: 'crash-red (weaker)',
  crashRedPending: `crash-red (weaker, ${PENDING_IMPLEMENTATION.toUpperCase()})`,
  cannotVerify: VERDICT_LABELS['cannot-verify'],
});

const CV = LABELS.cannotVerify;

// 1 MiB (the spawnSync default) truncates a chatty child, and the truncation is then reported as a
// failure that never happened. A jest run with two reporters is chatty.
const MAX_BUFFER = 64 * 1024 * 1024;

// The child environment is `CHILD_ENV` from `./run.mjs` and is not restated here: the run of record
// and the base run must not disagree about the language, the clock or the module loader. It pins
// LANG/LC_ALL=C because git and the toolchain otherwise speak the OS language (lib/git.mjs, fact 1:
// `git rev-parse HEAD` answered `Schwerwiegend: …` on this Mac), CI=1 and NO_COLOR so no child
// renders a progress spinner into an artifact, and NODE_OPTIONS=--experimental-vm-modules, without
// which every ESM test file dies with `Cannot use import statement outside a module` — a message
// that reads as a broken source and is not one. FORCE_COLOR is deliberately NOT pinned: measured in
// run.mjs, node prints a warning into every artefact when NO_COLOR and FORCE_COLOR are both set.

const USAGE = `usage: node tools/gates/red-check.mjs [--base <ref> | --since <sha>] [--kind ${[...JEST_KINDS, 'all'].join('|')}] [--isolate | --group]`;

const log = (m) => console.log(`[red-check] ${m}`);

/** The last non-blank lines of a child's output — what a tool says about its own failure. */
const tail = (s, n = 3) =>
  String(s ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(-n)
    .join(' | ');

/** A path turned into one artifact-name segment: `artifactPath` refuses a name carrying a slash. */
const tag = (s) => String(s).replace(/[^\w.-]/g, '_');

const quoted = (names) => names.map((n) => JSON.stringify(n)).join(', ');
const quotedBy = (list, pick) => quoted(list.map(pick));
const firstLine = (s) => String(s ?? '').split('\n')[0];
/** A path as the gates spell it: repo-relative, with the `./` tsc sometimes prints removed. */
const relPath = (p) => String(p).replace(/^\.\//, '');

// ───────────────────────────────────────────────────────────────────────────────── argv

/**
 * Parse the argv. → `{ ok, errors, base, since, kind, mode, help }`
 *
 * A valued option whose value is missing, or is another flag, is an ERROR rather than a silent fall
 * back to the default: `--since --kind` would otherwise swallow `--kind`, change which commit the
 * whole run is about, and read the default base as if it had been asked for. An unknown argument is
 * an error for the same reason — a misspelled `--isolat` must not read as "the default was wanted".
 */
export function parseArgs(argv) {
  const out = { ok: true, errors: [], base: 'main', since: null, kind: 'all', mode: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        out.errors.push(`${a} needs a value (got ${v === undefined ? 'nothing' : JSON.stringify(v)})`);
        return null;
      }
      i += 1;
      return v;
    };
    if (a === '--base') {
      const v = value();
      if (v !== null) out.base = v;
    } else if (a === '--since') {
      const v = value();
      if (v !== null) out.since = v;
    } else if (a === '--kind') {
      const v = value();
      if (v !== null) out.kind = v;
    } else if (a === '--isolate' || a === '--group') {
      const want = a.slice(2);
      if (out.mode !== null && out.mode !== want) out.errors.push('--isolate and --group contradict each other — pass one, or neither (isolate is the default)');
      else out.mode = want;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else {
      out.errors.push(`unknown argument ${JSON.stringify(a)}`);
    }
  }
  if (out.since !== null && argv.includes('--base'))
    out.errors.push('--since and --base name two different bases — pass one (--since <sha> wins nothing by accident here, it is refused)');
  if (![...JEST_KINDS, 'all'].includes(out.kind))
    out.errors.push(`--kind ${JSON.stringify(out.kind)} is not one of ${[...JEST_KINDS, 'all'].join(', ')} — the e2e lane has no base run (its browsers are not downloaded)`);
  if (out.mode === null) out.mode = 'isolate';
  out.ok = out.errors.length === 0;
  return out;
}

// ──────────────────────────────────────────────────────────────────────── spawning a child

/**
 * Spawn a child with an ARGV, never a shell string, and capture ITS OWN exit code.
 *
 * Nothing in this gate pipes the output of the tool it is judging: measured twice in this toolchain,
 * `tool | head` reports `$?` of `head` and hands back 0 over a crash (`eslint` whose real exit was
 * 2; `tsc` over four TS6059). The log is written from the captured buffer, so the file on disk and
 * the exit code describe the same process — and the verdict is then read from the file, never from
 * the code.
 *
 * `env` is part of the CONTRACT, not a convenience: jest-junit takes its output path from
 * `JEST_JUNIT_OUTPUT_FILE` and from no flag, so a child recorded by argv alone could not say where
 * it was told to write. It is returned as `envExtra` and written into the record beside `argv`.
 */
function runTool(ctx, file, args, { cwd, logPath = null, env = {} } = {}) {
  const r = spawnSync(file, args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER, env: { ...process.env, ...CHILD_ENV, ...env } });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (logPath) {
    try {
      writeFileSync(logPath, out, 'utf8');
      ctx.artifacts.push(logPath);
    } catch (e) {
      // A log that could not be written is REPORTED, not swallowed; its absence is already CANNOT
      // VERIFY in the reader that would have read it.
      log(`note: could not write ${String(logPath)}: ${firstLine(e.message)}`);
    }
  }
  return { argv: [file, ...args], envExtra: { ...env }, code: r.error ? null : (r.status ?? null), out, spawnError: r.error?.message ?? null };
}

// ──────────────────────────────────────────────────────────────────── the gate's own state

function newCtx({ root, args, head, mergeBase, startedAt }) {
  return {
    root,
    args,
    head,
    mergeBase,
    mb7: mergeBase === null ? null : mergeBase.slice(0, 7),
    startedAt,
    runDir: null,
    wt: null,
    wtReal: null,
    installRefusal: null,
    workspacePackages: null,
    red: [],
    green: [],
    unverifiable: [],
    artifacts: [],
    children: [],
    scope: { added: [], modified: [], skeleton: [], support: [], contracts: [], contractsOffered: [] },
    writtenCache: new Map(),
  };
}

const refuse = (ctx, file, why) => {
  const text = String(why).startsWith(`${file}:`) ? String(why) : `${file}:1 — ${why}`;
  ctx.unverifiable.push({ file, why: text });
  log(`${CV}: ${text}`);
};

/** Has this file already been judged? Read by the catch that turns a throw into CANNOT VERIFY. */
const judged = (ctx, file) => [...ctx.red, ...ctx.green, ...ctx.unverifiable].some((x) => x.file === file);

const showAt = (ctx, rev, path) => {
  const r = showAtRev(rev, path, { cwd: ctx.root });
  return r.ok ? r.text : null;
};

// ═════════════════════════════════════════════════════════════════════════════════ scope

/**
 * What this range put on the route. Added spec tests, modified spec tests whose SOURCE gained a
 * case, and — printed, never silent — the one set outside the jurisdiction.
 */
function collectScope(ctx) {
  const added = diffNamesFiltered(ctx.mergeBase, 'HEAD', 'A', { cwd: ctx.root });
  const modified = diffNamesFiltered(ctx.mergeBase, 'HEAD', 'M', { cwd: ctx.root });
  if (!added.ok) return `git diff --diff-filter=A failed: ${added.reason} (${added.argv?.join(' ')})`;
  if (!modified.ok) return `git diff --diff-filter=M failed: ${modified.reason} (${modified.argv?.join(' ')})`;

  const addedTests = [];
  for (const f of added.files) {
    const c = classify(f);
    if (c.form === 'spec-test' || c.form === 'e2e-test') addedTests.push(c);
    else if (c.cannotVerify)
      refuse(ctx, f, `${c.reason ?? 'no declared form matches this path'} — a test file nobody can place is CANNOT VERIFY, not a skip`);
  }

  ctx.scope.skeleton = added.files.filter(isSkeletonFixture);
  if (ctx.scope.skeleton.length)
    log(
      "outside this gate's jurisdiction, and the only set that is — skeleton fixtures (spec-less, green by design, guarded by " +
        `test-guard; there is no exemption trailer): ${ctx.scope.skeleton.join(', ')}`,
    );
  ctx.scope.support = added.files.filter(isTestSupport);
  ctx.scope.contractsOffered = added.files.filter(isContract);

  // Contracts are staged ONLY when a spec this range touched says `contracts: allowed` at HEAD.
  const specs = diffNamesFiltered(ctx.mergeBase, 'HEAD', 'd', { pathspec: ['docs/specs'], cwd: ctx.root });
  const allowed = (specs.ok ? specs.files : [])
    .filter((f) => f.endsWith('.md'))
    .some((f) => {
      const text = showAt(ctx, 'HEAD', f);
      return text !== null && parseSpec(text, { path: f }).contracts === 'allowed';
    });
  ctx.scope.contracts = allowed ? ctx.scope.contractsOffered : [];
  if (ctx.scope.contractsOffered.length)
    log(
      `contracts added by the range (${allowed ? 'staged — a touched spec says `contracts: allowed`' : 'NOT staged — no touched spec says `contracts: allowed`'}): ` +
        ctx.scope.contractsOffered.join(', '),
    );

  const modifiedTests = [];
  for (const f of modified.files) {
    const c = classify(f);
    if (c.form !== 'spec-test' && c.form !== 'e2e-test') continue;
    const diff = caseDiff(showAt(ctx, ctx.mergeBase, f), showAt(ctx, 'HEAD', f));
    const parts = [
      diff.added.length ? `new: ${quotedBy(diff.added, (x) => x.name)}` : null,
      diff.renamed.length ? `renamed: ${diff.renamed.map((r) => `${JSON.stringify(r.from.name)} → ${JSON.stringify(r.to.name)}`).join(', ')}` : null,
      diff.removed.length ? `removed: ${quotedBy(diff.removed, (x) => x.name)}` : null,
      diff.changed.length ? `changed body: ${quotedBy(diff.changed, (x) => x.key)}` : null,
    ]
      .filter(Boolean)
      .join('; ');
    if (diff.cannotVerify) {
      refuse(
        ctx,
        f,
        `the case list is not enumerable on one side (${diff.reasons.join('; ')}), so "nothing was added" cannot be concluded from the diff. ` +
          'What to do: give every case a literal title (lib/test-cases.mjs names the shapes it cannot enumerate).',
      );
      continue;
    }
    if (diff.hasNew) {
      modifiedTests.push({ info: c, file: f, diff });
      log(`modified test file WITH new case(s): ${f} — ${parts}`);
    } else {
      log(
        `modified test file, no new case: ${f} — ${parts || 'no case-level change'} ` +
          "(a changed body, a removal or a rename is test-guard's: declare it with a spec-change:/spec-conflict: trailer)",
      );
    }
  }

  // The e2e lane is refused BY NAME, with the premise quoted, so nobody reads silence as a pass.
  const browser = premise(readProbe({ root: ctx.root }), 'browser_probe');
  for (const c of [...addedTests, ...modifiedTests.map((m) => m.info)]) {
    if (c.kind !== 'e2e') continue;
    refuse(
      ctx,
      c.path,
      `the e2e lane has no base run in this repository: ${browser.reason}. ` +
        'What to do: observe the browser probe (node tools/gates/gate-probes.mjs --real), then prove this file red by hand and record how in the commit body.',
    );
  }

  const inKind = (kind) => JEST_KINDS.includes(kind) && (ctx.args.kind === 'all' || ctx.args.kind === kind);
  ctx.scope.added = addedTests.filter((c) => inKind(c.kind));
  ctx.scope.modified = modifiedTests.filter((m) => inKind(m.info.kind));
  for (const c of addedTests) if (c.kind !== 'e2e' && !inKind(c.kind)) log(`skipping ${c.path} — --kind ${ctx.args.kind} does not cover kind ${c.kind}`);
  for (const m of modifiedTests) if (m.info.kind !== 'e2e' && !inKind(m.info.kind)) log(`skipping ${m.file} — --kind ${ctx.args.kind} does not cover kind ${m.info.kind}`);
  return null;
}

// ══════════════════════════════════════════════════════════════ names that ever existed

// The source trees a name must be absent from for a red to mean "not written yet".
//
// MEASURED 2026-11-01 in a probe repository, and the reason the pathspec is spelled the long way.
// The obvious form, which is also the one the port plan writes, matches NOTHING:
//
//     git grep -q -w -e sha256 main -- 'packages/*/src'             -> exit 1 (no match)
//     git grep -q -w -e sha256 main -- ':(glob)packages/*/src/**'   -> exit 0
//
// git's leading-directory shortcut applies to a LITERAL prefix, not to one containing a wildcard, so
// the first pathspec is compared against whole paths and never matches a file INSIDE src. The
// failure is silent and in the one direction that matters: a pathspec matching nothing makes every
// name read as "never written", so the regression check below would never fire and a red caused by a
// DELETED symbol would be accepted as a pending implementation. `:(glob)` makes `*` stop at a slash,
// which is why the recursive `**` is there.
const SRC_PATHSPEC = [':(glob)packages/*/src/**', ':(glob)apps/*/src/**'];

/** `git grep -w` at BOTH revisions: did this name ever exist in a source tree? */
function everWritten(ctx, name) {
  if (typeof name !== 'string' || !name) return null;
  if (!ctx.writtenCache.has(name)) {
    const hit = [ctx.mergeBase, 'HEAD'].some((rev) => git(['grep', '-q', '-w', '-e', name, rev, '--', ...SRC_PATHSPEC], { cwd: ctx.root }).code === 0);
    ctx.writtenCache.set(name, hit);
  }
  return ctx.writtenCache.get(name);
}

/** Did the module a `missing-module` names exist at a revision? Resolved against the importer. */
function moduleExistedAt(ctx, rev, importer, specifier) {
  if (typeof specifier !== 'string' || !specifier.startsWith('.')) return null;
  const base = resolve('/', dirname(importer), specifier).slice(1);
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsAtRev(rev, cand, { cwd: ctx.root })) return cand;
  }
  return null;
}

/** The workspace package names AT THE BASE — what `classifyTs2307` compares a bare specifier against. */
function basePackageNames(ctx) {
  const ls = git(['ls-tree', '-r', '--name-only', '--end-of-options', ctx.mergeBase], { cwd: ctx.root });
  if (ls.code !== 0) return null;
  const names = [];
  for (const p of ls.stdout.split('\n')) {
    if (!/^(packages|apps|tools)\/[^/]+\/package\.json$/.test(p)) continue;
    const text = showAt(ctx, ctx.mergeBase, p);
    if (text === null) continue;
    try {
      const n = JSON.parse(text)?.name;
      if (typeof n === 'string') names.push(n);
    } catch {
      // An unparsable manifest at the base is L-deps' finding, not this gate's verdict.
    }
  }
  return names;
}

// ═══════════════════════════════════════════════════════════════════════════ the worktree

/** `git worktree add --detach` beside the repository. → the refusal reason, or null. */
function makeWorktree(ctx) {
  const ciRoot = process.env.CHEQ_CI_ROOT ?? `${ctx.root}-ci`;
  const wt = join(ciRoot, `redcheck-${ctx.mb7}-${process.pid}`);
  mkdirSync(ciRoot, { recursive: true });
  if (existsSync(wt))
    return `${wt} already exists — a base worktree is never reused, because a leftover tree carries a previous run's staging. What to do: git worktree remove --force ${wt}, then re-run.`;
  const add = git(['worktree', 'add', '--detach', '--end-of-options', wt, ctx.mergeBase], { cwd: ctx.root });
  if (add.code !== 0) return `git worktree add --detach ${wt} ${ctx.mb7} exited ${add.code}: ${tail(add.stderr)}`;
  ctx.wt = wt;
  try {
    ctx.wtReal = realpathSync(wt);
  } catch {
    ctx.wtReal = wt;
  }
  log(`base worktree: ${wt} at ${ctx.mb7}`);
  return null;
}

const bin = (ctx, name) => join(ctx.wt, 'node_modules/.bin', name);

/**
 * ONE install of the base worktree, from the BASE lockfile. → the refusal reason, or null.
 * Every branch here is a premise the whole route depends on, and each one names what to do about it.
 */
function installBase(ctx) {
  const logPath = artifactPath(ctx.runDir, 'install.log');
  const inst = runTool(ctx, 'pnpm', ['install', '--frozen-lockfile', '--prefer-offline', '--ignore-scripts'], { cwd: ctx.wt, logPath });
  ctx.children.push({ what: 'install', argv: inst.argv, exitCode: inst.code, log: logPath });

  if (inst.spawnError) return `pnpm could not be spawned (${inst.spawnError}) — the base worktree is not installed. What to do: install pnpm, then re-run.`;
  if (inst.code !== 0)
    return (
      `pnpm install --frozen-lockfile exited ${inst.code} in ${ctx.wt}: ${tail(inst.out)} — see ${logPath}. ` +
      'What to do: a manifest and a lockfile that disagree are not a slow CI but no CI; reconcile them at the base commit.'
    );

  const baseLock = showAt(ctx, ctx.mergeBase, 'pnpm-lock.yaml');
  if (baseLock === null) return `pnpm-lock.yaml does not exist at ${ctx.mb7} — there is no base lockfile to install from. What to do: commit the lockfile.`;

  // pnpm's own copy of the lockfile it installed FROM: the only evidence on disk of WHICH lock
  // produced this node_modules. Measured byte-identical to pnpm-lock.yaml on a healthy tree.
  const installedFrom = join(ctx.wt, 'node_modules/.pnpm/lock.yaml');
  if (!existsSync(installedFrom))
    return (
      `${installedFrom} is absent, so there is no evidence of WHICH lockfile pnpm installed from, and an install nobody can pin ` +
      `to the base lock is not a base. What to do: rm -rf ${join(ctx.wt, 'node_modules')} and re-run.`
    );
  const want = sha256(baseLock);
  const got = sha256(readFileSync(installedFrom, 'utf8'));
  if (want !== got)
    return (
      `the installed tree does not come from the base lockfile: sha256(${ctx.mb7}:pnpm-lock.yaml)=${want.slice(0, 12)} but ` +
      `sha256(node_modules/.pnpm/lock.yaml)=${got.slice(0, 12)}. Measured: pnpm can answer "Lockfile is up to date, resolution step is ` +
      `skipped" and keep the older tree. What to do: rm -rf ${join(ctx.wt, 'node_modules')} and re-run.`
    );
  log(`installed from ${ctx.mb7}:pnpm-lock.yaml (sha256 ${want.slice(0, 12)}, matching node_modules/.pnpm/lock.yaml)`);

  for (const b of ['tsc', 'jest']) {
    if (!existsSync(bin(ctx, b)))
      return (
        `${join('node_modules/.bin', b)} is absent after the install — the runner of record is not in the base worktree; see ${logPath}. ` +
        `What to do: check that ${b} is a devDependency at ${ctx.mb7}.`
      );
  }
  if (!existsSync(join(ctx.wt, 'jest.config.mjs')))
    return (
      `jest.config.mjs does not exist at ${ctx.mb7} — the base carries no project table, so no --selectProjects could be named. ` +
      'What to do: pass --since <sha> naming a base that already holds the jest config.'
    );
  return null;
}

function removeWorktree(ctx) {
  if (ctx.wt === null) return;
  const rm = git(['worktree', 'remove', '--force', '--end-of-options', ctx.wt], { cwd: ctx.root });
  if (rm.code === 0) return;
  log(`note: git worktree remove --force ${ctx.wt} exited ${rm.code}: ${tail(rm.stderr)}; removing the directory and pruning`);
  try {
    rmSync(ctx.wt, { recursive: true, force: true });
  } catch (e) {
    log(`note: ${ctx.wt} could not be removed: ${firstLine(e.message)}`);
  }
  git(['worktree', 'prune'], { cwd: ctx.root });
}

// ═════════════════════════════════════════════════════════════════════════════ staging

/** A directory on a staged path that the base carries as a symlink LEAVING the worktree. */
function escapesWorktree(ctx, path) {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i += 1) {
    const rel = parts.slice(0, i).join('/');
    let st;
    try {
      st = lstatSync(join(ctx.wt, rel));
    } catch {
      return null; // the directory does not exist yet, so staging will create it inside the tree
    }
    if (!st.isSymbolicLink()) continue;
    let target;
    try {
      target = realpathSync(join(ctx.wt, rel));
    } catch {
      return rel; // a symlink whose target cannot be resolved is never written through
    }
    if (target !== ctx.wtReal && !target.startsWith(`${ctx.wtReal}/`)) return rel;
  }
  return null;
}

/**
 * Copy one run's staged set into the reset worktree. → the reason it could not, or null.
 *
 * `contents` (path → text) is the ONLY legal way to overwrite a file the base already carries, and
 * only a modified file's run uses it, by name.
 *
 * The `node_modules` refusal is not ceremony in a pnpm monorepo: with an isolated node-linker that
 * tree is a farm of symlinks (`node_modules/@cheq/core → ../../packages/core`, `.pnpm` → a store
 * outside the tree entirely), so a path staged through one would be written into the WORKING
 * repository's real `packages/core` while the "base" run read the branch's code.
 */
function stage(ctx, wanted, contents = new Map()) {
  for (const f of wanted) {
    if (f.split('/').includes('node_modules')) return `${f} has a node_modules segment — nothing is ever staged through the symlink farm`;
    const via = escapesWorktree(ctx, f);
    if (via) return `${f} would be staged through ${via}, which the base carries as a symlink out of the worktree`;
    let held = null;
    try {
      held = lstatSync(join(ctx.wt, f));
    } catch {
      held = null;
    }
    if (held && held.isSymbolicLink()) return `${f} is already in the base tree AS A SYMLINK — staging it would write through it`;
    if (held && !contents.has(f))
      return `${f} is already in the base tree, so staging it would overwrite the base's own file (a case-insensitive filesystem folding two paths?)`;
    try {
      mkdirSync(join(ctx.wt, dirname(f)), { recursive: true });
      if (contents.has(f)) writeFileSync(join(ctx.wt, f), contents.get(f), 'utf8');
      else copyFileSync(join(ctx.root, f), join(ctx.wt, f));
    } catch (e) {
      return `${f} could not be staged: ${firstLine(e.message)}`;
    }
  }
  return null;
}

/**
 * The topmost directory of each staged path the worktree does NOT have yet — the whole of what this
 * staging is about to CREATE, and therefore the whole of what it may remove afterwards. Counted
 * BEFORE staging (and after the reset, which is what decides what exists), because afterwards
 * nothing distinguishes a directory this run made from one the base already carried.
 */
function dirsStagingWouldCreate(ctx, wanted) {
  const created = new Set();
  for (const f of wanted) {
    const parts = dirname(f).split('/');
    for (let i = 1; i <= parts.length; i += 1) {
      const rel = parts.slice(0, i).join('/');
      if (!existsSync(join(ctx.wt, rel))) {
        created.add(rel);
        break;
      }
    }
  }
  return created;
}

/** Remove the staged files, then `git clean` exactly the directories THIS staging created, deepest first. */
function unstage(ctx, createdDirs, wanted) {
  for (const f of wanted) rmSync(join(ctx.wt, f), { force: true });
  for (const d of [...createdDirs].toSorted((a, b) => b.length - a.length)) {
    if (!existsSync(join(ctx.wt, d))) continue;
    const c = git(['-C', ctx.wt, 'clean', '-fdq', '--', d], { cwd: ctx.root });
    if (c.code !== 0) log(`note: git clean -fdq -- ${d} in the base worktree exited ${c.code}: ${tail(c.stderr)}`);
  }
}

/** Reset the worktree to the base and CONFIRM it stands there. → null, or the reason it does not. */
function resetToBase(ctx) {
  const r = git(['-C', ctx.wt, 'reset', '--hard', '--quiet', '--end-of-options', ctx.mergeBase], { cwd: ctx.root });
  if (r.code !== 0) return `git reset --hard ${ctx.mb7} in the base worktree exited ${r.code}: ${tail(r.stderr)}`;
  // node_modules, .vite and .ci are kept on purpose: a full clean would re-install per file and push
  // whoever runs this gate toward reusing a dirty tree instead.
  const c = git(['-C', ctx.wt, 'clean', '-xdfq', '-e', 'node_modules', '-e', '.vite', '-e', '.ci'], { cwd: ctx.root });
  if (c.code !== 0) return `git clean -xdfq in the base worktree exited ${c.code}: ${tail(c.stderr)}`;
  const at = headSha({ cwd: ctx.wt });
  if (!at.ok) return `the base worktree HEAD does not resolve: ${at.reason}`;
  if (at.sha !== ctx.mergeBase)
    return `the base worktree stands at ${at.sha.slice(0, 7)}, not at the base ${ctx.mb7} — every verdict read from it would be about the wrong commit`;
  return null;
}

/**
 * After staging: the worktree must carry EXACTLY the staged set and nothing else.
 *
 * Two questions, and `--untracked-files=no` can only answer one of them. The tracked half is
 * `statusPorcelain` (the one reader, and its `--untracked-files=no` is right for every other
 * caller): a modified tracked file is legal only where `contents` deliberately overwrote one. The
 * untracked half needs `--untracked-files=all`, because a staged NEW file is untracked by
 * definition and is invisible to the other spelling — which is the whole of what this staging
 * normally consists of. So that one question is asked with its own argv, and the set it returns must
 * equal the staged set exactly: a surplus means a previous run's file survived the clean, and a
 * verdict read from such a tree is about a mixture of two runs.
 */
function confirmStaged(ctx, wanted, contents) {
  const tracked = statusPorcelain([], { cwd: ctx.wt });
  if (!tracked.ok) return `git status --porcelain in the base worktree failed: ${tracked.reason}`;
  const allowed = new Set(contents.keys());
  const unexpected = tracked.entries.map((e) => e.path).filter((p) => !allowed.has(p));
  if (unexpected.length)
    return `the base worktree carries modified tracked file(s) this run did not stage: ${unexpected.join(', ')} — a base run must read base sources`;

  const un = git(['-C', ctx.wt, 'status', '--porcelain', '--untracked-files=all'], { cwd: ctx.root });
  if (un.code !== 0) return `git status --porcelain --untracked-files=all in the base worktree exited ${un.code}: ${tail(un.stderr)}`;
  const listed = un.stdout
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 3)
    .map((l) => l.slice(3));
  const surplus = listed.filter((p) => !wanted.has(p) && !allowed.has(p));
  if (surplus.length)
    return (
      `the base worktree carries ${surplus.length} path(s) this run did not stage: ${surplus.slice(0, 8).join(', ')} — ` +
      'a leftover from an earlier staging makes the run about a mixture of two trees'
    );
  const missing = [...wanted].filter((f) => !existsSync(join(ctx.wt, f)));
  if (missing.length) return `staged file(s) are not on disk in the base worktree: ${missing.join(', ')}`;
  return null;
}

/** What one file's run carries into the base worktree. */
function stagedFor(ctx, info) {
  const set = new Set([info.path]);
  const pkg = packageOf(info.path);
  for (const s of ctx.scope.support) if (pkg && packageOf(s) === pkg) set.add(s);
  for (const c of ctx.scope.contracts) set.add(c);
  return set;
}

// ════════════════════════════════════════════════════════════════════════════ the channels

/** Channel 1 — types. → `{ read, code }`: the `readTsc` result plus the captured exit code. */
function typeChannel(ctx, kind, label) {
  const tsconfig = `${KIND_ROOT[kind]}/tsconfig.json`;
  if (!existsSync(join(ctx.wt, tsconfig)))
    return { read: { ok: false, verdict: 'cannot-verify', reason: `${tsconfig} does not exist at ${ctx.mb7}, so the type channel has no project to read` }, code: null };
  const logPath = artifactPath(ctx.runDir, `tsc.${label}.log`);
  // --pretty false, or tsc-log.mjs's diagnostic regex matches nothing; --listFiles, or a config that
  // read no input reads as a clean project (lib/tsc-log.mjs, THE GREEN RULE).
  const r = runTool(ctx, bin(ctx, 'tsc'), ['--noEmit', '--pretty', 'false', '--listFiles', '-p', tsconfig], { cwd: ctx.wt, logPath });
  ctx.children.push({ what: `tsc.${label}`, argv: r.argv, exitCode: r.code, log: logPath });
  if (r.spawnError) return { read: { ok: false, verdict: 'cannot-verify', reason: `tsc could not be spawned: ${r.spawnError}` }, code: null };
  return { read: readTsc(logPath), code: r.code };
}

/**
 * Channel 2 — behaviour. The filter is the FILE PATH, positional (measured: the repo-relative
 * spelling matches, and `classname` comes back in that same spelling).
 *
 * The argv is `jestArgv` from `./run.mjs` plus this gate's own path filter, and the JUnit path is
 * NOT in it: jest-junit reads `JEST_JUNIT_OUTPUT_FILE` from the environment, which `jestEnv` builds
 * and `runTool` records as `envExtra`. Neither builder is restated here — one command has one
 * builder, or two call sites eventually answer differently about the same run.
 *
 * → `{ ok, reason, junit, json, code }`
 */
function testChannel(ctx, kind, files, label) {
  const xml = artifactPath(ctx.runDir, `${label}.junit.xml`);
  const json = artifactPath(ctx.runDir, `${label}.json`);
  const logPath = artifactPath(ctx.runDir, `jest.${label}.log`);
  // `filter: null` — the cases are selected afterwards out of the artifact by exact name equality,
  // because `-t` is an unanchored substring match and cannot stand for a case (see the header).
  const args = [...jestArgv(kind, { json, filter: null }), ...files];
  const env = jestEnv({ junit: xml });
  const r = runTool(ctx, bin(ctx, 'jest'), args, { cwd: ctx.wt, logPath, env });
  ctx.children.push({ what: `jest.${label}`, argv: r.argv, envExtra: r.envExtra, exitCode: r.code, junit: xml, json });
  for (const a of [xml, json]) if (existsSync(a)) ctx.artifacts.push(a);
  if (r.spawnError)
    return { ok: false, reason: `jest could not be spawned: ${r.spawnError}`, junit: null, json: null, collection: [], code: null };

  const junitRead = readJUnit(xml);
  const jsonRead = readJestJson(json);

  // WHAT THE XML CANNOT SEE, THE JSON CAN NAME. A file that never loaded has no `<testsuite>` and
  // no `<testcase>` in the XML, so the XML of a run whose files all failed to collect is a bare
  // `<testsuites tests="0">` — refused below, and rightly, since it says nothing. The JSON channel
  // still carries one entry per uncollected file, and `collectionReason` reads its message. Mapped
  // here and nowhere else, so the caller classifies a collection failure through the same
  // `classifyRedReasons` as an ordinary one. The absolute path is matched by suffix, because the
  // JSON writes absolute and this gate speaks repo-relative (both measured).
  const collection = (jsonRead.collectionFailures ?? []).flatMap((f) => {
    const file = files.find((x) => f.name === x || f.name.endsWith(`/${x}`));
    if (file === undefined) return [];
    const c = collectionReason(f.message);
    return [{ file, name: file, type: '', reason: c.reason, specifier: c.specifier, message: c.message }];
  });

  if (!junitRead.ok)
    return {
      ok: false,
      reason: `${junitRead.reason} (jest exited ${r.code}: ${tail(r.out, 2)})`,
      junit: junitRead,
      json: jsonRead,
      collection,
      code: r.code,
    };

  // The positional filter is a path-FRAGMENT match (measured: `packages/core/test/skeleton` collected
  // two files), so a file whose path contains another's would land in the same process and the
  // isolation this gate promises would be gone without a word. The artifact says which files ran.
  const surplus = filesIn(junitRead).filter((f) => !files.includes(f));
  if (surplus.length)
    return {
      ok: false,
      reason:
        `the run collected ${surplus.length} file(s) nobody asked for: ${surplus.join(', ')} — a positional argument is a regex over ` +
        'the test PATH, so a path that contains another path shares its process, and a verdict from a shared process is not isolated. ' +
        'What to do: rename so that no test path is a fragment of another.',
      junit: junitRead,
      json: jsonRead,
      collection,
      code: r.code,
    };

  // A FILE THAT NEVER LOADED IS NOT IN THIS XML. The reconciliation that used to stand here read a
  // run whose every `<testcase>` was a collection failure and let it through as the honest crash-red
  // it was. MEASURED 2026-11-02, that run no longer exists: jest-junit omits an uncollected file's
  // `<testsuite>` entirely, so a run whose files all failed to collect writes `<testsuites
  // tests="0">` and is already refused by `readJUnit` above, and a run where only some failed comes
  // back short by exactly those files — which is the disagreement `crossCheck` reports below,
  // because its measured identity (XML tests === JSON total + collection failures) was closed on the
  // synthetic cases Vitest wrote and Jest does not. The JSON channel is the only one that still
  // counts them (`status: 'failed'`, no `assertionResults`, `Test suite failed to run`).
  //
  // Nothing is reconciled here instead, and that is the point: `crossCheck` and `isCollectionFailure`
  // live in lib/, this gate is not their owner, and a second arithmetic written at this call site
  // would be a gate marking its own premise as met. CANNOT VERIFY blocks, which is the honest answer
  // until those readers are re-measured against Jest (header: WHAT THE JEST ARTEFACT DOES NOT CARRY).
  const cross = crossCheck(junitRead, jsonRead);
  if (!cross.agree)
    return {
      ok: false,
      reason: `the two channels of one run disagree: ${cross.reasons.join('; ')}`,
      junit: junitRead,
      json: jsonRead,
      collection,
      code: r.code,
    };
  return { ok: true, reason: null, junit: junitRead, json: jsonRead, collection, code: r.code };
}

// ═══════════════════════════════════════════════════════════════════════ classification

/** `path:line` for a case, out of the enumeration — so every label names a place in the source. */
function placeOf(listed, file, name) {
  const c = (listed?.cases ?? []).find((x) => x.name === name);
  return c ? `${file}:${c.line}` : `${file}:1`;
}

/** One red case in the shape `classifyRedReasons` wants: its name plus the measured reason it is red. */
function caseReason(c) {
  const r = redReason(c.failure);
  return { name: c.name, reason: r.reason, type: r.type, message: r.message, specifier: r.specifier };
}

/**
 * The identifier a missing-symbol diagnostic is about, or null when it quotes none.
 *
 * TS2305/TS2694/TS2724 quote the MODULE first and the member last (`Module '"./x"' has no exported
 * member 'y'`), so the pick depends on the code. A string that is not an identifier (a path, a
 * sentence fragment) is refused rather than grepped for.
 */
export function symbolOf(diag) {
  const parts = [...String(diag?.msg ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (!parts.length) return null;
  const pick = ['TS2305', 'TS2694', 'TS2724'].includes(diag?.code) ? parts[parts.length - 1] : parts[0];
  return /^[A-Za-z_$][\w$]*$/.test(pick) ? pick : null;
}

/**
 * What the type channel says about the file under judgement. → `{ usable, stagedClean, why, note }`
 *
 * `usable: false` is CANNOT VERIFY for every file of the run, and `why` names the paths.
 * `stagedClean: true` means THE JUDGED FILE'S OWN types hold, which is what decides whether an
 * assertion-red is `✓ red on base` or `crash-red (weaker, PENDING IMPLEMENTATION)`.
 *
 * THE PARTITION IS THE POINT, and a run of this gate against its own second test commit is what
 * taught it: the base of a test-phase branch legitimately carries spec tests whose implementation is
 * still absent — that IS the pending-implementation state — so tsc reports THEIR diagnostics too
 * when it typechecks the package. Measured in a probe repository on 2026-11-01: judging a modified
 * `S2_honest-red.test.ts` whose base already held an unimplemented `S3_absent-module.test.ts` read
 * CANNOT VERIFY, because S3's TS2307 is located in a file this run did not stage. The gate would
 * have refused every second test commit of every branch, for a diagnostic that says nothing about
 * the file it was judging.
 *
 * So the diagnostics are split by where they live:
 *  - in a file this run STAGED → about the judged file; the pending rules below apply to these, and
 *    they are what makes `stagedClean` false;
 *  - in a spec test the BASE already carries → the base's own pending state; reported as a note, and
 *    it changes no verdict (the behaviour channel does not typecheck at all, so a type error in
 *    another file cannot manufacture a pass here);
 *  - anywhere else — `src`, a support file, a config → CANNOT VERIFY. A base that does not compile
 *    for a reason nobody declared is not a base.
 *
 * `classifyPending` is still the one reader of the closed missing-symbol set, over the union of the
 * first two places, so a syntax error or a `not-installed` specifier in EITHER place fails closed.
 *
 * The name check can only disqualify (see the header), and it is applied to the STAGED diagnostics
 * only. `everWritten(name) === true` means the symbol exists in a source tree at the base or at
 * HEAD, so the red is a REGRESSION and the verdict drops to CANNOT VERIFY. TS2554/TS2555 quote no
 * identifier at all: an argument-count error is a signature that moved, not an implementation that
 * is absent, so it cannot be excused either.
 */
function typeVerdict(ctx, read, staged) {
  if (read.verdict === 'green') return { usable: true, stagedClean: true, why: 'the types hold on the base', note: null };
  if (read.verdict !== 'red') return { usable: false, stagedClean: false, why: `the type channel is unusable: ${read.reason}`, note: null };

  const isStagedSpecTest = (p) => staged.has(relPath(p)) && classify(relPath(p)).isSpecTest;
  const isBaseSpecTest = (p) =>
    !staged.has(relPath(p)) && classify(relPath(p)).isSpecTest && existsAtRev(ctx.mergeBase, relPath(p), { cwd: ctx.root });

  const pend = classifyPending(read, (p) => isStagedSpecTest(p) || isBaseSpecTest(p), { workspacePackages: ctx.workspacePackages });
  if (!pend.pending) return { usable: false, stagedClean: false, why: `${read.reason}; ${pend.why}`, note: null };

  const mine = (read.diagnostics ?? []).filter((d) => isStagedSpecTest(d.path));
  const theirs = (read.diagnostics ?? []).filter((d) => !isStagedSpecTest(d.path));
  const note = theirs.length
    ? `the base carries ${theirs.length} missing-symbol diagnostic(s) of its own, in spec tests this run did not stage ` +
      `(${theirs.map((d) => `${d.path}:${d.line} ${d.code}`).join(', ')}) — that is the base's pending implementation, and it is not about the file being judged`
    : null;
  if (!mine.length) return { usable: true, stagedClean: true, why: 'the judged file typechecks on the base', note };

  const regressions = [];
  const unnameable = [];
  for (const d of mine) {
    const mod = classifyTs2307(d, { workspacePackages: ctx.workspacePackages });
    if (mod.reason === 'missing-module') {
      const atBase = moduleExistedAt(ctx, ctx.mergeBase, d.path, mod.specifier);
      if (atBase) regressions.push(`${d.path}:${d.line} ${d.code} names ${mod.specifier}, which EXISTS at ${ctx.mb7} as ${atBase}`);
      continue;
    }
    if (d.code === 'TS2554' || d.code === 'TS2555') {
      unnameable.push(`${d.path}:${d.line} ${d.code} quotes no identifier (${d.msg})`);
      continue;
    }
    const name = symbolOf(d);
    if (!name) {
      unnameable.push(`${d.path}:${d.line} ${d.code} quotes no identifier (${d.msg})`);
      continue;
    }
    if (everWritten(ctx, name) === true)
      regressions.push(`${d.path}:${d.line} ${d.code} names ${JSON.stringify(name)}, which EXISTS under packages/*/src or apps/*/src`);
  }
  if (regressions.length)
    return {
      usable: false,
      stagedClean: false,
      why:
        `${regressions.length} diagnostic(s) name something that was already written: ${regressions.join('; ')} — that is a regression, ` +
        'not a pending implementation. What to do: fix the import or the call, and let the test fail on an assertion instead.',
      note,
    };
  if (unnameable.length)
    return {
      usable: false,
      stagedClean: false,
      why:
        `${unnameable.length} diagnostic(s) cannot be checked against the sources: ${unnameable.join('; ')}. ` +
        'What to do: build the Given from types that already exist, so the test fails on an assertion rather than on the compiler.',
      note,
    };
  return { usable: true, stagedClean: false, why: `${mine.length} missing-symbol diagnostic(s) in the staged file(s): ${mine.map((d) => `${d.path}:${d.line} ${d.code}`).join(', ')}`, note };
}

/**
 * Turn the reasons of a set of red cases into this gate's vocabulary.
 * → `{ verdict: 'red'|'crash-red'|'crash-red-pending'|'cannot-verify', why }`
 *
 * `tscGreen` decides which half of the classification applies: with clean types only an
 * `AssertionError` is proven red, and the measured "not written yet" runtime signatures are
 * crash-red (weaker). `everWritten` is injected so a probe can call this function without a
 * repository.
 */
export function classifyRedReasons(reasons, { tscGreen, everWritten: wasWritten = () => null } = {}) {
  const kinds = new Set(reasons.map((r) => r.reason));
  const shown = reasons.map((r) => `${JSON.stringify(r.name ?? '')} ${r.reason}${r.specifier ? ` (${r.specifier})` : ''}`).join(', ');
  if (kinds.has('not-installed'))
    return {
      verdict: 'cannot-verify',
      why:
        `a case failed with \`Cannot find package …\`: ${shown} — the base worktree is not installed, so nothing about the test was measured. ` +
        'What to do: re-run; the install is a premise of this gate, not a step in it.',
    };
  if (kinds.has('unknown'))
    return {
      verdict: 'cannot-verify',
      why:
        'a case failed for a reason this gate cannot name: ' +
        reasons
          .filter((r) => r.reason === 'unknown')
          .map((r) => `${JSON.stringify(r.name)} ${r.type}: ${r.message}`)
          .join('; ') +
        '. What to do: make the test fail on an assertion, or add the signature to lib/junit-xml.mjs with a measurement beside it.',
    };
  if (kinds.size === 1 && kinds.has('assertion')) {
    if (tscGreen) return { verdict: 'red', why: `every case failed on an assertion: ${shown}` };
    return { verdict: 'crash-red-pending', why: `every case failed on an assertion, but the types do not hold on the base: ${shown}` };
  }
  const regressions = reasons
    .filter((r) => r.reason === 'missing-symbol' && wasWritten(r.specifier) === true)
    .map((r) => `${JSON.stringify(r.specifier)} (as called in ${JSON.stringify(r.name)})`);
  if (regressions.length)
    return {
      verdict: 'cannot-verify',
      why:
        `a case failed on a name that EXISTS under packages/*/src or apps/*/src: ${regressions.join(', ')} — that is a regression, ` +
        'not a pending implementation. What to do: fix the call, or assert the behaviour the spec adds.',
    };
  return {
    verdict: tscGreen ? 'crash-red' : 'crash-red-pending',
    why: `${shown} — a measured "not written yet" signature, which cannot tell a vacuous case from a real one`,
  };
}

const classifyWith = (ctx, reasons, opts) => classifyRedReasons(reasons, { ...opts, everWritten: (n) => everWritten(ctx, n) });

/** Record one file-level verdict under this gate's labels, and print it as it is recorded. */
function record(ctx, file, v) {
  if (v.verdict === 'red') {
    ctx.red.push({ file, why: v.why, weaker: false });
    log(`${LABELS.red}: ${file} — ${v.why}`);
    return;
  }
  if (v.verdict === 'crash-red' || v.verdict === 'crash-red-pending') {
    const label = v.verdict === 'crash-red' ? LABELS.crashRed : LABELS.crashRedPending;
    ctx.red.push({ file, why: `${label}: ${v.why}`, weaker: true });
    log(
      `✓ ${label}: ${file} — ${v.why}` +
        (v.verdict === 'crash-red' ? ' (prefer assertion-red)' : ' (re-proven by the next red-check once the implementation lands)'),
    );
    return;
  }
  if (v.verdict === 'green') {
    ctx.green.push({ file, why: v.why });
    log(`${LABELS.green}: ${file} — ${v.why}`);
    return;
  }
  refuse(ctx, file, v.why);
}

// ══════════════════════════════════════════════════════════════════════════════ routes

function runRoutes(ctx) {
  for (const kind of JEST_KINDS) {
    const files = ctx.scope.added.filter((c) => c.kind === kind);
    const mods = ctx.scope.modified.filter((m) => m.info.kind === kind);
    if (!files.length && !mods.length) continue;

    let isolate = true;
    if (ctx.args.mode === 'group') {
      const anySupport = files.some((c) => [...stagedFor(ctx, c)].some((p) => isTestSupport(p) || isContract(p)));
      if (anySupport) log(`--group ignored for kind ${kind}: a support/fixture or contract file is staged, so every file runs alone`);
      else if (files.length < GROUP_MIN_FILES) log(`--group ignored for kind ${kind}: ${files.length} file(s) < ${GROUP_MIN_FILES}, so every file runs alone`);
      else isolate = false;
    }
    log(`kind ${kind}: ${files.length} added file(s), ${mods.length} modified file(s) with new case(s); mode ${isolate ? 'isolate' : 'group'}`);

    if (isolate) for (const c of files) addedFileRun(ctx, kind, [c], tag(c.path));
    else if (files.length) addedFileRun(ctx, kind, files, `group-${kind}`);
    for (const m of mods) modifiedFileRun(ctx, kind, m);
  }
}

/** One base run for one added file (or, under `--group`, for a whole kind's added files). */
function addedFileRun(ctx, kind, infos, label) {
  const all = (v) => {
    for (const c of infos) record(ctx, c.path, v(c));
  };
  const bad = resetToBase(ctx);
  if (bad) {
    all(() => ({ verdict: 'cannot-verify', why: bad }));
    return;
  }
  const wanted = new Set(infos.flatMap((c) => [...stagedFor(ctx, c)]));
  const created = dirsStagingWouldCreate(ctx, wanted);
  const unstageable = stage(ctx, wanted, new Map());
  if (unstageable) {
    unstage(ctx, created, wanted);
    all(() => ({ verdict: 'cannot-verify', why: unstageable }));
    return;
  }
  log(`staged for ${infos.map((c) => c.path).join(' + ')}: ${[...wanted].join(', ')}`);
  try {
    const confirmed = confirmStaged(ctx, wanted, new Map());
    if (confirmed) {
      all(() => ({ verdict: 'cannot-verify', why: confirmed }));
      return;
    }
    const types = typeChannel(ctx, kind, label);
    const tv = typeVerdict(ctx, types.read, wanted);
    if (tv.note) log(`note: ${tv.note}`);
    if (!tv.usable) {
      all(() => ({ verdict: 'cannot-verify', why: tv.why }));
      return;
    }
    const tscGreen = tv.stagedClean;

    const t = testChannel(
      ctx,
      kind,
      infos.map((c) => c.path),
      label,
    );
    if (!t.ok) {
      // A file the JSON names as never having loaded is still judgeable: that is the commonest
      // shape of the red-test phase (a test importing what nobody has written), and the measured
      // reason says whether it is an absence or something else. `crash-red` is the weaker verdict
      // it has always been — never `red`, because a file that did not load proves no assertion —
      // and `not-installed` or an unnamed signature still blocks, through classifyRedReasons.
      // A file the JSON does NOT name has no honest reading at all, so it blocks on t.reason.
      for (const c of infos) {
        const hit = (t.collection ?? []).find((x) => x.file === c.path);
        if (hit === undefined) {
          record(ctx, c.path, { verdict: 'cannot-verify', why: t.reason });
          continue;
        }
        const v = classifyWith(ctx, [hit], { tscGreen });
        record(
          ctx,
          c.path,
          v.verdict === 'cannot-verify'
            ? v
            : { verdict: v.verdict === 'red' ? 'crash-red' : v.verdict, why: `${c.path} never loaded on the base — ${v.why}` },
        );
      }
      return;
    }
    for (const c of infos) {
      const src = showAt(ctx, 'HEAD', c.path);
      if (src === null) {
        record(ctx, c.path, { verdict: 'cannot-verify', why: 'its HEAD version cannot be read, so its declared cases are unknown' });
        continue;
      }
      const listed = listCases(src, { file: c.path });
      if (listed.cannotVerify) {
        record(ctx, c.path, {
          verdict: 'cannot-verify',
          why:
            `its cases are not enumerable from the source (${listed.note ?? listed.unparsable.join('; ')}), so the artifact's cases ` +
            'cannot be checked against anything. What to do: give every case a literal title.',
        });
        continue;
      }
      record(ctx, c.path, fileLevelVerdict(ctx, c.path, listed, t.junit, { tscGreen, pendingWhy: tv.why }));
    }
  } finally {
    unstage(ctx, created, wanted);
  }
}

/** The verdict for one file inside one base run, read from the artifact. */
function fileLevelVerdict(ctx, file, listed, junit, { tscGreen, pendingWhy }) {
  const fv = fileVerdict(junit, { file, expectedNames: listed.names, expected: listed.expected });
  if (fv.verdict === 'green') {
    const names = fv.cases.filter((c) => toTri(c) === 'green').map((c) => c.name);
    return {
      verdict: 'green',
      why:
        `${names.map((n) => `${placeOf(listed, file, n)} ${JSON.stringify(n)}`).join(', ')} PASSED on the base. ` +
        'A new test that is green on the base guards nothing — it restates existing behaviour or asserts nothing at all. ' +
        'What to do: assert the behaviour the spec adds, or move the test into a separate hardening commit with a rationale.',
    };
  }
  if (fv.verdict === 'red') {
    const c = classifyWith(ctx, fv.reasons, { tscGreen });
    return { ...c, why: tscGreen ? c.why : `${c.why}; ${pendingWhy}` };
  }
  // CANNOT VERIFY from the artifact. A collection failure is the one shape that can still be
  // crash-red: the file never loaded, and the measured reason says whether that is an absence.
  //
  // This filter reads the XML, where an uncollected file leaves NO row under this producer, so it
  // finds nothing here and the verdict below is CANNOT VERIFY. The live path for that shape is in
  // the caller, which reads it off the JSON channel (header item 2) — this one is kept because
  // `isCollectionFailure`'s suffix form is still correct for any producer that does emit a
  // synthetic case, and a gate that silently stopped looking would be the worse failure.
  const collection = (fv.cases ?? []).filter(isCollectionFailure);
  if (collection.length) {
    const c = classifyWith(ctx, collection.map(caseReason), { tscGreen });
    if (c.verdict === 'cannot-verify') return c;
    return { verdict: c.verdict === 'red' ? 'crash-red' : c.verdict, why: `${file} never loaded on the base — ${c.why}` };
  }
  return { verdict: 'cannot-verify', why: fv.why };
}

/**
 * A modified file, judged per CASE: its HEAD version over the base's own file, then the base version
 * alone. A case of the first run that the second does not have is NEW.
 */
function modifiedFileRun(ctx, kind, { info, file, diff }) {
  const headSrc = showAt(ctx, 'HEAD', file);
  const baseSrc = showAt(ctx, ctx.mergeBase, file);
  if (headSrc === null) {
    record(ctx, file, { verdict: 'cannot-verify', why: 'its HEAD version cannot be read' });
    return;
  }
  const listed = listCases(headSrc, { file });
  const declaredNew = diff.added.map((c) => c.name);
  const renamedTo = new Set(diff.renamed.map((r) => r.to.name));

  // ── run 1: the HEAD version, staged over the base's own file ───────────────────────────────
  const bad = resetToBase(ctx);
  if (bad) {
    record(ctx, file, { verdict: 'cannot-verify', why: bad });
    return;
  }
  const wanted = stagedFor(ctx, info);
  const created = dirsStagingWouldCreate(ctx, wanted);
  const contents = new Map([[file, headSrc]]);
  const unstageable = stage(ctx, wanted, contents);
  if (unstageable) {
    unstage(ctx, created, wanted);
    record(ctx, file, { verdict: 'cannot-verify', why: unstageable });
    return;
  }
  log(`staged for ${file} (its HEAD version over the base's own file; new case(s) ${quoted(declaredNew)}): ${[...wanted].join(', ')}`);
  let run1 = null;
  let tscGreen = false;
  let pendingWhy = '';
  try {
    const confirmed = confirmStaged(ctx, wanted, contents);
    if (confirmed) {
      record(ctx, file, { verdict: 'cannot-verify', why: confirmed });
      return;
    }
    const types = typeChannel(ctx, kind, `${tag(file)}.head`);
    const tv = typeVerdict(ctx, types.read, wanted);
    if (tv.note) log(`note: ${tv.note}`);
    if (!tv.usable) {
      record(ctx, file, { verdict: 'cannot-verify', why: tv.why });
      return;
    }
    tscGreen = tv.stagedClean;
    pendingWhy = tv.why;
    const t = testChannel(ctx, kind, [file], `${tag(file)}.head`);
    if (!t.ok) {
      record(ctx, file, { verdict: 'cannot-verify', why: t.reason });
      return;
    }
    run1 = t.junit;
  } finally {
    unstage(ctx, created, wanted);
  }

  const mine = (run1.cases ?? []).filter((c) => c.classname === file);
  if (!mine.length) {
    record(ctx, file, {
      verdict: 'cannot-verify',
      why: `no <testcase classname="${file}"> in the run; never ran is not red. What to do: check that the ${kind} project collects this path.`,
    });
    return;
  }
  if (mine.some(isCollectionFailure)) {
    const c = classifyWith(ctx, mine.filter(isCollectionFailure).map(caseReason), { tscGreen });
    record(ctx, file, {
      verdict: c.verdict === 'red' ? 'crash-red' : c.verdict,
      why:
        c.verdict === 'cannot-verify'
          ? c.why
          : `${file} never loaded on the base — ${c.why}; this covers the new case(s) ${quoted(declaredNew)}, which crash-red cannot tell apart`,
    });
    return;
  }

  // ── run 2: the base version alone — the case names the base already had ────────────────────
  let baseNames = null;
  if (baseSrc === null) log(`note: ${file} has no base version to compare case names against; its new cases come from the source diff`);
  else {
    const bad2 = resetToBase(ctx);
    if (bad2) log(`note: the base run of ${file} was not made (${bad2}); its new cases come from the source diff`);
    else {
      const t2 = testChannel(ctx, kind, [file], `${tag(file)}.base`);
      if (!t2.ok) log(`note: the base version of ${file} produced no usable run (${t2.reason}); its new cases come from the source diff`);
      else {
        const theirs = (t2.junit.cases ?? []).filter((c) => c.classname === file && !isCollectionFailure(c));
        if (theirs.length) baseNames = new Set(theirs.map((c) => c.name));
        else log(`note: the base version of ${file} produced no case; its new cases come from the source diff`);
      }
    }
  }

  const fresh = baseNames
    ? mine.filter((c) => !baseNames.has(c.name) && !renamedTo.has(c.name))
    : mine.filter((c) => declaredNew.includes(c.name));
  const how = baseNames ? "by name against the base version's own run" : 'from the source diff (the base version produced no run)';
  if (!fresh.length) {
    record(ctx, file, {
      verdict: 'cannot-verify',
      why:
        `the source gains ${declaredNew.length} case(s) (${quoted(declaredNew)}) but the run has no new case (${how}); never ran is not red. ` +
        'What to do: compare the case name in the artifact with the name in the source.',
    });
    return;
  }
  const greens = fresh.filter((c) => toTri(c) === 'green');
  if (greens.length) {
    record(ctx, file, {
      verdict: 'green',
      why:
        `new case(s) PASSED on the base (${how}): ${greens.map((c) => `${placeOf(listed, file, c.name)} ${JSON.stringify(c.name)}`).join(', ')}. ` +
        'What to do: assert the behaviour the spec adds, not behaviour the base already has.',
    });
    return;
  }
  const notRed = fresh.filter((c) => toTri(c) !== 'red');
  if (notRed.length) {
    record(ctx, file, {
      verdict: 'cannot-verify',
      why:
        'new case(s) did not execute (.skip or .todo — the XML cannot tell which): ' +
        `${notRed.map((c) => `${placeOf(listed, file, c.name)} ${JSON.stringify(c.name)}`).join(', ')}. ` +
        'What to do: write the case, or remove it from this commit.',
    });
    return;
  }
  const c = classifyWith(ctx, fresh.map(caseReason), { tscGreen });
  record(ctx, file, {
    ...c,
    why:
      `${fresh.length} new case(s) red on the base (${how}): ` +
      `${fresh.map((x) => placeOf(listed, file, x.name)).toSorted().join(', ')} — ${c.why}${tscGreen ? '' : `; ${pendingWhy}`}`,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════ the report

/** Fail closed: any green OR any CANNOT VERIFY ends the gate at exit 1. → the exit code. */
function report(ctx) {
  const weaker = ctx.red.filter((r) => r.weaker).length;
  const exitCode = ctx.green.length || ctx.unverifiable.length ? 1 : 0;
  const total = ctx.scope.added.length + ctx.scope.modified.length;
  const unique = [...new Set(ctx.artifacts)];
  if (unique.length) log(`artifacts: ${unique.join(', ')}`);

  if (ctx.runDir !== null && existsSync(ctx.runDir)) {
    const st = statusPorcelain([], { cwd: ctx.root });
    const summary = {
      gate: 'red-check',
      argv: process.argv.slice(1),
      startedAt: ctx.startedAt,
      base: ctx.mergeBase,
      baseRef: ctx.args.since ? null : ctx.args.base,
      since: ctx.args.since,
      head: ctx.head?.sha ?? null,
      kind: ctx.args.kind,
      mode: ctx.args.mode,
      scope: {
        added: ctx.scope.added.map((c) => c.path),
        modifiedWithNewCases: ctx.scope.modified.map((m) => m.file),
        skeletonSkipped: ctx.scope.skeleton,
        supportStaged: ctx.scope.support,
        contractsStaged: ctx.scope.contracts,
        contractsOffered: ctx.scope.contractsOffered,
      },
      installRefusal: ctx.installRefusal,
      red: ctx.red,
      green: ctx.green,
      cannotVerify: ctx.unverifiable,
      // Every judged child's own exit code, kept where it stays advisory: the verdicts above were
      // read from the artifacts, never from a status.
      children: ctx.children,
      artifacts: unique,
      exitCode,
    };
    try {
      const p = artifactPath(ctx.runDir, 'summary.json');
      writeFileSync(p, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
      log(`summary: ${p}`);
    } catch (e) {
      log(`note: could not write summary.json: ${firstLine(e.message)}`);
    }
    try {
      writeRunJson(ctx.runDir, {
        head: ctx.head?.sha ?? null,
        treeClean: st.ok ? st.entries.length === 0 : null,
        argv: process.argv.slice(1),
        exitCode,
        startedAt: ctx.startedAt,
        kind: ctx.args.kind,
        base: ctx.mergeBase,
        children: ctx.children,
      });
    } catch (e) {
      log(`note: could not write run.json: ${firstLine(e.message)}`);
    }
  }

  if (exitCode === 0) {
    log(
      `all ${ctx.scope.added.length} added test file(s) individually red on the base` +
        (ctx.scope.modified.length ? `, and the new cases of ${ctx.scope.modified.length} modified test file(s) red by name` : '') +
        (weaker ? ` (${weaker} ${LABELS.crashRed} — prefer assertion-red)` : '') +
        ' ✓',
    );
    return 0;
  }
  console.error(
    `\n[red-check] FAILED: ${ctx.red.length} red, ${ctx.green.length} green, ${ctx.unverifiable.length} ${CV.toLowerCase()} ` +
      `(the route carried ${total} file(s); a file outside it can still be refused):\n` +
      [...ctx.green.map((g) => `  - GREEN on base: ${g.file} — ${g.why}`), ...ctx.unverifiable.map((u) => `  - ${CV}: ${u.why}`)].join('\n') +
      '\n\nA spec-first test must be PROVEN red before its code exists.\n' +
      '  GREEN means the assertion is vacuous or restates behaviour the base already has.\n' +
      `  ${CV} means the gate could not execute the file honestly — and it blocks exactly like a green,\n` +
      '  because "it never ran" is not "it is red". Fix the placement, the config or the premise named above.\n' +
      '  There is no exemption trailer: the base worktree is installed from the base lockfile and typechecked\n' +
      '  from base sources, so a green verdict is always about the test.',
  );
  return 1;
}

// ══════════════════════════════════════════════════════════════════════════════════ main

/**
 * The whole gate. → the exit code; it never calls `process.exit` itself, so a probe can run it in
 * process and read the number.
 */
export function main(argvIn = process.argv.slice(2)) {
  const startedAt = new Date().toISOString();
  const args = parseArgs(argvIn);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (!args.ok) {
    for (const e of args.errors) console.error(`[red-check] ${String(e)}`);
    console.error(USAGE);
    return 2;
  }

  const rr = repoRoot();
  if (!rr.ok) {
    console.error(`[red-check] not a git repository: ${rr.reason}`);
    return 2;
  }
  const root = rr.root;
  // Every gate chdir's to the repository root first: run from a subdirectory, a relative pathspec
  // silently matches nothing (lib/git.mjs).
  process.chdir(root);

  if (!hasCommits({ cwd: root })) {
    console.error(
      `[red-check] ${CV}: the repository has no commits, so there is no range and no base to check out.\n` +
        '  red-check reads HEAD and a merge base, never the index and never the working tree.\n' +
        '  What to do: commit the scaffold first (git add -A && git commit), then re-run.',
    );
    return 2;
  }
  const head = headSha({ cwd: root });
  if (!head.ok) {
    console.error(`[red-check] ${CV}: HEAD does not resolve: ${head.reason}`);
    return 2;
  }

  let mergeBase = null;
  if (args.since !== null) {
    if (args.since === EMPTY_TREE) {
      console.error(
        `[red-check] ${CV}: --since names the empty tree (${EMPTY_TREE}). A worktree can only be checked out at a COMMIT,\n` +
          '  so there would be no base to run the tests against.\n' +
          '  What to do: pass --since <first commit> or --base <branch>.',
      );
      return 2;
    }
    const r = revParse(args.since, { cwd: root });
    if (!r.ok) {
      console.error(`[red-check] ${CV}: --since ${JSON.stringify(args.since)} does not resolve to a commit: ${r.reason}`);
      return 2;
    }
    mergeBase = r.sha;
  } else {
    const b = baseRev(args.base, { cwd: root });
    if (!b.ok) {
      console.error(`[red-check] ${CV}: no base revision: ${b.reason}`);
      return 2;
    }
    if (b.kind === 'empty-tree') {
      console.error(
        `[red-check] ${CV}: ${b.reason}. Every file would count as added, and a worktree cannot be checked out at the empty tree,\n` +
          '  so nothing could be run on a base.\n' +
          `  What to do: create ${args.base}, or pass --since <sha> naming a real commit.`,
      );
      return 2;
    }
    mergeBase = b.rev;
  }

  const ctx = newCtx({ root, args, head, mergeBase, startedAt });
  log(
    `range ${ctx.mb7}..${head.sha.slice(0, 7)} (base: ${args.since ? `--since ${String(args.since)}` : `merge-base with ${args.base}`}); ` +
      `kind ${args.kind}; mode ${args.mode}`,
  );

  const scopeFailure = collectScope(ctx);
  if (scopeFailure) {
    console.error(`[red-check] ${CV}: ${scopeFailure}`);
    return 2;
  }

  if (!ctx.scope.added.length && !ctx.scope.modified.length) {
    if (ctx.unverifiable.length) return report(ctx);
    log('no added test file and no new case in a modified test file on this branch — nothing to red-check ✓');
    return 0;
  }

  ctx.runDir = makeRunDir({ label: 'redcheck', kind: ctx.args.kind, root }).dir;
  log(`run of record: ${ctx.runDir}`);
  ctx.workspacePackages = basePackageNames(ctx);

  const refusal = makeWorktree(ctx);
  if (refusal) {
    for (const c of ctx.scope.added) refuse(ctx, c.path, refusal);
    for (const m of ctx.scope.modified) refuse(ctx, m.file, refusal);
    return report(ctx);
  }

  try {
    const refused = installBase(ctx);
    ctx.installRefusal = refused;
    if (refused !== null) {
      log(`${CV} on the whole route — the install is a premise: ${refused}`);
      for (const c of ctx.scope.added) refuse(ctx, c.path, refused);
      for (const m of ctx.scope.modified) refuse(ctx, m.file, refused);
    } else {
      runRoutes(ctx);
    }
  } catch (e) {
    // A gate that throws reports a stack trace instead of a verdict. This turns the throw into the
    // verdict it actually is: nothing was proven about any file still unjudged on the route.
    const why = `red-check itself failed: ${String(e?.stack ?? e?.message ?? e).split('\n').slice(0, 3).join(' | ')}`;
    for (const c of ctx.scope.added) if (!judged(ctx, c.path)) refuse(ctx, c.path, why);
    for (const m of ctx.scope.modified) if (!judged(ctx, m.file)) refuse(ctx, m.file, why);
  } finally {
    removeWorktree(ctx);
  }

  return report(ctx);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
