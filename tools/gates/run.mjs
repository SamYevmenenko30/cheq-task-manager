#!/usr/bin/env node
/**
 * run.mjs — the wrapper of every RUN OF RECORD, and the ONLY place in this
 * repository where a runner's command line is built.
 *
 *     node tools/gates/run.mjs types --kind <core|api|web|all> [--label <l>] [--expect-head <sha>]
 *     node tools/gates/run.mjs test  --kind <core|api|web|all> [--label <l>] [--expect-head <sha>] [--filter <re>]
 *     node tools/gates/run.mjs lint  [--label <l>] [--expect-head <sha>]
 *     node tools/gates/run.mjs e2e   [--label <l>] [--expect-head <sha>]
 *     … any lane, plus --dry-run: every refusal is still checked, the argv is
 *       printed, nothing is spawned and nothing is written (always exit 2).
 *
 * Zero dependencies: `node:` builtins plus tools/gates/lib. A gate must run in a
 * worktree before an install has finished, which is exactly when it is needed.
 *
 * WHY ONE PLACE. Five facts about these command lines were MEASURED — the lint
 * one on 2026-11-01, the rest on 2026-11-02 against jest 30 — and each of them
 * turns a hand-typed invocation into a silent lie. A second caller that
 * assembles its own argv gets one of them wrong:
 *
 *  1. HALF THE ARTIFACT CONTRACT IS NOT IN THE ARGV. `jest-junit` is declared in
 *     jest.config.mjs with NO `outputFile`, so it takes its path from the
 *     environment variable `JEST_JUNIT_OUTPUT_FILE`. Measured without it: the
 *     reporter writes `junit.xml` into the CWD — one file every run overwrites.
 *     So `jestEnv` below is as load-bearing as `jestArgv`, and `runTool` records
 *     what it put in the child's environment as `envExtra` in `run.json`, which
 *     is what L-artifacts judges (REQUIRED_ENV there).
 *  2. THE DOTTED `--outputFile` FORM IS SILENTLY IGNORED. `--outputFile.json=B`
 *     was the PREVIOUS runner's required form; measured on this one, the parser
 *     takes it without a word, runs every test and writes NO FILE. That is worse
 *     than the crash it used to cause, because the run looks complete: exit code
 *     from the tests, full console output, no artifact. One bare
 *     `--outputFile=<path>` is the only legal form, and L-artifacts refuses the
 *     dotted one.
 *  3. oxlint's type-aware rules do not run without `--type-aware`, and NOTHING
 *     says so — the output looks like a clean pass
 *     (tools/gates/lib/oxlint-json.mjs:11-16). The flag is therefore recorded in
 *     `run.json` as `typeAware`, so a light can assert the run was type-aware
 *     instead of assuming it.
 *  4. The runner does not typecheck AT ALL (`@swc/jest` strips types in Rust),
 *     so a missing export reaches the XML as a runtime error that is
 *     indistinguishable from an assertion. That is why the `test` lane runs BOTH
 *     halves — `tsc` and `jest` — on every run of record, and why
 *     `tsc.<kind>.log` sits beside `<kind>.junit.xml` in the same run directory
 *     (TD-0004).
 *  5. A `-t` FILTER THAT MATCHES NOTHING EXITS 0 AND CALLS ITSELF A SUCCESS.
 *     Measured on the `core` project with a pattern matching no case: exit 0,
 *     `success: true`, `numTotalTests: 17`, `numPassedTests: 0`,
 *     `numPendingTests: 17`. No flag prevents it — `--passWithNoTests` governs
 *     whether test FILES were found, and they were. The guard is therefore in
 *     the READER: `readJestJson` refuses a report in which `passed + failed`
 *     is zero, because a run that executed no case says nothing about the code.
 *
 * THE VERDICT COMES FROM THE ARTIFACT; THE EXIT CODE IS EVIDENCE. Nothing here
 * pipes the output of the tool it is judging: `spawnSync` with an argv ARRAY and
 * no `shell`, the child's own `status` captured and written to `run.json`, and
 * the verdict read back out of the file the child wrote. Two exit codes lied in
 * the session that measured this toolchain — `eslint … | head` reported 0 over a
 * crash whose real exit was 2, and `tsc … | head -12` reported 0 over four
 * `error TS6059` — both times `$?` belonged to `head` (ADR-0002).
 *
 * THIS PROCESS'S OWN EXIT CODE is the verdict, in three values, and `0` is only
 * ever the first of them:
 *     0  green          every artefact read green
 *     1  red            an artefact says red
 *     2  cannot-verify  / n/a / REFUSED — nothing ran, or what ran cannot be
 *                       read, or this wrapper refused to start. "Never ran" is
 *                       not green, and a refusal is not a pass.
 *
 * WHAT IT REFUSES TO START ON, each with the cure named in the message:
 *   · a tracked tree that is dirty under `packages|apps|e2e|tools` — the
 *     artefact would describe a tree no commit contains (untracked files are not
 *     dirt: a planted fixture and a staged new test are how the gates are
 *     probed);
 *   · a HEAD that does not resolve, or that differs from `--expect-head`;
 *   · a live watcher (`pgrep -fl "$WATCHER_PATTERN"`): a dev
 *     server re-transforming the same files mid-run is shared state (rule 2);
 *   · a held `.ci/lock`. A lock whose pid is NOT alive is REPORTED and never
 *     removed silently (AGENTS.md rule 2) — the leftover of an aborted run and
 *     a run in flight look the same from outside, and guessing wrong corrupts
 *     the artefacts of a run somebody is still waiting on;
 *   · `e2e` while `.ci/probe.json` does not carry `browser_probe` observed:
 *     `CANNOT VERIFY (playwright browsers not installed — TD-0001)`, exit 2.
 *
 * ENVIRONMENT IS PINNED FOR EVERY CHILD: `TZ=UTC`, `LANG=C`, `LC_ALL=C`. A task
 * manager is deadlines, and `toLocaleDateString`/`toLocaleString` read the
 * machine's zone and locale — a case that passes in one zone and fails in
 * another is not a verdict about the code. `CI=1` so no runner can decide to
 * watch or to write a new snapshot; `NO_COLOR=1` so the artefacts and logs carry
 * no escape sequences for a reader to trip over.
 *
 * NO SECONDS ARE PROMISED ANYWHERE HERE. A duration is REPORTED into
 * `run.json` as what this run took; it is never compared with a budget, because
 * there is no calibration lane in this repository (TD-0002).
 */

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KINDS, VERDICT_LABELS, deriveVerify } from './lib/spec-parse.mjs';
import { headSha, isTreeClean, repoRoot } from './lib/git.mjs';
import { artifactPath, makeRunDir, writeRunJson } from './lib/run-dir.mjs';
import { readTsc } from './lib/tsc-log.mjs';
import { isCollectionFailure, nameMatches, readJUnit, redReason } from './lib/junit-xml.mjs';
import { crossCheck, readJestJson } from './lib/jest-json.mjs';
import { readOxlint } from './lib/oxlint-json.mjs';
import { artifactVerdict, projectState } from './lib/test-project.mjs';
import { premise, readProbe } from './lib/probe.mjs';

// ------------------------------------------------------------------ vocabulary

/** The four lanes. `kinds` says what `--kind` means for each one. */
export const LANES = Object.freeze({
  types: { kinds: 'required', halves: ['tsc'] },
  test: { kinds: 'required', halves: ['tsc', 'jest'] },
  lint: { kinds: 'refused', halves: ['oxlint'] },
  e2e: { kinds: 'implied', halves: ['playwright'] },
});
const LANE_NAMES = Object.keys(LANES);

/** The kinds a jest/tsc lane can be asked for. `e2e` is a lane, not a `--kind`. */
const TYPED_KINDS = KINDS.filter((k) => k !== 'e2e');

/** kind → the package whose tsconfig.json is the type artefact of record. */
const PACKAGE_OF_KIND = Object.freeze({
  core: 'packages/core',
  api: 'apps/api',
  web: 'apps/web',
});

/** The pathspec a dirty tree is judged over: the judged tree plus the gates. */
const JUDGED_PATHS = Object.freeze(['packages', 'apps', 'e2e', 'tools']);

/** One run of record at a time. See the header on why a stale lock is reported. */
const CI_LOCK = '.ci/lock';

/** The probe that lifts the browser lane out of CANNOT VERIFY. */
const BROWSER_PREMISE = 'browser_probe';

/** Pinned for every child — see the header. */
export const CHILD_ENV = Object.freeze({
  TZ: 'UTC',
  LANG: 'C',
  LC_ALL: 'C',
  LANGUAGE: '',
  // NO_COLOR alone. MEASURED: with `FORCE_COLOR=0` also set, node prints
  // `Warning: the 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being
  // set` into every artefact — so setting both made the colour pin weaker AND
  // added a line to each log.
  NO_COLOR: '1',
  CI: '1',
  // Jest's ESM support. Without it a `.test.ts` that imports anything dies with
  // "Cannot use import statement outside a module", which reads like a broken
  // source and is not one.
  NODE_OPTIONS: '--experimental-vm-modules',
});

/**
 * The judged failures whose reason this repository has NOT measured, which must
 * be CANNOT VERIFY rather than either kind of red.
 *
 * `redReason` answers from a CLOSED set (tools/gates/lib/junit-xml.mjs:57): an
 * assertion is honest red, a missing symbol or module is crash-red, a missing
 * PACKAGE is an uninstalled worktree — and anything else is `unknown`, which its
 * own documentation says a gate must treat as CANNOT VERIFY. Measured in this
 * session, and the reason this function exists: with the browsers absent,
 * playwright fails every case with `browserType.launch: Executable doesn't
 * exist at …`, which is an environment that was never built, not a test that
 * failed — and the lane printed RED for it.
 */
function unmeasuredFailures(cases) {
  return cases
    .filter((c) => c.status === 'failed' || c.status === 'errored')
    .map((c) => ({ name: c.name, r: redReason(c.failure) }))
    .filter((x) => x.r.reason === 'unknown');
}

/** The measured signature of a playwright run with no browser downloaded. */
const BROWSER_ABSENT_RE = /Executable doesn't exist at|Please run the following command to download new browsers/;

const EXIT = Object.freeze({ green: 0, red: 1, 'cannot-verify': 2, 'n/a': 2 });

/**
 * Flags a caller may not pass, each with the reason it would break the run.
 * A refusal here is louder than "unknown flag" on purpose: the combination is
 * one where the artefact is not written, or where the assertion is rewritten by
 * the run that was supposed to judge it.
 *
 * EVERY PATTERN HERE IS A SPELLING, so every pattern was re-measured against
 * `jest --help` on 2026-11-02 rather than carried over. Four of them had been
 * written for the previous runner's spelling and matched nothing on this one,
 * which is the quietest way for a forbidden-flag list to stop forbidding:
 *
 *   `--reporter`        → this runner's flag is PLURAL, `--reporters`. A caller
 *                         passing it replaces the reporter list and drops
 *                         jest-junit, so the JUnit artefact is simply never
 *                         written and the gate reads a missing file.
 *   `--update`          → this runner's long form is `--updateSnapshot`; only
 *                         the `-u` short form was caught.
 *   `--bail`            → has a `-b` short form here.
 *   `--project`         → this runner's flag is `--selectProjects`.
 *
 * A pattern that matches nothing is indistinguishable from an allowed flag, so
 * a new entry is written with the spelling read off `--help`, never from memory.
 */
export const FORBIDDEN = Object.freeze([
  {
    re: /^(--watch|--watchAll|-w)(=.*)?$/,
    why: 'a watch run never finishes and shares state with a dev session (rule 2) — it writes no final artefact, so there is nothing to read a verdict from',
  },
  {
    re: /^--passWithNoTests(=.*)?$/,
    why: "this runner's default is already the strict one — a run that finds no test FILE exits 1 (measured: \"No tests found, exiting with code 1\") — so passing this flag can only loosen it and turn \"nothing to run\" into a pass",
  },
  {
    re: /^(-u|--updateSnapshot)(=.*)?$/,
    why: 'rewriting a snapshot rewrites the assertion — the run would then agree with whatever the code happened to do',
  },
  {
    re: /^(-b|--bail)(=.*)?$/,
    why: 'a bailed run stops early, so the artefact describes fewer cases than the sources declare and the count can never reconcile',
  },
  {
    re: /^--silent(=.*)?$/,
    why: 'the outputFile is redirected, so the console is the only place a reporter crash shows up; silencing it leaves a missing artefact with no explanation',
  },
  {
    re: /^(-t|--testNamePattern)(=.*)?$/,
    why: 'use --filter <re>: it passes the same pattern AND reconciles the number of cases that ran against the number of declared names the pattern matches. A name pattern on its own is not a proof',
  },
  {
    re: /^--retry(=.*)?$/,
    why: "this runner has NO retry flag (measured against --help), so passing one is silently ignored and the caller is left believing retries were pinned. Refused loudly instead. The real hazard this cannot see is `jest.retryTimes()` in a setup file — a flag check reads the command line, not the code, and L-testguard is what guards a change to apps/web/test/setup.ts",
  },
  {
    re: /^--reporters?(=.*)?$/,
    why: 'this wrapper owns the reporters, because the artefact names are what the gates read: replacing the list drops jest-junit and the JUnit channel is then never written at all',
  },
  {
    re: /^--outputFile(\..*)?(=.*)?$/,
    why: 'this wrapper owns the artefact paths: the JSON channel comes from --outputFile and the JUnit one from JEST_JUNIT_OUTPUT_FILE in the environment, so a hand-passed path would send one artefact somewhere no gate reads',
  },
  {
    re: /^(--project|--selectProjects)(=.*)?$/,
    why: 'the jest project IS the kind: pass --kind <k> and this wrapper passes --selectProjects <k>, so a spec of another kind can never run under this label',
  },
  {
    re: /^--type-aware$/,
    why: 'the lint lane always passes --type-aware and records it in run.json; passing it by hand suggests it is optional, and without it the type rules silently do not run',
  },
]);

// -------------------------------------------------------------------- helpers

const short = (sha) => (typeof sha === 'string' && sha.length >= 7 ? sha.slice(0, 7) : 'none');

/**
 * The lane verdict from its halves. The ORDER is the whole content of this
 * function, and it is fail-closed twice over:
 *
 *   cannot-verify > red > n/a > green
 *
 * `cannot-verify` first so an unknown is never hidden behind a known red.
 * `n/a` ABOVE `green` because of a measured mistake in this file: with
 * `apps/api/test` holding no case site, the `test --kind api` lane ran a green
 * `tsc` half and an unlaunched jest half, and a first version that ranked
 * green highest printed `VERDICT=green` — which reads as "the api tests passed"
 * when no test ran at all. A lane one of whose halves made no claim is not a
 * green lane; the per-half verdicts stay in `run.json` → `steps[].verdict` and
 * in the printed lines, which is where `ready` reads `n/a` per kind (rule 3).
 */
function combine(verdicts) {
  if (verdicts.some((v) => v === 'cannot-verify')) return 'cannot-verify';
  if (verdicts.some((v) => v === 'red')) return 'red';
  if (verdicts.some((v) => v === 'n/a')) return 'n/a';
  if (verdicts.some((v) => v === 'green')) return 'green';
  return 'n/a';
}

const out = [];
function say(line) {
  out.push(line);
  process.stdout.write(`${line}\n`);
}

/**
 * The commit this process resolved, remembered as soon as it is known.
 *
 * It exists because of a MEASURED defect in this file. `refuse()` called
 * `finish()` with no head, so every refusal AFTER the commit had resolved
 * printed `VERDICT=cannot-verify head=none` — observed on the `--expect-head`
 * mismatch, the dirty-tree refusal, the watcher refusal and all three lock
 * states. `head=none` is the machine line's way of saying "HEAD does not
 * resolve", which is a different fact from "HEAD is 055615c and is not the one
 * this run was asked to judge": a reader reconciling a refusal against a commit
 * would have been told the repository had none. The prose line above said the
 * sha; the line another gate parses contradicted it.
 */
let headOfRecord = null;

/**
 * Print the machine line and leave. `VERDICT=` is the one line another gate
 * reads, and it is printed on EVERY exit path including a refusal — a run that
 * printed no verdict would be read as "the wrapper crashed", which is a
 * different fact from "the wrapper refused".
 */
function finish(verdict, { head = headOfRecord, tests = 0, errors = 0, reasons = [] } = {}) {
  for (const r of reasons) say(`[run] ${r}`);
  say(`VERDICT=${verdict} head=${short(head)} tests=${String(tests)} errors=${String(errors)}`);
  process.exit(EXIT[verdict] ?? 2);
}

function refuse(reason, cure) {
  say(`[run] REFUSED: ${reason}`);
  if (cure) say(`[run]          cure: ${cure}`);
  finish('cannot-verify');
}

/**
 * Spawn one tool. argv ARRAY, no shell, no pipe: the child's own status is what
 * comes back, and the streams are captured so they can be written to the
 * artefact this wrapper named rather than to whatever the terminal happens to be.
 */
function runTool(bin, args, { cwd, env = {} }) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const r = spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...CHILD_ENV, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    argv: [bin, ...args],
    // Recorded beside argv because with Jest part of the artefact contract lives
    // in the ENVIRONMENT: jest-junit takes its output path from
    // JEST_JUNIT_OUTPUT_FILE, not from a flag. A run.json holding only argv
    // could not say where this run was told to write, so L-artifacts could not
    // check it.
    envExtra: { ...env },
    exitCode: r.error ? null : (r.status ?? null),
    signal: r.signal ?? null,
    spawnError: r.error ? r.error.message : null,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    startedAt,
    durationMs: Date.now() - t0,
  };
}

/** The workspace binary, never a global one: a global `tsc` on PATH is a
 * different engine, and status.mjs reports that case as CANNOT VERIFY. */
function workspaceBin(root, name) {
  const path = resolve(root, 'node_modules/.bin', name);
  return { path, exists: existsSync(path) };
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === 'EPERM'; // alive, owned by someone else
  }
}

/**
 * The pattern that finds a live watcher, as an EXTENDED regex over the whole
 * argv (`pgrep -f`), with each executable name anchored at a path or argv
 * boundary.
 *
 * THE ANCHORS ARE THE WHOLE POINT, measured 2026-11-01. The obvious pattern —
 * a plain alternation of the executable names — is a SUBSTRING match over every
 * process's full command line, and it reported SEVENTEEN live watchers on this
 * machine: shells whose argv merely CONTAINED the word, because the text they
 * were running happened to mention `from 'vitest'`, the runner's name at the
 * time. A wrapper that refuses on that number refuses every run of record for as
 * long as any such shell lives, and the refusal names a "watcher" nobody can
 * find.
 *
 * That count is a DATED OBSERVATION, not current state: re-run on 2026-11-02 the
 * same naive alternation returned 0, simply because no process's argv mentioned
 * those words at that moment. The hazard is the substring match, which does not
 * go away between measurements — only its visibility does, which is exactly why
 * the anchors stay.
 *
 * Verified against planted decoys: `node …/.bin/jest --watch`,
 * `node …/.bin/vite`, `…/.bin/tsc --watch -p tsconfig.json` and
 * `node …/.bin/tsx watch src/index.ts` all match; a zsh whose command line
 * merely mentions the runner's name does not.
 */
export const WATCHER_PATTERN = '(^|/)(jest|vite)( |$)|(^|/)tsc .*--watch|(^|/)tsx .*watch|jest .*--watch';

/** argv[0] basenames that are never a watcher themselves: the watcher would be
 * the shell's CHILD, which pgrep reports on its own line. */
const SHELLS = Object.freeze(new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'ksh', 'csh', 'tcsh', 'login', 'pgrep', 'xargs']));

/**
 * `pgrep -fl <WATCHER_PATTERN>` → the live watchers, this process excluded.
 * Measured: `pgrep -fl` prints `<pid> <full command line>` and exits 1 — not an
 * error — when nothing matches, which is why 1 is accepted here and anything
 * else is reported as "cannot tell" rather than as zero.
 *
 * Exported because status.mjs must REPORT the same number this file REFUSES on,
 * and two pgrep calls written twice are two answers waiting to disagree. It
 * belongs in tools/gates/lib/ beside the other readers; there is no module there
 * for the process table, so it lives with the gate that acts on it.
 */
export function liveWatchers() {
  // No CHILD_ENV here, and no `env` parameter: this spawns `pgrep` to read the PROCESS TABLE, not
  // a tool whose behaviour the environment steers. CHILD_ENV belongs to `runTool`.
  const r = spawnSync('pgrep', ['-fl', WATCHER_PATTERN], { encoding: 'utf8' });
  if (r.error) return { ok: false, found: [], reason: `pgrep did not run: ${r.error.message}`, pattern: WATCHER_PATTERN };
  if (r.status !== 0 && r.status !== 1)
    return { ok: false, found: [], reason: `pgrep -fl exited ${String(r.status)}: ${(r.stderr ?? '').trim()}`, pattern: WATCHER_PATTERN };
  const mine = new Set([process.pid, process.ppid]);
  const found = (r.stdout ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      const m = l.match(/^(\d+)\s+(.*)$/);
      return m ? { pid: Number(m[1]), cmd: m[2] } : { pid: null, cmd: l };
    })
    .filter((p) => {
      if (mine.has(p.pid)) return false;
      if (p.cmd.includes('tools/gates/')) return false; // a gate is not a watcher
      const argv0 = p.cmd.split(' ')[0] ?? '';
      return !SHELLS.has(argv0.split('/').pop() ?? '');
    });
  return { ok: true, found, reason: null, pattern: WATCHER_PATTERN };
}

// ------------------------------------------------------------------- the lock

function readLockFile(path) {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return { pid: typeof data?.pid === 'number' ? data.pid : null, data };
  } catch {
    return { pid: null, data: null };
  }
}

/**
 * The state of `.ci/lock` without touching it.
 * → { state: 'free' | 'held' | 'stale' | 'unreadable', path, pid, argv, startedAt, detail }
 *
 * Exported for status.mjs, which must REPORT a lock whose pid is dead
 * (AGENTS.md rule 2: reported, never removed silently). One reader, so the
 * wrapper's refusal and the pre-flight report cannot describe the lock
 * differently.
 */
export function inspectLock(root) {
  const path = resolve(root, CI_LOCK);
  if (!existsSync(path)) return { state: 'free', path, pid: null, argv: null, startedAt: null, detail: `${CI_LOCK} is free` };
  const held = readLockFile(path);
  const argv = Array.isArray(held.data?.argv) ? held.data.argv.join(' ') : null;
  const startedAt = typeof held.data?.startedAt === 'string' ? held.data.startedAt : null;
  if (held.pid === null)
    return { state: 'unreadable', path, pid: null, argv, startedAt, detail: `${CI_LOCK} exists but carries no readable pid — it cannot be told from a run in flight` };
  if (isAlive(held.pid))
    return {
      state: 'held',
      path,
      pid: held.pid,
      argv,
      startedAt,
      detail: `${CI_LOCK} is held by pid ${String(held.pid)} (${argv ?? 'argv not recorded'}, started ${startedAt ?? 'at an unrecorded time'}) — one run of record at a time (rule 2)`,
    };
  return {
    state: 'stale',
    path,
    pid: held.pid,
    argv,
    startedAt,
    detail: `${CI_LOCK} is held by pid ${String(held.pid)}, which is NOT alive — the leftover of an aborted run. A stale lock is REPORTED, never removed silently: from outside, an aborted run and a run in flight look the same, and guessing wrong corrupts artefacts somebody is waiting on`,
  };
}

function acquireLock(root, meta) {
  const path = resolve(root, CI_LOCK);
  mkdirSync(dirname(path), { recursive: true });
  let fd;
  try {
    fd = openSync(path, 'wx'); // 'wx' fails when the file exists — the atomic part
  } catch (e) {
    if (e?.code !== 'EEXIST') return { ok: false, path, reason: `cannot create ${CI_LOCK}: ${String(e?.message)}`, cure: null };
    const held = inspectLock(root);
    return {
      ok: false,
      path,
      reason: held.detail,
      cure: held.state === 'held' ? 'wait for that run, or stop it' : `check that no run is in flight, then \`rm ${CI_LOCK}\``,
    };
  }
  writeFileSync(fd, `${JSON.stringify({ ...meta, pid: process.pid }, null, 2)}\n`, 'utf8');
  closeSync(fd);
  return { ok: true, path, reason: null, cure: null };
}

function releaseLock(path) {
  if (!path || !existsSync(path)) return;
  const held = readLockFile(path);
  if (held.pid !== null && held.pid !== process.pid) return; // not ours; leave it and let the next run report it
  try {
    unlinkSync(path);
  } catch {
    /* the next run reports it rather than this one failing on the way out */
  }
}

// -------------------------------------------------------------------- the argv

export function parseArgs(argv) {
  const bad = argv.find((a) => FORBIDDEN.some((f) => f.re.test(a)));
  if (bad) {
    const f = FORBIDDEN.find((x) => x.re.test(bad));
    return { error: `${bad} is refused: ${f.why}` };
  }

  const lane = argv[0];
  if (lane === undefined || lane === '--help' || lane === '-h') return { help: true };
  if (!LANE_NAMES.includes(lane))
    return { error: `unknown lane ${JSON.stringify(lane)} — the lanes are ${LANE_NAMES.join(', ')}` };

  const opts = { lane, kind: null, label: null, expectHead: null, filter: null, dryRun: false };
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const name = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a;
    const inline = a.startsWith('--') && eq > 0 ? a.slice(eq + 1) : null;
    const take = (what) => {
      if (inline !== null) return inline;
      i += 1;
      const v = argv[i];
      if (v === undefined || v.startsWith('-')) return { missing: what };
      return v;
    };
    switch (name) {
      case '--kind': {
        const v = take('--kind');
        if (typeof v !== 'string') return { error: `--kind needs a value — one of ${[...TYPED_KINDS, 'all'].join(', ')}` };
        opts.kind = v;
        break;
      }
      case '--label': {
        const v = take('--label');
        if (typeof v !== 'string') return { error: '--label needs a value (it becomes a path segment under .ci/runs/)' };
        opts.label = v;
        break;
      }
      case '--expect-head': {
        const v = take('--expect-head');
        if (typeof v !== 'string') return { error: '--expect-head needs a sha' };
        opts.expectHead = v;
        break;
      }
      case '--filter': {
        const v = take('--filter');
        if (typeof v !== 'string') return { error: '--filter needs a regular expression' };
        opts.filter = v;
        break;
      }
      case '--dry-run':
        opts.dryRun = true;
        break;
      default:
        return { error: `unknown flag ${JSON.stringify(a)} — see node tools/gates/run.mjs --help` };
    }
  }

  const laneCfg = LANES[lane];
  if (laneCfg.kinds === 'refused' && opts.kind !== null)
    return { error: `the ${lane} lane takes no --kind: oxlint lints the whole tree in one pass, and a per-kind lint artefact would be a filter pretending to be a lane` };
  if (laneCfg.kinds === 'implied') {
    if (opts.kind !== null && opts.kind !== 'e2e')
      return { error: `the e2e lane is kind e2e; --kind ${JSON.stringify(opts.kind)} names another kind` };
    opts.kind = 'e2e';
  }
  if (laneCfg.kinds === 'required') {
    if (opts.kind === null)
      return { error: `the ${lane} lane needs --kind — one of ${[...TYPED_KINDS, 'all'].join(', ')}` };
    if (opts.kind !== 'all' && !TYPED_KINDS.includes(opts.kind))
      return {
        error:
          opts.kind === 'e2e'
            ? 'kind e2e has no tsconfig and no jest project: use the e2e lane (node tools/gates/run.mjs e2e)'
            : `unknown kind ${JSON.stringify(opts.kind)} — one of ${[...TYPED_KINDS, 'all'].join(', ')}`,
      };
  }
  if (opts.filter !== null && lane !== 'test')
    return { error: `--filter belongs to the test lane only; the ${lane} lane has no case names to filter` };
  if (opts.filter !== null) {
    try {
      RegExp(opts.filter); // called, not constructed: the throw IS the validation
    } catch (e) {
      return { error: `--filter ${JSON.stringify(opts.filter)} is not a regular expression: ${String(e?.message)}` };
    }
  }

  opts.kinds = opts.kind === 'all' ? [...TYPED_KINDS] : opts.kind === null ? [] : [opts.kind];
  opts.label ??= opts.kind === null || opts.kind === lane ? lane : `${lane}-${String(opts.kind)}`;
  return opts;
}

const HELP = `node tools/gates/run.mjs <lane> [options] — the wrapper of every run of record

  types --kind <${[...TYPED_KINDS, 'all'].join('|')}>   tsc --noEmit per package  -> tsc.<kind>.log
  test  --kind <${[...TYPED_KINDS, 'all'].join('|')}>   tsc + jest                -> tsc.<kind>.log, <kind>.junit.xml, <kind>.json
  lint                              oxlint --type-aware       -> oxlint.json
  e2e                               playwright                -> e2e.junit.xml, e2e.json

  --label <l>         the run directory is .ci/runs/<ts>-<label>/ (default: <lane>[-<kind>])
  --expect-head <sha> refuse unless HEAD is this commit
  --filter <re>       test lane only: a case-name pattern, reconciled against the declared names
  --dry-run           check every refusal, print the argv, spawn nothing, write nothing (exit 2)

Exit code: 0 green · 1 red (an artefact says so) · 2 cannot-verify, n/a or REFUSED.
A missing artefact is CANNOT VERIFY, never green.`;

// ------------------------------------------------------------- the lane bodies

/** `tsc --noEmit --pretty false --listFiles -p <pkg>/tsconfig.json` → tsc.<kind>.log
 *
 * `--pretty false`: the pretty renderer wraps, colours and re-indents a
 * diagnostic, and tsc-log.mjs's line regex then matches nothing.
 * `--listFiles`: `filesChecked` is the positive evidence the compiler read
 * something — zero diagnostics with zero inputs is CANNOT VERIFY, not green
 * (tools/gates/lib/tsc-log.mjs:136-150).
 */
export function typesArgv(kind) {
  const pkg = PACKAGE_OF_KIND[kind];
  return ['--noEmit', '--pretty', 'false', '--listFiles', '-p', `${pkg}/tsconfig.json`];
}

/**
 * The jest argv. Every flag is load-bearing, and TWO facts about Jest shape it:
 *
 *   --selectProjects <kind>  a spec of another kind cannot run under this label
 *                            (jest.config.mjs names the projects; the project
 *                            name IS the kind, so there is no registry between
 *                            the path and the artefact)
 *   --json + --outputFile    the second channel. Jest's JSON carries the same
 *                            field names the reader already knows
 *                            (numTotalTests / numPassedTests / numFailedTests /
 *                            numPendingTests), so lib/jest-json.mjs reads it
 *                            unchanged — the FORMAT is what that module knows,
 *                            not the producer.
 *   --ci                     a missing snapshot is a failure, never written
 *   --runInBand              one schedule per run, as --no-file-parallelism was
 *
 * NOT passed, and their ABSENCE is the contract:
 *   there is no --retry: Jest does not retry unless a test asks, so nothing has
 *   to switch it off;
 *   --passWithNoTests is NOT passed, because Jest's default is already to exit
 *   non-zero when no test matched. Passing it would be the dangerous spelling.
 *
 * The JUnit path is NOT here. jest-junit takes it from JEST_JUNIT_OUTPUT_FILE,
 * so it travels in the environment and is recorded in run.json as `envExtra`.
 */
export function jestArgv(kind, { json, filter }) {
  const args = ['--selectProjects', kind, '--ci', '--runInBand', '--json', `--outputFile=${json}`];
  // --filter is passed through as the runner's own name pattern. It is allowed
  // ONLY because the count is reconciled afterwards against the declared names
  // the same pattern matches; see runTest.
  if (filter !== null) args.push('-t', filter);
  return args;
}

/** The part of the artefact contract that travels in the environment, not argv. */
export function jestEnv({ junit }) {
  return { JEST_JUNIT_OUTPUT_FILE: junit };
}

/** `oxlint --type-aware --format=json` → oxlint.json (stdout IS the artefact). */
export function lintArgv() {
  return ['--type-aware', '--format=json'];
}

/**
 * The playwright argv. UNVERIFIED on this machine: the browsers are not
 * downloaded, so this lane has never been spawned here (TD-0001), and
 * `PLAYWRIGHT_JUNIT_OUTPUT_NAME` / `PLAYWRIGHT_JSON_OUTPUT_NAME` are how the
 * reporters are redirected per run rather than to the fixed paths
 * playwright.config.ts:12-15 names. Neither has been observed in this
 * repository. The lane refuses before reaching this function until a probe
 * records `browser_probe`, and that probe is also what will verify these.
 */
export function e2eArgv() {
  return ['test', '--reporter=junit'];
}

// ---------------------------------------------------------------------- main

export function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    process.exit(2); // a help text is not a verdict
  }
  if (parsed.error) {
    say(`[run] REFUSED: ${parsed.error}`);
    finish('cannot-verify');
  }
  const { lane, kind, kinds, label, expectHead, filter, dryRun } = parsed;

  // ---- the repository
  const rr = repoRoot();
  if (!rr.ok) refuse(`not a git repository: ${String(rr.reason)}`, 'run this from inside the repository');
  const root = rr.root;
  process.chdir(root);

  say(`[run] lane=${lane} kind=${kind ?? 'n/a'} label=${label}${filter === null ? '' : ` filter=${filter}`}`);

  // ---- the commit this run is pinned to
  const head = headSha({ cwd: root });
  headOfRecord = head.ok ? head.sha : null; // every refusal below now names it
  if (!head.ok && !dryRun)
    refuse(
      `HEAD does not resolve (${String(head.reason)}) — a run of record is pinned to a commit, and an artefact nobody can pin describes a tree nobody can check out`,
      'commit the scaffold first (the range-based gates read HEAD, never the index)',
    );
  if (expectHead !== null) {
    const want = expectHead.toLowerCase();
    const got = head.ok ? head.sha : null;
    if (!/^[0-9a-f]{7,40}$/.test(want))
      refuse(`--expect-head ${JSON.stringify(expectHead)} is not a hex object name of at least 7 characters`);
    if (got === null || !got.startsWith(want))
      refuse(
        `HEAD is ${short(got)}, --expect-head asked for ${want.slice(0, 7)} — the base this run was supposed to judge is not the one checked out`,
        `git checkout ${want.slice(0, 12)}, or drop --expect-head`,
      );
  }

  // ---- the tree
  const tree = isTreeClean([...JUDGED_PATHS], { cwd: root });
  if (tree.clean === null) refuse(`cannot read the tracked tree: ${String(tree.reason)}`);
  if (!tree.clean) {
    const paths = tree.entries.map((e) => e.path);
    refuse(
      `${String(paths.length)} tracked file(s) modified under ${JUDGED_PATHS.join('|')} (${paths.slice(0, 8).join(', ')}${paths.length > 8 ? ', …' : ''}) — the artefact would describe a tree no commit contains`,
      'commit or stash them (untracked files are not dirt: a planted fixture and a staged new test are how the gates are probed)',
    );
  }

  // ---- no shared state with a dev session
  const w = liveWatchers();
  if (!w.ok) refuse(`cannot tell whether a watcher is running: ${String(w.reason)}`, 'stop any dev server by hand, then retry');
  if (w.found.length)
    refuse(
      `${String(w.found.length)} live watcher(s) match ${JSON.stringify(w.pattern)}: ${w.found.map((p) => `${String(p.pid)} ${p.cmd}`).join(' | ')} — a dev server re-transforming the same files mid-run is shared state (rule 2)`,
      'stop the watcher, then retry',
    );

  // ---- the browser lane has no premise
  if (lane === 'e2e') {
    const p = premise(readProbe({ root }), BROWSER_PREMISE);
    if (p.verdict !== 'pass') {
      say('[run] CANNOT VERIFY (playwright browsers not installed — TD-0001)');
      say(`[run] ${p.reason}`);
      say(`[run] argv that WOULD run: ${[workspaceBin(root, 'playwright').path, ...e2eArgv()].join(' ')}`);
      finish('cannot-verify', { head: head.ok ? head.sha : null });
    }
  }

  // ---- what each half will be
  const plan = [];
  for (const k of kinds.length ? kinds : [null]) {
    for (const half of LANES[lane].halves) {
      if (half === 'tsc') {
        if (PACKAGE_OF_KIND[k] === undefined) {
          plan.push({ half, kind: k, skip: `kind ${String(k)} has no package tsconfig.json` });
          continue;
        }
        plan.push({ half, kind: k, bin: 'tsc', args: typesArgv(k), log: `tsc.${String(k)}.log` });
      } else if (half === 'jest') {
        plan.push({ half, kind: k, bin: 'jest', junit: `${String(k)}.junit.xml`, json: `${String(k)}.json` });
      } else if (half === 'oxlint') {
        plan.push({ half, kind: null, bin: 'oxlint', args: lintArgv(), log: 'oxlint.json' });
      } else {
        plan.push({ half, kind: 'e2e', bin: 'playwright', args: e2eArgv(), junit: 'e2e.junit.xml', json: 'e2e.json' });
      }
    }
  }

  // ---- the binaries, resolved to the workspace and never to a global one
  for (const step of plan) {
    if (step.skip !== undefined) continue;
    const b = workspaceBin(root, step.bin);
    if (!b.exists)
      refuse(
        `${step.bin} is not in node_modules/.bin — this worktree is not installed, and a global ${step.bin} on PATH would be a different engine than the lock names`,
        'pnpm install --frozen-lockfile',
      );
    step.binPath = b.path;
  }

  if (dryRun) {
    say('[run] --dry-run: every refusal above was checked; nothing is spawned and nothing is written');
    for (const step of plan) {
      if (step.skip !== undefined) {
        say(`[run] dry ${step.half}: SKIPPED — ${step.skip}`);
        continue;
      }
      const args =
        step.half === 'jest'
          ? jestArgv(step.kind, { json: '<run-dir>/' + step.json, filter })
          : step.args;
      say(`[run] dry ${step.half}: ${[step.binPath, ...args].join(' ')}`);
    }
    say(`[run] dry env: ${Object.entries(CHILD_ENV).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    finish('cannot-verify', { head: head.ok ? head.sha : null, reasons: ['a dry run writes no artefact, and a run with no artefact is never green'] });
  }

  // ---- the lock, then the run directory
  const startedAt = new Date().toISOString();
  const lock = acquireLock(root, { argv: process.argv.slice(1), startedAt, lane, kind, label });
  if (!lock.ok) refuse(lock.reason, lock.cure);

  let dir = null;
  let verdict = 'cannot-verify';
  let tests = 0;
  let errors = 0;
  const reasons = [];
  const records = [];

  // The run directory is created under the lock and BEFORE the lane body, so a
  // label that cannot become a path segment is a REFUSAL that names the rule
  // and the cure — not an exception read back as "the wrapper itself failed".
  // tools/gates/lib/run-dir.mjs owns the rule and raises the message; this
  // block only decides that such a message is a refusal, so there is no second
  // judge of what a label may be.
  let made;
  try {
    made = makeRunDir({ label, kind, root });
  } catch (e) {
    releaseLock(lock.path);
    refuse(
      `the run directory was not created: ${String(e?.message)}`,
      'pass --label as [a-z0-9-] starting with [a-z0-9] — it becomes a path segment under .ci/runs/ (the rule is in tools/gates/lib/run-dir.mjs)',
    );
  }

  try {
    dir = made.dir;
    say(`[run] head=${short(head.ok ? head.sha : null)} tree=clean watchers=0 dir=${made.ts}-${label}`);
    say(`[run] artefacts under ${CI_LOCK.replace(/lock$/, '')}runs/${made.ts}-${label}/`);

    const verdicts = [];

    for (const step of plan) {
      if (step.skip !== undefined) {
        verdicts.push('cannot-verify');
        reasons.push(`${step.half} for kind ${String(step.kind)}: ${step.skip} — CANNOT VERIFY, never green`);
        records.push({ half: step.half, kind: step.kind, skipped: step.skip });
        continue;
      }

      if (step.half === 'tsc' || step.half === 'oxlint') {
        const logPath = artifactPath(dir, step.log);
        const r = runTool(step.binPath, step.args, { cwd: root });
        // The artefact is the tool's own stdout. stderr is appended after a
        // marker line (inert to every reader in lib/) so a crash message is
        // never lost, and never mistaken for a diagnostic.
        const body = r.spawnError
          ? `--- spawn failed ---\n${r.spawnError}\n`
          : r.stdout + (r.stderr.trim().length ? `--- stderr ---\n${r.stderr}` : '');
        writeFileSync(logPath, body, 'utf8');

        const read = step.half === 'tsc' ? readTsc(logPath) : readOxlint(logPath);
        verdicts.push(read.verdict);
        errors += step.half === 'tsc' ? (read.all?.length ?? 0) : (read.errors ?? 0) + (read.warnings ?? 0);
        say(
          `[run] ${step.half.padEnd(6)} exit=${String(r.exitCode)} artefact=${step.log} ${VERDICT_LABELS[read.verdict] ?? read.verdict} — ${read.reason ?? ''}`,
        );
        records.push({
          half: step.half,
          kind: step.kind,
          argv: r.argv,
          // Recorded for every half, not just the one that needs it: these two
          // tools take nothing from the environment, and `{}` SAYS that, where an
          // absent field would leave a reader unable to tell "nothing was added"
          // from "nobody wrote it down".
          envExtra: r.envExtra ?? null,
          exitCode: r.exitCode,
          signal: r.signal,
          spawnError: r.spawnError,
          durationMs: r.durationMs,
          artefact: step.log,
          verdict: read.verdict,
          reason: read.reason,
          ...(step.half === 'tsc'
            ? { filesChecked: read.filesChecked ?? null, diagnostics: (read.all ?? []).map((d) => d.raw) }
            : { filesLinted: read.filesLinted ?? null, byRule: Object.keys(read.byRule ?? {}).toSorted((a, b) => (a < b ? -1 : 1)) }),
        });
        continue;
      }

      if (step.half === 'jest') {
        const t = runTest(root, dir, step, filter);
        verdicts.push(t.verdict);
        tests += t.tests;
        errors += t.errors;
        for (const line of t.lines) say(line);
        reasons.push(...t.reasons);
        records.push(t.record);
        continue;
      }

      const p = runE2e(root, dir, step);
      verdicts.push(p.verdict);
      tests += p.tests;
      errors += p.errors;
      for (const line of p.lines) say(line);
      reasons.push(...p.reasons);
      records.push(p.record);
    }

    verdict = combine(verdicts);
  } catch (e) {
    verdict = 'cannot-verify';
    reasons.push(`the wrapper itself failed: ${String(e?.message)}`);
  } finally {
    if (dir !== null) {
      // The exit code of record is the FIRST non-zero a judged tool reported, or
      // 0 when every one of them exited 0 — and it stays advisory: the verdict
      // above came from the artefacts.
      const codes = records.map((r) => r.exitCode).filter((c) => typeof c === 'number');
      const exitCode = codes.find((c) => c !== 0) ?? (codes.length ? 0 : null);
      try {
        writeRunJson(dir, {
          gate: 'run',
          lane,
          kind,
          kinds,
          label,
          verify: kinds.length === 1 ? deriveVerify(kinds[0]) : null,
          head: head.ok ? head.sha : null,
          treeClean: true,
          argv: process.argv.slice(2),
          exitCode,
          startedAt,
          finishedAt: new Date().toISOString(),
          verdict,
          tests,
          errors,
          filter,
          typeAware: lane === 'lint' ? true : null,
          env: { TZ: CHILD_ENV.TZ, LANG: CHILD_ENV.LANG, LC_ALL: CHILD_ENV.LC_ALL, CI: CHILD_ENV.CI },
          steps: records,
          reasons,
        });
      } catch (e) {
        reasons.push(`run.json was not written: ${String(e?.message)} — this run cannot be cited as evidence`);
        verdict = 'cannot-verify';
      }
    }
    releaseLock(lock.path);
  }

  finish(verdict, { head: head.ok ? head.sha : null, tests, errors, reasons });
}

/**
 * The jest half: two channels from one run, cross-checked, plus the
 * sources-vs-artefact reconciliation that decides `n/a` from the TREE and
 * CANNOT VERIFY from the artefact (rule 3, tools/gates/lib/test-project.mjs).
 */
function runTest(root, dir, step, filter) {
  const kind = step.kind;
  const lines = [];
  const reasons = [];
  const state = projectState({ root, project: kind });

  // `n/a` is decided from the sources and never from a count: a project whose
  // files hold no `it(`/`test(` call site is NOT LAUNCHED. Launching it would
  // make "the runner found nothing" indistinguishable from "there was nothing
  // to find", which is the confusion that lets an empty suite read as a pass.
  if (state.state === 'n/a') {
    const av = artifactVerdict(state, { present: false });
    lines.push(`[run] jest not launched — ${av.detail}`);
    return {
      verdict: 'n/a',
      tests: 0,
      errors: 0,
      lines,
      reasons: [`${kind}: n/a — ${av.detail}`],
      record: { half: 'jest', kind, launched: false, verdict: 'n/a', reason: av.detail },
    };
  }

  // A filter must be reconcilable BEFORE the run: a pattern that matches none of
  // the declared names cannot prove anything, and the run would exit 1 on
  // --passWithNoTests=false with no explanation of why.
  let expectedNames = null;
  if (filter !== null) {
    const re = new RegExp(filter);
    const declared = Object.values(state.expectedByFile).flat();
    expectedNames = declared.filter((n) => re.test(n));
    if (!expectedNames.length) {
      lines.push(
        `[run] REFUSED: --filter ${JSON.stringify(filter)} matches none of the ${String(declared.length)} case name(s) the ${kind} sources declare — a filter that matches nothing is not a proof`,
      );
      return {
        verdict: 'cannot-verify',
        tests: 0,
        errors: 0,
        lines,
        reasons: [`${kind}: --filter matched no declared case name`],
        record: { half: 'jest', kind, launched: false, verdict: 'cannot-verify', reason: 'filter matched no declared case name' },
      };
    }
  }

  const junitPath = artifactPath(dir, step.junit);
  const jsonPath = artifactPath(dir, step.json);
  const args = jestArgv(kind, { json: jsonPath, filter });
  const r = runTool(step.binPath, args, { cwd: root, env: jestEnv({ junit: junitPath }) });
  writeFileSync(artifactPath(dir, `${kind}.console.log`), r.stdout + (r.stderr.trim().length ? `--- stderr ---\n${r.stderr}` : ''), 'utf8');
  if (r.stdout.trim().length) process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : `${r.stdout}\n`);

  const junit = readJUnit(junitPath);
  const json = readJestJson(jsonPath);
  const cross = crossCheck(junit, json);

  const tests = junit.ok ? (junit.totals.tests ?? 0) : 0;
  const errors = junit.ok ? (junit.totals.failures ?? 0) + (junit.totals.errors ?? 0) : 0;

  lines.push(
    `[run] jest exit=${String(r.exitCode)} artefact=${step.junit} tests=${String(tests)} failures=${String(junit.ok ? junit.totals.failures : '-')} skipped=${String(junit.ok ? junit.totals.skipped : '-')}`,
  );

  if (!junit.ok) {
    lines.push(`[run] ${VERDICT_LABELS['cannot-verify']} — ${String(junit.reason)}`);
    return {
      verdict: 'cannot-verify',
      tests,
      errors,
      lines,
      reasons: [`${kind}: ${String(junit.reason)}`],
      record: {
        half: 'jest',
        kind,
        argv: r.argv,
        envExtra: r.envExtra ?? null,
        exitCode: r.exitCode,
        spawnError: r.spawnError,
        durationMs: r.durationMs,
        artefact: step.junit,
        verdict: 'cannot-verify',
        reason: junit.reason,
      },
    };
  }

  // The sources decide whether the count may be judged at all.
  //
  // MEASURED 2026-11-01, and the reason this is not a comparison against
  // `tests`: `--testNamePattern` does NOT reduce the number of `<testcase>`
  // elements. A run of the 17 core cases with `--testNamePattern=sha256` wrote
  // `tests="17" skipped="13"` — the non-matching cases come back as
  // `<skipped/>`, and the JSON channel counts them in `numPendingTests`. So with
  // a filter NEITHER channel can tell a filtered-out case from a real `.todo`,
  // and the only honest claim a filtered run can make is about the cases the
  // pattern matched. Those are judged; the rest make no claim at all.
  //
  // A collection failure's synthetic `<testcase>` is EXCLUDED from both sets.
  // MEASURED by planting an import of a path nobody wrote: the runner emits one
  // synthetic case for the whole file with `status: failed`, and the counts then
  // coincide with the sources exactly (17 real cases + 1 synthetic = 18, and the
  // sources enumerate 18 because the planted file declares one case). A first
  // version of this function reconciled, judged that synthetic case as an
  // ordinary failure and printed RED — a verdict built on a case that was never
  // parsed. That is the same shape as the scar in
  // tools/gates/lib/junit-xml.mjs:224-246: red-check would accept "red on base"
  // from a file that never loaded.
  const ran = junit.cases.filter((c) => c.status !== 'skipped' && !isCollectionFailure(c));
  const judged = filter === null ? junit.cases.filter((c) => !isCollectionFailure(c)) : ran.filter((c) => expectedNames.some((n) => nameMatches(c.name, n)));
  const av = filter === null ? artifactVerdict(state, { tests }) : reconcileFilter(kind, filter, expectedNames, ran);
  lines.push(`[run] reconcile: ${av.status} — ${av.detail}`);

  const collection = junit.collectionFailures ?? [];
  if (collection.length)
    reasons.push(
      `${String(collection.length)} file(s) never collected: ${collection
        .map((c) => `${c.classname} (${redReason(c.failure).reason}: ${redReason(c.failure).message.split('\n')[0]})`)
        .join(', ')} — nothing in them ran, so nothing in them is proven either way`,
    );

  if (!cross.ok) {
    for (const why of cross.reasons) lines.push(`[run] cross-check: ${why}`);
    reasons.push(`${kind}: the two channels of one run disagree — ${cross.reasons.join('; ')}`);
  } else {
    lines.push('[run] cross-check: the JUnit and JSON channels describe the same run');
  }

  const record = {
    half: 'jest',
    kind,
    argv: r.argv,
    // The JUnit path is NOT in the argv — jest-junit takes it from the
    // environment — so a record carrying only `argv` does not say where this run
    // was told to write half its artefacts. L-artifacts asserts this field
    // (REQUIRED_ENV there); omitting it made every run of record unjudgeable on
    // exactly the half that is hardest to notice missing.
    envExtra: r.envExtra ?? null,
    exitCode: r.exitCode,
    signal: r.signal,
    spawnError: r.spawnError,
    durationMs: r.durationMs,
    artefact: step.junit,
    artefacts: [step.junit, step.json, `${kind}.console.log`],
    totals: junit.totals,
    jsonCounts: json.ok ? json.counts : null,
    crossCheck: { agree: cross.agree, reasons: cross.reasons },
    declaredCases: state.expected,
    filterMatched: expectedNames === null ? null : expectedNames.length,
    judgedCases: judged.map((c) => c.name),
    collectionFailures: collection.map((c) => c.classname),
    reconcile: av,
  };

  // A file that never collected makes the LANE cannot-verify, not red: the run
  // has nothing to say about the cases in it, and a lane that is silent about
  // part of the project is not a verdict about the project.
  if (collection.length) {
    lines.push(`[run] ${VERDICT_LABELS['cannot-verify']} — ${String(collection.length)} file(s) never collected`);
    return { verdict: 'cannot-verify', tests, errors, lines, reasons, record: { ...record, verdict: 'cannot-verify' } };
  }

  if (av.status !== 'judgeable' || !cross.ok)
    return { verdict: 'cannot-verify', tests, errors, lines, reasons, record: { ...record, verdict: 'cannot-verify' } };

  const skipped = judged.filter((c) => c.status === 'skipped');
  if (skipped.length) {
    // Only reachable without a filter: `reconcileFilter` already refuses a
    // matched name that did not run. `.skip` and `.todo` are one string in the
    // XML, so neither is told from the other here — and a case that did not
    // execute proves nothing either way.
    reasons.push(
      `${String(skipped.length)} case(s) skipped (.skip or .todo — the XML writes <skipped/> for both): ${skipped.map((c) => c.name).join(', ')} — a case that did not execute proves nothing`,
    );
    return { verdict: 'cannot-verify', tests, errors, lines, reasons, record: { ...record, verdict: 'cannot-verify' } };
  }
  const unmeasured = unmeasuredFailures(judged);
  if (unmeasured.length) {
    const why = `${String(unmeasured.length)} case(s) failed for a reason this repository has not measured: ${unmeasured.map((x) => `${JSON.stringify(x.name)} ${x.r.type}: ${x.r.message.split('\n')[0]}`).join('; ')} — redReason answers from a closed set, and a red whose reason has no name is not a proven red`;
    lines.push(`[run] ${VERDICT_LABELS['cannot-verify']} — ${why}`);
    reasons.push(`${kind}: ${why}`);
    return { verdict: 'cannot-verify', tests, errors, lines, reasons, record: { ...record, verdict: 'cannot-verify' } };
  }
  const failed = judged.filter((c) => c.status === 'failed' || c.status === 'errored');
  const verdict = failed.length ? 'red' : 'green';
  lines.push(
    `[run] ${VERDICT_LABELS[verdict]} — ${String(failed.length)} of ${String(judged.length)} judged case(s) failed${filter === null ? '' : ` (of ${String(tests)} in the artefact; --filter judged only the matched names)`}`,
  );
  return { verdict, tests, errors, lines, reasons, record: { ...record, verdict } };
}

/**
 * The playwright half. Reached only once a probe has recorded `browser_probe`.
 *
 * An ENV VAR, not a flag, carries the artefact path: playwright.config.ts:12-15
 * names fixed reporter outputs, and a run of record must write into its OWN
 * directory. MEASURED in this session, by planting a probe record and one spec
 * file: with `PLAYWRIGHT_JUNIT_OUTPUT_NAME` set to a path inside the run
 * directory, the JUnit XML landed there and `readJUnit` parsed it (tests=1).
 *
 * WHAT IS STILL UNVERIFIED: a run with a browser. The browsers are not
 * downloaded (TD-0001), so no path here has ever produced a green e2e verdict —
 * and that is also the one thing this function was found to get wrong. With the
 * browsers absent every case fails with `browserType.launch: Executable doesn't
 * exist at …`; `redReason` calls that `unknown`, and a first version read it as
 * RED. An environment that was never built is CANNOT VERIFY, and when the
 * probe record claims otherwise the record is what is stale.
 */
function runE2e(root, dir, step) {
  const lines = [];
  const state = projectState({ root, project: 'e2e' });
  if (state.state === 'n/a') {
    const av = artifactVerdict(state, { present: false });
    lines.push(`[run] playwright not launched — ${av.detail}`);
    return {
      verdict: 'n/a',
      tests: 0,
      errors: 0,
      lines,
      reasons: [`e2e: n/a — ${av.detail}`],
      record: { half: 'playwright', kind: 'e2e', launched: false, verdict: 'n/a', reason: av.detail },
    };
  }

  const junitPath = artifactPath(dir, step.junit);
  const r = spawnSync(step.binPath, step.args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...CHILD_ENV, PLAYWRIGHT_JUNIT_OUTPUT_NAME: junitPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const consoleText = (r.stdout ?? '') + ((r.stderr ?? '').trim().length ? `--- stderr ---\n${r.stderr}` : '');
  writeFileSync(artifactPath(dir, 'e2e.console.log'), consoleText, 'utf8');
  if (consoleText.trim().length) process.stdout.write(consoleText.endsWith('\n') ? consoleText : `${consoleText}\n`);

  const junit = readJUnit(junitPath);
  const record = {
    half: 'playwright',
    kind: 'e2e',
    argv: [step.binPath, ...step.args],
    exitCode: r.error ? null : (r.status ?? null),
    spawnError: r.error ? r.error.message : null,
    artefact: step.junit,
    junitOutputNameEnv: junitPath,
    unverified: 'the browser lane has never run on this machine (TD-0001); PLAYWRIGHT_JUNIT_OUTPUT_NAME is cited from documentation, not observed',
    totals: junit.ok ? junit.totals : null,
  };
  lines.push(`[run] playwright exit=${String(record.exitCode)} artefact=${step.junit}`);
  if (!junit.ok) {
    lines.push(`[run] ${VERDICT_LABELS['cannot-verify']} — ${String(junit.reason)}`);
    return { verdict: 'cannot-verify', tests: 0, errors: 0, lines, reasons: [`e2e: ${String(junit.reason)}`], record: { ...record, verdict: 'cannot-verify' } };
  }
  const judged = junit.cases.filter((c) => !isCollectionFailure(c));
  const skipped = judged.filter((c) => c.status === 'skipped');
  if ((junit.collectionFailures ?? []).length || skipped.length) {
    const why = (junit.collectionFailures ?? []).length
      ? `${String(junit.collectionFailures.length)} spec file(s) never loaded`
      : `${String(skipped.length)} case(s) skipped`;
    lines.push(`[run] ${VERDICT_LABELS['cannot-verify']} — ${why}`);
    return { verdict: 'cannot-verify', tests: junit.totals.tests ?? 0, errors: 0, lines, reasons: [`e2e: ${why}`], record: { ...record, verdict: 'cannot-verify' } };
  }
  const unmeasured = unmeasuredFailures(judged);
  if (unmeasured.length) {
    const browser = unmeasured.find((x) => BROWSER_ABSENT_RE.test(x.r.message));
    const why =
      browser === undefined
        ? `${String(unmeasured.length)} case(s) failed for a reason this repository has not measured: ${unmeasured.map((x) => `${JSON.stringify(x.name)} ${x.r.type}: ${x.r.message.split('\n')[0]}`).join('; ')}`
        : `the browsers are not downloaded (${browser.r.message.split('\n')[0]}) — an environment that was never built is CANNOT VERIFY, not a failing test, and .ci/probe.json's browser_probe record is therefore stale: re-run gate-probes`;
    lines.push(`[run] ${VERDICT_LABELS['cannot-verify']} — ${why}`);
    return { verdict: 'cannot-verify', tests: junit.totals.tests ?? 0, errors: 0, lines, reasons: [`e2e: ${why}`], record: { ...record, verdict: 'cannot-verify' } };
  }
  const failed = judged.filter((c) => c.status === 'failed' || c.status === 'errored');
  const verdict = failed.length ? 'red' : 'green';
  lines.push(`[run] ${VERDICT_LABELS[verdict]} — ${String(failed.length)} of ${String(judged.length)} judged case(s) failed`);
  return { verdict, tests: junit.totals.tests ?? 0, errors: failed.length, lines, reasons: [], record: { ...record, verdict } };
}

/**
 * The reconciliation that makes `--filter` admissible where a bare
 * `--testNamePattern` is refused: the cases that actually RAN must be exactly
 * the declared names the same pattern matches, by name and by count.
 *
 * Both halves are needed. The count alone would accept a pattern that matched a
 * case this repository's scanner never enumerated (a case built in a loop); the
 * names alone would accept a run that also executed something the pattern was
 * supposed to exclude.
 */
function reconcileFilter(kind, filter, expectedNames, ran) {
  const missing = expectedNames.filter((n) => !ran.some((c) => nameMatches(c.name, n)));
  if (missing.length)
    return {
      status: 'cannot-verify',
      detail: `${kind}: --filter ${JSON.stringify(filter)} matches ${String(expectedNames.length)} declared name(s), and ${String(missing.length)} of them did not run: ${missing.map((n) => JSON.stringify(n)).join(', ')} — a name that came back <skipped/> may be a .todo, which the artefact cannot tell from a filtered-out case`,
    };
  if (ran.length !== expectedNames.length)
    return {
      status: 'cannot-verify',
      detail: `${kind}: --filter ${JSON.stringify(filter)} matches ${String(expectedNames.length)} declared name(s) but ${String(ran.length)} case(s) ran — the run executed something the sources do not enumerate, so a filter is not the proof`,
    };
  return {
    status: 'judgeable',
    detail: `${kind}: ${String(ran.length)} case(s) ran and --filter matches exactly those ${String(expectedNames.length)} declared name(s)`,
  };
}

// Importable without side effects: a probe may import the argv builders and
// assert them directly, while `node tools/gates/run.mjs …` still runs the lane.
// (Resonance's scar: 11 probes went red on MODULE RESOLUTION rather than on the
// defect they planted, and a gate that fails for the wrong reason reads as a
// catch — so a probe that can import the builder instead of parsing a help text
// is worth the three lines.)
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
