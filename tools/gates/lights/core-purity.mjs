/**
 * L-core-purity — the boundary around `packages/core`, asserted at THREE levels
 * because each one sees something the other two cannot.
 *
 * Zero dependencies, Node 22 ESM. Levels 1 and 2 ask `tsc`; level 3 is a token
 * scan over masked source. NOTHING here parses TypeScript (ADR-0005).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * LEVEL 1 — THE DECLARATION. `lib`, `types`, and an EMPTY `dependencies`
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `packages/core/tsconfig.json` must carry `"lib": ["ES2023"]` and `"types": []`,
 * and `packages/core/package.json` must carry `"dependencies": {}` — present and
 * empty, not absent.
 *
 * This is the strongest of the three and the cheapest to lose. MEASURED: with
 * that lib and those types, `document.title` inside the package is
 * `error TS2584: Cannot find name 'document'` and `import { readFileSync } from
 * 'node:fs'` is `error TS2591`. The boundary is then the ABSENCE OF THE TYPE,
 * which no comment can disable — unlike a lint rule, which a file-level
 * `oxlint-disable` can. And the empty `dependencies` is what makes an undeclared
 * package import unresolvable at all: with pnpm's isolated linker this package
 * has no `node_modules` of its own, so `import 'react-dom/client'` here is
 * `error TS2307`, not a style problem.
 *
 * Both the RAW file and the EFFECTIVE config are checked. The raw file, because
 * a value inherited from `tsconfig.base.json` would mean the base could widen
 * the boundary for the whole repository with one edit nobody reads as a core
 * change. The effective config through `tsc --showConfig`, because `extends`
 * hides values and `--showConfig` is the only honest reader of what the compiler
 * will actually use — and it NORMALISES, so `["ES2023"]` comes back
 * `["es2023"]` and every comparison goes through `sameValue` (./tsc.mjs).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * LEVEL 2 — THE GRAPH. The hole neither the compiler nor the linter can see
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * MEASURED, and the reason this level exists: with
 * `packages/core/src/__esc.ts` importing `'../../../apps/api/src/index.ts'`,
 * `tsc --noEmit` exits 0 with ZERO diagnostics. The compiler is silent, the
 * dependency graph is silent (a relative path is not a package, so pnpm
 * isolation never comes into it) and the linter is silent. The only witness is
 * `--listFiles`, which lists `apps/api/src/index.ts` among the inputs.
 *
 * `resolveClosure('core')` (./_shared.mjs) partitions that listing, and its
 * `workspace` array — in-repo paths OUTSIDE the package — IS this level. It must
 * be empty. Two measured subtleties the partition already carries:
 *
 *  - THE LIB FILES ARE NOT IN `node_modules/typescript/lib/`. TypeScript 7 ships
 *    them in `@typescript/typescript-<platform>/lib/lib.*.d.ts`. A filter on the
 *    TS≤6 location matches zero lines, every lib file then reads as a path
 *    outside the package, and this level fails on a clean tree — or somebody
 *    "fixes" it by widening the filter to all of `node_modules`. `classifyLib`
 *    derives the platform segment; no platform name appears in this file.
 *  - `external` IS NOT A DEFECT. Measured on a clean tree, `packages/core`'s
 *    closure holds 26 external `.d.ts` files: the skeleton tests import
 *    `@jest/globals`, which comes with the root `jest` devDependency. A
 *    level that refused every path outside the package would fail here. What is
 *    refused is an IN-REPO path outside the package, and a `foreign` path with
 *    no `node_modules` segment — because `foreign` is also what externals look
 *    like in a checkout whose `node_modules` is a symlink (tsc reports
 *    realpaths), so the paths are judged and not the count.
 *
 * AND THE NUMERIC HALF. `inside` is compared as a SET against the tracked `.ts`
 * / `.tsx` files git lists under the two include roots. "I narrowed the include
 * and everything went green" is a real way to pass a type lane, and it is
 * invisible to every check that only reads what the compiler DID read. A tracked
 * source the compiler never opened is named here; so is an input the compiler
 * read that git does not track.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * LEVEL 3 — THE TOKEN SCAN. Determinism, and two refusals
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Scope: every `.ts` / `.tsx` under `packages/core/**`, TEST FILES INCLUDED. A
 * core spec test that read the clock would be exactly as non-deterministic as a
 * core source that did, and the test is the thing a spec cites.
 *
 * WHY THIS IS A LIGHT AND NOT A LINT RULE, measured and recorded in
 * `.oxlintrc.jsonc:21-27`: oxlint has NO `no-restricted-syntax`, so the precise
 * AST selector cannot be expressed; and a blanket `no-restricted-globals` on
 * `Date` / `Math` is the wrong shape — it refused `x instanceof Date` (a type
 * test), `new Date(0)` (a fixed value) and `Math.floor` (arithmetic), none of
 * which is a clock. So the ban is a four-item closed list over masked source:
 *
 *     FORBIDDEN   Date.now(   new Date()  with an EMPTY argument list
 *                 Math.random(   performance.now(
 *     ALLOWED     new Date(<anything>)   x instanceof Date   `Date` as a type
 *                 every other member of Math
 *
 * THE MASKING TRAP, and it would have made this scan wrong in the generous
 * direction. `codeOnly` replaces every string literal with SPACES, offsets
 * preserved — so `new Date('2026-01-01')` becomes `new Date(             )`,
 * which an empty-argument-list regex matches. The call SITE is therefore found
 * in the masked text (so a `new Date()` inside a comment or a string is not a
 * finding) and the argument list is then read from the RAW text (so a masked
 * literal is not mistaken for no argument at all). Both halves are needed; one
 * alone is wrong in one of the two directions.
 *
 * Two refusals ride along, because both make a scan of this package meaningless:
 *  - A NESTED `package.json` OR `tsconfig*.json` anywhere under `packages/core`
 *    other than the package's own two. A nested manifest would give part of the
 *    pure layer its own dependencies, and a nested tsconfig would give it its
 *    own `lib` — level 1 would still pass while reading the wrong file.
 *  - A NON-LITERAL `import(expr)`. A dynamic specifier the compiler cannot
 *    resolve statically is a path `--listFiles` never lists, so level 2 would
 *    report a clean closure over a module that is loaded anyway.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * NO MODULE-LEVEL PREMISE, ON PURPOSE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Level 3 needs nothing installed, so this module does NOT declare
 * `premises: ['tsc']` — `lights/run.mjs` would then refuse the whole row before
 * `run` was called, and `--thin` would lose the one level that works in a
 * checkout with no `node_modules`. Levels 1 and 2 ask `requirePremise`
 * themselves and report the missing premise BY NAME, which is cannot-verify and
 * blocks: a level that did not run is not a level that passed.
 */

import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { lsFiles } from '../lib/git.mjs';
import { KIND_ROOT } from '../lib/test-file-patterns.mjs';
import { readPackages, readVisible, requirePremise, resolveClosure, scanSource, walk } from './_shared.mjs';
import { cite, readJsoncFile, sameValue, showConfig, tsconfigRelOf } from './tsc.mjs';

export const id = 'L-core-purity';
export const severity = 'hard';

/** The pure package, from the one KINDS→root table. */
const CORE = KIND_ROOT.core;
const CORE_TSCONFIG = tsconfigRelOf('core');
const CORE_MANIFEST = `${CORE}/package.json`;

/** The two roots `packages/core/tsconfig.json` includes — the level-2 numeric
 * comparison is against exactly these, because they are what the include names. */
const INCLUDE_ROOTS = Object.freeze([`${CORE}/src`, `${CORE}/test`]);

/** Level 1's pinned values, compared case-insensitively against the effective
 * config AND required in the package's own tsconfig. */
const LEVEL1_TSCONFIG = Object.freeze([
  { key: 'lib', expect: ['ES2023'], why: 'no "DOM" in lib is why `document` and `window` do not typecheck here at all' },
  { key: 'types', expect: [], why: 'no ambient types is why `process`, `require` and `node:*` do not typecheck here at all' },
]);

/**
 * The CLOSED list of hidden-clock and hidden-randomness tokens. Closed is the
 * point: adding one is a declared change to this file, not a configuration
 * knob, and a reader can see the whole ban in four lines.
 *
 * `newDateEmpty` is not a plain token — see the masking trap in the header.
 */
const BANNED_TOKENS = Object.freeze([
  { name: 'Date.now(', re: /\bDate\s*\.\s*now\s*\(/g, cure: 'take the instant as an argument: time enters packages/core through a parameter, never through a call' },
  { name: 'Math.random(', re: /\bMath\s*\.\s*random\s*\(/g, cure: 'take the randomness as an argument (a seed or a pre-drawn value); every other member of Math is allowed' },
  { name: 'performance.now(', re: /\bperformance\s*\.\s*now\s*\(/g, cure: 'take the instant as an argument; a monotonic clock is still a clock' },
]);

/** `new Date(` — the call site. Whether its argument list is empty is decided
 * from the RAW text, not from this match. */
const NEW_DATE_RE = /\bnew\s+Date\s*\(/g;

/** A dynamic import. The lookbehind keeps `foo.import(` and an identifier
 * ending in `import` out; `import.meta` has no `(` after the word, so it never
 * reaches here. */
const DYNAMIC_IMPORT_RE = /(?<![.\w$])import\s*\(/g;

/** Nested configuration that would make level 1 read the wrong file. */
const NESTED_CONFIG_RE = /^(package\.json|tsconfig(\.[A-Za-z0-9._-]+)?\.json)$/;

// ------------------------------------------------------------------- helpers

/** 1-based line of an offset. Local on purpose: it is three lines of counting,
 * not a reader of a repository fact, and `scanSource` keeps every offset on its
 * original line precisely so this works. */
function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/** The matching `)` for the `(` at `open`, by depth, over MASKED text — where a
 * string literal is spaces and therefore cannot hold an unbalanced paren. */
function matchParen(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// -------------------------------------------------------------------- level 1

export function level1(root, premises) {
  const problems = [];
  const notes = [];

  const raw = readJsoncFile(root, CORE_TSCONFIG);
  if (!raw.ok) problems.push(`${CORE_TSCONFIG}: ${raw.reason} — level 1 reads this file to prove the boundary is declared by the package itself`);
  else {
    const co = raw.data?.compilerOptions;
    for (const pin of LEVEL1_TSCONFIG) {
      if (co === null || typeof co !== 'object' || !Object.hasOwn(co, pin.key)) {
        problems.push(
          `${CORE_TSCONFIG}: "compilerOptions.${pin.key}" is not set BY THIS FILE — add "${pin.key}": ${JSON.stringify(pin.expect)}; inheriting it from tsconfig.base.json would let one edit to the base widen the core boundary for the whole repository (${pin.why})`,
        );
        continue;
      }
      if (!sameValue(co[pin.key], pin.expect))
        problems.push(`${cite(CORE_TSCONFIG, raw.text ? lineOfKey(raw.text, pin.key) : null)}: "${pin.key}" is ${JSON.stringify(co[pin.key])}, pinned to ${JSON.stringify(pin.expect)} — set it back; ${pin.why}`);
    }
  }

  const prem = requirePremise(premises, 'tsc');
  if (!prem.ok) notes.push(`level 1 effective-config half SKIPPED: ${prem.reason}`);
  else {
    const eff = showConfig(root, CORE_TSCONFIG, premises);
    if (!eff.ok) problems.push(`${CORE_TSCONFIG}: the effective config could not be read, so level 1 asserted only the raw file — ${eff.reason}`);
    else {
      const co = eff.data?.compilerOptions ?? null;
      for (const pin of LEVEL1_TSCONFIG) {
        if (co === null || !Object.hasOwn(co, pin.key)) problems.push(`${CORE_TSCONFIG}: tsc --showConfig reports no "${pin.key}" at all — the effective boundary is not what the file says`);
        else if (!sameValue(co[pin.key], pin.expect))
          problems.push(`${CORE_TSCONFIG}: tsc --showConfig reports "${pin.key}": ${JSON.stringify(co[pin.key])} while the pin is ${JSON.stringify(pin.expect)} — something in the extends chain overrides the package's own declaration`);
      }
      notes.push(`effective lib/types read from tsc --showConfig`);
    }
  }

  const pkgs = readPackages(root);
  const core = pkgs.byDir.get(CORE) ?? null;
  if (core === null) problems.push(`${CORE_MANIFEST}: no workspace package at ${CORE} (${pkgs.problems.join('; ') || 'readPackages found none'}) — there is no package to judge`);
  else if (!Object.hasOwn(core.raw, 'dependencies'))
    problems.push(
      `${CORE_MANIFEST}: no "dependencies" key — write it as "dependencies": {}; the EMPTY OBJECT is the carrier of the boundary (with pnpm's isolated linker this package then has no node_modules at all, so an undeclared import does not resolve), and an absent key says nothing`,
    );
  else if (core.raw.dependencies === null || typeof core.raw.dependencies !== 'object' || Array.isArray(core.raw.dependencies))
    problems.push(`${CORE_MANIFEST}: "dependencies" is ${JSON.stringify(core.raw.dependencies)}, not an object`);
  else if (Object.keys(core.raw.dependencies).length !== 0)
    problems.push(
      `${CORE_MANIFEST}: "dependencies" declares ${Object.keys(core.raw.dependencies).join(', ')} — packages/core depends on nothing (rule 1); move the adapter to apps/ and keep this object empty`,
    );
  else notes.push(`${CORE_MANIFEST} dependencies: {}`);

  return { problems, notes };
}

/** First occurrence of a quoted key in a text, 1-based. A local helper rather
 * than `jsonLine` with a different name: it answers the same question for the
 * same reason and is imported from `_shared` by `tsc.mjs`; here the text is
 * already in hand. */
function lineOfKey(text, key) {
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i += 1) if (lines[i].includes(`"${key}"`)) return i + 1;
  return null;
}

// -------------------------------------------------------------------- level 2

export function level2(root, premises) {
  const problems = [];
  const notes = [];

  const prem = requirePremise(premises, 'tsc');
  if (!prem.ok) return { problems: [`level 2 (the loaded-file graph) did NOT run: ${prem.reason} — the only witness of a relative path out of the package is tsc --listFiles, so this level cannot be answered without it`], notes };

  const c = resolveClosure('core', { root, premises });
  if (!c.ok) return { problems: [`level 2: the closure of ${CORE_TSCONFIG} could not be read — ${c.reason}`], notes };

  for (const w of c.workspace)
    problems.push(
      `${w.rel} is an IN-REPO input of ${CORE_TSCONFIG} from outside ${CORE}${w.owner === null ? '' : ` (owned by ${w.owner})`} — delete the import that reaches it; a relative path out of this package typechecks clean with exit 0 and no diagnostic (measured), so tsc --listFiles is the only thing that sees it`,
    );

  const foreignNonModule = c.foreign.filter((p) => !p.split('/').includes('node_modules'));
  for (const f of foreignNonModule)
    problems.push(`${f} is an input of ${CORE_TSCONFIG} from outside the repository and is not under any node_modules — name what it is or remove the import; a path nobody in this repository owns cannot be judged`);

  // The numeric half.
  const tracked = lsFiles(INCLUDE_ROOTS, { cwd: root });
  if (!tracked.ok) problems.push(`level 2 numeric half: git ls-files failed (${tracked.reason})`);
  else {
    const trackedTs = tracked.files.filter((f) => f.endsWith('.ts') || f.endsWith('.tsx')).toSorted();
    const onDisk = walk(root, { roots: INCLUDE_ROOTS, exts: ['.ts', '.tsx'], visible: readVisible(root) });
    if (trackedTs.length === 0 && onDisk.files.length > 0)
      problems.push(
        `level 2 numeric half CANNOT VERIFY: git tracks no .ts under ${INCLUDE_ROOTS.join(' or ')} while ${onDisk.files.length} file(s) are on disk — the comparison is against the index, so stage or commit them (git add -A); without it "I narrowed the include and everything went green" is invisible`,
      );
    else {
      const insideSet = new Set(c.inside);
      const missed = trackedTs.filter((f) => !insideSet.has(f));
      const untracked = c.inside.filter((f) => !trackedTs.includes(f));
      if (missed.length)
        problems.push(
          `${missed.length} tracked source(s) under ${CORE} that the compiler NEVER READ: ${missed.join(', ')} — widen "include" in ${CORE_TSCONFIG} or delete the files; a source outside the type project is a source no lane judges`,
        );
      if (untracked.length) notes.push(`${untracked.length} input(s) the compiler read and git does not track: ${untracked.join(', ')}`);
      if (!missed.length) notes.push(`level 2 numeric: ${c.inside.length} input(s) == ${trackedTs.length} tracked .ts/.tsx under ${INCLUDE_ROOTS.join(' + ')}`);
    }
  }

  notes.push(`closure: ${c.inside.length} inside · ${c.workspace.length} in-repo elsewhere · ${c.external.length} external · ${c.foreign.length} foreign · ${c.libs.length} lib (${c.libLayouts.join(',')})`);
  return { problems, notes };
}

// -------------------------------------------------------------------- level 3

export function level3(root) {
  const problems = [];
  const notes = [];

  if (!existsSync(join(root, CORE)))
    return { problems: [`${CORE} does not exist — there is no pure package to scan`], notes };

  // The nested-configuration refusal covers the whole package, not only `src`:
  // a nested manifest under `test/` would give the spec tests their own
  // dependencies, which is the same defect one directory over.
  const all = walk(root, { roots: [CORE], visible: readVisible(root) });
  for (const p of all.problems) problems.push(`${CORE}: ${p}`);
  for (const f of all.files) {
    const name = f.split('/').at(-1) ?? '';
    if (!NESTED_CONFIG_RE.test(name)) continue;
    if (f === CORE_MANIFEST || f === CORE_TSCONFIG) continue;
    problems.push(
      `${f}: REFUSED — a nested ${name} under ${CORE}; delete it and keep the package's declaration in ${CORE_MANIFEST} and ${CORE_TSCONFIG} alone, because level 1 would keep passing while reading the wrong file`,
    );
  }

  const sources = all.files.filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
  let scanned = 0;
  const found = [];

  for (const rel of sources) {
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch (e) {
      problems.push(`${rel}: unreadable (${String(e.message)}) — a file the scan could not read is CANNOT VERIFY, not clean`);
      continue;
    }
    const s = scanSource(text);
    for (const p of s.problems)
      problems.push(`${rel}: the mask itself may be wrong (${p}) — this file cannot be token-scanned, so it is not clean`);
    if (s.problems.length) continue;
    scanned += 1;
    const code = s.code;

    for (const ban of BANNED_TOKENS) {
      ban.re.lastIndex = 0;
      let m;
      while ((m = ban.re.exec(code)) !== null) found.push(`${rel}:${lineAt(text, m.index)} ${ban.name} — ${ban.cure}`);
    }

    NEW_DATE_RE.lastIndex = 0;
    let m;
    while ((m = NEW_DATE_RE.exec(code)) !== null) {
      const open = code.indexOf('(', m.index);
      const close = matchParen(code, open);
      if (close === -1) {
        problems.push(`${rel}:${lineAt(text, m.index)}: a \`new Date(\` whose argument list never closes — the file cannot be scanned`);
        continue;
      }
      // THE RAW slice, not the masked one: a masked string literal is spaces,
      // so `new Date('2026-01-01')` would read as an empty argument list.
      const rawArgs = text.slice(open + 1, close);
      if (rawArgs.trim() === '')
        found.push(
          `${rel}:${lineAt(text, m.index)} new Date() with an empty argument list — pass the instant in (new Date(<value>) is allowed, and so are \`instanceof Date\` and \`Date\` as a type); the clock enters packages/core as an argument`,
        );
    }

    DYNAMIC_IMPORT_RE.lastIndex = 0;
    while ((m = DYNAMIC_IMPORT_RE.exec(code)) !== null) {
      const open = code.indexOf('(', m.index);
      const close = matchParen(code, open);
      if (close === -1) {
        problems.push(`${rel}:${lineAt(text, m.index)}: an \`import(\` whose argument list never closes — the file cannot be scanned`);
        continue;
      }
      let k = open + 1;
      while (k < close && /\s/.test(code[k])) k += 1;
      const lit = s.literals.get(k);
      const literal = lit !== undefined && lit.kind === 'quoted' && lit.isLiteral === true && lit.end >= close - 1;
      if (!literal)
        problems.push(
          `${rel}:${lineAt(text, m.index)}: REFUSED — a non-literal import(${text.slice(open + 1, Math.min(close, open + 41)).trim()}); write the specifier as a string literal, because a specifier tsc cannot resolve statically never appears in --listFiles and level 2 would report a clean closure over a module that is loaded anyway`,
        );
    }
  }

  notes.push(`level 3 scanned ${scanned}/${sources.length} source(s) under ${CORE} (test/** included) for ${[...BANNED_TOKENS.map((b) => b.name), 'new Date()'].join(', ')}`);
  return { problems: [...problems, ...found], notes };
}

// -------------------------------------------------------------------- the run

export function run(ctx) {
  const { root, premises } = ctx;
  const problems = [];
  const notes = [];

  for (const level of [level1(root, premises), level2(root, premises), level3(root)]) {
    problems.push(...level.problems);
    notes.push(...level.notes);
  }

  const summary = [...new Set(notes)].join(' · ');
  if (problems.length === 0) return { id, severity, status: 'pass', detail: `three levels pass · ${summary}` };

  // A level that could not run is cannot-verify, and it blocks exactly as a
  // failure does; a level that ran and found something is a failure. The two
  // are distinguished by the words `did NOT run` / `SKIPPED` / `CANNOT VERIFY`
  // the level itself used, so the row says which of the two it is.
  const unrun = problems.filter((p) => /did NOT run|CANNOT VERIFY|could not be read|unreadable|may be wrong/.test(p));
  const status = unrun.length === problems.length ? 'cannot-verify' : 'fail';
  return { id, severity, status, detail: `${problems.length} problem(s): ${problems.join(' || ')} · ${summary}` };
}
