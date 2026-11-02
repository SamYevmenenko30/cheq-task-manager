/**
 * L-orphans — nothing in this repository is reachable by NOBODY, and nothing is
 * reachable TWICE.
 *
 * Zero dependencies, Node 22 ESM. Nothing here parses TypeScript: the reach of
 * the compiler is asked of the compiler (`resolveClosure` → `tsc --listFiles`),
 * the reach of the runner is asked of the runner (`jest --listTests --json`), and the
 * only thing read out of a source file is a MODULE SPECIFIER, taken from the
 * literal table `scanSource` already builds (`../lib/test-cases.mjs`) rather
 * than from a second scanner of this module's own.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE FOUR CLAUSES, AND WHAT EACH ONE NEEDS INSTALLED
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. NO ORPHAN SOURCE, IN TWO HALVES THAT ANSWER DIFFERENT QUESTIONS.
 *
 *    1a THE COMPILER READ IT: every tracked `.ts`/`.tsx` under a package's
 *    `src/` appears in that package's own `--listFiles` closure. A file the
 *    compiler never read is a file no type verdict covers: it can hold anything
 *    and the green row above it is about other files. The reverse is reported
 *    too — a path the compiler DID read under `src/` that git does not track
 *    exists on this machine and in no clone.
 *    NEEDS: the `tsc` premise.
 *
 *    1b SOMETHING IMPORTS IT: every tracked `.ts`/`.tsx` under `src/` is reached
 *    from one of the package's DECLARED ENTRY POINTS by the static import graph.
 *
 *    Both halves are here because 1a alone would be close to a tautology, and
 *    saying so is the point: the include in every tsconfig of this repository is
 *    the GLOB `src/**` (packages/core/tsconfig.json:11), so membership in the
 *    closure means "the include covers it" and not "something imports it". What
 *    1a therefore catches is a file the project does NOT typecheck — the wrong
 *    extension for its include (a `.tsx` under `packages/core`, whose include
 *    reaches only the `.ts` files of `src`), a narrowed include, an `exclude`, a
 *    file in the wrong directory. What it cannot catch is the file nobody
 *    imports, which is what the word orphan means, and that is the question 1b
 *    asks — of the import graph, seeded at the entry points, needing no premise.
 *
 *    1b reports a module no entry point reaches, and it says whether a TEST
 *    reaches it, because those are two different repairs: a module nothing
 *    imports is dead, while a module only a test imports is a helper living on
 *    the production side of the package.
 *
 * 2. ONE RUNNER PER TEST FILE — every `*.test.ts(x)` is collected by exactly one
 *    BAND of Jest projects. Zero bands means a test file that never runs and
 *    nothing says so; two bands mean one file judged twice with no declaration
 *    of which verdict is the record.
 *
 *    THE PARITY BAND IS NOT AN EXCEPTION, IT IS A COMPUTED GROUP. `core` and
 *    `core-dom` share `root` and `include` on purpose — the same files in node
 *    and in jsdom, which is the one honest parity lane here and what
 *    `L-env-parity` diffs. So this clause does not count PROJECTS, it counts
 *    bands: projects grouped by `(dir, extensions)` from the table in
 *    `../lib/test-project.mjs`. A file matching `core` and `core-dom` matches
 *    ONE band and is correct; a file matching `core` and `web` matches two and
 *    is a fail. Nothing is special-cased by name, so a third environment added
 *    to the same files joins the band by itself and a project aimed at somebody
 *    else's files is caught the day it is written.
 *
 *    That table is a DECLARATION of what `jest.config.mjs` says
 *    (test-project.mjs:16-25 names this light as the one that compares them), so
 *    this clause also reads the config — see the next section — and, when the
 *    runner is installed, asks the runner itself which files it collects.
 *
 * 3. ONE PUBLIC PATH PER MODULE — the `exports` subpaths of a package are
 *    disjoint: no module's exports reach the outside world through two of them.
 *    Two names for one symbol means two ways to import it, two things a spec
 *    test could assert against, and no statement of which is the surface.
 *
 * 4. THE TESTING SURFACE IS ITS OWN SUBPATH — a package that ships test helpers
 *    (`src/testing/`) exposes them under a subpath of their own, and `.` does not
 *    reach them. A production bundle that can import the digest helper by
 *    importing the package is a boundary nobody declared.
 *
 * Clauses 2, 3 and 4 need nothing installed; clause 2's corroboration does.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHICH TREE THIS LIGHT JUDGES, AND WHY `git ls-files` IS NOT "READING THE INDEX"
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * The TRACKED SET comes from `git ls-files` (`../lib/git.mjs`). Every piece of
 * CONTENT judged — the closure, the specifiers, the manifests — comes from the
 * WORK TREE, which is the same tree `tsc` just read. The rule a range-based gate
 * obeys (read HEAD through `git show`, never the index, or a hook goes green on
 * an uncommitted edit) is about judged CONTENT, and this light reads none from
 * the index: `git show :<path>` appears nowhere here. It asks git one question —
 * which paths does this repository know about — because that is the difference
 * between a source file and a scratch file somebody left in `src/`, and no
 * commit range can answer it about the tree the compiler read.
 *
 * AN EMPTY TRACKED SET IS NOT AN EMPTY REPOSITORY. Before the first `git add`
 * the answer is zero paths, and four clauses over zero files would pass. So the
 * file set FALLS BACK to the work-tree walk, the substitution is named in the
 * detail, and the row is cannot-verify even when every clause is satisfied: a
 * violation found this way is still a violation and is still reported as a fail,
 * but "nothing was tracked" is never green.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE CONFIG IS SCANNED, NOT PARSED — AND A SCAN THAT READ NOTHING FAILS CLOSED
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `jest.config.mjs` is JavaScript, and a gate here does not parse the language
 * it judges. What it does instead: `scanSource` masks comments and hands back
 * every string literal with its offset, and each literal is attributed to the
 * key immediately before it (`name:`, `root:`, `environment:`, `include: [`).
 * Masking first is what makes this honest — the config's own prose mentions
 * `core` and `core-dom`, and a raw-text scan would read a comment as a
 * declaration.
 *
 * The grouping assumption is stated so it can fail loudly: a `name:` literal
 * OPENS a project block and the keys after it belong to that block. A block that
 * does not yield all of name/root/environment/include, or an `include` outside
 * the two measured pattern forms, is cannot-verify naming what could not be
 * read — never a pass, and never a silent fallback to the table the config is
 * supposed to be checked against.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE RUNNER'S OWN ANSWER, AND THE MEASURED TRAP IN IT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `jest --selectProjects <p> --listTests --json` exits 0 and prints the test FILES it
 * `projectName` and an ABSOLUTE `file` (measured 2026-11-01). That is the
 * runner's own collection, and it is a stronger answer about "which project
 * collects this file" than any matcher written here. It is therefore asked
 * whenever the `jest` premise is present, and a disagreement with the matcher
 * is cannot-verify rather than a note: if the two disagree, the matcher's answer
 * for every OTHER file is of unknown worth as well.
 *
 * `file` is absolute and is relativised against the root before comparison —
 * comparing it with a path from git directly matches nothing, every time.
 *
 * Case NAMES are not read here, which spares this light the double-escaping the
 * list applies to a quote inside a name (measured: the list gives `\"abc\"`
 * where the XML gives `"abc"`); only `file` and `projectName` are used, and
 * neither is escaped.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE HOLE IN CLAUSE 3, NAMED RATHER THAN PAPERED OVER
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * A re-export is traceable when it is written as one: `export { x } from './a'`
 * carries the module in the statement. The form `import { x } from './a';
 * export { x };` puts the same symbol on the same surface and a token scan
 * CANNOT follow it — the link is a binding, and following bindings is a parse.
 *
 * So the closure follows `export … from` edges, and the untraceable form is
 * REFUSED in a barrel instead of being guessed at: an `exports` target that
 * re-exports through a bare `export { … }` is a fail whose cure is to write it
 * as `export { … } from './a'`. The rule is narrow — it applies to the handful
 * of files a package names in `exports`, not to ordinary modules — and it is
 * what keeps the public surface of a package readable without a parser.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { lsFiles } from '../lib/git.mjs';
import { PROJECTS, PROJECT_NAMES } from '../lib/test-project.mjs';
import { normRel, readPackages, readVisible, relPosix, requirePremise, resolveClosure, scanSource, sh, under, walk } from './_shared.mjs';

export const id = 'L-orphans';
export const severity = 'hard';

/**
 * NO `premises` export on purpose. `run.mjs` refuses a light by a declared
 * premise before `run` is called, which would cost clauses 2, 3 and 4 — all of
 * which run with nothing installed — whenever the compiler is absent. Each
 * clause asks for what it needs and says which one went unreached.
 */

/** The directory inside a package that holds its sources. */
const SRC = 'src';

/** The directory inside a package whose exports must live on their own subpath. */
const TESTING = 'src/testing';

/** The config this light compares the project table against. */
export const CONFIG_REL = 'jest.config.mjs';

/** Extensions a module specifier may be resolved to, in probe order. `./App`
 * resolving to `App.tsx` is in this tree, so the bare form is not optional. */
const RESOLVE_SUFFIXES = Object.freeze(['', '.ts', '.tsx', '/index.ts', '/index.tsx']);

/**
 * Where a package's import graph is seeded when its manifest declares no
 * `exports`. An app has an entry nobody writes in package.json —
 * `apps/web/index.html` names `src/main.tsx` in a script tag — so the
 * conventional names are probed and EVERY one that exists becomes a seed. A
 * package with none of them, and no `exports`, has no declared entry at all and
 * clause 1b is cannot-verify for it rather than failing every file it holds.
 */
const ENTRY_CANDIDATES = Object.freeze(['src/main.tsx', 'src/main.ts', 'src/index.tsx', 'src/index.ts']);

/** Suffixes that make a file a runner-collected test by name alone, taken from
 * the project table so this light holds no second list. */
const TEST_SUFFIXES = Object.freeze([...new Set(PROJECT_NAMES.flatMap((p) => (PROJECTS[p].runner === 'jest' ? PROJECTS[p].extensions : [])))]);

/** A source file a type project is expected to have read. */
/**
 * `<pkg>/src/contracts/CHQ-nnn/<file>` — the one place a spec's `contracts: allowed` front matter
 * lets the TEST phase put types on the production side of a package. The id is matched in full so
 * a directory merely called `contracts` is not covered.
 */
const SPEC_CONTRACT_RE = /(?:^|\/)src\/contracts\/CHQ-\d{3}\/[^/]+$/;

const SOURCE_SUFFIXES = Object.freeze(['.ts', '.tsx']);

const sortStr = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

/** The 1-based line of an offset, so every message can cite `path:line`. */
const lineOf = (text, offset) => String(text).slice(0, Math.max(0, offset)).split('\n').length;

// ------------------------------------------------------------ module specifiers

/** How far back the attribution regexes look. A bound, not a guess: every form
 * below is a statement head, and a 400-character window holds the longest
 * import clause anybody writes while keeping the anchored match cheap. */
const LOOKBEHIND = 400;

const RE_REEXPORT = /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+[A-Za-z_$][\w$]*)?|\{[^}]*\})\s+from\s*$/;
const RE_IMPORT_FROM = /\bimport\s+(?:type\s+)?[^;]*?\bfrom\s*$/;
const RE_IMPORT_BARE = /\bimport\s*$/;
const RE_IMPORT_DYNAMIC = /\bimport\s*\(\s*$/;
/** `export { x }` with no `from`: the untraceable re-export form — see the header. */
const RE_EXPORT_LOCAL = /\bexport\s+(?:type\s+)?\{[^}]*\}/g;

/**
 * Every module specifier in one source, with the role it plays.
 *
 * → { ok, problems, specifiers: [{ spec, role, line }], exportLocals: [{ line, text }] }
 *
 * `role` is `reexport | import | bare | dynamic`. The literal table comes from
 * `scanSource`, so a specifier inside a comment or inside another string is not
 * one — and the masked text is what the attribution regexes run against, which
 * is why `[^;]*?` in RE_IMPORT_FROM cannot swallow a quoted `;`.
 */
export function readSpecifiers(text) {
  const scan = scanSource(String(text));
  const problems = scan.problems.map((p) => `the source mask may be wrong (${p}) — nothing below is derived from it`);
  const specifiers = [];
  for (const lit of [...scan.literals.values()].toSorted((a, b) => a.start - b.start)) {
    if (lit.kind !== 'quoted' || !lit.isLiteral || typeof lit.value !== 'string') continue;
    const before = scan.code.slice(Math.max(0, lit.start - LOOKBEHIND), lit.start);
    let role = null;
    if (RE_REEXPORT.test(before)) role = 'reexport';
    else if (RE_IMPORT_DYNAMIC.test(before)) role = 'dynamic';
    else if (RE_IMPORT_FROM.test(before)) role = 'import';
    else if (RE_IMPORT_BARE.test(before)) role = 'bare';
    if (role === null) continue;
    specifiers.push({ spec: lit.value, role, line: lineOf(text, lit.start) });
  }
  const exportLocals = [];
  RE_EXPORT_LOCAL.lastIndex = 0;
  let m;
  while ((m = RE_EXPORT_LOCAL.exec(scan.code)) !== null) {
    // `export { … } from '…'` matches this pattern too, and that form is
    // already a traceable edge: only the bare one is the untraceable kind.
    if (!/^\s*from\b/.test(scan.code.slice(m.index + m[0].length))) exportLocals.push({ line: lineOf(text, m.index), text: m[0].replace(/\s+/g, ' ').trim() });
    if (m.index === RE_EXPORT_LOCAL.lastIndex) RE_EXPORT_LOCAL.lastIndex += 1;
  }
  return { ok: problems.length === 0, problems, specifiers, exportLocals };
}

/** Resolve a RELATIVE specifier against the file that wrote it. → repo-relative
 * path, or null when nothing on disk answers to it. A package specifier returns
 * null too and is never an orphan question — `L-graph` owns those edges. */
export function resolveRelative(root, fromRel, spec) {
  if (!spec.startsWith('.')) return null;
  const dir = fromRel.includes('/') ? fromRel.slice(0, fromRel.lastIndexOf('/')) : '';
  const parts = `${dir}/${spec}`.split('/');
  const stack = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  const base = stack.join('/');
  const candidates = base.endsWith('.js') ? [base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), base] : RESOLVE_SUFFIXES.map((s) => `${base}${s}`);
  for (const c of candidates) {
    const abs = join(root, c);
    try {
      if (existsSync(abs) && statSync(abs).isFile()) return c;
    } catch {
      // An unreadable candidate is not a resolution; the next one is tried and
      // an exhausted list answers null, which the caller reports as a problem.
    }
  }
  return null;
}

/**
 * Every module reachable from `seeds` by STATIC relative specifiers.
 *
 * → { reached: Set<string>, unresolved: [{ from, line, spec }], unreadable: [] }
 *
 * `roles` picks which edges to follow: clause 1b follows every static form a
 * bundler follows, while a barrel closure follows `reexport` alone. A
 * non-relative specifier is a package edge and belongs to `L-graph`; a
 * non-literal `import(expr)` is invisible to a token scan and is refused in the
 * core by `L-core-purity`, so neither is this function's business.
 */
export function importGraph(root, seeds, { roles = ['import', 'reexport', 'bare', 'dynamic'], cache = new Map() } = {}) {
  const reached = new Set();
  const unresolved = [];
  const unreadable = [];
  const queue = [...seeds];
  while (queue.length > 0) {
    const rel = queue.shift();
    if (reached.has(rel)) continue;
    reached.add(rel);
    let read = cache.get(rel);
    if (read === undefined) {
      try {
        read = readSpecifiers(readFileSync(join(root, rel), 'utf8'));
      } catch (e) {
        unreadable.push(`${rel}: ${String(e.message)}`);
        continue;
      }
      cache.set(rel, read);
    }
    for (const s of read.specifiers) {
      if (!roles.includes(s.role) || !s.spec.startsWith('.')) continue;
      const resolved = resolveRelative(root, rel, s.spec);
      if (resolved === null) unresolved.push({ from: rel, line: s.line, spec: s.spec });
      else queue.push(resolved);
    }
  }
  return { reached, unresolved, unreadable };
}

// ------------------------------------------------------------- the config scan

const INCLUDE_SINGLE_RE = /^([\w./-]+)\/\*\*\/\*(\.[\w.]+)$/;
const INCLUDE_BRACED_RE = /^([\w./-]+)\/\*\*\/\*\.([\w.]+)\.\{([\w,]+)\}$/;

/** One `include` pattern → `{ prefix, extensions }`, or null when the pattern is
 * outside the two forms measured in this config. Null is cannot-verify at the
 * call site: a pattern nobody parsed matches whatever it likes. */
export function parseInclude(pattern) {
  // Jest writes a project's `testMatch` against its own `rootDir` and spells that
  // with a token: `<rootDir>/test/**/*.test.ts`. The previous runner's `include`
  // was already relative to the project root and carried no token, so the two
  // forms below never saw one — and every pattern read as unknown, which made the
  // light report four test files across ZERO collection bands. Stripping the
  // token is the whole difference; what follows it is the same shape.
  pattern = String(pattern ?? '').replace(/^<rootDir>\//, '');
  const braced = INCLUDE_BRACED_RE.exec(pattern);
  if (braced) {
    const [, prefix, middle, list] = braced;
    return { prefix, extensions: list.split(',').map((e) => `.${middle}.${e}`) };
  }
  const single = INCLUDE_SINGLE_RE.exec(pattern);
  if (single) return { prefix: single[1], extensions: [single[2]] };
  return null;
}

/**
 * The project blocks `jest.config.mjs` declares, read by attributing each
 * string literal to the key before it. → { ok, reason, blocks }
 *
 * `blocks` is `[{ name, root, environment, includes: [string], line }]`.
 */
export function scanConfig(text) {
  const scan = scanSource(String(text));
  const blocks = [];
  let current = null;
  for (const lit of [...scan.literals.values()].toSorted((a, b) => a.start - b.start)) {
    if (lit.kind !== 'quoted' || !lit.isLiteral || typeof lit.value !== 'string') continue;
    const before = scan.code.slice(Math.max(0, lit.start - 80), lit.start);
    const line = lineOf(text, lit.start);

    // The key this literal belongs to: either immediately before it, or — for
    // the second and later element of an array — the key that opened the array.
    const direct = /\b(displayName|rootDir|testEnvironment|testMatch|setupFilesAfterEnv)\s*:\s*(?:\[\s*)?$/.exec(before);
    let which = null;
    if (direct !== null) which = direct[1];
    else if (/\btestMatch\s*:\s*\[[^\]]*$/.test(before)) which = 'testMatch';
    else if (/\bsetupFilesAfterEnv\s*:\s*\[[^\]]*$/.test(before)) which = 'setupFilesAfterEnv';

    if (which === 'displayName') {
      current = { name: lit.value, root: null, environment: null, includes: [], line };
      blocks.push(current);
      continue;
    }
    if (current === null) continue;
    if (which === 'rootDir') current.root = lit.value;
    else if (which === 'testEnvironment') current.environment = lit.value;
    else if (which === 'testMatch') current.includes.push(lit.value);
  }
  if (blocks.length === 0)
    return {
      ok: false,
      reason:
        `no \`displayName: '<project>'\` literal was read out of ${CONFIG_REL} — this is a token scan over masked source, not a parse, ` +
        'so a config whose shape changed reads as empty rather than as agreeing with the project table; the cure is to add the new shape to scanConfig()',
      blocks,
    };
  const bad = blocks.filter((b) => b.root === null || b.environment === null || b.includes.length === 0);
  if (bad.length > 0)
    return {
      ok: false,
      reason:
        `${CONFIG_REL}: ${bad.map((b) => `block "${b.name}" (line ${b.line}) yielded ${['rootDir', 'testEnvironment', 'testMatch'].filter((k) => (k === 'testMatch' ? b.includes.length === 0 : b[{ rootDir: 'root', testEnvironment: 'environment' }[k]] === null)).join(' and ')}`).join('; ')} — ` +
        'the scan attributes a literal to the key before it and assumes `displayName:` opens a block; a block it cannot read whole is not a block it may compare',
      blocks,
    };
  return { ok: true, reason: null, blocks };
}

// ------------------------------------------------------------------- the light

export function run({ root = process.cwd(), premises = null } = {}) {
  const problems = [];
  const notes = [];
  const unreached = [];

  // ------------------------------------------------------------ the file set
  const visible = readVisible(root);
  if (!visible.ok) notes.push(`visible.json: ${visible.problems[0]} (L-visible owns this row; the walk hid nothing)`);

  const tracked = lsFiles([], { cwd: root });
  let files;
  let fileSource;
  if (!tracked.ok) {
    unreached.push(`the tracked set could not be read (${tracked.reason})`);
    const found = walk(root, { roots: ['packages', 'apps', 'e2e'], visible });
    files = found.files;
    fileSource = 'the work tree (git ls-files failed)';
    for (const p of found.problems) problems.push(`walk: ${p}`);
  } else if (tracked.files.length === 0) {
    unreached.push(
      'nothing is tracked yet, so "every tracked source" is a claim about zero files — the set below is the WORK TREE instead ' +
        '(cure: git add -A && CHEQ_SKIP_HOOKS=1 git commit -m "scaffold: …", then this light judges what a clone would receive)',
    );
    const found = walk(root, { roots: ['packages', 'apps', 'e2e'], visible });
    files = found.files;
    fileSource = 'the work tree (the index holds no path)';
    for (const p of found.problems) problems.push(`walk: ${p}`);
    for (const miss of found.missing) notes.push(`${miss}/ does not exist — nothing of that tree was walked`);
  } else {
    files = tracked.files;
    fileSource = `${files.length} tracked path(s)`;
  }
  const fileSet = new Set(files);

  const pkgs = readPackages(root);
  for (const p of pkgs.problems) problems.push(p);

  // -------------------------------- clause 1b: something imports it (no premise)
  const graphCache = new Map();
  for (const pkg of pkgs.packages) {
    const srcRoot = `${pkg.rel}/${SRC}`;
    const mine = files.filter((f) => under(f, srcRoot) && SOURCE_SUFFIXES.some((e) => f.endsWith(e)));
    if (mine.length === 0) continue;

    const fromExports =
      pkg.exports !== null && typeof pkg.exports === 'object' && !Array.isArray(pkg.exports)
        ? Object.values(pkg.exports)
            .filter((v) => typeof v === 'string')
            .map((v) => normRel(`${pkg.rel}/${v.replace(/^\.\//, '')}`))
            .filter((v) => v !== null && existsSync(join(root, v)))
        : [];
    const entries = fromExports.length > 0 ? fromExports : ENTRY_CANDIDATES.map((c) => `${pkg.rel}/${c}`).filter((c) => existsSync(join(root, c)));
    if (entries.length === 0) {
      unreached.push(
        `clause 1b for ${pkg.rel}: no declared entry point — ${pkg.manifestRel} has no string "exports" target and none of ${ENTRY_CANDIDATES.join(', ')} exists, ` +
          `so the ${mine.length} source file(s) there are reachable from nothing this light can name`,
      );
      continue;
    }

    const fromEntries = importGraph(root, entries, { cache: graphCache });
    const testDirs = [...new Set(PROJECT_NAMES.filter((p) => PROJECTS[p].runner === 'jest' && under(PROJECTS[p].dir, pkg.rel)).map((p) => PROJECTS[p].dir))];
    const testSeeds = files.filter((f) => testDirs.some((d) => under(f, d)) && SOURCE_SUFFIXES.some((e) => f.endsWith(e)));
    const fromTests = importGraph(root, testSeeds, { cache: graphCache });

    for (const f of mine) {
      if (fromEntries.reached.has(f)) continue;
      // A SPEC CONTRACT IS REACHED BY THE TESTS FIRST, BY DESIGN. A spec whose front matter says
      // `contracts: allowed` lets the TEST phase place types under `<pkg>/src/contracts/CHQ-nnn/`
      // — the shape fixed by the spec, with no function bodies — and for the whole of that phase
      // only the spec tests import them, because the implementation they belong to does not exist
      // yet. `implement-to-green` is what makes an entry point reach them. So between those two
      // phases this is the designed state and not a misplaced helper, and the cure the message
      // below offers would be actively wrong: moving a contract under the test directory would
      // put the agreed shape where the production code may not import it.
      //
      // Reported rather than passed over in silence — this light says what it is tolerating, and
      // it tolerates the PATH only. What it cannot see is a contract that is still unreached after
      // the implementation lands: nothing here knows that the phase is over (TD-0014).
      if (SPEC_CONTRACT_RE.test(f) && fromTests.reached.has(f)) {
        notes.push(
          `${f}: a spec contract reached by the tests and not yet by an entry point — the designed state while \`contracts: allowed\` is in force and the implementation is pending; ` +
            'an entry point reaches it when implement-to-green lands (TD-0014: nothing here notices if it never does)',
        );
        continue;
      }
      if (fromTests.reached.has(f))
        problems.push(
          `${f}:1: no entry point of ${pkg.rel} reaches this module (entries: ${entries.join(', ')}) and a test imports it — a helper on the production side of the package. ` +
            'Move it under the test directory, or publish it through an "exports" subpath of its own',
        );
      else
        problems.push(
          `${f}:1: nothing imports this module — no entry point of ${pkg.rel} (${entries.join(', ')}) and no test reaches it. ` +
            'Import it from the surface it belongs to, or delete it',
        );
    }
    for (const u of [...fromEntries.unresolved, ...fromTests.unresolved])
      notes.push(`${u.from}:${u.line} imports ${JSON.stringify(u.spec)}, which resolves to no file — L-tsc owns that diagnostic (TS2307); the graph above stops there`);
    for (const u of [...fromEntries.unreadable, ...fromTests.unreadable]) problems.push(`${u} — a module the import graph cannot read leaves every file behind it unjudged`);
  }

  // ------------------------------ clause 1a: the compiler read it (needs tsc)
  const closures = new Map();
  const prem = requirePremise(premises, 'tsc');
  if (!prem.ok) {
    unreached.push(`clause 1a (the compiler read it) not reached: ${prem.reason}`);
  } else {
    for (const pkg of pkgs.packages) {
      if (pkg.tsconfigRel === null) {
        notes.push(`${pkg.rel} has no tsconfig.json — it has no type project, so no closure says what it read`);
        continue;
      }
      const closure = resolveClosure(pkg, { root, premises });
      closures.set(pkg.rel, closure);
      if (!closure.ok) {
        unreached.push(`clause 1a for ${pkg.rel}: ${closure.reason}`);
        continue;
      }
      const read = new Set(closure.inside);
      const srcRoot = `${pkg.rel}/${SRC}`;
      const mine = files.filter((f) => under(f, srcRoot) && SOURCE_SUFFIXES.some((e) => f.endsWith(e)));
      for (const f of mine)
        if (!read.has(f))
          problems.push(
            `${f}:1: ${pkg.tsconfigRel} read ${closure.filesChecked} file(s) and this is not one of them — no type verdict covers it. ` +
              'Import it from the package surface, add it to the tsconfig include, or delete it',
          );
      // The other direction: the compiler read a source file the repository does
      // not hold. Only asked when the tracked set is real — against a work-tree
      // fallback every file is "untracked" and the answer would be noise.
      if (tracked.ok && tracked.files.length > 0)
        for (const f of closure.inside)
          if (under(f, srcRoot) && !fileSet.has(f))
            problems.push(`${f}:1: ${pkg.tsconfigRel} read this file and git does not track it — it exists on this machine and in no clone; git add it or delete it`);
    }
  }

  // ------------------------------------- clause 2: one runner per test file
  //
  // The bands, computed from the project table. A band is one include, however
  // many environments run it.
  const bands = new Map();
  for (const name of PROJECT_NAMES) {
    const cfg = PROJECTS[name];
    if (cfg.runner !== 'jest') continue;
    const key = `${cfg.dir}|${[...cfg.extensions].toSorted(sortStr).join(',')}`;
    if (!bands.has(key)) bands.set(key, { key, dir: cfg.dir, extensions: cfg.extensions, projects: [] });
    bands.get(key).projects.push(name);
  }

  const testFiles = files.filter((f) => TEST_SUFFIXES.some((e) => f.endsWith(e)));
  const matchedBy = new Map();
  for (const f of testFiles) {
    const hits = [...bands.values()].filter((b) => under(f, b.dir) && b.extensions.some((e) => f.endsWith(e)));
    matchedBy.set(f, hits);
    if (hits.length === 0)
      problems.push(
        `${f}:1: no Jest project collects this file (bands: ${[...bands.values()].map((b) => `${b.dir}/**/*${b.extensions.join('|')}`).join(', ')}) — ` +
          'it never runs and no row says so; move it under the test directory of its kind or delete it',
      );
    else if (hits.length > 1)
      problems.push(
        `${f}:1: ${hits.length} Jest project bands collect this file (${hits.map((b) => b.projects.join('+')).join(' and ')}) — ` +
          'two runs judge one file and nothing declares which verdict is the record; narrow one include',
      );
  }
  const parityBands = [...bands.values()].filter((b) => b.projects.length > 1);
  for (const b of parityBands) notes.push(`${b.projects.join(' + ')} share ${b.dir} (a parity band, not a double collection — L-env-parity diffs it)`);

  // The table against the config it declares (test-project.mjs:16-25).
  const configAbs = join(root, CONFIG_REL);
  if (!existsSync(configAbs)) {
    problems.push(`${CONFIG_REL}: does not exist — the project table in tools/gates/lib/test-project.mjs declares what this file says, and there is nothing to declare`);
  } else {
    let configText = '';
    try {
      configText = readFileSync(configAbs, 'utf8');
    } catch (e) {
      unreached.push(`${CONFIG_REL} is unreadable (${String(e.message)}) — the project table went uncompared`);
    }
    if (configText !== '') {
      const scanned = scanConfig(configText);
      if (!scanned.ok) {
        unreached.push(scanned.reason);
      } else {
        const declared = new Set(PROJECT_NAMES.filter((p) => PROJECTS[p].runner === 'jest'));
        const inConfig = new Set(scanned.blocks.map((b) => b.name));
        for (const name of inConfig)
          if (!declared.has(name))
            problems.push(
              `${CONFIG_REL}:${scanned.blocks.find((b) => b.name === name).line}: project "${name}" is in the config and not in PROJECTS ` +
                '(tools/gates/lib/test-project.mjs) — every gate that names an artifact reads that table, so a project it does not know is a lane nobody judges',
            );
        for (const name of declared) if (!inConfig.has(name)) problems.push(`PROJECTS declares "${name}" and ${CONFIG_REL} has no such block — the table promises a lane the runner does not run`);
        for (const b of scanned.blocks) {
          const cfg = PROJECTS[b.name];
          if (cfg === undefined) continue;
          const root0 = normRel(b.root);
          if (root0 === null) {
            problems.push(`${CONFIG_REL}:${b.line}: project "${b.name}" has root ${JSON.stringify(b.root)}, which is not a repo-relative path`);
            continue;
          }
          const parsed = b.includes.map((p) => ({ pattern: p, parsed: parseInclude(p) }));
          const unknown = parsed.filter((p) => p.parsed === null);
          if (unknown.length > 0) {
            unreached.push(
              `${CONFIG_REL}:${b.line}: include ${unknown.map((u) => JSON.stringify(u.pattern)).join(', ')} of project "${b.name}" is outside the two forms this scan reads ` +
                '(`<dir>/**/*.<ext>` and `<dir>/**/*.<mid>.{a,b}`) — the pattern decides which files run, so it is not compared by guess',
            );
            continue;
          }
          const dirs = [...new Set(parsed.map((p) => `${root0}/${p.parsed.prefix}`))];
          const exts = [...new Set(parsed.flatMap((p) => p.parsed.extensions))].toSorted(sortStr);
          if (dirs.length !== 1 || dirs[0] !== cfg.dir)
            problems.push(
              `${CONFIG_REL}:${b.line}: project "${b.name}" collects ${dirs.join(' and ')} while PROJECTS says ${cfg.dir} — ` +
                'the table is what every gate resolves an artifact path through; fix whichever is wrong, in the same commit',
            );
          const tableExts = [...cfg.extensions].toSorted(sortStr);
          if (exts.join(',') !== tableExts.join(','))
            problems.push(`${CONFIG_REL}:${b.line}: project "${b.name}" collects ${exts.join(' ')} while PROJECTS says ${tableExts.join(' ')}`);
          if (b.environment !== cfg.environment)
            problems.push(
              `${CONFIG_REL}:${b.line}: project "${b.name}" runs in ${b.environment} while PROJECTS says ${cfg.environment} — ` +
                'the environment is the whole content of the parity claim, so a silent change makes L-env-parity compare one environment with itself',
            );
        }
      }
    }
  }

  // The runner's own collection, when it is installed. A disagreement is
  // cannot-verify: if the matcher is wrong here it is of unknown worth anywhere.
  const runner = requirePremise(premises, 'jest');
  if (!runner.ok) {
    unreached.push(`clause 2 corroboration not reached: ${runner.reason} — the matcher above is this light's own answer, uncorroborated by the runner`);
  } else {
    for (const band of bands.values()) {
      const project = band.projects[0];
      // MEASURED difference from the previous runner: `jest --listTests --json`
      // prints an array of ABSOLUTE FILE PATHS, not one record per case. For this
      // clause that is the better answer — the question is which project collects
      // a FILE — but the parse below had to change with it.
      const r = sh(runner.premise.path, ['--selectProjects', project, '--listTests', '--json'], { cwd: root });
      if (r.code === null) {
        unreached.push(`could not run ${runner.premise.rel} --listTests for project ${project}: ${r.spawnError ?? 'spawn failed'}`);
        continue;
      }
      let listed;
      try {
        listed = JSON.parse(r.stdout);
      } catch (e) {
        unreached.push(
          `\`${runner.premise.rel} --selectProjects ${project} --listTests --json\` exited ${r.code} and its stdout is not JSON (${String(e.message)}) — ` +
            'the runner\'s own collection went unread, so the matcher is uncorroborated',
        );
        continue;
      }
      if (!Array.isArray(listed)) {
        unreached.push(`\`${runner.premise.rel} --selectProjects ${project} --listTests --json\` printed ${typeof listed}, not an array — the measured shape is an array of absolute test-file paths`);
        continue;
      }
      // `file` is ABSOLUTE in this output; a comparison without this step
      // matches nothing (measured).
      const byRunner = new Set(listed.map((f) => relPosix(root, String(f ?? ''))).filter((f) => f !== ''));
      const byMatcher = new Set(testFiles.filter((f) => (matchedBy.get(f) ?? []).some((b) => b.key === band.key)));
      const onlyRunner = [...byRunner].filter((f) => !byMatcher.has(f)).toSorted(sortStr);
      const onlyMatcher = [...byMatcher].filter((f) => !byRunner.has(f)).toSorted(sortStr);
      // A file the matcher claims and the runner does not collect is only a
      // disagreement when the runner could have seen it: an UNTRACKED file in a
      // work-tree fallback is collected by the runner too, so the asymmetry here
      // is always the other way round and both directions are reported.
      if (onlyRunner.length > 0 || onlyMatcher.length > 0)
        unreached.push(
          `the ${band.projects.join('+')} band disagrees with \`jest --selectProjects ${project} --listTests\`: ` +
            [
              ...(onlyRunner.length > 0 ? [`the runner collects ${onlyRunner.join(', ')} and the matcher does not`] : []),
              ...(onlyMatcher.length > 0 ? [`the matcher claims ${onlyMatcher.join(', ')} and the runner does not collect it`] : []),
            ].join('; ') +
            ' — the runner is the authority on what it runs, so every verdict this clause gave is of unknown worth',
        );
      else notes.push(`${band.projects.join('+')}: ${byRunner.size} file(s), and \`jest --listTests --json\` collects exactly those`);
    }
  }

  // ------------------------------- clauses 3 and 4: one public path per module
  for (const pkg of pkgs.packages) {
    const map = pkg.exports;
    if (map === null || map === undefined) {
      notes.push(`${pkg.manifestRel} declares no "exports" — nothing of it is importable by subpath, so clauses 3 and 4 have no surface to judge`);
      continue;
    }
    if (typeof map !== 'object' || Array.isArray(map)) {
      problems.push(`${pkg.manifestRel}: "exports" must be an object of subpath → file (got ${Array.isArray(map) ? 'an array' : typeof map})`);
      continue;
    }

    const subpaths = [];
    for (const [key, value] of Object.entries(map)) {
      if (typeof value !== 'string') {
        unreached.push(
          `${pkg.manifestRel}: subpath "${key}" has a conditional target (${Array.isArray(value) ? 'an array' : typeof value}) — this reader understands only a string target, ` +
            'so the surface of this package went unjudged rather than half-judged',
        );
        continue;
      }
      if (key !== '.' && !key.startsWith('./')) {
        problems.push(`${pkg.manifestRel}: subpath ${JSON.stringify(key)} is neither "." nor "./<name>" — a pattern or a bare name here is a surface nobody can enumerate`);
        continue;
      }
      const target = normRel(`${pkg.rel}/${value.replace(/^\.\//, '')}`);
      if (target === null || !existsSync(join(root, target))) {
        problems.push(`${pkg.manifestRel}: subpath "${key}" points at ${value}, which does not exist — an import of this subpath fails on a fresh clone`);
        continue;
      }
      if (!under(target, pkg.rel)) {
        problems.push(`${pkg.manifestRel}: subpath "${key}" points at ${target}, outside ${pkg.rel} — a package publishes its own files`);
        continue;
      }
      if (tracked.ok && tracked.files.length > 0 && !fileSet.has(target))
        problems.push(`${pkg.manifestRel}: subpath "${key}" points at ${target}, which git does not track — the subpath resolves here and nowhere else`);
      subpaths.push({ key, target });
    }

    // The re-export closure of each subpath: `export … from` edges, followed
    // transitively. The untraceable form is refused rather than guessed at.
    const closureOf = new Map();
    for (const sp of subpaths) {
      const seen = new Set();
      const queue = [sp.target];
      while (queue.length > 0) {
        const rel = queue.shift();
        if (seen.has(rel)) continue;
        seen.add(rel);
        let text;
        try {
          text = readFileSync(join(root, rel), 'utf8');
        } catch (e) {
          problems.push(`${rel}: unreachable from ${pkg.manifestRel} subpath "${sp.key}" (${String(e.message)}) — a surface a gate cannot read is a surface it did not judge`);
          continue;
        }
        const read = readSpecifiers(text);
        for (const p of read.problems) problems.push(`${rel}: ${p}`);
        if (rel === sp.target)
          for (const local of read.exportLocals)
            problems.push(
              `${rel}:${local.line}: \`${local.text}\` in the file ${pkg.manifestRel} publishes as subpath "${sp.key}" — a re-export written as a local binding ` +
                'cannot be followed without parsing TypeScript, so the public surface of this package stops being readable; write it as `export { … } from \'./<module>\'`',
            );
        for (const s of read.specifiers) {
          if (s.role !== 'reexport') continue;
          if (!s.spec.startsWith('.')) {
            notes.push(`${rel}:${s.line} re-exports the package ${s.spec} — an edge, judged by L-graph, not a module of this package`);
            continue;
          }
          const resolved = resolveRelative(root, rel, s.spec);
          if (resolved === null) {
            problems.push(`${rel}:${s.line}: re-export from ${JSON.stringify(s.spec)} resolves to no file — the subpath "${sp.key}" is broken for every importer`);
            continue;
          }
          queue.push(resolved);
        }
      }
      closureOf.set(sp.key, seen);
    }

    for (let i = 0; i < subpaths.length; i += 1)
      for (let j = i + 1; j < subpaths.length; j += 1) {
        const a = subpaths[i];
        const b = subpaths[j];
        const shared = [...(closureOf.get(a.key) ?? [])].filter((m) => (closureOf.get(b.key) ?? new Set()).has(m)).toSorted(sortStr);
        if (shared.length > 0)
          problems.push(
            `${pkg.manifestRel}: subpaths "${a.key}" and "${b.key}" both re-export ${shared.join(', ')} — one module on two public paths means two import names for one symbol ` +
              'and no statement of which is the surface; keep each module on one subpath',
          );
      }

    // Clause 4. Derived from the tree, not from a package name: a package that
    // HAS a testing directory must publish it separately, and `.` must not reach
    // into it.
    const testingRel = `${pkg.rel}/${TESTING}`;
    if (!existsSync(join(root, testingRel))) continue;
    const dot = subpaths.find((s) => s.key === '.');
    const testingSubpaths = subpaths.filter((s) => s.key !== '.' && under(s.target, testingRel));
    if (testingSubpaths.length === 0)
      problems.push(
        `${pkg.manifestRel}: ${testingRel}/ exists and no "exports" subpath other than "." publishes it — test helpers reachable only through "." are reachable from production code; ` +
          'declare them under a subpath of their own (e.g. "./testing")',
      );
    if (dot !== undefined) {
      const reached = [...(closureOf.get('.') ?? [])].filter((m) => under(m, testingRel)).toSorted(sortStr);
      if (reached.length > 0)
        problems.push(
          `${pkg.manifestRel}: subpath "." reaches ${reached.join(', ')} under ${testingRel}/ — importing the package would hand a production bundle its test helpers; ` +
            'keep the testing surface on its own subpath',
        );
    }
    notes.push(`${pkg.name ?? pkg.rel}: ${subpaths.map((s) => `"${s.key}" → ${s.target}`).join(', ')}`);
  }

  // ---------------------------------------------------------------- the row
  const summary = [
    fileSource,
    `${testFiles.length} test file(s) across ${bands.size} collection band(s)`,
    `${closures.size} closure(s) read`,
    ...notes,
  ];

  if (problems.length > 0)
    return {
      id,
      severity,
      status: 'fail',
      detail: `${problems.length} problem(s): ${problems.join(' · ')} [${summary.join(' · ')}${unreached.length > 0 ? ` · NOT REACHED: ${unreached.join(' · ')}` : ''}]`,
    };

  if (unreached.length > 0)
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail: `${unreached.join(' · ')} — a clause that did not run is not a clause that passed [${summary.join(' · ')}]`,
    };

  return { id, severity, status: 'pass', detail: summary.join(' · ') };
}
