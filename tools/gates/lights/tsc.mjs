/**
 * L-tsc — the compile verdict of record, one project at a time, plus the pin on
 * the tsconfig fields that make the other lanes mean anything.
 *
 * Zero dependencies, Node 22 ESM. THIS MODULE NEVER PARSES TYPESCRIPT: every
 * question about types is asked of `tsc` and comes back as text, read by
 * `../lib/tsc-log.mjs` — the one reader of that format in the repository.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT IT ASSERTS, AND WHY EACH HALF EXISTS
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. THE VERDICT. For every typed kind, `tsc --noEmit --pretty false
 *    --listFiles -p <pkg>/tsconfig.json` is run, its output is WRITTEN to
 *    `.ci/lights/tsc.<kind>.log`, and the verdict is read back out of that file
 *    by `readTsc`. The file is the artifact the row cites, so a human can open
 *    the thing the status was read from. The child's exit code is captured
 *    separately (`sh` in `./_shared.mjs` never pipes) and stays ADVISORY: two
 *    exit codes lied in the session that measured this toolchain, both times
 *    because `$?` belonged to `head`.
 *
 * 2. `filesChecked === 0` IS CANNOT VERIFY. `readTsc` enforces it and that is
 *    why `--listFiles` is in the argv: zero diagnostics proves nothing unless
 *    the compiler read something. Measured, both shapes exit non-zero with the
 *    whole message on stdout: `-p` at a missing path → `error TS5058`; an
 *    `include` that matched nothing → `error TS18003`.
 *
 * 3. THE FIELD PIN, read from `tsc --showConfig` — the only honest reader of the
 *    EFFECTIVE options, because `extends` hides values. MEASURED on 7.0.2 and
 *    the reason this pin is a short list rather than a diff: `--showConfig`
 *    prints options nobody wrote (`preserveConstEnums: true` appears on
 *    packages/core with that key in none of our files), so comparing the whole
 *    object would be red for ever. It also NORMALISES values — `"lib": ["es2023"]`
 *    and `"target": "es2023"` come back lowercased — so every comparison here
 *    goes through `normValue`.
 *
 * 4. NO `rootDir` AND NO `outDir`. A MEASURED defect, not a style rule:
 *    `rootDir: "src"` together with an `include` that reaches the `test` tree
 *    makes every test file `error TS6059`, and the project then reports red for a
 *    configuration reason that has nothing to do with the code. A noEmit
 *    typecheck config carries neither key.
 *
 * 5. `skipLibCheck: true` IS A DECLARED DEBT, NOT A SETTING. It hides whatever
 *    is wrong inside a `.d.ts`, so it is tolerated only while the debt entry
 *    that owns it exists AND still names it — TD-0004 does
 *    (docs/tech-debt/TD-0004-runner-does-not-typecheck.md:16 cites
 *    tsconfig.base.json:26, and :35 says this light is what pins it). Delete or
 *    silently rewrite that entry and this light goes red, which is the whole
 *    point of a reference: the tolerance and its justification cannot drift
 *    apart in silence.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE ONE TOLERANCE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Between the test phase and the implementation phase a spec test names symbols
 * nobody has written, so the project does not typecheck and THAT IS THE NORMAL
 * STATE. `classifyPending` in `../lib/tsc-log.mjs` establishes the world state
 * (every diagnostic a missing-symbol code, every one of them inside a placed
 * spec test, no configuration diagnostic, no unresolved PACKAGE — an
 * uninstalled worktree must not read as "the whole feature is pending"), and
 * this light SAYS SO by starting its detail with
 * `PENDING_IMPLEMENTATION_PREFIX`. `lights/run.mjs` recognises exactly that
 * prefix from exactly this id and only when `--pending-implementation-tolerance`
 * was passed, so the flag alone changes nothing. The status stays
 * `cannot-verify` either way: this light never calls a tree that does not
 * typecheck green.
 *
 * A PIN FAILURE IS NEVER TOLERATED. A config that lost `strict` is not an
 * implementation nobody has written yet, so the pin is evaluated first and a
 * violation makes the row `fail` with no prefix.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE OWNS FOR ITS SIBLINGS
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `tools/gates/lib` has no JSONC reader, and three of the configs this
 * repository is judged by carry comments (`tsconfig.base.json`,
 * `packages/core/tsconfig.json`, `.oxlintrc.jsonc`). Rather than let four
 * lights each strip comments slightly differently, the reader lives HERE —
 * `readJsonc`, `tsconfigChain`, `setterOf`, `showConfig` — and `core-purity`,
 * `graph`, `lint` and `visible` import it. One reader per format, and the
 * module that owns the tsconfig question is the one that reads tsconfigs.
 *
 * `JSON.parse` cannot be used on these files and a regex cannot replace a
 * scanner: `tsconfig.base.json:2` holds `"https://json.schemastore.org/tsconfig"`,
 * whose `//` is inside a string. `readJsonc` is a character scanner that tracks
 * string state and escapes for exactly that reason.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PENDING_IMPLEMENTATION_PREFIX } from '../lib/spec-parse.mjs';
import { KIND_ROOT, KINDS, isSpecTest } from '../lib/test-file-patterns.mjs';
import { classifyPending, readTsc } from '../lib/tsc-log.mjs';
import { jsonLine, normRel, readPackages, requirePremise, resolveClosure, sh } from './_shared.mjs';

export const id = 'L-tsc';
export const severity = 'hard';
/** This light can do NOTHING without the compiler, so it DECLARES the premise and
 * `run.mjs` refuses it by that premise's own name before `run` is called. */
const LIGHT_PREMISES = ['tsc'];
// Exported under the contract's name while the local binding is not called
// `premises`: three functions take a premise probe as a parameter, and a
// module-level `premises` made every one of them a shadow.
export { LIGHT_PREMISES as premises };

/**
 * The kinds that have a type project. `e2e` is Playwright's and has no
 * tsconfig at all (measured: `resolveClosure('e2e')` answers
 * `no e2e/tsconfig.json`), so it is not a gap here — `L-browser` owns that lane.
 * Derived from the one KINDS dictionary rather than written out again.
 */
export const TYPED_KINDS = Object.freeze(KINDS.filter((k) => k !== 'e2e'));

/** Where a light writes the artifact it then reads back. NOT a run of record:
 * `.ci/runs/<ts>-<label>/` is that, it is never reused, and `L-artifacts` owns
 * it. This path is fixed and overwritten on every run, and nothing may cite it
 * as evidence of a run — it exists so the row can name a file a human opens. */
export const LIGHT_ARTIFACT_DIR = '.ci/lights';

/**
 * The pinned compiler options, with the reason each one is pinned. Compared
 * field by field against `tsc --showConfig` — never as a whole object, because
 * `--showConfig` prints options nobody wrote (fact 3 in the header).
 */
const PINNED = Object.freeze([
  { key: 'strict', expect: true, why: 'the whole type lane rests on it; without it a diagnostic lane reports about something weaker than the code' },
  { key: 'noUncheckedIndexedAccess', expect: true, why: 'an index read is `T | undefined`, which is what makes `noEmit` type checking worth running at all' },
  { key: 'exactOptionalPropertyTypes', expect: true, why: 'an absent property and an `undefined` one are different facts, and a spec that distinguishes them needs the compiler to' },
  { key: 'noEmit', expect: true, why: 'every project here is a verdict, not a build step — and it is what makes allowImportingTsExtensions legal (TS5097)' },
]);

/** Keys that must be ABSENT from the effective config. The measured TS6059. */
const FORBIDDEN = Object.freeze([
  {
    key: 'rootDir',
    why: 'MEASURED: rootDir together with an include that reaches test/** makes every test file error TS6059, and the project then reads red for a configuration reason',
  },
  { key: 'outDir', why: 'a noEmit project emits nothing, so an outDir names a directory nobody writes and invites a rootDir to match it' },
]);

/** `skipLibCheck: true` is allowed only while this debt entry exists and still
 * names the setting. Both halves are checked — an entry that stopped mentioning
 * it is a reference that has drifted. */
const SKIP_LIB_CHECK_DEBT = Object.freeze({
  id: 'TD-0004',
  file: 'docs/tech-debt/TD-0004-runner-does-not-typecheck.md',
  mustMention: 'skipLibCheck',
});

// --------------------------------------------------------------- JSONC reading

/**
 * Strip JSONC down to JSON: line comments and block comments out, trailing
 * commas before `}` / `]` out, every other character and every newline kept so
 * an offset still maps to its line.
 *
 * A CHARACTER SCANNER, not a regex, and the reason is in this repository:
 * `tsconfig.base.json:2` is `"$schema": "https://json.schemastore.org/tsconfig"`,
 * whose `//` sits inside a string. A regex that removed `//`-to-end-of-line
 * would truncate that line and the file would stop parsing — the kind of
 * failure that looks like "the config is broken" rather than "the reader is".
 */
export function stripJsonc(text) {
  const src = String(text ?? '');
  const out = Array.from({ length: src.length }, (_, i) => src[i]);
  const blank = (a, b) => {
    for (let k = a; k < Math.min(b, src.length); k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end === -1 ? src.length : end + 2;
      blank(i, j);
      i = j;
      continue;
    }
    i += 1;
  }
  // Trailing commas: a `,` whose next non-whitespace character closes a
  // container. Comments are already blanked, so whitespace is all that can sit
  // between the two.
  const once = out.join('');
  const chars = Array.from(once);
  for (let k = 0; k < chars.length; k += 1) {
    if (chars[k] !== ',') continue;
    let j = k + 1;
    while (j < chars.length && /\s/.test(chars[j])) j += 1;
    if (chars[j] === '}' || chars[j] === ']') chars[k] = ' ';
  }
  return chars.join('');
}

/** Parse a JSONC text. → { ok, data, reason } — NEVER throws. */
export function readJsonc(text, label = 'the file') {
  let stripped;
  try {
    stripped = stripJsonc(text);
  } catch (e) {
    return { ok: false, data: null, reason: `${label}: could not strip comments: ${String(e?.message ?? e)}` };
  }
  try {
    return { ok: true, data: JSON.parse(stripped), reason: null };
  } catch (e) {
    return { ok: false, data: null, reason: `${label}: not valid JSON even with comments and trailing commas removed (${String(e?.message ?? e)})` };
  }
}

/**
 * One JSONC config file off disk.
 * → { ok, rel, path, exists, text, data, reason }
 * An absent file is a STATE (`exists: false`), never a throw.
 */
export function readJsoncFile(root, rel) {
  const r = normRel(rel);
  if (r === null) return { ok: false, rel: String(rel ?? ''), path: null, exists: false, text: null, data: null, reason: `${String(rel)}: not a repo-relative path` };
  const path = join(root, r);
  if (!existsSync(path)) return { ok: false, rel: r, path, exists: false, text: null, data: null, reason: `${r}: does not exist` };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { ok: false, rel: r, path, exists: true, text: null, data: null, reason: `${r}: unreadable: ${String(e.message)}` };
  }
  const p = readJsonc(text, r);
  return { ok: p.ok, rel: r, path, exists: true, text, data: p.data, reason: p.reason };
}

/** `packages/core` → `packages/core/tsconfig.json`. A kind or a package dir. */
export function tsconfigRelOf(target) {
  const dir = normRel(KIND_ROOT[target] ?? target);
  return dir === null ? null : `${dir}/tsconfig.json`;
}

/**
 * A tsconfig and everything it extends, nearest first.
 * → { ok, files: [{ rel, text, data }], problems }
 *
 * Only a RELATIVE `extends` is followed. A package specifier (`extends:
 * "@tsconfig/node22/tsconfig.json"`) is reported as a problem rather than
 * guessed at: resolving it would need a module resolver, and a chain this
 * reader silently stopped walking would make `setterOf` answer "nobody sets
 * this key" about a key somebody set.
 */
export function tsconfigChain(root, rel, seen = new Set()) {
  const files = [];
  const problems = [];
  let cur = normRel(rel);
  while (cur !== null) {
    if (seen.has(cur)) {
      problems.push(`${cur}: extends cycle — the chain returns to a file it already read`);
      break;
    }
    seen.add(cur);
    const f = readJsoncFile(root, cur);
    if (!f.ok) {
      problems.push(f.reason);
      break;
    }
    files.push({ rel: cur, text: f.text, data: f.data });
    const ext = f.data?.extends;
    if (ext === undefined || ext === null) break;
    if (typeof ext !== 'string') {
      problems.push(`${cur}: "extends" is not a string (an array of bases is outside what this reader walks) — the chain stops here, so a pinned key set further up would be invisible`);
      break;
    }
    if (!ext.startsWith('.')) {
      problems.push(`${cur}: extends ${JSON.stringify(ext)} is a package specifier, not a relative path — this reader does not resolve modules, so the chain stops here and a key set in that base is invisible to the pin`);
      break;
    }
    const next = normRel(join(dirname(cur), ext));
    cur = next === null ? null : next.endsWith('.json') ? next : `${next}.json`;
  }
  return { ok: problems.length === 0, files, problems };
}

/**
 * Which file in a chain SETS a compilerOptions key, and on which line.
 * → { rel, line, value } for the nearest setter, or null.
 * `line` is the first occurrence of the quoted key in that file (`jsonLine`
 * keeps no positions of its own), which is what a `path:line` in a message
 * needs to be openable.
 */
export function setterOf(chain, key) {
  for (const f of chain.files ?? []) {
    const co = f.data?.compilerOptions;
    if (co !== null && typeof co === 'object' && Object.hasOwn(co, key)) {
      return { rel: f.rel, line: jsonLine(f.text, key), value: co[key] };
    }
  }
  return null;
}

/** `path:line`, or just the path when the line is unknown. */
export const cite = (rel, line) => (line === null || line === undefined ? String(rel) : `${rel}:${line}`);

/**
 * Lowercase every string, in a scalar or in an array of scalars. MEASURED:
 * `tsc --showConfig` answers `"lib": ["es2023"]` and `"target": "es2023"` for a
 * file that wrote `ES2023`, so every comparison against it is case-insensitive
 * or permanently wrong.
 */
export function normValue(v) {
  if (typeof v === 'string') return v.toLowerCase();
  if (Array.isArray(v)) return v.map(normValue);
  return v;
}

/** Deep equality for the shapes a tsconfig value can take (scalar, array). */
export function sameValue(a, b) {
  const x = normValue(a);
  const y = normValue(b);
  if (Array.isArray(x) || Array.isArray(y)) {
    if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
    return x.every((e, i) => sameValue(e, y[i]));
  }
  return x === y;
}

/**
 * `tsc --showConfig -p <cfg>` — the RESOLVED options, `files` and `include`.
 * → { ok, reason, data, argv, exitCode, text }
 *
 * Runs with `cwd` = the repository root, like every other child in the lights,
 * so a path it prints is repo-relative and comparable with a path from git.
 */
export function showConfig(root, cfgRel, premises) {
  const prem = requirePremise(premises, 'tsc');
  if (!prem.ok) return { ok: false, reason: prem.reason, data: null, argv: null, exitCode: null, text: '' };
  const r = sh(prem.premise.path, ['--showConfig', '-p', cfgRel], { cwd: root });
  if (r.code === null)
    return { ok: false, reason: `could not run ${prem.premise.rel}: ${r.spawnError ?? 'spawn failed'}`, data: null, argv: r.argv, exitCode: null, text: '' };
  const p = readJsonc(r.combined, `${prem.premise.rel} --showConfig -p ${cfgRel}`);
  if (!p.ok)
    return {
      ok: false,
      reason: `${cfgRel}: --showConfig printed no JSON (exit ${String(r.code)}): ${r.combined.split('\n').find((l) => l.trim()) ?? '(no output)'}`,
      data: null,
      argv: r.argv,
      exitCode: r.code,
      text: r.combined,
    };
  return { ok: true, reason: null, data: p.data, argv: r.argv, exitCode: r.code, text: r.combined };
}

// -------------------------------------------------------------------- the pin

/**
 * Check one project's effective config against PINNED / FORBIDDEN / the debt.
 * → { problems: string[], notes: string[] }
 * Every problem carries `path:line` and what to do (rule 8).
 */
export function pinProblems(root, kind, cfgRel, cfg, chain) {
  const problems = [];
  const notes = [];
  const co = cfg?.compilerOptions;
  if (co === null || co === undefined || typeof co !== 'object') {
    problems.push(
      `${cfgRel} (${kind}): the effective config could not be read, so the field pin asserted NOTHING — ${cfg?.showConfigReason ?? 'tsc --showConfig returned no compilerOptions object'}`,
    );
    return { problems, notes };
  }

  for (const pin of PINNED) {
    if (!Object.hasOwn(co, pin.key)) {
      const base = chain.files.at(-1)?.rel ?? 'tsconfig.base.json';
      problems.push(`${cfgRel} (${kind}): the effective config does not set "${pin.key}" — add "${pin.key}": ${JSON.stringify(pin.expect)} to ${base} or to ${cfgRel}; ${pin.why}`);
      continue;
    }
    if (!sameValue(co[pin.key], pin.expect)) {
      const s = setterOf(chain, pin.key);
      problems.push(
        `${s === null ? cfgRel : cite(s.rel, s.line)} (${kind}): "${pin.key}" is ${JSON.stringify(co[pin.key])}, pinned to ${JSON.stringify(pin.expect)} — set it back; ${pin.why}`,
      );
    }
  }

  for (const f of FORBIDDEN) {
    if (!Object.hasOwn(co, f.key)) continue;
    const s = setterOf(chain, f.key);
    problems.push(
      `${s === null ? cfgRel : cite(s.rel, s.line)} (${kind}): "${f.key}" is set to ${JSON.stringify(co[f.key])} and must be absent from a noEmit typecheck config — delete the key; ${f.why}`,
    );
  }

  if (co.skipLibCheck === true) {
    const s = setterOf(chain, 'skipLibCheck');
    const where = s === null ? cfgRel : cite(s.rel, s.line);
    const debt = readJsoncOrText(root, SKIP_LIB_CHECK_DEBT.file);
    if (!debt.ok)
      problems.push(
        `${where} (${kind}): "skipLibCheck": true is a DECLARED DEBT and its entry is unreadable (${debt.reason}) — restore ${SKIP_LIB_CHECK_DEBT.file} or turn skipLibCheck off; it hides whatever is wrong inside a .d.ts, so it is allowed only while the debt that owns it is on the ledger`,
      );
    else if (!debt.text.includes(SKIP_LIB_CHECK_DEBT.mustMention))
      problems.push(
        `${where} (${kind}): "skipLibCheck": true is tolerated only by ${SKIP_LIB_CHECK_DEBT.id}, and ${SKIP_LIB_CHECK_DEBT.file} no longer mentions "${SKIP_LIB_CHECK_DEBT.mustMention}" — the reference has drifted: name the setting in that entry again, or turn skipLibCheck off`,
      );
    else notes.push(`skipLibCheck: true at ${where} is the declared debt ${SKIP_LIB_CHECK_DEBT.id}`);
  }

  for (const p of chain.problems) problems.push(`${cfgRel} (${kind}): ${p}`);
  return { problems, notes };
}

/** A file read as plain text, for the debt entry: a `.md` is not JSONC. */
function readJsoncOrText(root, rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return { ok: false, text: '', reason: `${rel} does not exist` };
  try {
    return { ok: true, text: readFileSync(path, 'utf8'), reason: null };
  } catch (e) {
    return { ok: false, text: '', reason: `${rel}: unreadable: ${String(e.message)}` };
  }
}

// -------------------------------------------------------------------- the run

export function run(ctx) {
  const { root, premises } = ctx;

  let artifactDir = join(root, LIGHT_ARTIFACT_DIR);
  let dirProblem = null;
  try {
    mkdirSync(artifactDir, { recursive: true });
  } catch (e) {
    dirProblem = `${LIGHT_ARTIFACT_DIR}: not writable (${String(e.message)}) — the verdict is read from a file this light writes, so there is nothing to read`;
    artifactDir = null;
  }

  const workspacePackages = readPackages(root).packages.map((p) => p.name).filter((n) => n !== null);
  const rows = [];
  const problems = [];
  const pending = [];
  const notes = [];

  for (const kind of TYPED_KINDS) {
    const cfgRel = tsconfigRelOf(kind);
    if (cfgRel === null || !existsSync(join(root, cfgRel))) {
      problems.push(`${kind}: no ${cfgRel ?? `${String(KIND_ROOT[kind])}/tsconfig.json`} — a typed kind with no type project cannot be judged; create it or stop calling ${kind} a typed kind`);
      rows.push(`${kind}=cannot-verify(no tsconfig)`);
      continue;
    }

    // ONE spawn per kind: resolveClosure runs exactly the argv of record and
    // hands back the text, and it cross-checks its own --listFiles line count
    // against ../lib/tsc-log.mjs so the two line rules cannot drift.
    const closure = resolveClosure(kind, { root, premises });
    const text = closure.text ?? '';

    if (artifactDir === null) {
      problems.push(`${kind}: ${dirProblem}`);
      rows.push(`${kind}=cannot-verify(no artifact)`);
      continue;
    }
    const logRel = `${LIGHT_ARTIFACT_DIR}/tsc.${kind}.log`;
    const logPath = join(artifactDir, `tsc.${kind}.log`);
    try {
      writeFileSync(logPath, text, 'utf8');
    } catch (e) {
      problems.push(`${logRel}: could not be written (${String(e.message)}) — the verdict is read from this file, and a missing artifact is CANNOT VERIFY, never green`);
      rows.push(`${kind}=cannot-verify(artifact not written)`);
      continue;
    }

    const read = readTsc(logPath);
    const pin = pinProblems(root, kind, cfgRel, showConfigOf(root, cfgRel, premises), tsconfigChain(root, cfgRel));
    problems.push(...pin.problems);
    notes.push(...pin.notes);

    if (read.verdict === 'green') {
      rows.push(`${kind}=green(${read.filesChecked} input(s))`);
      if (!closure.ok) notes.push(`${kind}: the closure reader is unhappy although the log is clean — ${closure.reason}`);
      continue;
    }

    if (read.verdict === 'red') {
      const p = classifyPending(read, isSpecTest, { workspacePackages });
      if (p.pending) {
        pending.push(`${kind}: ${p.why}`);
        rows.push(`${kind}=red(pending implementation, ${read.diagnostics.length} diagnostic(s))`);
      } else {
        const first = read.all.slice(0, 3).map((d) => (d.path ? `${d.path}:${d.line} ${d.code} ${d.msg}` : `${d.code}: ${d.msg}`));
        problems.push(`${kind}: ${logRel} — ${read.reason}; ${first.join(' | ')}${read.all.length > 3 ? ` (+${read.all.length - 3} more)` : ''}; not pending implementation because ${p.why}`);
        rows.push(`${kind}=red(${read.all.length})`);
      }
      continue;
    }

    problems.push(`${kind}: ${logRel} — ${read.reason}${closure.ok ? '' : `; closure: ${closure.reason}`}`);
    rows.push(`${kind}=cannot-verify`);
  }

  // Deduped: the same base tsconfig answers for three projects, so the same
  // note would otherwise be printed three times and bury the per-kind rows.
  const uniqueNotes = [...new Set(notes)];
  const summary = `${rows.join(' · ')}${uniqueNotes.length ? ` · ${uniqueNotes.join(' · ')}` : ''}`;

  // A pin failure is a configuration defect, never "the implementation is not
  // written yet", so it is decided BEFORE the tolerance and carries no prefix.
  if (problems.length)
    return { id, severity, status: 'fail', detail: `${problems.length} problem(s): ${problems.join(' || ')} · ${summary}` };

  if (pending.length)
    return {
      id,
      severity,
      status: 'cannot-verify',
      // The prefix is the FIRST thing in the detail: lights/run.mjs matches it
      // with startsWith after normalizeResult has trimmed, and the tolerance is
      // recognised from this string, never from the flag alone.
      detail: `${PENDING_IMPLEMENTATION_PREFIX} every diagnostic is a missing symbol inside a placed spec test — ${pending.join(' || ')} · ${summary} · every strict run fails on this tree; only the hook prints it as a warning`,
    };

  return { id, severity, status: 'pass', detail: `${summary} · artifacts under ${LIGHT_ARTIFACT_DIR}/tsc.<kind>.log · pinned: ${PINNED.map((p) => p.key).join(', ')}; forbidden: ${FORBIDDEN.map((f) => f.key).join(', ')}` };
}

/** `showConfig` with its failure folded into a shape `pinProblems` can read: a
 * config nobody could resolve becomes one problem naming the reason, instead of
 * four problems about absent keys. */
function showConfigOf(root, cfgRel, premises) {
  const s = showConfig(root, cfgRel, premises);
  return s.ok ? s.data : { compilerOptions: null, showConfigReason: s.reason };
}
