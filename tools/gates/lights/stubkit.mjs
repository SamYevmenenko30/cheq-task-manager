#!/usr/bin/env node
/**
 * L-stubkit (hard) — a stub renders no invented data (rule 9). Four claims, each
 * mechanical:
 *
 *   1. PATH. A stub screen lives under `apps/web/src/stubs/` and nowhere else.
 *   2. IMPORTS. Inside that directory the only non-relative specifiers are
 *      `react` and `@cheq/stubkit`; every relative specifier RESOLVES.
 *   3. MARKER. The root element of a stub screen carries `data-stub`.
 *   4. NO INVENTED DATA. No literal array of objects — `[{ … }]` — anywhere in
 *      a stub: that is what a fabricated task list looks like in source.
 *
 *     node tools/gates/lights/stubkit.mjs
 *
 * Zero dependencies, Node 22 ESM. The module contract lives in `./_shared.mjs`.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE PORT TAKES THE PROMISE, NOT THE HOLE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * In the Resonance original the header of this light promises that an
 * unresolvable specifier fails, and the code then reads `if (!path) continue` —
 * so the one shape it most needed to catch, an import of something nobody
 * wrote, walked straight through. Here an unresolvable specifier is a FAIL with
 * its `path:line`, and so is a specifier that is not a literal at all
 * (`import(`${dir}/x`)`): a stub whose imports cannot be followed is a stub
 * nobody can tell apart from a screen wired to invented data.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT MAKES A FILE A STUB SCREEN — and why `App.tsx` is not one
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Two MECHANICAL markers, and nothing else: an import of `@cheq/stubkit`, or a
 * `data-stub` attribute inside a JSX opening tag. The word STUB in rendered text
 * is prose and is deliberately NOT a marker — `apps/web/src/App.tsx` is the
 * scaffold's rule-9 stub (AGENTS.md), it shows a visible `STUB` tag, it lives
 * outside `apps/web/src/stubs/` by design, and a light that read its prose as a
 * marker would fail a committed tree it was never meant to judge. Whether an
 * empty state is HONEST is a human reading (process.md); what is checked here is
 * the path, the marker, the import list and the absence of fabricated rows.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * TODAY'S STATE: NOTHING TO GUARD, WHICH IS A PASS WITH THE REASON NAMED
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `apps/web/src/stubs/` does not exist and `@cheq/stubkit` is not a workspace
 * package (2026-11-01). An absent directory is `pass` — there is no stub screen
 * to be dishonest — and the detail says so rather than printing a bare `pass`
 * that reads as "four claims verified". But an absent `@cheq/stubkit` WITH a
 * stub screen present is a fail: a stub that builds its primitives by hand is
 * the thing rule 9 forbids, and the one import that proves it is missing.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY THIS LIGHT READS THE WORK TREE AND NOT HEAD
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * A range-based gate must read HEAD, or the hook goes green on an uncommitted
 * edit. This light is not range-based: "does this specifier resolve" is a
 * question about files ON DISK, and two of its four claims (path, resolution)
 * are properties of the tree as it stands. It is the same arrangement the hook
 * already has for its filesystem lights. The consequence is written down rather
 * than left implicit: this light judges what is there now, so it reports a
 * violation that was committed long ago as well as one being added.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * NO AST, AS EVERYWHERE ELSE — AND WHAT THAT COSTS
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * A question about types goes to `tsc`; this light scans TEXT. Every scan runs
 * over `scanSource`'s masked code, so a comment, a string literal and a `${…}`
 * substitution cannot trigger anything — the specifier itself is then read back
 * from that reader's `literals` map by offset, which is the only place the text
 * of a string is still available. An unbalanced mask (`problems`) is
 * cannot-verify for that file: if the masking went wrong, every `path:line`
 * below it would be a lie.
 *
 * The limits, stated instead of implied: the root element is the first JSX
 * opening tag after the first `return` (or the first in the file when there is
 * none, which is the arrow-component form), a JSX FRAGMENT root is a fail
 * because a fragment cannot carry an attribute, and `[{` is the literal-array
 * shape — a fabricated list built by `Array.from({ length: 8 })` is not caught
 * and is a human reading.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TEST_DIR } from '../lib/test-file-patterns.mjs';
import { baseRev, repoRoot } from '../lib/git.mjs';
import { normalizeResult, readPackages, readPremises, readVisible, scanSource, under, walk } from './_shared.mjs';

export const id = 'L-stubkit';
export const severity = 'hard';

/** The one directory a stub screen may live in (rule 9, AGENTS.md). */
export const STUB_ROOT = 'apps/web/src/stubs';
/** The only source of stub primitives. */
export const STUBKIT = '@cheq/stubkit';
/** The attribute the root element of a stub screen carries. */
export const STUB_ATTR = 'data-stub';
/** The ONLY non-relative specifiers allowed inside STUB_ROOT. Exact matches:
 * `react-dom/client` is a different package and `@cheq/stubkit/x` is a subpath
 * nobody declared, so both are named rather than waved through by a prefix. */
export const ALLOWED_BARE = Object.freeze(['react', STUBKIT]);
/** Where the outside-the-stubs scan looks for a misplaced stub screen. */
const SOURCE_ROOTS = Object.freeze(['packages', 'apps']);
const SOURCE_EXTS = Object.freeze(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx']);

/** The suffixes a relative specifier may resolve through, in order. The `.js` →
 * `.ts` pair is TypeScript's own rewrite; the bare `.ts`/`.tsx` forms are legal
 * here because every project is `noEmit` with `allowImportingTsExtensions`. */
const RESOLVE_SUFFIXES = Object.freeze(['', '.ts', '.tsx', '.d.ts', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']);

const lineOf = (text, offset) => {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
};

/**
 * Every module specifier of one file, from the masked code plus the literals
 * map `scanSource` returns. → { specifiers, problems }
 *
 * A specifier is a literal whose preceding CODE ends in `from`, `import`,
 * `import(` or `require(` — the four ways a module is named in this toolchain.
 * `literal: false` marks a template specifier with a substitution, which has no
 * text to resolve; the caller fails on it rather than skipping it.
 *
 * Nothing in `tools/gates/lib` answers this question: `resolveClosure` in
 * `./_shared.mjs` reports the paths tsc RESOLVED, which is strictly less — an
 * unresolvable specifier never appears in a `--listFiles` listing at all, and
 * the specifier TEXT (`react` vs `react-dom/client`) is gone by then.
 */
export function importsOf(text) {
  const scan = scanSource(text);
  const specifiers = [];
  for (const [start, lit] of [...scan.literals.entries()].toSorted((a, b) => a[0] - b[0])) {
    const before = scan.code.slice(0, start).replace(/\s+$/, '');
    let how = null;
    if (/(?:^|[^$\w])from$/.test(before)) how = 'from';
    else if (/(?:^|[^$\w])import$/.test(before)) how = 'bare';
    else if (/(?:^|[^$\w])(?:import|require)\s*\($/.test(before)) how = 'dynamic';
    if (how === null) continue;
    specifiers.push({
      how,
      spec: lit.isLiteral ? String(lit.value) : null,
      literal: lit.isLiteral === true,
      kind: lit.kind,
      line: lineOf(text, start),
    });
  }
  return { specifiers, problems: scan.problems, code: scan.code };
}

/**
 * JSX opening tags in masked code. → [{ start, end, name, text }]
 * `name` is `''` for a fragment (`<>`). Attribute VALUES are already masked, so
 * no `>` can hide inside one; a generic (`<T>`) or a comparison can still look
 * like a tag, which is why this is used only to locate the root element and to
 * bound the `data-stub` search — never to count elements.
 */
export function jsxOpenTags(code) {
  const out = [];
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] !== '<') continue;
    const next = code[i + 1] ?? '';
    if (next !== '>' && !/[A-Za-z_$]/.test(next)) continue;
    const end = code.indexOf('>', i + 1);
    if (end === -1) break;
    const text = code.slice(i, end + 1);
    const name = /^<\s*([A-Za-z_$][\w$.:-]*)/.exec(text)?.[1] ?? '';
    out.push({ start: i, end, name, text });
    i = end;
  }
  return out;
}

/** The root element of a component: the first JSX opening tag after the first
 * `return`, or the first in the file when there is no `return` (the arrow form).
 * → the tag, or null when the file holds no JSX at all. */
export function rootTag(code) {
  const tags = jsxOpenTags(code);
  if (tags.length === 0) return null;
  const ret = /(?:^|[^$\w])return(?![$\w])/.exec(code);
  if (ret === null) return tags[0];
  return tags.find((t) => t.start > ret.index) ?? null;
}

/** Does a relative specifier resolve to a file on disk? → the path, or null. */
export function resolveRelative(root, fromRel, spec) {
  const dir = fromRel.includes('/') ? fromRel.slice(0, fromRel.lastIndexOf('/')) : '';
  const joined = resolve(join(root, dir), spec);
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${joined}${suffix}`;
    if (existsSync(candidate)) return candidate;
  }
  // TypeScript's own `.js` → `.ts` rewrite, which is how an ESM-correct import
  // of a TypeScript file is written.
  if (joined.endsWith('.js')) {
    for (const swap of ['.ts', '.tsx']) {
      const candidate = joined.replace(/\.js$/, swap);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Judge one file inside STUB_ROOT. → { fails, unknowns }
 *
 * The two lists are kept apart all the way up to the row rather than being
 * distinguished later by the words in a message: a status decided by searching a
 * string for "cannot verify" is a status that changes when somebody rewords a
 * sentence.
 */
function judgeStubFile(root, rel, text) {
  const problems = [];
  const { specifiers, problems: maskProblems, code } = importsOf(text);
  if (maskProblems.length)
    return {
      fails: [],
      unknowns: [`${rel}: the source could not be masked (${maskProblems.join('; ')}) — every path:line below it would be a guess, so nothing is claimed about this file`],
    };

  for (const s of specifiers) {
    const where = `${rel}:${String(s.line)}`;
    if (!s.literal) {
      problems.push(`${where}: a ${s.kind} specifier with a \`\${…}\` substitution cannot be resolved — a stub imports literal paths only, so that its imports can be followed`);
      continue;
    }
    if (s.spec.startsWith('.')) {
      if (resolveRelative(root, rel, s.spec) === null)
        problems.push(`${where}: import ${JSON.stringify(s.spec)} resolves to no file — write the file or remove the import (tried the specifier itself and ${RESOLVE_SUFFIXES.filter(Boolean).join(', ')})`);
      continue;
    }
    if (!ALLOWED_BARE.includes(s.spec))
      problems.push(`${where}: import ${JSON.stringify(s.spec)} — inside ${STUB_ROOT}/ the only non-relative specifiers are ${ALLOWED_BARE.map((x) => JSON.stringify(x)).join(' and ')} (rule 9: a stub takes its primitives from ${STUBKIT}, never from a domain module)`);
  }

  const arr = /\[\s*\{/.exec(code);
  if (arr !== null)
    problems.push(`${rel}:${String(lineOf(text, arr.index))}: a literal array of objects — a stub renders an honest empty state and never fabricated rows (rule 9); if this is configuration rather than data, move it out of ${STUB_ROOT}/`);

  // A helper under the stubs directory is legitimate; it is simply not a screen,
  // so claim 3 does not apply to it. `screen: false` is said out loud in the row
  // so a reader does not take the absence of a complaint for a verified marker.
  const top = rootTag(code);
  if (top !== null) {
    if (top.name === '')
      problems.push(`${rel}:${String(lineOf(text, top.start))}: the root element is a JSX fragment, which cannot carry ${STUB_ATTR} — wrap the screen in a real element`);
    else if (!new RegExp(`\\b${STUB_ATTR}\\b`).test(top.text))
      problems.push(`${rel}:${String(lineOf(text, top.start))}: the root element <${top.name}> does not carry ${STUB_ATTR} — add it, so a stub is identifiable in a rendered tree and in a test`);
  }
  return { fails: problems, unknowns: [], screen: top !== null };
}

/** A stub screen's two mechanical markers, looked for OUTSIDE STUB_ROOT. */
function stubMarkersOutside(rel, text) {
  const { specifiers, problems: maskProblems, code } = importsOf(text);
  if (maskProblems.length) return { marker: null, problems: maskProblems.map((p) => `${rel}: ${p}`) };
  const importsStubkit = specifiers.some((s) => s.literal && (s.spec === STUBKIT || s.spec.startsWith(`${STUBKIT}/`)));
  if (importsStubkit) return { marker: `imports ${STUBKIT}`, problems: [] };
  const attrRe = new RegExp(`\\b${STUB_ATTR}\\b`);
  const tag = jsxOpenTags(code).find((t) => attrRe.test(t.text));
  if (tag !== undefined) return { marker: `carries ${STUB_ATTR} on <${tag.name || '>'}> at line ${String(lineOf(text, tag.start))}`, problems: [] };
  return { marker: null, problems: [] };
}

export function run(ctx = {}) {
  const root = ctx.root ?? process.cwd();
  const visible = readVisible(root);
  const pkgs = readPackages(root);
  const stubkitPackage = pkgs.byName?.get(STUBKIT) ?? null;

  const stubAbs = join(root, STUB_ROOT);
  const stubDirExists = existsSync(stubAbs);
  const stubWalk = stubDirExists ? walk(root, { roots: [STUB_ROOT], exts: SOURCE_EXTS, visible }) : { files: [], problems: [], skipped: [] };

  // A walk problem (an unreadable directory, a symlink inside a judged tree) is
  // cannot-verify, not a fail: what it says is that part of the tree was not
  // looked at, and fail-closed means saying so rather than judging the rest.
  const unknowns = stubWalk.problems.map((p) => `${STUB_ROOT}: ${p}`);
  const problems = [];
  const notes = [];
  let screens = 0;

  // ---- the outside scan: a stub screen anywhere but STUB_ROOT
  const outside = walk(root, { roots: [...SOURCE_ROOTS], exts: SOURCE_EXTS, visible });
  unknowns.push(...outside.problems.map((p) => `${SOURCE_ROOTS.join('/, ')}/: ${p}`));
  const testRoots = Object.values(TEST_DIR);
  let scanned = 0;
  for (const rel of outside.files) {
    if (under(rel, STUB_ROOT)) continue;
    // A file under a test directory is collected by a runner, not rendered by
    // the app: its shapes are L-testshape's jurisdiction, and a test that
    // renders a stub would otherwise read as a misplaced screen.
    if (testRoots.some((t) => under(rel, t))) continue;
    scanned += 1;
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch (e) {
      unknowns.push(`${rel}: unreadable (${String(e.message)}) — a file a gate cannot read is never clean`);
      continue;
    }
    const found = stubMarkersOutside(rel, text);
    unknowns.push(...found.problems);
    if (found.marker !== null)
      problems.push(`${rel}: ${found.marker} — a stub screen lives under ${STUB_ROOT}/ and nowhere else (rule 9); move it there, or drop the marker if this is not a stub`);
  }

  // ---- the inside scan
  for (const rel of stubWalk.files) {
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch (e) {
      unknowns.push(`${rel}: unreadable (${String(e.message)})`);
      continue;
    }
    const judged = judgeStubFile(root, rel, text);
    problems.push(...judged.fails);
    unknowns.push(...judged.unknowns);
    if (judged.screen === true) screens += 1;
  }

  if (stubWalk.files.length > 0 && stubkitPackage === null)
    problems.push(
      `${STUB_ROOT}/ holds ${String(stubWalk.files.length)} file(s) and ${STUBKIT} is not a workspace package (pnpm-workspace.yaml enumerates ${String(pkgs.packages.length)}) — a stub that builds its primitives by hand is what rule 9 forbids; create packages/stubkit and declare it`,
    );

  if (pkgs.problems.length) notes.push(`workspace: ${pkgs.problems.join('; ')}`);
  if (!visible.ok) notes.push(`${visible.rel}: ${visible.problems.join('; ')} — the walk fell back to skipping nothing but self-hidden paths`);

  const where = stubDirExists
    ? `${STUB_ROOT}/: ${String(stubWalk.files.length)} file(s), ${String(screens)} of them a screen (a JSX root)`
    : `${STUB_ROOT}/ does not exist, so there is no stub screen to be dishonest — the path, marker, import and no-invented-data claims have nothing to stand on yet`;
  const head = `${where}; ${String(scanned)} source file(s) under ${SOURCE_ROOTS.join('/, ')}/ scanned for a misplaced stub; ${STUBKIT} ${stubkitPackage === null ? 'is not a workspace package' : `is ${stubkitPackage.rel}`}`;

  // A fail outranks a cannot-verify in the ROW (both block a hard light), and
  // both lists are printed either way: "part of the tree was not read" is not
  // news a reader may lose because something else was already red.
  const status = problems.length > 0 ? 'fail' : unknowns.length > 0 ? 'cannot-verify' : 'pass';
  return { id, severity, status, detail: [head, ...problems, ...unknowns, ...notes].join(' · ') };
}

// ------------------------------------------------------------------------- cli

/** `node tools/gates/lights/stubkit.mjs` — the command a spec's `## Lights` row
 * cites. One row, the pack's vocabulary, the pack's exit rule: a hard light that
 * is not `pass` exits 1. A refusal names the cure, never a stack trace. */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rr = repoRoot();
  if (!rr.ok) {
    console.error(`[${id}] REFUSED: not a git work tree (${rr.reason}) — the walk and the workspace reader both start at the repository root.`);
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
