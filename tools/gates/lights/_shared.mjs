/**
 * lights/_shared.mjs — the foundation the sixteen standing lights stand on: ONE
 * directory walk, ONE workspace-manifest reader, ONE tsc closure, ONE reader per
 * declared manifest, and ONE way to run a child process. Nothing here is a
 * light; everything here is a reader a light asks.
 *
 * Zero dependencies. `node:` builtins plus two relative imports (`../lib/*.mjs`),
 * because a gate has to run in a fresh worktree before an install finishes.
 * No module here parses TypeScript: a question about types goes to `tsc` and
 * comes back as text (`resolveClosure`). A token scan over masked source is
 * allowed and is `codeOnly`, which is RE-EXPORTED from `../lib/test-cases.mjs`
 * rather than written twice.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE LIGHT MODULE CONTRACT — this is the law `run.mjs` enforces
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * A light module is `tools/gates/lights/<id without the `L-` prefix>.mjs`, so
 * `L-core-purity` is `lights/core-purity.mjs`. There is no table mapping one to
 * the other: the filename IS the id, and `run.mjs` derives it (`moduleOf`).
 *
 *     export const id = 'L-something';          // from STANDING_LIGHT_IDS
 *     export const severity = 'hard' | 'soft';
 *     export const dependsOn = ['L-other'];     // optional, see below
 *     export const premises = ['tsc'];          // optional, names from PREMISES
 *     export function run(ctx) {                // SYNCHRONOUS, always
 *       return { id, severity, status, detail };
 *     }
 *
 *   `status` is one of `LIGHT_STATUSES` (`pass` | `fail` | `cannot-verify`) —
 *   imported from `../lib/spec-parse.mjs`, never spelled out in a light.
 *   `detail` is MANDATORY and non-empty: it carries the artifact path the verdict
 *   was read from, or the list of problems, and it is the only part of a row a
 *   human acts on. A result with an empty detail is rewritten by `run.mjs` into
 *   `cannot-verify · the light returned no detail`, because a row that says FAIL
 *   and nothing else is an unusable interface (rule 8).
 *
 *   `ctx` carries AT LEAST `{ root, mb, allow }` — the repository root, the base
 *   of the range, and the package allowlist a spec's wave named. A range-based
 *   light diffs `mb..HEAD` and reads neither the work tree nor the index, so
 *   `mb` decides what it can see; `run.mjs` is the ONE place that answers which
 *   commit it is, and `ctx.rangeKind` is the word for that answer, so a light
 *   reports what it compared against instead of inferring it from a sha. There
 *   are FOUR kinds and no fifth (`RANGE_KINDS` in `run.mjs`):
 *
 *     'since'            the commit `--since` named.
 *     'merge-base'       the fork point from the base ref; HEAD is ahead of it.
 *     'previous-commit'  `HEAD^`. HEAD is AT the base ref, so `<base>..HEAD`
 *                        would be EMPTY — and an empty range does not fail a
 *                        light, it makes every range-based one report "0
 *                        changed" and PASS. Measured on this tree: the same
 *                        scaffold commit read as 0 additions against the empty
 *                        range and as 21 additions with 4 undeclared
 *                        dependencies against `HEAD^`. This kind is the
 *                        ordinary one on a single-branch repository, which is
 *                        why it is named and not a silent fallback.
 *     'empty-tree'       the empty-tree hash: HEAD is a root commit, or the
 *                        branch shares no history with the base ref. Every file
 *                        IS an addition, which is what a first commit is.
 *
 *   A light must not re-derive any of this: `baseRev`/`hasCommits` in
 *   `../lib/git.mjs` answer a narrower question and do NOT know about the empty
 *   range, so a light that calls them for itself gets the reading this contract
 *   exists to prevent. Take `ctx.mb` and `ctx.rangeKind`. The context also
 *   carries `{ mode, thin, premises, base, tolerate }`; a light may read those
 *   and nothing else. `premises` is the ONE premise probe of the run (see
 *   below), taken once so twelve lights do not each stat the same directory and,
 *   more importantly, so the NAME of a missing premise is one string in one
 *   place. A light may also DECLARE `premises: ['tsc']`, and `run.mjs` then
 *   refuses it with that premise's own name before `run` is ever called — but
 *   only a light that can do NOTHING without it should declare one; see
 *   `requirePremise` below.
 *
 *   `dependsOn` is a DECLARATION, not an array position. Two things follow from
 *   it and nothing else: execution order (`run.mjs` topologically sorts, so a
 *   dependency has already reported when the dependent runs) and tolerance
 *   propagation (`--pending-implementation-tolerance` is recognised on `L-tsc`
 *   and, since 2026-11-02, on `L-lint`, each deciding for ITSELF whether its own
 *   findings are the pending-implementation shape and saying so with the prefix;
 *   a light that declares `dependsOn: ['L-tsc']` has its own cannot-verify shown
 *   as the same warning instead of blocking). In the Resonance original
 *   that relationship was implicit in a literal's order — `csc` first,
 *   `monoParity` last — which is a fact nobody can read off the code.
 *
 *   `run` IS SYNCHRONOUS. Every reader in `../lib` is (`spawnSync`,
 *   `readFileSync`), so a Promise buys a light nothing and would only invite a
 *   parallel run whose artifacts interleave; `run.mjs` turns a returned Promise
 *   into cannot-verify naming the file, rather than reading its missing `status`
 *   as a mystery. Sequencing is the aggregator's job.
 *
 *   A light NEVER calls `process.exit`, never prints, and never throws for a
 *   verdict: a thrown exception is caught by `run.mjs` and becomes
 *   `cannot-verify · threw: <first line>`, which blocks when the light is hard.
 *   Throwing is therefore never a way to say "red".
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE WALK HAS EXACTLY ONE DECLARED REASON TO SKIP A PATH
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `walk()` skips a path only when `tools/gates/visible.json` declares it, and
 * `isExcluded` — the predicate that answers that question — lives in THIS
 * module, the same one that reads the manifest. The blind spot of every walk and
 * the light that guards the blind spot (`L-visible`) therefore read ONE file
 * through ONE reader. Two readers of a blind-spot manifest is the failure this
 * arrangement exists to prevent: the walk tolerates a shape the guard refuses,
 * and a whole subtree becomes invisible to every hard light without a word.
 *
 * Beside that one declared reason there are the segments that are already
 * invisible to every tool in this toolchain — a `.`-prefixed segment (`.git`,
 * `.ci`, `.pnpm`) and `node_modules`. Declaring one of those would change
 * nothing, so `isExcluded` reports them with `why: 'self-hidden'` and
 * `L-visible` does not count them against the manifest. That list is a frozen
 * constant in CODE (`SELF_HIDDEN`) and deliberately NOT a manifest field: a
 * configurable self-hidden list is a second door, and the whole point of
 * `visible.json` is that there is one.
 *
 * Manifest entries are LITERAL repo-relative paths — a path matches an entry
 * when it equals it or lies under it. No globs. A glob in a blind-spot manifest
 * is a small language nobody can audit, and "which files does this hide" stops
 * being answerable by reading.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * JSON HAS NO COMMENTS, SO THE MANIFESTS CARRY `_note`
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * The four manifests (`visible`, `homes`, `generated`, `role-scope`) are plain
 * `.json`, not `.jsonc`: they are read by `JSON.parse` in a gate with no
 * dependencies. A plain JSON file cannot hold a comment, so every one of them
 * carries a `_note` key — an array of lines — saying what it is for, what the
 * entry shape is, and what the empty state MEANS. `_note` is validated like any
 * other field (`manifestProblems`), so it cannot quietly disappear. An empty
 * `entries` list is a STATEMENT and the note is where it is made: "nothing is
 * hidden from a walk today" has to be written down, or the next reader cannot
 * tell it apart from "nobody filled this in".
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * MEASURED, 2026-11-01, typescript 7.0.2 — why `resolveClosure` looks like this
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. THE LIB FILES ARE NOT IN `node_modules/typescript/lib/`. TypeScript 7 ships
 *    them in a PLATFORM package:
 *      node_modules/.pnpm/@typescript+typescript-darwin-x64@7.0.2/node_modules/
 *        @typescript/typescript-darwin-x64/lib/lib.es2023.d.ts
 *    A filter on the TS ≤ 6 location matches ZERO lines, every lib file then
 *    reads as a path outside the package, and the light fails on a clean tree —
 *    or somebody "fixes" it by widening the filter to all of `node_modules`.
 *    `TS_LIB_RE` matches `@typescript/typescript-<platform>/lib/lib.*.d.ts` and
 *    DERIVES the platform segment; `darwin-x64` appears nowhere in this file.
 *    Measured partition of a clean tree: packages/core 61 lib + 26 external + 5
 *    in-repo, apps/api 63 + 153 + 2, apps/web 65 + 228 + 5 — and ZERO files
 *    under the platform lib directory that are not `lib.*.d.ts`. A closure with
 *    no lib file at all is therefore `ok: false`, never a pass: it means the
 *    layout moved and the partition below is about something else.
 *
 * 2. DIAGNOSTICS AND THE FILE LISTING SHARE STDOUT, stderr stays EMPTY, and the
 *    diagnostics come FIRST. On a planted `string` → `number` plus a
 *    `document.title` in a `lib: ["ES2023"]` project: exit 1, two diagnostic
 *    lines then 62 absolute paths, nothing on stderr.
 *
 * 3. A DIAGNOSTIC PATH IS RELATIVE TO THE CWD OF THE TSC PROCESS, not to the
 *    tsconfig. The same project judged from three directories printed
 *    `src/a.ts(1,14)`, `../../../../private/tmp/…/src/a.ts(1,14)` and
 *    `claude-501/…/src/a.ts(1,14)`. `resolveClosure` therefore ALWAYS runs with
 *    `cwd` = the repository root, so a diagnostic path is repo-relative and can
 *    be compared with a path from git. The listing is absolute in every case.
 *
 * 4. ZERO LISTED FILES HAS TWO SHAPES, both exit non-zero with the whole message
 *    on stdout: `-p` at a path that does not exist → exit 1, `error TS5058`;
 *    an `include` that matched nothing → exit **2**, `error TS18003`. Both are
 *    `ok: false` with the global diagnostic as the reason — "never ran" is not
 *    green, and the exit code is not what says so.
 *
 * 5. A WORKSPACE DEPENDENCY REACHED THROUGH THE PNPM SYMLINK IS LISTED AT ITS
 *    REAL PATH. Measured on a synthetic tree with `app/node_modules/@p/core` →
 *    `../../../pkg`: the listing holds `pkg/src/index.ts`, not the path through
 *    `node_modules`. So a declared workspace edge and an illegal relative escape
 *    look IDENTICAL in the listing — both are an in-repo path outside the
 *    package. The listing alone cannot tell them apart. `resolveClosure` reports
 *    them together as `workspace`, each with the `owner` package `ownerOf`
 *    resolves, and the LIGHT decides: legal exactly when that owner is a
 *    declared dependency of the package being judged (`readPackages` says what
 *    is declared). Nothing here should ever be cited as proof of an edge.
 *
 * 6. THE PARTITION CLOSES THE HOLE §9 OF THE MEASUREMENT LEFT OPEN. With
 *    `packages/core/src/__esc.ts` importing `'../../../apps/api/src/index.ts'`,
 *    tsc exits 0 with ZERO diagnostics — the compiler, the dependency graph and
 *    the linter are all silent — and `resolveClosure('core')` returns
 *    `workspace: [{ rel: 'apps/api/src/index.ts', owner: '@cheq/api' }]`. That
 *    one array is the whole of L-core-purity level 2.
 *
 * 7. `foreign` IS NOT A DEFECT BY ITSELF. Measured in a checkout whose
 *    `node_modules` is a SYMLINK to another tree: the 26 external `.d.ts` files
 *    came back as `foreign` (resolved outside this root) and `external` was
 *    empty, because tsc reports realpaths (fact 5). A light that reads
 *    `foreign.length > 0` as a failure would therefore fail on a perfectly
 *    ordinary linked worktree. Judge the paths, not the count.
 *
 * 8. `--listFiles` COUNT IS CROSS-CHECKED. `../lib/tsc-log.mjs` already counts
 *    the listing lines (`parseDiagnostics().filesChecked`) but does not return
 *    them, and this module needs the paths. Rather than own a second line rule,
 *    it extracts the paths and then compares its own count with that reader's.
 *    A disagreement is `ok: false` naming both numbers, so the two cannot drift
 *    in silence.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { parseDiagnostics } from '../lib/tsc-log.mjs';
import { KIND_ROOT } from '../lib/test-file-patterns.mjs';
import { LIGHT_STATUSES, SEVERITIES, parseYamlSubset, severityOf } from '../lib/spec-parse.mjs';

// ---------------------------------------------------------------------- basics

/** 1 MiB (the spawnSync default) truncates a chatty child, and the truncation
 * then reads as a failure that never happened. `tsc --listFiles` on apps/web
 * prints 298 absolute paths; `git log` over a long range is worse. */
const MAX_BUFFER = 64 * 1024 * 1024;

/** Deterministic, uncoloured, English child output. A gate that matches text
 * must not depend on the OS locale (git has already lied in German here). */
const SH_ENV = Object.freeze({
  LANG: 'C',
  LC_ALL: 'C',
  LANGUAGE: '',
  NO_COLOR: '1',
  FORCE_COLOR: '0',
  TZ: 'UTC',
});

/** Every sort in this module passes a comparator: `Array#sort`'s default is a
 * lexicographic compare of the STRING form, which is the right answer for paths
 * by accident rather than by statement. Writing it down means a list of paths
 * sorts the same way in every light on every platform. */
const byString = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const byRel = (a, b) => byString(a.rel, b.rel);
const byDirent = (a, b) => byString(a.name, b.name);

/** Repo-relative, forward slashes, no `./`, no trailing slash. The one spelling
 * a path has anywhere in the lights, so a string compare means something. */
export function relPosix(root, abs) {
  const r = relative(root, abs).split(sep).join('/');
  return r.replace(/^\.\//, '').replace(/\/+$/, '');
}

/** The same normalisation for a path that is already relative (a manifest entry,
 * a git path). Absolute input is REFUSED by returning null — a manifest holding
 * an absolute path is a defect its validator names, not something to absorb. */
export function normRel(p) {
  const s = String(p ?? '').trim();
  if (!s || isAbsolute(s) || /^[A-Za-z]:[\\/]/.test(s)) return null;
  return s.split(sep).join('/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** Does `rel` equal `root` or lie under it? Both are normalised repo-relative. */
export function under(rel, rootRel) {
  if (!rel || !rootRel) return false;
  return rel === rootRel || rel.startsWith(`${rootRel}/`);
}

/** The 1-based line of the first `"key"` in a text, or null. Used so a manifest
 * problem can cite `tools/gates/visible.json:7` — `JSON.parse` keeps no
 * positions, and FIRST OCCURRENCE is all this claims to find. */
export function jsonLine(text, key) {
  const lines = String(text ?? '').split('\n');
  const needle = `"${key}"`;
  for (let i = 0; i < lines.length; i += 1) if (lines[i].includes(needle)) return i + 1;
  return null;
}

// ------------------------------------------------------------------------- sh

/**
 * Run a child process from an ARGUMENT VECTOR. No shell, ever — so no quoting
 * rule, no glob expansion and no `$(…)` in a path can change which command runs.
 *
 * → { argv, code, signal, stdout, stderr, combined, spawnError, timedOut, ok }
 *
 * THE EXIT CODE IS CAPTURED SEPARATELY FROM THE TEXT, AND IT IS ADVISORY. There
 * is no pipe here and there must never be one at a call site: `cmd | head`
 * reports `$?` of `head`, which is how two runs in the session that designed
 * these gates reported `exit=0` for a crashed linter and for four TS6059. The
 * verdict comes from the artifact — the stdout this returns, or a file the child
 * wrote — and `code` only ever corroborates it.
 *
 * `code: null` means the process could not be started at all (missing binary);
 * `spawnError` then carries the reason and `ok` is false. `ok` is `code === 0`
 * and is a convenience for "the tool ran to completion", never for "the thing it
 * judged is fine".
 */
export function sh(cmd, args = [], { cwd, env, input, timeout, maxBuffer = MAX_BUFFER } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer,
    input,
    timeout,
    shell: false,
    env: { ...process.env, ...SH_ENV, ...env },
  });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  const code = r.error ? null : (r.status ?? null);
  return {
    argv: [cmd, ...args],
    code,
    signal: r.signal ?? null,
    stdout,
    stderr,
    combined: stdout + stderr,
    spawnError: r.error?.message ?? null,
    timedOut: r.error?.code === 'ETIMEDOUT',
    ok: code === 0,
  };
}

// ------------------------------------------------------------------- premises

/**
 * The runtime premises a light may need, each with the NAME it is reported
 * under and the cure. This replaces the calibration record Resonance gates on:
 * the precondition is not the freshness of a measurement but the presence of a
 * named thing, and a missing one is cannot-verify WITH ITS NAME — never a pass
 * and never a silent skip. Remove the check instead and a lane that said
 * "refuses until measured" quietly becomes "always works" (TD-0002).
 */
export const PREMISES = Object.freeze({
  node_modules: { rel: 'node_modules', cure: 'pnpm install' },
  tsc: { rel: 'node_modules/.bin/tsc', cure: 'pnpm install (typescript is a root devDependency)' },
  oxlint: { rel: 'node_modules/.bin/oxlint', cure: 'pnpm install (oxlint is a root devDependency)' },
  jest: { rel: 'node_modules/.bin/jest', cure: 'pnpm install (jest is a root devDependency)' },
  playwright: { rel: 'node_modules/.bin/playwright', cure: 'pnpm install' },
});

export const PREMISE_NAMES = Object.keys(PREMISES);

/**
 * Probe every premise once. → { [name]: { name, present, path, rel, cure } }
 * `run.mjs` calls this once per run and hands the result to every light in
 * `ctx.premises`, so the answer and its wording are the same in sixteen rows.
 */
export function readPremises(root = process.cwd()) {
  const out = {};
  for (const [name, p] of Object.entries(PREMISES)) {
    const abs = join(root, p.rel);
    out[name] = { name, present: existsSync(abs), path: abs, rel: p.rel, cure: p.cure };
  }
  return out;
}

/**
 * Ask for a premise by name. → { ok, reason, premise }
 * The reason is the whole message a light puts in its `detail`, so sixteen
 * lights cannot each invent a different sentence for the same absence.
 */
/**
 * The ONE sort order the lights use. Locale collation is machine state: a
 * generated projection ordered by `localeCompare` differs between machines, and
 * L-generated would then fail on a tree nobody touched. This compares code
 * points and nothing else.
 */
export function byCodepoint(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function requirePremise(premises, name) {
  // Two different absences, and they used to share one sentence: asking for an
  // unknown NAME, and being handed no premise probe AT ALL. The shared wording
  // said `premise "tsc" is not a declared premise (known: …, tsc, …)` — which
  // names tsc on both sides of the claim and reads as a contradiction. It cost a
  // wrong diagnosis the first time a light was called by hand; the caller had
  // simply omitted `premises` from the context the registry normally supplies.
  if (premises === null || premises === undefined)
    return {
      ok: false,
      reason:
        `premise "${name}" could not be asked: the caller passed no premise probe in the light's context ` +
        `(run.mjs calls readPremises(root) once and hands the result to every light as ctx.premises; ` +
        `a light invoked by hand must do the same)`,
      premise: null,
    };
  const p = premises[name];
  if (p === undefined)
    return { ok: false, reason: `premise "${name}" is not a declared premise (known: ${PREMISE_NAMES.join(', ')})`, premise: null };
  if (!p.present) return { ok: false, reason: `premise "${name}" absent: ${p.rel} does not exist — ${p.cure}`, premise: p };
  return { ok: true, reason: `premise "${name}" present: ${p.rel}`, premise: p };
}

// ------------------------------------------------------------------ manifests

/** The four declared manifests, by the key a light asks for. */
export const MANIFEST_REL = Object.freeze({
  visible: 'tools/gates/visible.json',
  homes: 'tools/gates/homes.json',
  generated: 'tools/gates/generated.json',
  roleScope: 'tools/gates/role-scope.json',
});

export const MANIFEST_NAMES = Object.keys(MANIFEST_REL);

/** The four doors a path can be hidden behind — `visible.json` entries name the
 * ones that apply to them, and `L-visible` checks the doors it was told about
 * against the doors it finds. */
export const DOORS = Object.freeze(['gitignore', 'oxlint-ignorePatterns', 'tsconfig-exclude', 'jest-ignorePatterns']);

/**
 * Read one manifest. NEVER throws: an absent file is a STATE, a malformed one is
 * a problem with a `path:line`.
 *
 * → { ok, which, rel, path, exists, data, text, problems }
 *   `ok` is "parsed AND passed its shape check". `data` is the parsed object
 *   verbatim — unknown keys are passed through, because a reader that drops what
 *   it does not understand makes the writer's extra declaration disappear.
 */
export function readManifest(root, which) {
  const rel = MANIFEST_REL[which];
  if (rel === undefined)
    return { ok: false, which, rel: null, path: null, exists: false, data: null, text: null, problems: [`unknown manifest "${which}" (known: ${MANIFEST_NAMES.join(', ')})`] };
  const path = join(root, rel);
  const base = { which, rel, path };
  if (!existsSync(path))
    return { ...base, ok: false, exists: false, data: null, text: null, problems: [`${rel}: does not exist — create it (it is read by the lights, and an absent manifest declares nothing)`] };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { ...base, ok: false, exists: true, data: null, text: null, problems: [`${rel}: unreadable: ${String(e.message)}`] };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ...base, ok: false, exists: true, data: null, text, problems: [`${rel}: not valid JSON (${String(e.message)}) — this file is plain .json and carries its comments in "_note"`] };
  }
  const read = { ...base, ok: true, exists: true, data, text, problems: [] };
  read.problems = manifestProblems(read);
  read.ok = read.problems.length === 0;
  return read;
}

export const readVisible = (root = process.cwd()) => readManifest(root, 'visible');
export const readHomes = (root = process.cwd()) => readManifest(root, 'homes');
export const readGenerated = (root = process.cwd()) => readManifest(root, 'generated');
export const readRoleScope = (root = process.cwd()) => readManifest(root, 'roleScope');

/** Glob metacharacters: a manifest entry is a literal path, never a pattern. */
const GLOB_CHARS = /[*?[\]{}]/;

const at = (read, key) => {
  const line = jsonLine(read.text, key);
  return `${read.rel}${line === null ? '' : `:${line}`}`;
};

/**
 * The shape check for every manifest, in ONE place, so the file and the light
 * that reads it cannot disagree about what a valid entry is. Returns a list of
 * messages, each with `path:line` and what to do (rule 8). Shape only: whether a
 * declared path is really ignored by git, whether a producer really regenerates
 * byte-for-byte, whether a role really stayed in its zone — those are the
 * lights' questions, and they need the shape to have been checked first.
 */
export function manifestProblems(read) {
  if (!read?.exists || read.data === null) return read?.problems ?? [`${read?.rel ?? 'manifest'}: nothing to check`];
  const p = [];
  const d = read.data;
  // An "" element is a paragraph break and is allowed; a note made ONLY of
  // those says nothing, which is what the second clause refuses.
  const note = d['_note'];
  if (!Array.isArray(note) || note.some((l) => typeof l !== 'string') || !note.some((l) => l.trim() !== ''))
    p.push(`${at(read, '_note')}: "_note" must be an array of strings with at least one non-blank line ("" is a paragraph break) — JSON takes no comments, so this is where this file says what it is for and what its empty state MEANS`);

  const list = (key, each) => {
    const arr = d[key];
    if (!Array.isArray(arr)) {
      p.push(`${at(read, key)}: "${key}" must be an array (an empty one is a statement; a missing one is a gap)`);
      return;
    }
    arr.forEach((e, i) => {
      const where = `${at(read, key)}: ${key}[${i}]`;
      if (e === null || typeof e !== 'object' || Array.isArray(e)) {
        p.push(`${where} must be an object`);
        return;
      }
      each(e, where);
    });
  };

  // A glob is refused HERE rather than in `normRel`, which also normalises real
  // filesystem paths where a `[` is a legal character in a filename.
  const needRel = (e, where, key) => {
    const v = normRel(e[key]);
    if (v === null || GLOB_CHARS.test(v)) {
      p.push(`${where}.${key} must be a repo-relative LITERAL path with forward slashes (got ${JSON.stringify(e[key] ?? null)}) — absolute paths and globs are both refused: an entry is a literal path, a path matches it when it equals it or lies under it, and a glob here would be a small language nobody can audit`);
      return null;
    }
    return v;
  };
  const needWhy = (e, where) => {
    if (typeof e.why !== 'string' || e.why.trim().length < 10)
      p.push(`${where}.why must be a sentence saying why this entry exists — an undeclared declaration is the thing these manifests exist to prevent`);
  };

  switch (read.which) {
    case 'visible':
      list('entries', (e, where) => {
        needRel(e, where, 'path');
        needWhy(e, where);
        if (!Array.isArray(e.doors) || e.doors.length === 0 || e.doors.some((x) => !DOORS.includes(x)))
          p.push(`${where}.doors must be a non-empty array drawn from ${DOORS.join(' | ')} — naming the door is what lets L-visible check the declaration against what it finds`);
      });
      break;
    case 'homes':
      list('entries', (e, where) => {
        needRel(e, where, 'path');
        needWhy(e, where);
      });
      break;
    case 'generated':
      list('entries', (e, where) => {
        needRel(e, where, 'path');
        const script = needRel(e, where, 'producerScript');
        if (typeof e.producer !== 'string' || !e.producer.trim())
          p.push(`${where}.producer must be the exact command that rewrites this file — it is printed as the CURE when the light fails, so it has to be runnable as written`);
        if (typeof e.check !== 'string' || !e.check.trim())
          p.push(`${where}.check must be the command that only reports, so a human can ask without rewriting`);
        if (!Array.isArray(e.sourceRoots) || e.sourceRoots.length === 0 || e.sourceRoots.some((s) => normRel(s) === null))
          p.push(`${where}.sourceRoots must be a non-empty array of repo-relative directories this file is derived from`);
        if (script !== null && !script.startsWith('tools/'))
          p.push(`${where}.producerScript must live under tools/ (got ${script}) — the judge and the generator are the same code, and that code is a gate`);
      });
      break;
    case 'roleScope':
      list('roles', (e, where) => {
        if (typeof e.role !== 'string' || !/^[a-z][a-z0-9-]*$/.test(e.role))
          p.push(`${where}.role must be a lowercase name matching the file under .claude/agents/`);
        const af = needRel(e, where, 'agentFile');
        if (af !== null && !af.startsWith('.claude/agents/'))
          p.push(`${where}.agentFile must be the .claude/agents/<role>.md that states this zone in prose — the manifest is the machine-readable half of that file, not a second source`);
        for (const key of ['write', 'neverWrite']) {
          if (!Array.isArray(e[key]) || e[key].some((s) => normRel(s) === null))
            p.push(`${where}.${key} must be an array of repo-relative paths (an empty "write" is legitimate: a read-only role)`);
        }
        needWhy(e, where);
      });
      break;
    default:
      p.push(`${read.rel}: no shape check is declared for manifest "${read.which}"`);
  }
  return p;
}

// ------------------------------------------------------------- the blind zone

/**
 * Path segments that are already invisible to every tool in this toolchain, so
 * declaring one in `visible.json` would change nothing: a `.`-prefixed segment
 * (`.git`, `.ci`, `.pnpm`) and `node_modules`. In CODE and frozen on
 * purpose — see the header: a configurable self-hidden list is a second door.
 */
export const SELF_HIDDEN = Object.freeze(['node_modules']);

/** → { hidden, why, segment } for the self-hidden reasons only. */
export function selfHidden(rel) {
  for (const seg of String(rel ?? '').split('/')) {
    if (seg.startsWith('.') && seg !== '.' && seg !== '..') return { hidden: true, why: 'dot-segment', segment: seg };
    if (SELF_HIDDEN.includes(seg)) return { hidden: true, why: 'self-hidden-segment', segment: seg };
  }
  return { hidden: false, why: null, segment: null };
}

/**
 * THE ONE PREDICATE. Is `rel` outside what a walk may see?
 * → { excluded, why, entry }
 *   `why: 'declared'`  a `visible.json` entry covers it — `entry` is that entry.
 *   `why: 'dot-segment' | 'self-hidden-segment'`  already invisible; declaring
 *          it would change nothing, so `L-visible` does not count it.
 *   `why: 'manifest-unreadable'`  the manifest did not parse. FAIL CLOSED: the
 *          path is NOT excluded, so the walk sees everything and the light that
 *          reads the manifest reports why. The alternative — treating an
 *          unreadable manifest as "nothing is declared, carry on" — is the same
 *          outcome; treating it as "everything is declared" would hide the tree.
 *
 * `visible` is the result of `readVisible()`. Pass it in: a walk that re-read
 * the manifest per path would read it tens of thousands of times, and a walk
 * that read it for itself would be the second reader this module exists to
 * prevent.
 */
export function isExcluded(rel, visible = null) {
  const r = normRel(rel);
  const self = selfHidden(r);
  if (self.hidden) return { excluded: true, why: self.why, entry: null, segment: self.segment };
  if (visible === null) return { excluded: false, why: null, entry: null, segment: null };
  if (!visible.ok) return { excluded: false, why: 'manifest-unreadable', entry: null, segment: null };
  for (const e of visible.data?.entries ?? []) {
    const path = normRel(e?.path);
    if (path !== null && under(r, path)) return { excluded: true, why: 'declared', entry: e, segment: null };
  }
  return { excluded: false, why: null, entry: null, segment: null };
}

/** The declared blind zone as normalised paths, for a light that wants the list
 * rather than the predicate. Entries that failed the shape check are dropped and
 * their absence is already a problem in `visible.problems`. */
export function declaredRoots(visible) {
  return (visible?.data?.entries ?? []).map((e) => normRel(e?.path)).filter((x) => x !== null);
}

// ----------------------------------------------------------------------- walk

/**
 * Walk a tree and answer with repo-relative POSIX paths, sorted.
 *
 * → { files, dirs, skipped, symlinks, missing, problems }
 *   `files`     every regular file (filtered by `exts` when given), sorted.
 *   `dirs`      every directory entered, sorted (only when `includeDirs`).
 *   `skipped`   `{ rel, why, entry }` per skipped path — the walk's blind spot,
 *               itemised, so what it did not look at is readable.
 *   `symlinks`  a symlink is never followed and never counted as a file: it is
 *               listed here AND reported in `problems`. pnpm's node_modules is a
 *               forest of symlinks and following them loops; a symlink INSIDE a
 *               judged tree is something a light should refuse, not absorb.
 *   `missing`   a requested root that does not exist, named rather than silent.
 *   `problems`  everything the caller must fail closed on.
 *
 * `roots` are repo-relative. `exts` is a list of suffixes compared with
 * `endsWith`, so `.test.tsx` works as well as `.ts`.
 */
export function walk(root, { roots = ['.'], exts = null, visible = null, includeDirs = false, maxEntries = 500000 } = {}) {
  const files = [];
  const dirs = [];
  const skipped = [];
  const symlinks = [];
  const missing = [];
  const problems = [];
  let seen = 0;

  const keep = (rel) => exts === null || exts.some((e) => rel.endsWith(e));

  const descend = (absDir) => {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch (e) {
      problems.push(`${relPosix(root, absDir)}: unreadable directory: ${String(e.message)}`);
      return;
    }
    for (const d of entries.toSorted(byDirent)) {
      const abs = join(absDir, d.name);
      const rel = relPosix(root, abs);
      seen += 1;
      if (seen > maxEntries) {
        problems.push(`walk stopped after ${maxEntries} entries at ${rel} — raise maxEntries or narrow roots; a truncated walk must never read as a clean one`);
        return;
      }
      const ex = isExcluded(rel, visible);
      if (ex.excluded) {
        skipped.push({ rel, why: ex.why, entry: ex.entry ?? null });
        continue;
      }
      if (d.isSymbolicLink()) {
        symlinks.push(rel);
        problems.push(`${rel}: symbolic link — the walk does not follow it and does not count it as a file; a link inside a judged tree hides what it points at`);
        continue;
      }
      if (d.isDirectory()) {
        if (includeDirs) dirs.push(rel);
        descend(abs);
        continue;
      }
      if (d.isFile() && keep(rel)) files.push(rel);
    }
  };

  for (const r of roots) {
    const rel = normRel(r) ?? '';
    const abs = rel === '' || rel === '.' ? root : join(root, rel);
    if (!existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    let st;
    try {
      st = statSync(abs);
    } catch (e) {
      problems.push(`${rel}: unreadable: ${String(e.message)}`);
      continue;
    }
    if (st.isDirectory()) {
      if (includeDirs && rel) dirs.push(rel);
      descend(abs);
    } else if (keep(rel)) files.push(rel);
  }

  return {
    files: files.toSorted(byString),
    dirs: dirs.toSorted(byString),
    skipped,
    symlinks,
    missing,
    problems,
  };
}

// ------------------------------------------------------------------- packages

/** `pnpm-workspace.yaml` is parsed by `parseYamlSubset` from `../lib/spec-parse.mjs`
 * — the one hand-written YAML subset in this repository. Only the `<dir>/*` glob
 * form is understood; any other form is reported, never guessed at. */
const WORKSPACE_FILE = 'pnpm-workspace.yaml';

/**
 * Every `package.json` of the workspace, with what it declares.
 *
 * → { ok, rootPackage, packages, byName, byDir, allManifests, globs,
 *     emptyGlobs, problems }
 *
 *   `packages`     one entry per workspace member, sorted by `rel`.
 *   `rootPackage`  the repository manifest (`rel: ''`), kept SEPARATE so
 *                  `ownerOf` cannot resolve every path to it; `allManifests`
 *                  is `[rootPackage, ...packages]` for a light that judges all
 *                  of them (L-deps judges dependencies, devDependencies and
 *                  peerDependencies of every manifest — devDeps execute code).
 *   `emptyGlobs`   a workspace glob matching no `package.json`. NOT a problem:
 *                  `tools/*` is deliberately empty of packages — a package.json
 *                  under `tools/gates` would give the gates dependencies, and
 *                  they would stop running exactly when they are needed
 *                  (package.json:4). Reported so the emptiness stays visible.
 *
 * Each package: `{ name, rel, dir, manifestRel, private, type, version,
 * dependencies, devDependencies, peerDependencies, optionalDependencies,
 * declared (name → { spec, kind }), exports, tsconfigRel, raw, text }`.
 */
export function readPackages(root = process.cwd()) {
  const problems = [];
  const readManifestAt = (rel) => {
    const manifestRel = rel === '' ? 'package.json' : `${rel}/package.json`;
    const abs = join(root, manifestRel);
    if (!existsSync(abs)) return null;
    let text;
    let raw;
    try {
      text = readFileSync(abs, 'utf8');
      raw = JSON.parse(text);
    } catch (e) {
      problems.push(`${manifestRel}: unreadable or not valid JSON (${String(e.message)}) — every gate that asks what a package declares reads this file`);
      return null;
    }
    const group = (key) => (raw[key] !== null && typeof raw[key] === 'object' && !Array.isArray(raw[key]) ? raw[key] : {});
    const dependencies = group('dependencies');
    const devDependencies = group('devDependencies');
    const peerDependencies = group('peerDependencies');
    const optionalDependencies = group('optionalDependencies');
    const declared = new Map();
    for (const [kind, g] of [
      ['dependencies', dependencies],
      ['devDependencies', devDependencies],
      ['peerDependencies', peerDependencies],
      ['optionalDependencies', optionalDependencies],
    ]) {
      for (const [name, spec] of Object.entries(g)) declared.set(name, { spec: String(spec), kind });
    }
    const tsconfigRel = rel === '' ? null : `${rel}/tsconfig.json`;
    return {
      name: typeof raw.name === 'string' ? raw.name : null,
      rel,
      dir: rel === '' ? root : join(root, rel),
      manifestRel,
      isRoot: rel === '',
      private: raw.private === true,
      type: typeof raw.type === 'string' ? raw.type : null,
      version: typeof raw.version === 'string' ? raw.version : null,
      dependencies,
      devDependencies,
      peerDependencies,
      optionalDependencies,
      declared,
      exports: raw.exports ?? null,
      tsconfigRel: tsconfigRel !== null && existsSync(join(root, tsconfigRel)) ? tsconfigRel : null,
      raw,
      text,
    };
  };

  const rootPackage = readManifestAt('');
  if (rootPackage === null) problems.push('package.json: the repository manifest is absent or unreadable — nothing below can be judged without it');

  const wsAbs = join(root, WORKSPACE_FILE);
  let globs = [];
  if (!existsSync(wsAbs)) {
    problems.push(`${WORKSPACE_FILE}: does not exist — the workspace members cannot be enumerated (pnpm reads this file too)`);
  } else {
    try {
      const parsed = parseYamlSubset(readFileSync(wsAbs, 'utf8'));
      const list = parsed?.packages;
      if (!Array.isArray(list)) problems.push(`${WORKSPACE_FILE}: "packages" must be a list of globs`);
      else globs = list.map(String);
    } catch (e) {
      problems.push(`${WORKSPACE_FILE}: outside the YAML subset the gates parse (${String(e.message)}) — keep it to a plain "packages:" block list`);
    }
  }

  const packages = [];
  const emptyGlobs = [];
  for (const glob of globs) {
    const parts = glob.split('/');
    const stars = parts.filter((s) => s.includes('*')).length;
    if (stars !== 1 || parts.at(-1) !== '*') {
      problems.push(`${WORKSPACE_FILE}: glob ${JSON.stringify(glob)} is not the "<dir>/*" form this reader understands — add the form to readPackages or spell the directory out; a glob nobody parsed silently enumerates nothing`);
      continue;
    }
    const prefix = parts.slice(0, -1).join('/');
    const absPrefix = join(root, prefix);
    if (!existsSync(absPrefix)) {
      emptyGlobs.push(glob);
      continue;
    }
    let found = 0;
    for (const d of readdirSync(absPrefix, { withFileTypes: true }).toSorted(byDirent)) {
      if (!d.isDirectory()) continue;
      const pkg = readManifestAt(`${prefix}/${d.name}`);
      if (pkg === null) continue;
      found += 1;
      packages.push(pkg);
      if (pkg.name === null) problems.push(`${pkg.manifestRel}: no "name" — every gate that judges an edge speaks package names`);
    }
    if (found === 0) emptyGlobs.push(glob);
  }

  packages.sort(byRel);
  const byName = new Map(packages.filter((p) => p.name !== null).map((p) => [p.name, p]));
  const byDir = new Map(packages.map((p) => [p.rel, p]));
  if (byName.size !== packages.filter((p) => p.name !== null).length)
    problems.push('two workspace packages share a "name" — a package name is the key every edge is spelled with');

  return {
    ok: problems.length === 0,
    rootPackage,
    packages,
    byName,
    byDir,
    allManifests: [...(rootPackage === null ? [] : [rootPackage]), ...packages],
    globs,
    emptyGlobs,
    problems,
  };
}

/** Which workspace package owns a repo-relative path? The LONGEST matching
 * `rel` wins, and the repository root package is never an owner — see
 * `readPackages`. → the package, or null for a path outside every member. */
export function ownerOf(rel, packages) {
  const r = normRel(rel);
  if (r === null) return null;
  let best = null;
  for (const p of packages?.packages ?? packages ?? []) {
    if (p.isRoot === true || !p.rel) continue;
    if (under(r, p.rel) && (best === null || p.rel.length > best.rel.length)) best = p;
  }
  return best;
}

// ------------------------------------------------------------------- closures

/**
 * `@typescript/typescript-<platform>/lib/lib.*.d.ts` — the TypeScript 7 lib
 * location, with the platform segment CAPTURED rather than written down. See
 * header fact 1: the TS ≤ 6 path `node_modules/typescript/lib/` matches nothing
 * in this tree.
 */
export const TS_LIB_RE = /(?:^|\/)@typescript\/typescript-([^/]+)\/lib\/(lib\.[^/]+\.d\.ts)$/;
/** The TS ≤ 6 location. Matched too, so a downgrade is read correctly rather
 * than as "every lib file is outside the package" — and `libLayout` then says
 * which of the two was seen, because that difference is a fact about the tree. */
export const TS_LIB_LEGACY_RE = /(?:^|\/)node_modules\/typescript\/lib\/(lib\.[^/]+\.d\.ts)$/;

/** Every partition of a closure, empty. Spread into every `resolveClosure`
 * answer so a caller reading `c.inside` on a failed read gets an empty array
 * rather than `undefined` — a reader whose fields appear only on success makes
 * every call site write a guard, and one of them forgets. */
const CLOSURE_EMPTY = Object.freeze({
  listed: [],
  inside: [],
  workspace: [],
  external: [],
  foreign: [],
  libs: [],
  libPlatforms: [],
  libLayouts: [],
});

/** The failed form of a `resolveClosure` answer: `ok: false` plus a reason a
 * light turns into cannot-verify, and every field present. */
const closureFail = (reason, extra = {}) => ({
  ok: false,
  reason,
  rel: null,
  tsconfigRel: null,
  argv: null,
  exitCode: null,
  text: '',
  diagnostics: null,
  filesChecked: 0,
  ...CLOSURE_EMPTY,
  ...extra,
});

/** Is this `--listFiles` line a TypeScript lib file? → { lib, platform, layout } */
export function classifyLib(absPath) {
  const m = TS_LIB_RE.exec(absPath);
  if (m) return { lib: true, platform: m[1], layout: 'platform-package' };
  const l = TS_LIB_LEGACY_RE.exec(absPath);
  if (l) return { lib: true, platform: null, layout: 'typescript-lib' };
  return { lib: false, platform: null, layout: null };
}

/**
 * What the compiler actually READ for one project — the closure, partitioned.
 *
 * `target` is a kind (`core`/`api`/`web`/`e2e`, resolved through `KIND_ROOT`), a
 * repo-relative package directory, or a package object from `readPackages`.
 *
 * → { ok, reason, rel, tsconfigRel, argv, exitCode, text, diagnostics,
 *     listed, inside, workspace, external, foreign, libs, libPlatforms,
 *     libLayouts, filesChecked }
 *
 *   `ok: false` + `reason` is what a LIGHT turns into cannot-verify. This reader
 *   returns no light status of its own: `crossCheck` in `../lib/jest-json.mjs`
 *   had to be renamed because a field called `verdict` holding `'green'` is a
 *   label waiting to be misread, and the same trap is avoided here by not
 *   borrowing the vocabulary at all.
 *
 *   `inside`     listed paths under the package — the honest ones.
 *   `workspace`  `{ rel, owner }` for an in-repo path OUTSIDE the package. A
 *                declared dependency reached through pnpm's symlink and an
 *                illegal `../../../apps/api/src/index.ts` look the SAME here
 *                (header fact 5). The light decides, using `owner` and
 *                `readPackages().declared`.
 *   `external`   under some `node_modules`.
 *   `foreign`    outside the repository entirely.
 *   `libs`       the TypeScript lib files; `libPlatforms` the segments derived
 *                from them. An empty `libs` is `ok: false`.
 *
 * ALWAYS runs with `cwd` = `root` (header fact 3), so every diagnostic path in
 * `diagnostics` is repo-relative and comparable with a path from git.
 */
export function resolveClosure(target, { root = process.cwd(), premises = null, tsconfigRel = null } = {}) {
  let rel;
  if (typeof target === 'string') rel = normRel(KIND_ROOT[target] ?? target);
  else if (target !== null && typeof target === 'object') rel = normRel(target.rel);
  else rel = null;
  if (rel === null || rel === '') return closureFail(`resolveClosure: ${JSON.stringify(target)} names no package directory (a kind, a repo-relative directory or a readPackages entry)`);

  const prem = requirePremise(premises ?? readPremises(root), 'tsc');
  if (!prem.ok) return closureFail(prem.reason, { rel });

  const cfg = tsconfigRel ?? `${rel}/tsconfig.json`;
  if (!existsSync(join(root, cfg)))
    return closureFail(`no ${cfg} — this package has no type project, so there is no closure to read (e2e is the known case: it is judged by Playwright, not by tsc)`, { rel });

  const r = sh(prem.premise.path, ['--noEmit', '--pretty', 'false', '--listFiles', '-p', cfg], { cwd: root });
  if (r.code === null)
    return closureFail(`could not run ${prem.premise.rel}: ${r.spawnError ?? 'spawn failed'}`, { rel, tsconfigRel: cfg, argv: r.argv });

  const text = r.combined;
  const diagnostics = parseDiagnostics(text);

  const listed = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line || line.includes('): error ') || !isAbsolute(line)) continue;
    listed.push(line);
  }
  if (listed.length !== diagnostics.filesChecked)
    return closureFail(
      `this reader counted ${listed.length} --listFiles line(s) and ../lib/tsc-log.mjs counted ${diagnostics.filesChecked} — the two line rules have drifted; fix them before trusting either (${r.argv.join(' ')})`,
      { rel, tsconfigRel: cfg, argv: r.argv, exitCode: r.code, text, diagnostics },
    );

  const base = {
    rel,
    tsconfigRel: cfg,
    argv: r.argv,
    exitCode: r.code,
    text,
    diagnostics,
    filesChecked: diagnostics.filesChecked,
  };

  if (listed.length === 0) {
    const why = diagnostics.global.length
      ? diagnostics.global.map((g) => `${g.code}: ${g.msg}`).join(' | ')
      : 'and no diagnostic explains it either';
    return {
      ...base,
      ...CLOSURE_EMPTY,
      ok: false,
      reason: `tsc read NOTHING for ${cfg} (${why}) — never ran is not green, and the exit code (${r.code}) is not what says so`,
    };
  }

  const pkgs = readPackages(root);
  const inside = [];
  const workspace = [];
  const external = [];
  const foreign = [];
  const libs = [];
  const platforms = new Set();
  const layouts = new Set();
  const rootResolved = resolve(root);

  for (const abs of listed) {
    const lib = classifyLib(abs);
    if (lib.lib) {
      libs.push(abs);
      if (lib.platform !== null) platforms.add(lib.platform);
      layouts.add(lib.layout);
      continue;
    }
    if (!abs.startsWith(`${rootResolved}/`)) {
      foreign.push(abs);
      continue;
    }
    const p = relPosix(rootResolved, abs);
    if (p.split('/').includes('node_modules')) {
      external.push(p);
      continue;
    }
    if (under(p, rel)) inside.push(p);
    else workspace.push({ rel: p, owner: ownerOf(p, pkgs)?.name ?? null });
  }

  if (libs.length === 0)
    return {
      ...base,
      ...CLOSURE_EMPTY,
      listed,
      ok: false,
      reason: `${listed.length} file(s) listed and NOT ONE is a TypeScript lib file — the lib layout moved (expected @typescript/typescript-<platform>/lib/lib.*.d.ts; the TS<=6 node_modules/typescript/lib/ form is matched too). Every lib file would now read as a path outside the package, so this partition is about something else`,
    };

  return {
    ...base,
    ok: true,
    reason: `${listed.length} input(s): ${inside.length} inside ${rel}, ${workspace.length} elsewhere in the repository, ${external.length} external, ${libs.length} lib`,
    listed,
    inside: inside.toSorted(byString),
    workspace: workspace.toSorted(byRel),
    external: external.toSorted(byString),
    foreign: foreign.toSorted(byString),
    libs,
    libPlatforms: [...platforms].toSorted(byString),
    libLayouts: [...layouts].toSorted(byString),
  };
}

// ---------------------------------------------------------------- light shape

/**
 * The shape check every light result passes through — in this module, not in
 * `run.mjs`, so a light that wants to validate its own return value uses the
 * same code the aggregator judges it with.
 *
 * → { id, severity, status, detail, declaredSeverity, problems, notRun }
 *
 * What it fixes, fail-closed every time:
 *   - a status outside `LIGHT_STATUSES` becomes `cannot-verify`;
 *   - an empty `detail` becomes `cannot-verify · the light returned no detail`;
 *   - the id and severity of the ROW are the MODULE's declared ones, never the
 *     ones the returned object carries, and a disagreement between the two is
 *     appended to the detail — a light reporting somebody else's id is how a row
 *     ends up describing a check that never ran;
 *   - severity comes from `severityOf` in `../lib/spec-parse.mjs` when that
 *     table declares one, from the module when it does not, and an undeclared
 *     severity is treated as `hard` with `(severity undeclared)` in the detail,
 *     exactly as that table's own comment instructs.
 *
 * `quietSeverityProvenance` suppresses only that last note, for the rows where a
 * module does not exist at all: "the module declares no severity" says nothing
 * about a file nobody has written, and twelve copies of it would bury the row's
 * real detail. The gap itself is still a gap — `run.mjs` prints it once, under
 * the table, naming every id it applies to.
 */
export function normalizeResult(light, returned, { quietSeverityProvenance = false } = {}) {
  const id = light?.id ?? returned?.id ?? '(unnamed light)';
  const table = severityOf(id);
  const fromModule = SEVERITIES.includes(light?.severity) ? light.severity : null;
  const problems = [];

  let severity;
  if (table.known && table.declared) {
    severity = table.severity;
    if (fromModule !== null && fromModule !== severity)
      problems.push(`severity disagreement: the module says ${fromModule}, ../lib/spec-parse.mjs says ${severity} — one of them is wrong and the table wins`);
  } else if (fromModule !== null) {
    severity = fromModule;
    if (table.known && !quietSeverityProvenance)
      problems.push('(severity undeclared in ../lib/spec-parse.mjs STANDING_LIGHTS — fill the row in the commit that lands this light)');
  } else {
    severity = 'hard';
    if (!quietSeverityProvenance)
      problems.push('(severity undeclared by the module AND by ../lib/spec-parse.mjs — read as hard, which is the fail-closed reading)');
  }

  if (!table.known) problems.push(`"${id}" is not in STANDING_LIGHT_IDS — a light nobody declared cannot be part of a mode`);

  let status = returned?.status;
  if (!LIGHT_STATUSES.includes(status)) {
    problems.push(`status ${JSON.stringify(status ?? null)} is not one of ${LIGHT_STATUSES.join(' | ')}`);
    status = 'cannot-verify';
  }
  if (returned?.id !== undefined && light?.id !== undefined && returned.id !== light.id)
    problems.push(`the result names id ${JSON.stringify(returned.id)} but the module is ${JSON.stringify(light.id)}`);

  let detail = typeof returned?.detail === 'string' ? returned.detail.replace(/\s+/g, ' ').trim() : '';
  if (detail === '') {
    status = 'cannot-verify';
    detail = 'the light returned no detail — a row that says a status and nothing else names no artifact and no cure (rule 8)';
  }
  if (problems.length) detail = `${detail} [${problems.join('; ')}]`;

  return { id, severity, status, detail, declaredSeverity: table.declared ? table.severity : null, problems, notRun: returned?.notRun === true };
}

// -------------------------------------------------------- re-exports, not copies

/**
 * `codeOnly` masks comments, string literals AND `${…}` substitutions while
 * preserving every offset and line, which is what makes a token scan over
 * TypeScript honest without parsing it. It is RE-EXPORTED from
 * `../lib/test-cases.mjs`, never reimplemented: a second masker would differ by
 * one character on a JSX apostrophe and two lights would then disagree about
 * what the source says. `scanSource` comes with it because it is the form that
 * also returns `problems` — an unbalanced mask means the masking itself may have
 * gone wrong, and a light that needs to fail closed needs to see that.
 */
export { codeOnly, scanSource } from '../lib/test-cases.mjs';

/** Re-exported so a light imports ONE module: the dictionaries still live in
 * `../lib/spec-parse.mjs` and these are the same frozen arrays, not copies. */
export { LIGHT_STATUSES, SEVERITIES };
