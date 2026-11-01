/**
 * L-graph — the package graph of ADR-0001: three packages, two edges, one
 * direction, and the four ways that boundary can be crossed WITHOUT any of the
 * compiler, the resolver or the linter saying a word.
 *
 * Zero dependencies, Node 22 ESM. Nothing here parses TypeScript: the edges come
 * from `package.json` (JSON), the real closure comes from `tsc --listFiles`
 * (text), and the specifier scan runs over source masked by `scanSource` — a
 * token scan, never an AST (rule 2).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT IT ASSERTS — SEVEN CLAIMS, AND WHICH INSTRUMENT SEES EACH
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. `name` EQUALS THE FOLDER. `packages/core` is `@cheq/core`. Every edge in
 *    this repository is spelled with a package NAME while every path is spelled
 *    with a DIRECTORY, so the day the two disagree a declared edge and a real
 *    import stop being comparable and both halves still look fine.
 *
 * 2. THE DECLARED EDGES ARE EXACTLY THE TWO ADR-0001 NAMES. `@cheq/api` and
 *    `@cheq/web` may depend on `@cheq/core`; the core depends on NOTHING; and
 *    `@cheq/web` must never name `@cheq/api` — the web package talks to the api
 *    over HTTP, never by import. All four dependency groups are judged, not just
 *    `dependencies`: a `devDependencies` edge executes code (a vite plugin, a
 *    postinstall) and is an edge like any other.
 *
 * 3. NO CYCLE. Computed from the declared edge set rather than asserted from the
 *    allowlist, because the allowlist is a claim about today and the cycle check
 *    is a claim about whatever the manifests say.
 *
 * 4. NO RELATIVE SPECIFIER LEAVES ITS OWN PACKAGE. MEASURED, and the reason this
 *    light exists at all: with `packages/core/src/__esc.ts` importing
 *    `'../../../apps/api/src/index.ts'`, `tsc --noEmit` exits 0 with ZERO
 *    diagnostics. The compiler is silent, the manifest is silent (a relative
 *    path is not a package, so pnpm's isolated linker never comes into it) and
 *    the linter is silent. Two instruments see it and this light uses BOTH:
 *      - the LEXICAL scan, which resolves every relative specifier against its
 *        own file and refuses one that climbs out of the package. It needs
 *        nothing installed, so it is the half that still works in a bare
 *        checkout;
 *      - `tsc --listFiles`, whose `workspace` partition (`resolveClosure` in
 *        `./_shared.mjs`) holds every in-repo input from outside the package.
 *    They are not redundant: the listing cannot distinguish a legal workspace
 *    edge from an illegal relative escape — a dependency reached through pnpm's
 *    symlink is reported at its REAL path (measured) — while the lexical scan
 *    can, because an escape has a `../` in it and an edge does not.
 *
 * 5. NO ALIAS. A tsconfig `paths` entry or a vite `resolve.alias` pointing into
 *    another package's `src` is a second, silent edge the manifests do not
 *    mention; ADR-0001 rejected the arrangement by name, precisely so this light
 *    has ONE source of edges to reconcile instead of two.
 *
 * 6. THE DECLARED EDGES MATCH THE REAL ONES. Every workspace package a source
 *    actually imports must be a declared dependency of the importing package.
 *
 * 7. `@cheq/core` REACHES NOTHING IN THE REPOSITORY. The core's own closure is
 *    checked here as well as in `L-core-purity`; the two ask it for different
 *    reasons (purity there, graph consistency here) and a disagreement between
 *    them would itself be worth seeing.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * ONE DEVIATION FROM THE PLAN, MEASURED AND DELIBERATE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * The plan says "declared edges == the real closure", an equality. Measured on
 * this tree 2026-11-01: `apps/api` and `apps/web` both declare `@cheq/core` and
 * NEITHER imports it yet — the only cross-package import anywhere is none. A
 * strict equality would therefore fail a clean scaffold, and a light that is red
 * on a correct tree gets switched off. So the two directions are weighed
 * differently, and the difference is the whole point:
 *
 *   an edge in the code that NOBODY DECLARED            → fail (it is a boundary
 *                                                          crossing nobody owns)
 *   an edge DECLARED that the code does not use yet     → a named note (it is a
 *                                                          dependency waiting
 *                                                          for its first caller)
 *
 * The note names the package and the edge, so "declared and unused" stays
 * visible rather than becoming invisible — which is what an equality nobody can
 * satisfy would have achieved.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE HOLE ADR-0001 NAMED, AND WHY IT IS A NOTE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * ADR-0001's "Open hole": the ROOT's own devDependency set is importable from
 * every package by upward resolution, and it says this light's closure check is
 * what sees it. Measured: `packages/core`'s closure holds external `.d.ts` files
 * for `vitest`, `@vitest/mocker`, `expect-type`, `tinybench` and more, every one
 * resolved out of the workspace root, because the skeleton tests import `vitest`
 * by bare specifier. Failing on that would fail a correct tree, so the externals
 * reached past the package are COUNTED AND NAMED in the detail. That turns "the
 * hole is open and nothing reports it" into "the hole is open and this row says
 * how wide", which is the honest difference a light can make here.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * NO MODULE-LEVEL PREMISE, ON PURPOSE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Claims 1, 2, 3, 4-lexical and 5 need nothing installed. Declaring
 * `premises: ['tsc']` would make `lights/run.mjs` refuse the whole row before
 * `run` was called and a bare checkout would lose all five. The closure half
 * asks `requirePremise` itself and reports the missing premise BY NAME, which is
 * cannot-verify and blocks.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { normRel, ownerOf, readPackages, readPremises, readVisible, requirePremise, resolveClosure, scanSource, under, walk } from './_shared.mjs';
import { cite, readJsoncFile, tsconfigChain } from './tsc.mjs';

export const id = 'L-graph';
export const severity = 'hard';

/**
 * The edge table of ADR-0001, as `from → to` pairs. A workspace-to-workspace
 * dependency outside this list is refused, and so is any edge out of
 * `@cheq/core`. Adding a package is a change to the ADR table, to this constant
 * and to the repository map, in one `gate:` commit.
 */
export const ALLOWED_EDGES = Object.freeze([
  Object.freeze({ from: '@cheq/api', to: '@cheq/core', why: 'the api maps HTTP to core calls (ADR-0001)' }),
  Object.freeze({ from: '@cheq/web', to: '@cheq/core', why: 'the web package renders core state and turns input into core intents (ADR-0001)' }),
]);

/** The package that may depend on nothing at all. */
const CORE_NAME = '@cheq/core';

/** The dependency groups an edge can hide in. `devDependencies` is judged like
 * the rest: a vite plugin and a postinstall script both execute. */
const GROUPS = Object.freeze(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']);

/** Source extensions the specifier scan reads. */
const SRC_EXTS = Object.freeze(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx']);

/** The config files a bundler alias can hide in. */
const ALIAS_CONFIG_RE = /^(vite|vitest)\.config\.(ts|mts|cts|js|mjs|cjs)$/;

/** How many items a single problem prints before it says how many are left. */
const SHOW = 6;

const byString = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

const listOf = (items) => {
  const sorted = items.toSorted(byString);
  const head = sorted.slice(0, SHOW).join(', ');
  return sorted.length > SHOW ? `${head} (+${String(sorted.length - SHOW)} more)` : head;
};

/** 1-based line of an offset. Local on purpose, as in `core-purity.mjs:179`. */
function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/** The identifier or single character immediately before `start`, skipping
 * whitespace, read from MASKED code. This is how a string literal is told apart
 * from a module specifier without parsing: a specifier follows `from`, `import`,
 * `import(` or `require(`, and nothing else does. */
function tokenBefore(code, start) {
  let i = start - 1;
  while (i >= 0 && /\s/.test(code[i])) i -= 1;
  if (i < 0) return '';
  if (code[i] === '(') {
    let j = i - 1;
    while (j >= 0 && /\s/.test(code[j])) j -= 1;
    let end = j;
    while (j >= 0 && /[A-Za-z0-9_$]/.test(code[j])) j -= 1;
    return `${code.slice(j + 1, end + 1)}(`;
  }
  if (!/[A-Za-z0-9_$]/.test(code[i])) return code[i];
  let j = i;
  while (j >= 0 && /[A-Za-z0-9_$]/.test(code[j])) j -= 1;
  return code.slice(j + 1, i + 1);
}

/** The tokens that make the literal after them a module specifier. */
const SPECIFIER_TOKENS = new Set(['from', 'import', 'import(', 'require(']);

/**
 * Every module specifier of one file, with its line.
 * → { ok, specifiers: [{ spec, line }], problems }
 *
 * Reads the literals `scanSource` recorded and keeps the ones a specifier token
 * precedes. A template literal with a substitution is not a literal specifier
 * and is reported: a path the compiler cannot resolve statically never appears
 * in `--listFiles`, so the closure half would report a clean graph over a module
 * that is loaded anyway.
 */
export function specifiersOf(text, rel) {
  const problems = [];
  const specifiers = [];
  const s = scanSource(text);
  for (const p of s.problems) problems.push(`${rel}: the mask itself may be wrong (${p}) — this file cannot be scanned for imports, so it is not clean`);
  if (s.problems.length) return { ok: false, specifiers, problems };
  for (const lit of s.literals.values()) {
    const before = tokenBefore(s.code, lit.start);
    if (!SPECIFIER_TOKENS.has(before)) continue;
    if (lit.isLiteral !== true || typeof lit.value !== 'string') {
      problems.push(
        `${rel}:${String(lineAt(text, lit.start))}: a non-literal module specifier after \`${before}\` — write it as a string literal; a specifier tsc cannot resolve statically never appears in --listFiles, and the closure half of this light would then report a clean graph over a module that is loaded anyway`,
      );
      continue;
    }
    specifiers.push({ spec: lit.value, line: lineAt(text, lit.start) });
  }
  return { ok: true, specifiers, problems };
}

// ------------------------------------------------- claims 1, 2, 3: manifests

/**
 * `name` against the folder, the declared edge set, and the cycle.
 * → { problems, notes, declared: Map<name, Set<name>> }
 */
export function manifestClaims(pkgs) {
  const problems = [];
  const notes = [];
  const declared = new Map();
  const names = new Set(pkgs.packages.map((p) => p.name).filter((n) => n !== null));

  for (const p of pkgs.packages) {
    const dirName = p.rel.slice(p.rel.lastIndexOf('/') + 1);
    if (p.name === null) continue;
    const unscoped = p.name.includes('/') ? p.name.slice(p.name.indexOf('/') + 1) : p.name;
    if (unscoped !== dirName)
      problems.push(
        `${p.manifestRel}: "name" is ${JSON.stringify(p.name)} and the folder is ${JSON.stringify(dirName)} — rename one of them; every edge in this repository is spelled with a package NAME and every path with a DIRECTORY, so a disagreement makes a declared edge and a real import stop being comparable while both halves still look fine`,
      );

    const out = new Set();
    for (const group of GROUPS) {
      for (const dep of Object.keys(p[group] ?? {})) {
        if (!names.has(dep)) continue;
        out.add(dep);
        const allowed = ALLOWED_EDGES.some((e) => e.from === p.name && e.to === dep);
        if (allowed) continue;
        if (p.name === CORE_NAME)
          problems.push(
            `${p.manifestRel}: "${group}" declares ${dep} — ${CORE_NAME} depends on NOTHING (ADR-0001), and the empty "dependencies" object is the carrier of that rule rather than a comment about it; move the adapter into an app`,
          );
        else
          problems.push(
            `${p.manifestRel}: "${group}" declares ${dep}, which is not an edge ADR-0001 names (the only two are ${ALLOWED_EDGES.map((e) => `${e.from} → ${e.to}`).join(', ')}) — remove it, or extend the table in docs/decisions/ADR-0001-package-layers.md and ALLOWED_EDGES in tools/gates/lights/graph.mjs in one gate: commit`,
          );
      }
    }
    declared.set(p.name, out);
  }

  // The cycle, computed from whatever the manifests say.
  const colour = new Map();
  const stack = [];
  const reportCycle = (at) => {
    const from = stack.indexOf(at);
    problems.push(`a dependency CYCLE among workspace packages: ${[...stack.slice(from), at].join(' → ')} — one direction only (ADR-0001); break it by moving the shared half into ${CORE_NAME}`);
  };
  const visit = (name) => {
    const state = colour.get(name);
    if (state === 'done') return;
    if (state === 'open') {
      reportCycle(name);
      return;
    }
    colour.set(name, 'open');
    stack.push(name);
    for (const next of [...(declared.get(name) ?? [])].toSorted(byString)) visit(next);
    stack.pop();
    colour.set(name, 'done');
  };
  for (const name of [...names].toSorted(byString)) visit(name);

  const edgeList = [...declared.entries()].flatMap(([from, tos]) => [...tos].map((to) => `${from}→${to}`));
  notes.push(`${String(pkgs.packages.length)} package(s), ${String(edgeList.length)} declared workspace edge(s): ${edgeList.length ? edgeList.toSorted(byString).join(' ') : 'none'}`);
  if (pkgs.emptyGlobs.length) notes.push(`workspace glob(s) matching no package: ${pkgs.emptyGlobs.join(', ')} (tools/* is deliberately empty — a package.json there would give the gates dependencies)`);
  return { problems, notes, declared };
}

// ------------------------------------ claims 4-lexical and 6: the specifiers

/**
 * The lexical half: every relative specifier resolved against its own file, and
 * every bare workspace specifier collected as a real edge.
 * → { problems, notes, used: Map<name, Set<name>> }
 */
export function specifierClaims(root, pkgs, visible) {
  const problems = [];
  const notes = [];
  const used = new Map();
  let scanned = 0;

  for (const pkg of pkgs.packages) {
    if (pkg.name === null) continue;
    used.set(pkg.name, new Set());
    const found = walk(root, { roots: [pkg.rel], exts: SRC_EXTS, visible });
    for (const p of found.problems) problems.push(`${pkg.rel}: ${p}`);
    for (const rel of found.files) {
      let text;
      try {
        text = readFileSync(join(root, rel), 'utf8');
      } catch (e) {
        problems.push(`${rel}: unreadable (${String(e.message)}) — a file the import scan could not read is not a file with no escaping import in it`);
        continue;
      }
      const s = specifiersOf(text, rel);
      problems.push(...s.problems);
      if (!s.ok) continue;
      scanned += 1;
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      for (const { spec, line } of s.specifiers) {
        if (spec.startsWith('.')) {
          const target = normRel(posix.normalize(posix.join(dir, spec)));
          if (target === null || !under(target, pkg.rel))
            problems.push(
              `${rel}:${String(line)}: the relative specifier ${JSON.stringify(spec)} resolves to ${String(target)}, OUTSIDE ${pkg.rel} — delete the import and go through a declared dependency; MEASURED: this escape typechecks clean with exit 0 and no diagnostic, and the manifest and the linter are silent about it too, so only this scan and tsc --listFiles see it`,
            );
          continue;
        }
        if (spec.startsWith('/')) {
          problems.push(`${rel}:${String(line)}: the absolute specifier ${JSON.stringify(spec)} names a path outside any package — use a relative path inside the package or a declared dependency`);
          continue;
        }
        // A bare specifier. Only a workspace name is an edge; everything else is
        // a registry package and L-deps' business.
        const head = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : (spec.split('/')[0] ?? spec);
        if (pkgs.byName.has(head)) used.get(pkg.name).add(head);
      }
    }
  }

  notes.push(`import scan: ${String(scanned)} source file(s) across ${String(pkgs.packages.length)} package(s)`);
  return { problems, notes, used };
}

// ---------------------------------------------------------- claim 5: aliases

/**
 * A tsconfig `paths` entry or a bundler `alias` reaching into another package.
 * → { problems, notes }
 *
 * The bundler half is a TOKEN SCAN, and deliberately conservative: if the word
 * `alias` appears in a vite or vitest config and its value is not a literal this
 * reader can take apart, that is a PROBLEM rather than a silence — an alias
 * nobody could read is an edge nobody can reconcile with the manifests.
 */
export function aliasClaims(root, pkgs) {
  const problems = [];
  const notes = [];
  let pathsSeen = 0;
  let aliasSeen = 0;

  for (const pkg of pkgs.packages) {
    if (pkg.tsconfigRel === null) continue;
    const chain = tsconfigChain(root, pkg.tsconfigRel);
    for (const f of chain.files) {
      const paths = f.data?.compilerOptions?.paths;
      if (paths === null || paths === undefined) continue;
      if (typeof paths !== 'object' || Array.isArray(paths)) {
        problems.push(`${f.rel}: "compilerOptions.paths" is not an object — an alias table nobody can read is an edge nobody can reconcile with the manifests`);
        continue;
      }
      const dir = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '';
      for (const [key, value] of Object.entries(paths)) {
        pathsSeen += 1;
        const targets = Array.isArray(value) ? value : [value];
        for (const t of targets) {
          const resolved = normRel(posix.normalize(posix.join(dir, String(t).replaceAll('*', ''))));
          const owner = resolved === null ? null : ownerOf(resolved, pkgs);
          if (owner !== null && owner.rel !== pkg.rel)
            problems.push(
              `${cite(f.rel, lineAt(f.text, f.text.indexOf('"paths"')))}: the alias ${JSON.stringify(key)} → ${JSON.stringify(String(t))} resolves into ${owner.rel} (${String(owner.name)}) — ADR-0001 rejected cross-package "paths" by name: an alias is a second, silent edge the manifests do not mention, and this light would then have two sources of edges to reconcile`,
            );
        }
      }
    }
  }

  const configs = walk(root, { roots: ['.'], visible: readVisible(root) }).files.filter((f) => ALIAS_CONFIG_RE.test(f.slice(f.lastIndexOf('/') + 1)));
  for (const rel of configs) {
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch (e) {
      problems.push(`${rel}: unreadable (${String(e.message)}) — a bundler config the alias scan could not read is not a config with no alias in it`);
      continue;
    }
    const s = scanSource(text);
    for (const p of s.problems) problems.push(`${rel}: the mask itself may be wrong (${p}) — this config cannot be scanned for an alias`);
    if (s.problems.length) continue;
    const re = /\balias\s*:/g;
    let m = re.exec(s.code);
    while (m !== null) {
      aliasSeen += 1;
      const where = `${rel}:${String(lineAt(text, m.index))}`;
      const literals = [...s.literals.values()].filter((lit) => lit.start > m.index && lit.start < m.index + 400);
      if (literals.length === 0)
        problems.push(
          `${where}: an \`alias\` whose value holds no string literal this reader can take apart — spell the alias as literal strings, or remove it; an alias is a second edge the manifests do not mention and ADR-0001 rejected the arrangement`,
        );
      for (const lit of literals) {
        if (lit.isLiteral !== true || typeof lit.value !== 'string') {
          problems.push(`${where}: a non-literal value inside \`alias\` — an alias nobody can read is an edge nobody can reconcile with the manifests`);
          continue;
        }
        const value = lit.value;
        if (!value.includes('/') && !value.startsWith('.')) continue;
        const resolved = normRel(posix.normalize(value.startsWith('.') ? posix.join(rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', value) : value));
        const owner = resolved === null ? null : ownerOf(resolved, pkgs);
        const self = ownerOf(rel, pkgs);
        if (owner !== null && (self === null || owner.rel !== self.rel))
          problems.push(
            `${where}: the alias value ${JSON.stringify(value)} resolves into ${owner.rel} (${String(owner.name)}) — ADR-0001 rejected a cross-package alias by name; import through the declared dependency instead`,
          );
      }
      m = re.exec(s.code);
    }
  }

  notes.push(`alias scan: ${String(pathsSeen)} tsconfig "paths" entr(ies), ${String(aliasSeen)} \`alias\` site(s) in ${String(configs.length)} bundler config(s)`);
  return { problems, notes };
}

// ------------------------------------------- claims 4-closure, 6 and 7: tsc

/**
 * The closure half: what the compiler actually READ, per package.
 * → { problems, notes, reached: Map<name, Set<name>> }
 */
export function closureClaims(root, pkgs, premises) {
  const problems = [];
  const notes = [];
  const reached = new Map();

  const prem = requirePremise(premises, 'tsc');
  if (!prem.ok)
    return {
      problems: [
        `the closure half did NOT run: ${prem.reason} — tsc --listFiles is the only instrument that sees a relative path out of a package reach another one through pnpm's symlink, so this half cannot be answered without it`,
      ],
      notes,
      reached,
    };

  for (const pkg of pkgs.packages) {
    if (pkg.name === null) continue;
    reached.set(pkg.name, new Set());
    if (pkg.tsconfigRel === null) {
      notes.push(`${pkg.rel}: no tsconfig, so it has no type project and no closure (Playwright owns the e2e lane)`);
      continue;
    }
    const c = resolveClosure(pkg, { root, premises });
    if (!c.ok) {
      problems.push(`${pkg.rel}: the closure of ${String(pkg.tsconfigRel)} could not be read — ${c.reason}`);
      continue;
    }
    const foreignNonModule = c.foreign.filter((p) => !p.split('/').includes('node_modules'));
    if (foreignNonModule.length)
      problems.push(`${pkg.rel}: ${String(foreignNonModule.length)} input(s) from outside the repository and under no node_modules: ${listOf(foreignNonModule)} — name what they are or remove the import`);

    const declaredHere = new Set(GROUPS.flatMap((g) => Object.keys(pkg[g] ?? {})));
    for (const w of c.workspace) {
      const owner = w.owner;
      if (owner === null) {
        problems.push(`${pkg.rel}: ${w.rel} is an in-repo input from outside the package and belongs to NO workspace package — nothing owns it, so no edge can describe it`);
        continue;
      }
      reached.get(pkg.name).add(owner);
      if (!declaredHere.has(owner))
        problems.push(
          `${pkg.rel}: ${w.rel} is an in-repo input of ${String(pkg.tsconfigRel)} owned by ${owner}, which ${pkg.manifestRel} does NOT declare — either declare the dependency (with a package: trailer, L-deps judges that) or delete the import; MEASURED: a declared edge reached through pnpm's symlink and an illegal relative escape look IDENTICAL in --listFiles, so the lexical scan above is what tells them apart`,
        );
    }

    // ADR-0001's named hole, reported rather than refused: externals reached by
    // upward resolution past this package's own declarations.
    const upward = new Set();
    for (const e of c.external) {
      const after = e.lastIndexOf('node_modules/');
      if (after === -1) continue;
      const tail = e.slice(after + 'node_modules/'.length);
      const head = tail.startsWith('@') ? tail.split('/').slice(0, 2).join('/') : (tail.split('/')[0] ?? tail);
      if (!declaredHere.has(head)) upward.add(head);
    }
    if (upward.size)
      notes.push(
        `${pkg.rel}: ${String(upward.size)} external package(s) reached by UPWARD resolution past its own manifest — ${listOf([...upward])} (ADR-0001's named open hole: the root's devDependency set is importable from every package; counted here, not refused, because the skeleton tests legitimately import vitest this way)`,
      );
    notes.push(`${pkg.rel}: closure ${String(c.inside.length)} inside · ${String(c.workspace.length)} in-repo elsewhere · ${String(c.external.length)} external · ${String(c.libs.length)} lib`);
  }

  return { problems, notes, reached };
}

// -------------------------------------------------------------------- the run

export function run({ root = process.cwd(), premises = null } = {}) {
  const probe = premises ?? readPremises(root);
  const visible = readVisible(root);
  const pkgs = readPackages(root);
  const problems = [];
  const unverifiable = [];
  const notes = [];

  for (const p of pkgs.problems) unverifiable.push(`the workspace could not be read: ${p}`);
  if (pkgs.packages.length === 0)
    return { id, severity, status: 'cannot-verify', detail: `no workspace package was found at all (${pkgs.problems.join('; ') || 'readPackages found none'}) — there is no graph to judge` };

  const man = manifestClaims(pkgs);
  problems.push(...man.problems);
  notes.push(...man.notes);

  const spec = specifierClaims(root, pkgs, visible);
  problems.push(...spec.problems);
  notes.push(...spec.notes);

  const alias = aliasClaims(root, pkgs);
  problems.push(...alias.problems);
  notes.push(...alias.notes);

  const closure = closureClaims(root, pkgs, probe);
  notes.push(...closure.notes);
  for (const p of closure.problems) {
    if (p.includes('did NOT run') || p.includes('could not be read')) unverifiable.push(p);
    else problems.push(p);
  }

  // Claim 6, both directions — weighed differently on purpose (see the header).
  for (const pkg of pkgs.packages) {
    if (pkg.name === null) continue;
    const declaredHere = man.declared.get(pkg.name) ?? new Set();
    const real = new Set([...(spec.used.get(pkg.name) ?? []), ...(closure.reached.get(pkg.name) ?? [])]);
    for (const to of [...real].toSorted(byString))
      if (!declaredHere.has(to))
        problems.push(
          `${pkg.manifestRel}: the code imports ${to} and the manifest declares no edge to it — an edge nobody declared is a boundary crossing nobody owns; declare the dependency or delete the import`,
        );
    const unused = [...declaredHere].filter((to) => !real.has(to)).toSorted(byString);
    if (unused.length) notes.push(`${String(pkg.name)} declares ${unused.join(', ')} and no source imports ${unused.length === 1 ? 'it' : 'them'} yet — a declared dependency waiting for its first caller, named rather than failed (see the header)`);
  }

  if (!existsSync(join(root, 'pnpm-workspace.yaml'))) unverifiable.push('pnpm-workspace.yaml is absent — the workspace members cannot be enumerated, so the edge set is about an unknown number of packages');
  const ox = readJsoncFile(root, '.oxlintrc.jsonc');
  if (!ox.exists) notes.push('.oxlintrc.jsonc is absent — not this light\'s subject, but the lint lane that would also notice an illegal import is not configured');

  const summary = [...new Set(notes)].join(' · ');
  if (problems.length) return { id, severity, status: 'fail', detail: `${String(problems.length)} problem(s): ${problems.join(' || ')} · ${summary}` };
  if (unverifiable.length)
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail: `${String(unverifiable.length)} half/halves of the graph could not be read: ${unverifiable.join(' || ')} · ${summary} · a half that did not run is not a half that passed`,
    };
  return { id, severity, status: 'pass', detail: `${String(ALLOWED_EDGES.length)} allowed edge(s), no cycle, no escaping relative import, no alias · ${summary}` };
}
