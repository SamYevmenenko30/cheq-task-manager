/**
 * The reader of the type artefact of record: a `tsc --noEmit` log.
 *
 * Zero dependencies, `node:` builtins only. This module reads TEXT that tsc
 * wrote; it never parses TypeScript. Every question about types is delegated to
 * the compiler, which is the whole reason a gate may be this small.
 *
 * THE COMMAND THIS READS (typescript 7.0.2, the only type engine in the tree):
 *
 *     pnpm exec tsc --noEmit --pretty false --listFiles -p <pkg>/tsconfig.json  > tsc.<kind>.log 2>&1
 *
 * `--pretty false` because the pretty renderer wraps, colours and re-indents
 * the diagnostic, and the line regex below then matches nothing.
 * `--listFiles` because of the GREEN rule: see `readTsc`.
 *
 * THE MEASURED SHAPES (rerun: plant the defect, run the command above)
 *
 * A positioned diagnostic — path RELATIVE to the cwd, exit 1:
 *     packages/core/src/x.ts(1,26): error TS2304: Cannot find name 'missingSymbol'.
 *     packages/core/src/x.ts(2,22): error TS2307: Cannot find module './nope.ts' or its corresponding type declarations.
 *
 * A diagnostic with NO position at all, also on a line of its own:
 *     error TS18003: No inputs were found in config file '…'. …
 *     error TS5058: The specified path does not exist: '…'.
 * These are configuration failures. They must never read as green, and they
 * cannot be deduped or located by path, so they are collected separately as
 * `global`. A run whose `include` matched nothing produced TS18003 and ONE
 * line of output in total — `filesChecked: 0`, the exact "never ran" signal.
 *
 * `--listFiles` prints every input as an ABSOLUTE path, one per line, in the
 * same stream as the diagnostics (measured: 92 paths on a clean
 * `packages/core`; 93 paths plus 4 diagnostics on the planted run).
 *
 * THE CORE BOUNDARY IS A COMPILER FACT, NOT A LINT RULE. With
 * `"lib": ["ES2023"]` and `"types": []` (packages/core/tsconfig.json:7-8,
 * under the comment that says so at :4-6), the absence of the type IS the
 * error, and no comment can disable it:
 *     `document.title`                     → error TS2584: Cannot find name 'document'.
 *     `import … from 'node:fs'`            → error TS2591: Cannot find name 'node:fs'.
 * NEITHER code is in MISSING_SYMBOL_CODES, so neither can ever be excused as
 * "pending implementation". That is on purpose.
 *
 * AND THE HOLE THIS CANNOT SEE: a RELATIVE path out of packages/core —
 * `import … from '../../../apps/api/src/index.ts'` — typechecks clean, exit 0,
 * no diagnostic. The compiler, the dependency graph and the linter are all
 * silent. Only a light that walks the import graph catches it; nothing in this
 * file should ever be cited as evidence that the boundary held.
 */

import { existsSync, readFileSync } from 'node:fs';

/**
 * `path(line,col): error TSxxxx: message` — the positioned form (measured).
 * The path group refuses a leading `(` and a leading space so a wrapped pretty
 * line cannot masquerade as a diagnostic.
 */
export const TSC_DIAGNOSTIC_RE = /^(?<path>[^\s(][^(]*?)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d{4,6}): (?<msg>.*)$/;

/** `error TSxxxx: message` with no file position — a configuration failure. */
export const TSC_GLOBAL_RE = /^error (?<code>TS\d{4,6}): (?<msg>.*)$/;

/**
 * The CLOSED set of codes that mean "the symbol or module is not written yet".
 * Closed is the point: a code outside it is never excused, so a new compiler
 * diagnostic cannot quietly join the tolerance. Adding a code is a declared
 * change to this file, not a configuration knob.
 *
 *  TS2304 Cannot find name                TS2305 has no exported member
 *  TS2307 Cannot find module              TS2339 Property does not exist on type
 *  TS2551 Property does not exist (did you mean)
 *  TS2552 Cannot find name (did you mean) TS2554 Expected n arguments
 *  TS2555 Expected at least n arguments   TS2694 Namespace has no exported member
 *  TS2724 has no exported member named    TS2792 Cannot find module (moduleResolution)
 */
export const MISSING_SYMBOL_CODES = Object.freeze(
  new Set(['TS2304', 'TS2305', 'TS2307', 'TS2339', 'TS2551', 'TS2552', 'TS2554', 'TS2555', 'TS2694', 'TS2724', 'TS2792']),
);

/**
 * Diagnostics out of log text.
 * → { positioned: [{ path, line, col, code, msg, raw }],
 *     global:     [{ code, msg, raw }],
 *     filesChecked: number }
 *
 * Deduped by `path|line|col|code`: the same diagnostic can be printed more than
 * once when a file is part of several programs, and three copies of one error
 * is not three errors.
 *
 * `filesChecked` counts `--listFiles` lines: an absolute path that is not itself
 * a diagnostic. Zero is not "a clean project", it is "the compiler read
 * nothing" — the distinction `readTsc` turns into a verdict.
 */
export function parseDiagnostics(text) {
  const seen = new Set();
  const positioned = [];
  const global = [];
  let filesChecked = 0;

  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line) continue;

    const m = line.match(TSC_DIAGNOSTIC_RE);
    if (m) {
      const key = `${m.groups.path}|${m.groups.line}|${m.groups.col}|${m.groups.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      positioned.push({
        path: m.groups.path,
        line: Number(m.groups.line),
        col: Number(m.groups.col),
        code: m.groups.code,
        msg: m.groups.msg,
        raw: line,
      });
      continue;
    }

    const g = line.match(TSC_GLOBAL_RE);
    if (g) {
      global.push({ code: g.groups.code, msg: g.groups.msg, raw: line });
      continue;
    }

    // A --listFiles entry: an absolute path and nothing else on the line.
    if (line.startsWith('/') && !line.includes('): error ')) filesChecked += 1;
  }

  return { positioned, global, filesChecked };
}

/**
 * Read one tsc log by its EXPLICIT path (no glob — see
 * tools/gates/lib/run-dir.mjs).
 *
 * → { ok, verdict, reason, path, diagnostics, global, filesChecked, all }
 *   verdict ∈ `green | red | cannot-verify`
 *
 * THE GREEN RULE, and the reason `--listFiles` is in the command: green needs
 * BOTH zero diagnostics AND positive evidence that the compiler read something.
 * `filesChecked === 0` with no diagnostics is CANNOT VERIFY — "never ran is not
 * green". An `exit 0` proves nothing here: a config whose `include` matches
 * nothing, a `-p` pointing at a file that does not exist, a log that was never
 * written because the command died before tsc started — all of them produce an
 * empty or near-empty log, and two exit codes already lied in the session that
 * designed this file by reporting 0 for a crash and for four TS6059.
 *
 * `global` diagnostics make the verdict `red` regardless of count: a
 * configuration that did not load is a failure, not a clean project.
 */
export function readTsc(path) {
  if (!path) return { ok: false, verdict: 'cannot-verify', reason: 'readTsc: no path given', path: null };
  if (!existsSync(path))
    return { ok: false, verdict: 'cannot-verify', reason: `no such file: ${path} — a missing artefact is CANNOT VERIFY, never green`, path };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { ok: false, verdict: 'cannot-verify', reason: `unreadable: ${path}: ${String(e.message)}`, path };
  }

  const { positioned, global, filesChecked } = parseDiagnostics(text);
  const all = [...positioned, ...global];
  const base = { ok: true, path, diagnostics: positioned, global, filesChecked, all };

  if (global.length)
    return {
      ...base,
      verdict: 'red',
      reason: `${global.length} configuration diagnostic(s) with no file position: ${global.map((g) => `${g.code}: ${g.msg}`).join(' | ')}`,
    };

  if (positioned.length)
    return {
      ...base,
      verdict: 'red',
      reason: `${positioned.length} diagnostic(s): ${[...new Set(positioned.map((d) => d.code))].toSorted().join(', ')}`,
    };

  if (filesChecked === 0)
    return {
      ...base,
      ok: false,
      verdict: 'cannot-verify',
      reason: `${path}: zero diagnostics but filesChecked=0 — the compiler read no input, and never ran is not green (is --listFiles in the command?)`,
    };

  return { ...base, verdict: 'green', reason: `clean over ${filesChecked} input file(s)` };
}

/**
 * Is a TS2307 about code nobody has written, or about a worktree nobody has
 * installed? The message is the same string for both, so the SPECIFIER decides.
 * Measured 2026-11-01 — both of these are TS2307, word for word the same
 * sentence:
 *     Cannot find module '@cheq/nonexistent-pkg' or its corresponding type declarations.
 *     Cannot find module '@cheq/core/deep/nope.ts' or its corresponding type declarations.
 *
 * → { reason, specifier, bare, subpath }
 *   `not-installed`  a BARE specifier, no subpath: `@cheq/core`, `fastify`.
 *                    Nothing inside the repository can fix this; `pnpm install`
 *                    can. A gate must not read it as pending implementation.
 *   `missing-module` a relative or absolute path, or a package WITH a subpath.
 *   `not-ts2307`     the diagnostic is some other code.
 *
 * `bare` is the package part so a caller can compare it against the workspace
 * package names. AMBIGUITY, named rather than hidden: a subpath specifier reads
 * as `missing-module` even when the package itself is absent — the message does
 * not distinguish the two. Pass `workspacePackages` and a subpath whose package
 * is not one of them is reported `not-installed` instead.
 */
export function classifyTs2307(diag, { workspacePackages = null } = {}) {
  if (diag?.code !== 'TS2307' && diag?.code !== 'TS2792')
    return { reason: 'not-ts2307', specifier: null, bare: null, subpath: null };
  const m = String(diag.msg ?? '').match(/Cannot find module '([^']+)'/);
  if (!m) return { reason: 'not-ts2307', specifier: null, bare: null, subpath: null };
  const spec = m[1];

  if (spec.startsWith('.') || spec.startsWith('/'))
    return { reason: 'missing-module', specifier: spec, bare: null, subpath: null };

  const scoped = spec.startsWith('@');
  const parts = spec.split('/');
  const bare = scoped ? parts.slice(0, 2).join('/') : parts[0];
  const subpath = spec.length > bare.length ? spec.slice(bare.length + 1) : null;

  if (!subpath) return { reason: 'not-installed', specifier: spec, bare, subpath: null };
  if (workspacePackages && !workspacePackages.includes(bare))
    return { reason: 'not-installed', specifier: spec, bare, subpath };
  return { reason: 'missing-module', specifier: spec, bare, subpath };
}

/**
 * Does this log say "the implementation is not written yet", and nothing else?
 *
 * `isSpecTestPath` is a predicate the caller supplies — path classification
 * lives in tools/gates/lib/test-file-patterns.mjs, not here, so there is one
 * answer to "is this a spec test" in the repository.
 *
 * → { pending, why, offending }
 *
 * `pending: true` requires ALL of:
 *  - at least one diagnostic (zero diagnostics is not pending, it is green or
 *    CANNOT VERIFY — `readTsc` decides which);
 *  - NO `global` diagnostic: a config that did not load tells us nothing;
 *  - every positioned diagnostic's code in MISSING_SYMBOL_CODES;
 *  - every positioned diagnostic located in a file `isSpecTestPath` accepts —
 *    one error in `src` is a broken implementation, not an absent one;
 *  - no TS2307 that `classifyTs2307` calls `not-installed`: an uninstalled
 *    worktree would otherwise read as "the whole feature is pending".
 *
 * This is the only tolerance in the type lane, and it belongs to ONE branch:
 * the pre-commit path prints it as a warning, every strict run fails on the
 * same tree. Nothing in this module decides which branch it is in; it reports
 * the fact and the caller owns the policy.
 */
export function classifyPending(read, isSpecTestPath, { workspacePackages = null } = {}) {
  if (!read?.ok && !read?.all?.length)
    return { pending: false, why: `unreadable log: ${read?.reason ?? 'no result given'}`, offending: [] };
  if (read.global?.length)
    return {
      pending: false,
      why: `configuration diagnostic(s) present: ${read.global.map((g) => g.code).join(', ')} — a config that did not load says nothing about an implementation`,
      offending: read.global,
    };
  const diags = read.diagnostics ?? [];
  if (!diags.length) return { pending: false, why: 'no diagnostics — pending is a claim about errors, and there are none', offending: [] };

  const notMissing = diags.filter((d) => !MISSING_SYMBOL_CODES.has(d.code));
  if (notMissing.length)
    return {
      pending: false,
      why: `${notMissing.length} diagnostic(s) outside the missing-symbol set: ${notMissing.map((d) => `${d.path}:${d.line} ${d.code}`).join(', ')}`,
      offending: notMissing,
    };

  const outside = diags.filter((d) => !isSpecTestPath(d.path));
  if (outside.length)
    return {
      pending: false,
      why: `${outside.length} diagnostic(s) outside a spec test: ${outside.map((d) => `${d.path}:${d.line} ${d.code}`).join(', ')} — an error in src is a broken implementation, not an absent one`,
      offending: outside,
    };

  const uninstalled = diags
    .map((d) => ({ d, c: classifyTs2307(d, { workspacePackages }) }))
    .filter((x) => x.c.reason === 'not-installed');
  if (uninstalled.length)
    return {
      pending: false,
      why: `${uninstalled.length} diagnostic(s) name an unresolved package, not a missing symbol: ${uninstalled.map((x) => `${x.d.path}:${x.d.line} ${x.c.specifier}`).join(', ')} — the worktree is not installed`,
      offending: uninstalled.map((x) => x.d),
    };

  return {
    pending: true,
    why: `${diags.length} missing-symbol diagnostic(s), all in spec tests: ${diags.map((d) => `${d.path}:${d.line} ${d.code}`).join(', ')}`,
    offending: [],
  };
}
