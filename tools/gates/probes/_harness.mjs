/**
 * probes/_harness.mjs — the harness every probe group stands on, and the
 * CONTRACT the groups are written against. Read this header before writing
 * `probes/gates.mjs` or `probes/lights.mjs`: everything below marked LAW is
 * enforced mechanically by `runProbe`, not by review.
 *
 * Zero dependencies, Node 22 ESM, `node:` builtins plus relative imports of the
 * modules this repository already has ONE of: `sh`/`readPremises`/
 * `normalizeResult` from `../lights/_shared.mjs`, `CHILD_ENV` from `../run.mjs`,
 * `git`/`lsFiles` from `../lib/git.mjs`. Nothing here re-implements them; a
 * second spawner or a second premise probe would be a second answer waiting to
 * disagree with the gates it is supposed to judge.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT A GROUP MODULE LOOKS LIKE (LAW)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *     // tools/gates/probes/<group>.mjs
 *     import { assert, probe, runGate, skipped } from './_harness.mjs';
 *
 *     export const title = 'one line saying what this group is about';
 *     export const probes = [
 *       probe('L-tsc: a type error in packages/core/src fails the light', (ctx) => {
 *         …
 *       }),
 *     ];
 *
 * `probes` is an ARRAY of descriptors built by `probe(name, fn)` — never a
 * module-level registry that `probe()` pushes into. A registry would be filled
 * by import order, would double on a second import, and `--only` would filter a
 * list nobody can see. An array is the list, and it is readable.
 *
 * `fn` may be sync or async; `runProbe` awaits it. It receives ONE argument,
 * `ctx = { root, premises, real, only }`:
 *   `root`      the repository root (`REPO_ROOT`), for a probe that reads this tree.
 *   `premises`  the ONE premise probe of this run (`readPremises`), so a group
 *               asks `ctx.premises.node_modules.present` instead of stat-ing.
 *   `real`      whether `--real` was passed. A group probe must NOT change what
 *               it asserts because of it; the real observations live in
 *               `gate-probes.mjs` alone.
 *   `only`      the `--only` substring, for a message that explains a narrow run.
 *
 * THREE OUTCOMES, AND NO FOURTH:
 *   pass      the fn returned normally.
 *   fail      `assert` threw (`✗`), or the fn threw anything else — reported
 *             SEPARATELY as `✗ (the probe itself threw)`, because a probe that
 *             dies on module resolution or a missing binary is not evidence
 *             about a gate. Eleven probes in the Resonance original went red
 *             exactly that way and read as eleven caught defects.
 *   skipped   the fn returned `SKIP`, or `skipped('<reason>')` (`○`). A skip is
 *             NOT a pass and `gate-probes` exits non-zero on one; it exists so
 *             "the premise is absent" cannot be dressed up as "the gate is fine".
 *
 * TWO LINT CONSTRAINTS ON A GROUP, both measured on this tree rather than
 * guessed — `tools/**` is linted with `correctness` and `suspicious` as errors,
 * and a probe file is no exception:
 *   - a fn that returns `skipped(…)` on one path must END with `return null;`,
 *     or `typescript(consistent-return)` fires. `null` is a pass: only `SKIP`
 *     and `skipped()` mean "did not run".
 *   - `.toSorted()` with no comparator is `typescript(require-array-sort-compare)`.
 *     Use `byCodepoint` from `../lights/_shared.mjs`, which is also the ONE sort
 *     order the lights use — locale collation is machine state.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * `assert(cond, msg)` IS THE ONLY WAY TO FAIL — AND `msg` CARRIES THE OUTPUT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `assert` refuses a message that is not a non-empty string, because the whole
 * value of a probe is in what it prints when it fires. `assert(x === y, 'should
 * match')` is useless: it names no file, no gate and no observed text. Write the
 * ACTUAL output of the thing being judged into the message — the convenience
 * forms below do it for you and are the shortest path:
 *
 *     assertStatus(res, 1, 'spec-gate on an unanswered question');
 *     assertOut(res, /Open questions/, 'spec-gate on an unanswered question');
 *     assertLight(row, 'fail', /docs\/vendor\/fastify\.md/, 'L-deps with no digest');
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * A PROBE THAT ASSERTS ONLY THE EXIT CODE IS USELESS — AND THAT IS ENFORCED
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * A gate can exit non-zero for reasons that have nothing to do with the defect
 * planted: an import that did not resolve, a binary that is not there, a path
 * typo. Read as "the gate caught it", that is a probe proving the opposite of
 * what it claims. So `runGate` and `runLight` return objects whose fields are
 * GETTERS that record which of them a probe actually read, and `runProbe` fails
 * the probe when the verdict field was read and no text field ever was:
 *
 *     runGate  → reading `status` obliges reading one of `out|stdout|stderr|combined`
 *     runLight → reading `status` obliges reading `detail`
 *
 * A result nobody reads at all is left alone — `runGate` is also how a fixture
 * is SET UP (a commit, an install-free install), and setup asserts nothing.
 * `JSON.stringify(res)` touches every getter and therefore satisfies the check
 * without reading anything in particular; that is the one way around it, and it
 * is written here rather than hidden.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * FIXTURES: NO `pnpm install`, AND THE REAL MODULES THE SUBJECT IMPORTS
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `scratchRepo()` is a `mkdtemp` + `git init -b main` with a fixed identity and
 * fixed commit dates, so a fixture is reproducible and its commits are not
 * machine state. `writeWorkspace(r)` fills it, and it does NOT hand-write a
 * miniature monorepo: it COPIES this repository's own tracked skeleton
 * (`git ls-files` over `packages`, `apps`, `e2e` plus the declared root files)
 * and REFUSES when a listed file is missing. A hand-written fixture is a second
 * description of the workspace, and a probe against a shape the repository does
 * not have proves something about an imaginary project. `copyGates(r)` copies
 * the real `tools/gates/lib/*.mjs`, `tools/gates/lights/*.mjs`, the four
 * manifests and the gate scripts, for the same reason in the other direction:
 * run a gate against a fixture that lacks the modules it imports and the probe
 * fails on MODULE RESOLUTION, which reads as a caught defect.
 *
 * `linkNodeModules(r)` symlinks THIS repository's `node_modules` into the
 * fixture — `pnpm install` per fixture is minutes of network per probe run, and
 * the install is not what is being probed. Two consequences, both deliberate:
 * the fixture sees exactly the versions this tree has (which is what a probe
 * should judge), and nothing in a fixture may write into `node_modules`.
 *
 * Every scratch directory is removed when the run ends. `CHEQ_KEEP_SCRATCH=1`
 * keeps them and makes `gate-probes` print where they are, for the ten minutes
 * after a probe fails and the question is what the fixture actually looked like.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { lsFiles } from '../lib/git.mjs';
import { CHILD_ENV } from '../run.mjs';
import { normalizeResult, readPackages, readPremises, sh } from '../lights/_shared.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repository this harness belongs to: `tools/gates/probes/..` twice over. */
export const REPO_ROOT = resolve(HERE, '..', '..', '..');

/** Where the captured artifacts live. Relative, so it can be printed. */
export const FIXTURES_REL = 'tools/gates/fixtures';

/** Returned (or thrown) to say a probe did not run. Never a pass. */
export const SKIP = Symbol('probe skipped');

/** The sentence the summary carries, so it is one string in one place. */
export const SKIPPED_NOTE = 'a skipped probe is not a pass';

/** The three marks, in the one spelling every group prints. */
export const MARKS = Object.freeze({ pass: '✓', fail: '✗', skipped: '○' });

export const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');

// ------------------------------------------------------------------ assertions

/** What `assert` throws. Distinguished from an accidental throw on purpose. */
export class ProbeFailure extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProbeFailure';
  }
}

/**
 * The ONE way a probe fails. `msg` must be a non-empty string and must carry the
 * actual output of whatever was judged — see the header. A message that is not a
 * string is a TypeError here rather than a silent `undefined` in a report.
 */
export function assert(cond, msg) {
  if (typeof msg !== 'string' || msg.trim() === '') {
    throw new TypeError(
      'assert(cond, msg): msg must be a non-empty string carrying the ACTUAL output of the thing judged — a probe that fires with no message names no gate, no file and no cure (rule 8)',
    );
  }
  if (!cond) throw new ProbeFailure(msg);
}

/** `return skipped('<reason>')` — a skip WITH its reason, which is the only readable kind. */
export function skipped(reason) {
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new TypeError('skipped(reason): a skip with no reason is unreadable — name the premise that is absent');
  }
  return { [SKIP]: reason };
}

/** True when a probe's return value says "skipped", in either form. */
function skipReasonOf(returned) {
  if (returned === SKIP) return '(no reason given — use skipped("<reason>"))';
  if (returned !== null && typeof returned === 'object' && Object.hasOwn(returned, SKIP)) return String(returned[SKIP]);
  return null;
}

/** A descriptor. `probe()` builds one; it does not run or register anything. */
export function probe(name, fn) {
  if (typeof name !== 'string' || name.trim() === '') throw new TypeError('probe(name, fn): name must be a non-empty string');
  if (typeof fn !== 'function') throw new TypeError(`probe(${JSON.stringify(name)}, fn): fn must be a function`);
  return { name, fn };
}

// ------------------------------------------------- the read ledger (enforced)

/**
 * Open while ONE probe's fn runs, so the ledger cannot mix two probes. Probes
 * are executed strictly sequentially by `runGroup`, which is what makes a
 * module-level current ledger correct here.
 */
let LEDGER = null;

/**
 * Wrap a result so reads are recorded. `verdictKey` read without any of
 * `textKeys` is the failure described in the header.
 */
function tracked(data, { what, verdictKey, textKeys }) {
  const reads = new Set();
  const out = {};
  for (const key of Object.keys(data)) {
    Object.defineProperty(out, key, {
      enumerable: true,
      configurable: false,
      get() {
        reads.add(key);
        return data[key];
      },
    });
  }
  if (LEDGER !== null) LEDGER.push({ what, verdictKey, textKeys, reads });
  return out;
}

function ledgerProblems(entries) {
  const problems = [];
  for (const e of entries) {
    if (!e.reads.has(e.verdictKey)) continue;
    if (e.textKeys.some((k) => e.reads.has(k))) continue;
    problems.push(
      `${e.what}: the probe read \`${e.verdictKey}\` and never read ${e.textKeys.map((k) => `\`${k}\``).join(' / ')} — ` +
        'a probe that asserts only the exit code reads "the gate failed for the reason I planted" off a gate that may have failed ' +
        'on an unresolved import, a missing binary or a path typo. Assert the TEXT as well.',
    );
  }
  return problems;
}

// ------------------------------------------------------------ running a probe

/**
 * Run one descriptor. NEVER throws.
 *
 * → { name, state: 'pass'|'fail'|'skipped', kind: 'assert'|'threw'|null,
 *     message: string|null }
 */
export async function runProbe(p, ctx = {}) {
  const previous = LEDGER;
  const entries = [];
  LEDGER = entries;
  try {
    const returned = await p.fn({ root: REPO_ROOT, premises: ctx.premises ?? readPremises(REPO_ROOT), real: ctx.real === true, only: ctx.only ?? null });
    const reason = skipReasonOf(returned);
    if (reason !== null) return { name: p.name, state: 'skipped', kind: null, message: reason };
    const problems = ledgerProblems(entries);
    if (problems.length > 0) return { name: p.name, state: 'fail', kind: 'assert', message: problems.join('\n') };
    return { name: p.name, state: 'pass', kind: null, message: null };
  } catch (e) {
    if (e instanceof ProbeFailure) return { name: p.name, state: 'fail', kind: 'assert', message: e.message };
    const first = String(e?.stack ?? e?.message ?? e)
      .split('\n')
      .slice(0, 4)
      .join('\n');
    return {
      name: p.name,
      state: 'fail',
      kind: 'threw',
      message: `the probe itself threw — this is NOT evidence about the thing it judges:\n${first}`,
    };
  } finally {
    LEDGER = previous;
  }
}

/**
 * Run a whole group STRICTLY sequentially, handing each result to `onResult` as
 * it lands so a caller can print it immediately. → the results, in order.
 *
 * Sequential is a requirement, not an oversight: the read ledger belongs to one
 * probe at a time, and two probes sharing a scratch directory or a planted file
 * would judge each other's leftovers.
 *
 * Written as recursion rather than a loop, and MEASURED rather than guessed:
 * this repository's lint lane runs `eslint(no-await-in-loop)` as an error over
 * `tools/**`, and oxlint 1.90.0 flags `for await (… of …)` under that rule too —
 * which upstream eslint does not. So the one sequential driver lives here, in
 * one place, and every group and the CLI pass a callback instead of writing a
 * loop of their own.
 */
export async function runGroup(list, ctx = {}, onResult = () => {}) {
  const [first, ...rest] = list;
  if (first === undefined) return [];
  const r = await runProbe(first, ctx);
  onResult(r);
  return [r, ...(await runGroup(rest, ctx, onResult))];
}

// -------------------------------------------------------- calling the subject

/**
 * A gate AS A PROCESS. `script` is repo-relative (`tools/gates/spec-gate.mjs`).
 *
 * It is resolved against `cwd` FIRST, so a fixture that carries its own copy of
 * the gates judges itself end to end, and against `REPO_ROOT` otherwise; the
 * answer is in `resolvedFrom`, so a failure says which copy ran. The exit code
 * is captured by `spawnSync` — never through a pipe: `cmd | head` reports `$?` of
 * `head`, which lied three times in the session that wrote these gates.
 *
 * → tracked { argv, status, signal, out, stdout, stderr, combined, script,
 *             resolvedFrom, cwd, spawnError, timedOut }
 * `status` is `null` when the process could not be started at all.
 */
export function runGate(script, args = [], { cwd = REPO_ROOT, env = {}, input, timeout = 300_000 } = {}) {
  const inFixture = join(cwd, script);
  const fromFixture = existsSync(inFixture);
  const abs = fromFixture ? inFixture : join(REPO_ROOT, script);
  const r = sh(process.execPath, [abs, ...args], { cwd, env: { ...CHILD_ENV, ...env }, input, timeout });
  return tracked(
    {
      argv: [script, ...args],
      script,
      resolvedFrom: fromFixture ? 'fixture' : 'repository',
      cwd,
      status: r.code,
      signal: r.signal,
      stdout: r.stdout,
      stderr: r.stderr,
      combined: r.combined,
      out: r.combined,
      spawnError: r.spawnError,
      timedOut: r.timedOut,
    },
    { what: `runGate(${script} ${args.join(' ')})`, verdictKey: 'status', textKeys: ['out', 'stdout', 'stderr', 'combined'] },
  );
}

/**
 * A workspace BINARY as a process: `node_modules/.bin/<name>`, resolved in
 * `cwd` first and in `REPO_ROOT` otherwise (a fixture reaches the repository's
 * binaries through its symlinked `node_modules`, so both answers are the same
 * install — `resolvedFrom` says which path was used). Never `pnpm exec`: that
 * adds a parent process whose exit code is not the tool's.
 *
 * → the same tracked shape as `runGate`, with `bin` naming the absolute binary.
 * `status: null` and `spawnError` set means the binary is not installed, which
 * is a SKIP for the caller, never a red.
 */
export function runBin(name, args = [], { cwd = REPO_ROOT, env = {}, input, timeout = 600_000 } = {}) {
  const local = join(cwd, 'node_modules', '.bin', name);
  const fromCwd = existsSync(local);
  const abs = fromCwd ? local : join(REPO_ROOT, 'node_modules', '.bin', name);
  const r = sh(abs, args, { cwd, env: { ...CHILD_ENV, ...env }, input, timeout });
  return tracked(
    {
      argv: [name, ...args],
      bin: abs,
      script: name,
      resolvedFrom: fromCwd ? 'fixture' : 'repository',
      cwd,
      status: r.code,
      signal: r.signal,
      stdout: r.stdout,
      stderr: r.stderr,
      combined: r.combined,
      out: r.combined,
      spawnError: r.spawnError,
      timedOut: r.timedOut,
    },
    { what: `runBin(${name} ${args.join(' ')})`, verdictKey: 'status', textKeys: ['out', 'stdout', 'stderr', 'combined'] },
  );
}

/** `assertStatus(res, 1, '<what was planted>')` — the message carries the output. */
export function assertStatus(res, want, what) {
  const got = res.status;
  assert(
    got === want,
    `${what}: expected exit ${String(want)}, got ${String(got)}${res.spawnError ? ` (spawn error: ${res.spawnError})` : ''}\n` +
      `  argv: ${res.argv.join(' ')} (${res.resolvedFrom})\n  output:\n${indent(res.out)}`,
  );
}

/** `assertOut(res, /re/, '<what was planted>')` — the message carries the output. */
export function assertOut(res, re, what) {
  assert(
    re.test(res.out),
    `${what}: the output does not match ${String(re)}\n  argv: ${res.argv.join(' ')} (${res.resolvedFrom}), exit ${String(res.status)}\n  output:\n${indent(res.out)}`,
  );
}

/** The negative form, for "and it must NOT say this". */
export function assertNotOut(res, re, what) {
  assert(
    !re.test(res.out),
    `${what}: the output matches ${String(re)} and must not\n  argv: ${res.argv.join(' ')} (${res.resolvedFrom}), exit ${String(res.status)}\n  output:\n${indent(res.out)}`,
  );
}

/** A light AS A MODULE: `tools/gates/lights/<id без L->.mjs`, the registry `lights/run.mjs` uses. */
export async function loadLight(id, { root = REPO_ROOT } = {}) {
  const rel = `tools/gates/lights/${String(id).replace(/^L-/, '')}.mjs`;
  const abs = join(root, rel);
  assert(existsSync(abs), `loadLight(${id}): ${rel} does not exist under ${root} — the light that owns that id is not written here`);
  return import(pathToFileURL(abs).href);
}

/**
 * Run one light the way `lights/run.mjs` does: synchronous `run(ctx)`, the
 * module's own severity, the result passed through the SAME `normalizeResult`
 * the aggregator judges it with.
 *
 * `ctx` needs `{ root, mb }` at least; `premises` is probed for the fixture root
 * when the caller omits it, and `rangeKind`/`mode`/`allow`/`tolerate` default to
 * the shape a `--fast` run hands a light.
 *
 * → tracked { id, severity, status, detail, problems, notRun }
 */
export async function runLight(id, ctx = {}) {
  const root = ctx.root ?? REPO_ROOT;
  const mod = await loadLight(id, { root: ctx.lightsFrom ?? root });
  assert(typeof mod.run === 'function', `runLight(${id}): the module exports no run() — the contract is { id, severity, dependsOn?, premises?, run(ctx) }`);
  const full = {
    root,
    mb: ctx.mb ?? null,
    allow: ctx.allow ?? [],
    mode: ctx.mode ?? 'fast',
    thin: ctx.thin ?? false,
    premises: ctx.premises ?? readPremises(root),
    base: ctx.base ?? 'main',
    rangeKind: ctx.rangeKind ?? 'previous-commit',
    tolerate: ctx.tolerate ?? false,
  };
  const returned = mod.run(full);
  assert(typeof returned?.then !== 'function', `runLight(${id}): run() returned a Promise — a light is SYNCHRONOUS by contract (lights/_shared.mjs)`);
  const row = normalizeResult({ id: mod.id ?? id, severity: mod.severity }, returned);
  return tracked({ ...row, light: id }, { what: `runLight(${id})`, verdictKey: 'status', textKeys: ['detail'] });
}

/** `assertLight(row, 'fail', /re/, '<what was planted>')` — status AND detail, both. */
export function assertLight(row, wantStatus, detailRe, what) {
  const got = row.status;
  const detail = row.detail;
  assert(got === wantStatus, `${what}: expected ${row.light ?? 'the light'} to read ${wantStatus}, it read ${String(got)}\n  detail: ${detail}`);
  if (detailRe !== null && detailRe !== undefined) {
    assert(detailRe.test(detail), `${what}: ${row.light ?? 'the light'} read ${wantStatus} but its detail does not match ${String(detailRe)}\n  detail: ${detail}`);
  }
}

const indent = (text) =>
  String(text ?? '')
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');

// -------------------------------------------------------------------- fixtures

export function fixturePath(...seg) {
  return join(REPO_ROOT, FIXTURES_REL, ...seg);
}

/** A captured artifact, verbatim. Fails the probe when it is not there. */
export function readFixture(...seg) {
  const p = fixturePath(...seg);
  assert(existsSync(p), `fixture missing: ${join(FIXTURES_REL, ...seg)} — the captured artifacts are committed on purpose (see ${FIXTURES_REL}/README.md); re-capture it rather than hand-writing one`);
  return readFileSync(p, 'utf8');
}

export function fixtureJson(...seg) {
  const text = readFixture(...seg);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ProbeFailure(`fixture ${join(FIXTURES_REL, ...seg)} is not JSON: ${String(e.message)}`);
  }
}

// ------------------------------------------------------------ the scratch repo

const SCRATCH = [];

/** Fixed, so a fixture's commits are not machine state. */
const FIXED_DATE = '2026-01-01T00:00:00 +0000';

/**
 * A throwaway git repository. → a handle:
 *
 *   dir                 absolute path
 *   write(rel, text)    write a file, creating its directories
 *   read(rel)           read one back ('' when absent)
 *   rm(rel)             remove a path
 *   copyFrom(abs, rel)  copy a file in from anywhere
 *   git(args)           run git in it (the ../lib/git.mjs runner)
 *   add(pathspec)       `git add -A <pathspec>`
 *   commit(msg, {verbatim, allowEmpty})  add -A then commit; `verbatim` passes
 *                       `--cleanup=verbatim`, which is the only way to commit a
 *                       message git would otherwise rewrite — a trailer ending
 *                       in CR among them, which is a form test-guard must read
 *                       and which cannot be produced any other way.
 *   head()              the HEAD sha, or null
 *   cleanup()           remove the directory
 */
export function scratchRepo({ label = 'probe' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `cheq-${label}-`));
  SCRATCH.push(dir);
  // `../lib/git.mjs` is the READER of this repository and takes no env; a
  // fixture needs its author date and its HOME pinned, so building one goes
  // through `sh`, the declared one way to run a child process.
  const env = {
    GIT_AUTHOR_DATE: FIXED_DATE,
    GIT_COMMITTER_DATE: FIXED_DATE,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    LANG: 'C',
    LC_ALL: 'C',
    LANGUAGE: '',
    TZ: 'UTC',
    NO_COLOR: '1',
    HOME: dir,
  };
  const run = (args) => sh('git', args, { cwd: dir, env });
  const handle = {
    dir,
    env,
    git(args) {
      const r = run(args);
      if (!r.ok) throw new ProbeFailure(`git ${args.join(' ')} failed in the fixture ${dir}: exit ${String(r.code)} ${r.combined.trim() || r.spawnError || 'no output'}`);
      return r;
    },
    tryGit: run,
    write(rel, text) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text);
      return abs;
    },
    read(rel) {
      const abs = join(dir, rel);
      return existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    },
    rm(rel) {
      rmSync(join(dir, rel), { recursive: true, force: true });
    },
    /** `opts` reaches `cpSync` verbatim. The one caller that needs it is the copy of
     *  a `node_modules` symlink farm, which must pass `verbatimSymlinks: true` — see
     *  `copyPackageNodeModules`. */
    copyFrom(abs, rel, opts = {}) {
      const target = join(dir, rel);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(abs, target, { recursive: true, ...opts });
      return target;
    },
    add(pathspec = '-A') {
      return handle.git(['add', '-A', ...(pathspec === '-A' ? [] : [pathspec])]);
    },
    commit(msg, { verbatim = false, allowEmpty = true } = {}) {
      handle.git(['add', '-A']);
      const args = ['commit', '-m', msg];
      if (allowEmpty) args.push('--allow-empty');
      if (verbatim) args.push('--cleanup=verbatim');
      return handle.git(args);
    },
    head() {
      const r = run(['rev-parse', 'HEAD']);
      return r.ok ? r.stdout.trim() : null;
    },
    cleanup() {
      // A probe may clean up early to bound the disk a long run uses — but not
      // when the run was asked to KEEP the fixtures: a flag the probes defeat
      // one by one is a flag that does not work.
      if (keepScratch()) return;
      rmSync(dir, { recursive: true, force: true });
    },
  };

  handle.git(['init', '-b', 'main']);
  handle.git(['config', 'user.email', 'probe@example.invalid']);
  handle.git(['config', 'user.name', 'Probe Fixture']);
  handle.git(['config', 'commit.gpgsign', 'false']);
  // The repository's own hook must never run inside a fixture: it would judge
  // the fixture with the gates under test and recurse.
  handle.git(['config', 'core.hooksPath', join(dir, '.githooks-none')]);
  return handle;
}

/** True while the run was asked to keep its fixtures. */
export const keepScratch = () => process.env.CHEQ_KEEP_SCRATCH === '1';

/**
 * Remove every scratch directory this process made. `gate-probes` calls it in a
 * finally. `kept` lists only the directories that are STILL THERE: a probe may
 * have cleaned up its own, and reporting a path that does not exist as "left
 * behind for inspection" sends the reader looking for nothing.
 */
export function cleanupScratch({ keep = keepScratch() } = {}) {
  const all = [...SCRATCH];
  if (!keep) for (const d of all) rmSync(d, { recursive: true, force: true });
  SCRATCH.length = 0;
  const kept = keep ? all.filter((d) => existsSync(d)) : [];
  return { kept, removed: keep ? 0 : all.length };
}

// ------------------------------------------------------ filling the fixture

/**
 * The root files a workspace fixture needs, beside the tracked trees. Each is
 * COPIED from this repository; a missing one is a refusal, never a quiet skip,
 * because a fixture that silently lacks `jest.config.mjs` probes a project
 * layout this repository does not have.
 */
export const WORKSPACE_ROOT_FILES = Object.freeze([
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'jest.config.mjs',
  '.oxlintrc.jsonc',
  '.gitignore',
  '.nvmrc',
  '.npmrc',
  'playwright.config.ts',
]);

/**
 * Root files copied WHEN THIS REPOSITORY HAS THEM, rather than refused when it does
 * not — the `e2e` rule of `WORKSPACE_TREES`, applied to a file.
 *
 * `Dockerfile` is here because a container is a thing a repository may or may not
 * have, and asserting its presence in the harness would be the harness asserting a
 * fact about the PRODUCT. What makes the absence loud anyway is that the file is
 * load-bearing for a gate: `L-orphans` seeds clause 1b from the image's esbuild
 * entry (`containerEntries`), so a fixture that failed to copy it reports
 * `apps/api/src/server.ts` as an orphan and every probe asserting that a copy of
 * this repository is GREEN goes red. A quiet skip here cannot stay quiet.
 */
export const WORKSPACE_ROOT_FILES_IF_PRESENT = Object.freeze(['Dockerfile']);

/** The tracked trees copied wholesale. `e2e` does not exist yet and is skipped when absent. */
export const WORKSPACE_TREES = Object.freeze(['packages', 'apps', 'e2e']);

/**
 * PER-TICKET WORK IN FLIGHT, which a baseline fixture must not inherit.
 *
 * `writeWorkspace` copies what `git ls-files` lists, and that reads the INDEX — so a spec test the
 * test phase has staged is in it. Ten probes assert that a copy of this repository is GREEN: that a
 * fixture reaches the real toolchain, that L-tsc reads the untouched skeleton as pass, that the
 * REVERSE case of L-core-purity, L-lint, L-testshape and L-orphans passes. All ten failed on
 * 2026-11-02 while CHQ-001's seven red spec tests sat staged in the tree — measured, and every
 * failure named a TS2339 for a symbol nobody has written yet.
 *
 * That is the phase, not a defect, and it would recur on every ticket: a probe about the HARNESS
 * cannot depend on which phase the product happens to be in. So the baseline excludes the spec TEST
 * directories, and a probe that wants a spec test writes its own — which is what every probe here
 * already does. The skeleton fixtures under `test/skeleton/` are NOT excluded: they are the green
 * baseline.
 *
 * SPEC CONTRACTS ARE NOT EXCLUDED, and the first version of this pattern wrongly excluded them.
 * `src/contracts/CHQ-nnn/` holds types the test phase placed on the PRODUCTION side, and once
 * `implement-to-green` lands, `src/index.ts` — which every fixture copies — imports them. Dropping
 * them left the fixture importing a path it did not have, so it could not typecheck, and EIGHTEEN
 * probes failed on a baseline that was broken rather than red (measured 2026-11-02, right after
 * CHQ-001's implementation landed). It was invisible before that only because nothing in production
 * reached the contracts yet.
 *
 * The original measurement said as much and was over-read: all ten failures that motivated the
 * exclusion were TS2339 diagnostics from TEST files, not one from a contract. A contracts file is
 * self-contained types and typechecks on its own in either phase, so it belongs in the baseline.
 */
const IN_FLIGHT_RE = /(?:^|\/)test\/CHQ-\d{3}\//;

/**
 * Fill a scratch repo with THIS repository's skeleton.
 *
 * It copies rather than writes: `git ls-files` over `WORKSPACE_TREES` plus
 * `WORKSPACE_ROOT_FILES`, from the work tree. A hand-written mini-monorepo is a
 * second description of the workspace, and the moment the real one changes the
 * probes keep passing against the old shape.
 *
 * `{ lock: true }` also copies `pnpm-lock.yaml` — needed by every light that
 * reads `git show HEAD:pnpm-lock.yaml` (L-deps, L-type-engines). `{ commit }`
 * commits the result, because every range-based gate reads HEAD and a fixture
 * with no commit can only be probed for its refusal.
 *
 * → { files: [rel], missing: [rel], head }
 */
export function writeWorkspace(r, { lock = true, commit = 'chore: scaffold', trees = WORKSPACE_TREES } = {}) {
  const files = [];
  const missing = [];
  const listed = lsFiles([...trees], { cwd: REPO_ROOT });
  assert(listed.ok, `writeWorkspace: git ls-files failed in ${REPO_ROOT}: ${listed.reason ?? 'no reason given'}`);
  const baseline = listed.files.filter((rel) => !IN_FLIGHT_RE.test(rel));
  const ifPresent = WORKSPACE_ROOT_FILES_IF_PRESENT.filter((rel) => existsSync(join(REPO_ROOT, rel)));
  const wanted = [...baseline, ...WORKSPACE_ROOT_FILES, ...ifPresent, ...(lock ? ['pnpm-lock.yaml'] : [])];
  for (const rel of wanted) {
    const abs = join(REPO_ROOT, rel);
    if (!existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    r.copyFrom(abs, rel);
    files.push(rel);
  }
  assert(
    missing.length === 0,
    `writeWorkspace: ${missing.length} declared file(s) are missing from ${REPO_ROOT} and the fixture would differ from the repository: ${missing.join(', ')}`,
  );
  const head = commit === false ? null : (r.commit(commit), r.head());
  return {
    files,
    missing,
    head,
    inFlightExcluded: listed.files.filter((rel) => IN_FLIGHT_RE.test(rel)),
    ifPresent,
    ifPresentAbsent: WORKSPACE_ROOT_FILES_IF_PRESENT.filter((rel) => !ifPresent.includes(rel)),
  };
}

/** `tools/gates` as the subject imports it. `probes/` and `fixtures/` stay out: the
 * first would recurse, the second is only read through `readFixture` from THIS tree. */
export function copyGates(r, { include = ['lib', 'lights', 'gates', 'manifests'] } = {}) {
  const want = (rel) => {
    if (rel.startsWith('tools/gates/probes/')) return false;
    if (rel.startsWith('tools/gates/fixtures/')) return false;
    if (rel.startsWith('tools/gates/lib/')) return include.includes('lib');
    if (rel.startsWith('tools/gates/lights/')) return include.includes('lights');
    if (/^tools\/gates\/[^/]+\.json$/.test(rel)) return include.includes('manifests');
    if (/^tools\/gates\/[^/]+\.mjs$/.test(rel)) return include.includes('gates');
    return false;
  };
  const listed = lsFiles(['tools'], { cwd: REPO_ROOT });
  assert(listed.ok, `copyGates: git ls-files failed in ${REPO_ROOT}: ${listed.reason ?? 'no reason given'}`);
  const copied = [];
  for (const rel of listed.files) {
    if (!want(rel)) continue;
    const abs = join(REPO_ROOT, rel);
    assert(existsSync(abs), `copyGates: ${rel} is tracked but not on disk — a fixture missing a module the gate imports fails on module resolution, which reads as a caught defect`);
    r.copyFrom(abs, rel);
    copied.push(rel);
  }
  return { copied };
}

/**
 * Copy each workspace package's own `node_modules` — pnpm's per-package symlink
 * farm — into the fixture, so a module specifier resolves the way it does in this
 * repository. `packages/core` declares no dependencies and needs none of it; a
 * fixture that must resolve `fastify` inside `apps/api`, or `@cheq/core` from it,
 * does.
 *
 * `verbatimSymlinks: true` IS THE WHOLE POINT, and its absence was a defect this
 * harness carried. `cpSync` defaults to `verbatimSymlinks: false`, which REWRITES a
 * relative symlink's target to an absolute path — measured in isolation:
 *
 *     src/nm/link -> ../target
 *     default  : /private/var/folders/…/tmp.XXXX/src/target
 *     verbatim : ../target
 *
 * So with the default, this repository's `apps/api/node_modules/@cheq/core ->
 * ../../../../packages/core` became, inside the fixture, an absolute link to
 * `/Users/…/cheq-task-manager/packages/core`, and `tsc -p apps/api/tsconfig.json`
 * run in the fixture compiled THIS repository's core rather than the fixture's own
 * (measured 2026-11-02 by `--traceResolution`: "Module name '@cheq/core' was
 * successfully resolved to /Users/…/cheq-task-manager/packages/core/src/index.ts").
 * Every `resolve: true` probe was therefore judging a tree it had not planted its
 * defect in. `L-graph REVERSE` was the only one that noticed, because that light
 * reports inputs from outside the repository under judgement.
 *
 * Copied verbatim, the same link resolves to the FIXTURE's `packages/core`, while
 * the relative hops into `node_modules/.pnpm/…` still land in the real install
 * through the root symlink `linkNodeModules` makes — which is what keeps the
 * fixture install-free.
 *
 * → { copied: [rel], absent: [rel] }
 */
export function copyPackageNodeModules(r) {
  const copied = [];
  const absent = [];
  for (const pkg of readPackages(REPO_ROOT).packages) {
    const rel = `${pkg.rel}/node_modules`;
    if (!existsSync(join(REPO_ROOT, rel))) {
      absent.push(rel);
      continue;
    }
    r.copyFrom(join(REPO_ROOT, rel), rel, { verbatimSymlinks: true });
    copied.push(rel);
  }
  return { copied, absent };
}

/** Symlink this repository's `node_modules` into the fixture. Never an install. */
export function linkNodeModules(r) {
  const src = join(REPO_ROOT, 'node_modules');
  if (!existsSync(src)) return { linked: false, reason: `no node_modules at ${src} — pnpm install` };
  const target = join(r.dir, 'node_modules');
  if (existsSync(target)) return { linked: true, reason: 'already present' };
  // `fs.symlinkSync` through the import list above would need another import; the
  // one spawner is already here and `ln -s` is the same system call.
  const res = sh('ln', ['-s', src, target]);
  return { linked: res.ok, reason: res.ok ? `${target} -> ${src}` : `ln -s failed: ${res.combined.trim()}` };
}

// -------------------------------------------------------- the harness's own probes

/**
 * The harness is itself a gate: if `scratchRepo`, the read ledger or the fixture
 * copy are broken, every group built on it reports about nothing. These run as
 * the group `harness` and are the first thing `gate-probes` prints.
 */
export const title = 'the harness itself: the ledger, the scratch repo, the copied skeleton';

export const selfProbes = [
  probe('assert refuses a message that carries no output', () => {
    let threw = null;
    try {
      assert(false, '');
    } catch (e) {
      threw = e;
    }
    assert(threw instanceof TypeError, `assert('' ) should be a TypeError about the message, got ${String(threw && threw.name)}: ${String(threw && threw.message)}`);
    let fired = null;
    try {
      assert(false, 'a message with the actual output in it');
    } catch (e) {
      fired = e;
    }
    assert(fired instanceof ProbeFailure, `assert(false, msg) should throw ProbeFailure, got ${String(fired && fired.name)}`);
  }),

  probe('a probe that reads only the exit code is failed by the ledger', async () => {
    const result = await runProbe(
      probe('inner: exit code only', () => {
        const res = runGate('tools/gates/status.mjs', ['--help']);
        assert(res.status !== null, `status.mjs --help did not start: ${String(res.status)}`);
      }),
    );
    assert(
      result.state === 'fail' && /asserts only the exit code/.test(result.message ?? ''),
      `the ledger should fail a probe that never read the output; it answered state=${result.state} message=${String(result.message)}`,
    );
    const ok = await runProbe(
      probe('inner: exit code and text', () => {
        const res = runGate('tools/gates/status.mjs', ['--help']);
        assert(res.status === 0 && res.out.length > 0, `status.mjs --help: exit ${String(res.status)}, output ${JSON.stringify(res.out.slice(0, 120))}`);
      }),
    );
    assert(ok.state === 'pass', `a probe reading both channels should pass; it answered state=${ok.state} message=${String(ok.message)}`);
  }),

  probe('the ledger holds for a LIGHT too: a status read without its detail fails the probe', async () => {
    const result = await runProbe(
      probe('inner: light status only', async () => {
        const row = await runLight('L-homes', { mb: null });
        assert(row.status !== undefined, `L-homes returned no status: ${String(row.status)}`);
      }),
    );
    assert(
      result.state === 'fail' && /asserts only the exit code/.test(result.message ?? ''),
      `a light row whose detail was never read must fail the probe; it answered state=${result.state} message=${String(result.message)}`,
    );
    const ok = await runProbe(
      probe('inner: light status and detail', async () => {
        const row = await runLight('L-homes', { mb: null });
        assertLight(row, row.status, /\S/, 'L-homes as the registry calls it');
      }),
    );
    assert(ok.state === 'pass', `reading both must pass; it answered state=${ok.state} message=${String(ok.message)}`);
  }),

  probe('a probe that throws is reported as the PROBE failing, not the subject', async () => {
    const result = await runProbe(
      probe('inner: broken probe', async () => {
        await import('./__a_module_nobody_wrote.mjs');
      }),
    );
    assert(
      result.state === 'fail' && result.kind === 'threw' && /the probe itself threw/.test(result.message ?? ''),
      `an unresolved import inside a probe must read as the probe failing; got state=${result.state} kind=${String(result.kind)} message=${String(result.message)}`,
    );
  }),

  probe('skipped() carries its reason and is not a pass', async () => {
    const result = await runProbe(probe('inner: skipped', () => skipped('node_modules is absent')));
    assert(
      result.state === 'skipped' && result.message === 'node_modules is absent',
      `skipped('…') should answer state=skipped with the reason; got state=${result.state} message=${String(result.message)}`,
    );
  }),

  probe('scratchRepo commits, and --cleanup=verbatim keeps a CR-terminated trailer git would strip', () => {
    const r = scratchRepo({ label: 'harness-git' });
    r.write('a.txt', 'one\n');
    r.commit('chore: first');
    const head = r.head();
    assert(/^[0-9a-f]{40}$/.test(String(head)), `the fixture has no HEAD after a commit: ${String(head)}`);

    r.write('b.txt', 'two\n');
    r.commit('test: a CRLF trailer\r\n\r\npackage: fastify — because the api needs a server\r\n', { verbatim: true });
    const verbatim = r.git(['log', '-1', '--format=%B']).stdout;
    assert(verbatim.includes('package: fastify — because the api needs a server\r'), `--cleanup=verbatim should keep the CR: ${JSON.stringify(verbatim)}`);

    r.write('c.txt', 'three\n');
    r.commit('test: the same trailer without verbatim\r\n\r\npackage: fastify — because the api needs a server\r\n');
    const cleaned = r.git(['log', '-1', '--format=%B']).stdout;
    assert(
      !cleaned.includes('server\r'),
      `git's default cleanup should have stripped the CR, which is why verbatim exists: ${JSON.stringify(cleaned)}`,
    );
    r.cleanup();
  }),

  probe('writeWorkspace copies the repository skeleton and copyGates brings the modules the gates import', () => {
    const r = scratchRepo({ label: 'harness-ws' });
    const ws = writeWorkspace(r, { lock: true });
    assert(ws.files.includes('packages/core/package.json'), `the fixture has no packages/core/package.json; it copied ${ws.files.length} file(s): ${ws.files.slice(0, 8).join(', ')}`);
    assert(ws.files.includes('jest.config.mjs'), `the fixture has no jest.config.mjs; it copied ${ws.files.length} file(s)`);
    assert(/^[0-9a-f]{40}$/.test(String(ws.head)), `writeWorkspace should leave a commit; head=${String(ws.head)}`);

    const g = copyGates(r);
    for (const needed of ['tools/gates/lib/junit-xml.mjs', 'tools/gates/lights/_shared.mjs', 'tools/gates/visible.json', 'tools/gates/lights/run.mjs']) {
      assert(g.copied.includes(needed), `copyGates did not bring ${needed}; it copied ${g.copied.length} file(s): ${g.copied.slice(0, 6).join(', ')}`);
    }
    r.commit('gate: the gates as the fixture sees them');

    // End to end: the lights pack, run from INSIDE the fixture, must produce a
    // table — the proof that the copied tree is self-contained. Anything else
    // (a refusal, a stack) means a fixture nobody can probe a light in.
    const res = runGate('tools/gates/lights/run.mjs', ['--thin', '--since', 'HEAD^'], { cwd: r.dir });
    assert(
      /\| id \| severity \| status \| detail \|/.test(res.out),
      `the lights pack did not print its table inside the fixture (exit ${String(res.status)}, ran from ${res.resolvedFrom}):\n${indent(res.out)}`,
    );
    r.cleanup();
  }),

  probe('a fixture reaches the real toolchain through a symlink, with no install of its own', (ctx) => {
    if (!havePremise(ctx, 'tsc')) return skipped(`premise "tsc" absent: ${ctx.premises.tsc.rel} does not exist — ${ctx.premises.tsc.cure}`);
    const r = scratchRepo({ label: 'harness-link' });
    writeWorkspace(r, { lock: true });
    const linked = linkNodeModules(r);
    assert(linked.linked, `the fixture must reach node_modules without an install: ${linked.reason}`);

    const res = runBin('tsc', ['--noEmit', '--pretty', 'false', '--listFiles', '-p', 'packages/core/tsconfig.json'], { cwd: r.dir });
    assert(
      res.resolvedFrom === 'fixture',
      `the binary must come from the fixture's own node_modules symlink, it came from ${res.resolvedFrom} (${res.bin})`,
    );
    assert(res.status === 0, `tsc must be green on the copied skeleton, it exited ${String(res.status)}:\n${res.out.split('\n').slice(0, 6).join('\n')}`);
    assert(
      res.stdout.split('\n').filter((l) => l.startsWith('/')).length > 0,
      `--listFiles must name the inputs it read, so a later probe can plant one and see the count change; it printed ${JSON.stringify(res.stdout.slice(0, 120))}`,
    );

    // A LIMIT of this fixture, named here because the other two groups will hit
    // it: the workspace packages' own `node_modules` (pnpm's per-package symlink
    // farm) are gitignored and therefore NOT copied by `writeWorkspace`. Only the
    // root install is reachable, which is enough for packages/core (it declares no
    // dependencies) and NOT enough for a fixture that needs `fastify` resolved
    // inside apps/api. `copyPackageNodeModules` is what lifts it, and the probe
    // below is what proves the lift does not reach back into this repository.
    r.cleanup();
    return null;
  }),

  probe('copyPackageNodeModules leaves a fixture resolving its OWN packages, not this repository\'s', (ctx) => {
    if (!havePremise(ctx, 'tsc')) return skipped(`premise "tsc" absent: ${ctx.premises.tsc.rel} does not exist — ${ctx.premises.tsc.cure}`);
    const r = scratchRepo({ label: 'harness-selfcontained' });
    writeWorkspace(r, { lock: true });
    const nm = copyPackageNodeModules(r);
    assert(nm.copied.includes('apps/api/node_modules'), `the copy must bring apps/api/node_modules; it brought ${nm.copied.join(', ') || 'nothing'} and found none at ${nm.absent.join(', ')}`);
    const linked = linkNodeModules(r);
    assert(linked.linked, `the fixture must reach node_modules without an install: ${linked.reason}`);

    // The property, read straight off the link rather than inferred: a RELATIVE
    // target is what keeps the hop inside the fixture. `cpSync` rewrites it to an
    // absolute path unless `verbatimSymlinks` is set, and that rewrite is the
    // defect this probe exists for.
    const link = join(r.dir, 'apps/api/node_modules/@cheq/core');
    const target = existsSync(link) ? readlinkSync(link) : null;
    assert(
      target !== null && target.startsWith('..'),
      `apps/api/node_modules/@cheq/core must be a RELATIVE symlink so it resolves inside the fixture; it reads ${JSON.stringify(target)}`,
    );

    // And the consequence, asked of the compiler: no SOURCE of this repository may
    // appear among the inputs. The real `node_modules` legitimately does — that is
    // the symlink above, and the reason the fixture needs no install of its own.
    const res = runBin('tsc', ['--noEmit', '--pretty', 'false', '--listFiles', '-p', 'apps/api/tsconfig.json'], { cwd: r.dir });
    assert(res.status === 0, `tsc must be green on the copied skeleton, it exited ${String(res.status)}:\n${res.out.split('\n').slice(0, 6).join('\n')}`);
    const foreign = res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith(`${REPO_ROOT}/packages/`) || l.startsWith(`${REPO_ROOT}/apps/`));
    assert(
      foreign.length === 0,
      `tsc in the fixture read ${foreign.length} source(s) of THIS repository, so a defect planted in the fixture would be judged against a tree that does not hold it: ${foreign.slice(0, 4).join(', ')}`,
    );
    r.cleanup();
    return null;
  }),

  probe('runLight calls a light the way the registry does and normalises its row', async () => {
    const row = await runLight('L-homes', { mb: null });
    assert(
      ['pass', 'fail', 'cannot-verify'].includes(row.status) && row.detail.length > 0,
      `L-homes answered status=${String(row.status)} detail=${JSON.stringify(row.detail)} — every light returns one of three statuses and a non-empty detail`,
    );
  }),

  probe('the captured fixtures are present and readable', () => {
    const manifest = fixtureJson('manifest.json');
    const entries = Object.keys(manifest.artifacts ?? {});
    assert(entries.length > 0, `${FIXTURES_REL}/manifest.json declares no artifacts: ${JSON.stringify(manifest).slice(0, 200)}`);
    const absent = entries.filter((rel) => !existsSync(fixturePath(rel)));
    assert(absent.length === 0, `${FIXTURES_REL}/manifest.json declares ${absent.length} artifact(s) that are not on disk: ${absent.join(', ')}`);
  }),
];

/** Written here so `gate-probes.mjs` and a group ask the same question. */
export function havePremise(ctx, name) {
  const p = ctx?.premises?.[name];
  return p !== undefined && p.present === true;
}

/** A directory for a probe's own scratch artifacts inside `.ci/` (gitignored). */
export function probeArtifactDir(sub) {
  const dir = join(REPO_ROOT, '.ci', 'probe', sub);
  mkdirSync(dir, { recursive: true });
  return dir;
}
