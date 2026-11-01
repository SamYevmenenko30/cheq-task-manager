/**
 * L-type-engines — this repository has EXACTLY ONE type engine, and this light
 * is the sentry that stops a second one coming back.
 *
 * Zero dependencies, Node 22 ESM. It reads nothing but git: `HEAD:pnpm-lock.yaml`
 * and every `package.json` in HEAD. It never runs a compiler and never parses
 * TypeScript — the question is which engines are DECLARED, which is a question
 * about committed text.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY THIS LIGHT EXISTS AT ALL — THE SHAPE IT IS GUARDING AGAINST WAS BUILT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * A two-engine arrangement was built here, verified working, and then REVERSED:
 * TypeScript 7 for the verdict of record, plus a `tools/lint` package carrying
 * TypeScript 6.0.3 so typescript-eslint could run. It is not in the repository.
 * The reason it was reversed is measured and is recorded in ADR-0004:
 *
 *   - typescript-eslint REFUSES TypeScript 7 outright — `typescript-eslint does
 *     not support TS 7.0` (typescript-eslint/typescript-eslint#10940) — and no
 *     version in the registry supports it (latest 8.72.1, canary 8.72.2-alpha.4,
 *     both with the peer range `typescript >=4.8.4 <6.1.0`). It is the ONLY
 *     TypeScript parser for eslint, so with TS 7 eslint cannot lint a `.ts` file
 *     in this repository at all;
 *   - TS 7.0.2 typechecks `packages/core` in 233-260 ms where TS 6.0.3 takes
 *     666-1126 ms, already at 25 files;
 *   - oxlint plus `oxlint-tsgolint` ("powered by typescript-go", the same line as
 *     the root compiler) covers every bug class the eslint pair covered except
 *     `require-await`, which is a configuration gap and not a capability one
 *     (TD-0003).
 *
 * So the plan's original claim — "exactly TWO engines, and exactly the declared
 * ones" — is INVERTED here. The property ADR-0004 depends on is uniqueness, and
 * uniqueness is exactly the kind of property that stops being true quietly: one
 * `pnpm add` of a tool that peers on TypeScript 6 and the repository has two
 * engines again, with no error anywhere. This light is the honest replacement for
 * the parity lane that fell out of the port: there is no parity to check with one
 * engine, but the ONENESS needs checking or it is an assumption.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE THREE ASSERTIONS
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. `git show HEAD:pnpm-lock.yaml` holds EXACTLY ONE version of the package
 *    `typescript`. Two is the reversed arrangement returning; zero means the
 *    verdict of record has no compiler.
 * 2. No `package.json` in HEAD declares `eslint`, `typescript-eslint`, an
 *    `@typescript-eslint` scoped package or an `@eslint` scoped one, in ANY
 *    dependency group. `devDependencies` counts: that is where the removed tree
 *    lived.
 * 3. `oxlint-tsgolint` is declared, and its MAJOR equals `typescript`'s major.
 *    If those diverge, the type-aware lint rules and the compile verdict are
 *    reasoning on two different engine lines again — the thing assertion 1 is
 *    about, arriving through the back door.
 *
 * A fourth, cheap and worth having: if two manifests declare `typescript` with
 * DIFFERENT specifiers, that is the reversed arrangement in its exact original
 * shape (a root on 7, a tools package on 6) even when the lock has not been
 * refreshed yet. The lock is the resolution of record; the manifests are the
 * declaration, and both are read.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * MAJOR ONLY, AND THAT IS A DECLARED LIMIT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `oxlint-tsgolint` self-releases on its own cadence — 7.0.2005 against the
 * compiler's 7.0.2 — so a minor or patch drift happens at any install and
 * pinning it would make this light red for a reason nobody can act on. TD-0008
 * states the consequence: "same engine LINE, not the same binary", with no probe
 * comparing their verdicts, and it names the tightening (major → whatever a
 * fixture set shows actually matters) as the way to close itself. The limit is
 * cited in the row so nobody reads a pass here as "the two agree".
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * HEAD, NEVER THE WORK TREE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Every read is `git show HEAD:<path>` / `git ls-tree HEAD`. Reading the work
 * tree would make the pre-commit hook turn green on an uncommitted `pnpm add`
 * that the commit it is guarding does not contain — and the index is read by
 * nobody, because the index is not what lands. A repository with no commit is
 * therefore CANNOT VERIFY naming the cure, which is also the honest state of
 * this tree before its first commit.
 */

import { basename } from 'node:path';

import { git, hasCommits, showAtHead } from '../lib/git.mjs';

export const id = 'L-type-engines';
export const severity = 'hard';

/** The lock of record: the file the clone checks out, not the one on disk. */
const LOCK_REL = 'pnpm-lock.yaml';

/** The one engine. */
const ENGINE = 'typescript';

/** The linter's type engine, which must stay on the same line. */
const TSGOLINT = 'oxlint-tsgolint';

/** Where the limit of assertion 3 is written down. */
const MAJOR_ONLY_DEBT = 'TD-0008 (docs/tech-debt/TD-0008-tsgolint-tsc-parity-unverified.md)';

/** The dependency groups a declaration can hide in. All four: `devDependencies`
 * is where the reversed two-engine tree lived. */
const GROUPS = Object.freeze(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']);

/**
 * The names whose reappearance means a second engine is back, each with what it
 * would drag in. `exact` is a whole name; `scope` is a package scope prefix.
 */
export const FORBIDDEN = Object.freeze([
  Object.freeze({ exact: 'eslint', why: 'eslint cannot lint a .ts file here at all without typescript-eslint, and typescript-eslint refuses TypeScript 7 — so declaring it means a second TypeScript is coming with it' }),
  Object.freeze({ exact: 'typescript-eslint', why: 'it peers on `typescript >=4.8.4 <6.1.0`, so it CANNOT resolve against the engine of record and pulls a second one in' }),
  Object.freeze({ scope: '@typescript-eslint', why: 'the unscoped halves of the same pair — parser, eslint-plugin, type-utils — each carrying the same peer range' }),
  Object.freeze({ scope: '@eslint', why: 'the eslint config packages (@eslint/js and friends) were removed with the reversed arrangement; their return is that arrangement returning' }),
]);

const byString = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

/** The leading integer of a semver-ish version string, or null. */
export function majorOf(version) {
  const m = /^(\d+)\./.exec(String(version ?? '').trim());
  return m === null ? null : Number.parseInt(m[1], 10);
}

/**
 * Every `<name>: {version…}` the lock's `packages:` section resolves.
 * → { ok, versions: Map<name, string[]>, reason }
 *
 * A KEY SCAN, not a YAML parse, and the difference is the claim: the question is
 * "which versions of one package does this lock resolve", which the section's
 * keys answer exactly. `parseYamlSubset` in `../lib/spec-parse.mjs` understands
 * a plain block list (it is there for `pnpm-workspace.yaml`) and a lockfile is
 * far outside it, so pretending to parse this file would be the dishonest half.
 *
 * MEASURED on lockfileVersion 9.0 (this repository, 2026-11-01):
 *   `packages:` at column 0 opens the section, `snapshots:` closes it;
 *   an entry is a 2-space-indented `name@version:`, single-quoted when the name
 *   is scoped (`'@typescript/typescript-darwin-x64@7.0.2':`); its own fields sit
 *   at 4 spaces; a peer suffix (`oxlint@1.90.0(oxlint-tsgolint@7.0.2005)`)
 *   appears in `snapshots:` and is stripped here anyway.
 *
 * THE TRAP THIS SPLIT AVOIDS: the twenty `@typescript/typescript-<platform>`
 * entries. A substring search for `typescript@` matches every one of them, so a
 * light written that way would report twenty-one versions of the engine on a
 * perfectly correct lock. The name is cut at the LAST `@`, and the name is then
 * compared whole.
 */
export function lockPackageVersions(text) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, versions: new Map(), reason: `${LOCK_REL} is empty or unreadable` };
  const versions = new Map();
  let inSection = false;
  let seen = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^[A-Za-z][\w-]*:\s*$/.test(line)) {
      inSection = line.trimEnd() === 'packages:';
      continue;
    }
    if (!inSection) continue;
    const m = /^ {2}(\S.*):\s*$/.exec(line);
    if (m === null) continue;
    let key = m[1].trim();
    if (key.startsWith("'") && key.endsWith("'")) key = key.slice(1, -1);
    key = key.replace(/\([^()]*\)$/, '');
    const at = key.lastIndexOf('@');
    if (at <= 0) continue;
    const name = key.slice(0, at);
    const version = key.slice(at + 1);
    if (version === '' || name === '') continue;
    seen += 1;
    const list = versions.get(name) ?? [];
    if (!list.includes(version)) list.push(version);
    versions.set(name, list);
  }
  if (seen === 0)
    return {
      ok: false,
      versions,
      reason: `${LOCK_REL}: no entry was read out of a "packages:" section — either the section is absent or lockfileVersion changed its shape; the key scan in lockPackageVersions() is written against lockfileVersion 9.0 and must be re-measured before this light can say anything`,
    };
  return { ok: true, versions, reason: null };
}

/**
 * Every `package.json` committed in HEAD, outside any `node_modules`.
 * → { ok, manifests: [{ rel, raw }], problems }
 */
export function manifestsAtHead(cwd) {
  const problems = [];
  const listed = git(['ls-tree', '-r', '--name-only', '--full-tree', 'HEAD'], { cwd });
  if (listed.code !== 0) return { ok: false, manifests: [], problems: [`git ls-tree HEAD failed: ${listed.stderr.split('\n')[0] ?? `exit ${String(listed.code)}`}`] };
  const paths = listed.stdout
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0 && basename(l) === 'package.json' && !l.split('/').includes('node_modules'));
  const manifests = [];
  for (const rel of paths.toSorted(byString)) {
    const shown = showAtHead(rel, { cwd });
    if (!shown.ok) {
      problems.push(`HEAD:${rel} could not be read (${String(shown.reason)}) — a manifest nobody could read may declare a second engine`);
      continue;
    }
    try {
      manifests.push({ rel, raw: JSON.parse(shown.text) });
    } catch (e) {
      problems.push(`HEAD:${rel} is not valid JSON (${String(e.message)}) — a manifest nobody could parse may declare a second engine`);
    }
  }
  if (manifests.length === 0 && problems.length === 0) problems.push('HEAD holds no package.json at all — there is no declaration to judge');
  return { ok: problems.length === 0, manifests, problems };
}

/** Every declaration of one package name across a manifest list.
 * → [{ rel, group, spec }] */
export function declarationsOf(manifests, name) {
  const out = [];
  for (const m of manifests) {
    for (const group of GROUPS) {
      const g = m.raw?.[group];
      if (g === null || g === undefined || typeof g !== 'object' || Array.isArray(g)) continue;
      if (Object.hasOwn(g, name)) out.push({ rel: m.rel, group, spec: String(g[name]) });
    }
  }
  return out;
}

// -------------------------------------------------------------------- the run

export function run({ root = process.cwd() } = {}) {
  const cwd = root;
  if (!hasCommits({ cwd }))
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail:
        `this repository has no commits — L-type-engines reads HEAD on purpose (\`git show HEAD:${LOCK_REL}\` and every package.json in HEAD), because reading the work tree would let the pre-commit hook turn green on an uncommitted \`pnpm add\` that the commit it guards does not contain. ` +
        'Cure: git add -A && CHEQ_SKIP_HOOKS=1 git commit -m "scaffold: …", then run this again. "It never ran" is not green.',
    };

  const problems = [];
  const unverifiable = [];
  const notes = [];

  // ----------------------------------------- assertion 1: one version in HEAD
  const lock = showAtHead(LOCK_REL, { cwd });
  let engineVersions = [];
  let tsgolintVersions = [];
  if (!lock.ok) {
    unverifiable.push(`HEAD:${LOCK_REL} could not be read (${String(lock.reason)}) — the lock is the resolution of record, and uniqueness cannot be asserted without it`);
  } else {
    const parsed = lockPackageVersions(lock.text);
    if (!parsed.ok) unverifiable.push(String(parsed.reason));
    else {
      engineVersions = (parsed.versions.get(ENGINE) ?? []).toSorted(byString);
      tsgolintVersions = (parsed.versions.get(TSGOLINT) ?? []).toSorted(byString);
      const platformCount = [...parsed.versions.keys()].filter((n) => n.startsWith('@typescript/typescript-')).length;
      if (engineVersions.length === 0)
        problems.push(
          `HEAD:${LOCK_REL} resolves NO version of "${ENGINE}" while it holds ${String(platformCount)} @typescript/typescript-<platform> entr(ies) — the verdict of record has no compiler; either the engine was removed or the key scan is reading the wrong section`,
        );
      else if (engineVersions.length > 1)
        problems.push(
          `HEAD:${LOCK_REL} resolves ${String(engineVersions.length)} versions of "${ENGINE}": ${engineVersions.join(', ')} — a SECOND type engine is back. ADR-0004 rests on there being one: the arrangement this replaced put TypeScript 6.0.3 in a tools package so typescript-eslint could run, and it is ~2.8x slower on packages/core (666-1126 ms against 233-260 ms, measured). Remove the second declaration and run pnpm install`,
        );
      else notes.push(`HEAD:${LOCK_REL} resolves exactly one ${ENGINE}: ${String(engineVersions[0])} (plus ${String(platformCount)} platform package(s), which are the same release and not a second engine)`);
      if (tsgolintVersions.length > 1)
        problems.push(`HEAD:${LOCK_REL} resolves ${String(tsgolintVersions.length)} versions of "${TSGOLINT}": ${tsgolintVersions.join(', ')} — the linter's type engine must be one thing too`);
    }
  }

  // ----------------------------------- assertion 2: nothing forbidden declared
  const head = manifestsAtHead(cwd);
  for (const p of head.problems) unverifiable.push(p);
  const manifests = head.manifests;

  for (const m of manifests) {
    for (const group of GROUPS) {
      const g = m.raw?.[group];
      if (g === null || g === undefined || typeof g !== 'object' || Array.isArray(g)) continue;
      for (const name of Object.keys(g).toSorted(byString)) {
        const hit = FORBIDDEN.find((f) => (f.exact !== undefined ? name === f.exact : name === f.scope || name.startsWith(`${String(f.scope)}/`)));
        if (hit === undefined) continue;
        problems.push(
          `HEAD:${m.rel} declares ${name} in "${group}" (${String(g[name])}) — ${hit.why}. ADR-0004 keeps ONE type engine; the lint lane is oxlint + ${TSGOLINT}, and a second engine is a second configuration able to disagree with the verdict of record`,
        );
      }
    }
  }

  // ------------------------- assertion 4: one declared specifier for the engine
  if (manifests.length > 0) {
    const engineDecls = declarationsOf(manifests, ENGINE);
    if (engineDecls.length === 0)
      problems.push(`no package.json in HEAD declares "${ENGINE}" — the compiler of record is then an incidental transitive install, and nothing pins it; declare it as a root devDependency`);
    else {
      const specs = [...new Set(engineDecls.map((d) => d.spec))].toSorted(byString);
      if (specs.length > 1)
        problems.push(
          `"${ENGINE}" is declared with ${String(specs.length)} different specifiers in HEAD: ${engineDecls.map((d) => `${d.rel} (${d.group}) ${d.spec}`).join(' | ')} — that is the reversed two-engine arrangement in its exact original shape (a root on one major, a tools package on another), visible in the manifests before the lock has even been refreshed`,
        );
      else notes.push(`${ENGINE} declared once: ${engineDecls.map((d) => `${d.rel} (${d.group}) ${String(specs[0])}`).join(', ')}`);
    }

    // ------------------- assertion 3: tsgolint declared, and on the same major
    const golintDecls = declarationsOf(manifests, TSGOLINT);
    if (golintDecls.length === 0)
      problems.push(
        `no package.json in HEAD declares "${TSGOLINT}" — without it oxlint's type-aware rules have no engine, and MEASURED, their absence is SILENT: the run looks like a clean pass. Declare it as a root devDependency beside ${ENGINE}`,
      );
    else notes.push(`${TSGOLINT} declared: ${golintDecls.map((d) => `${d.rel} (${d.group}) ${d.spec}`).join(', ')}`);

    const engineMajor = engineVersions.length === 1 ? majorOf(engineVersions[0]) : null;
    const golintMajor = tsgolintVersions.length === 1 ? majorOf(tsgolintVersions[0]) : null;
    if (engineMajor === null || golintMajor === null) {
      if (engineVersions.length === 1 && tsgolintVersions.length === 1)
        unverifiable.push(
          `the majors could not be compared: ${ENGINE}=${String(engineVersions[0])} ${TSGOLINT}=${String(tsgolintVersions[0])} — one of them is not a leading-integer version, so "the same engine line" is asserted about nothing`,
        );
      else if (golintDecls.length > 0 && tsgolintVersions.length === 0)
        unverifiable.push(`HEAD:${LOCK_REL} resolves no version of "${TSGOLINT}" although a manifest declares it — the lock and the manifests disagree, so the major comparison cannot be made (TD-0007 is about that disagreement generally)`);
    } else if (engineMajor !== golintMajor)
      problems.push(
        `${ENGINE} is on major ${String(engineMajor)} (${String(engineVersions[0])}) and ${TSGOLINT} on major ${String(golintMajor)} (${String(tsgolintVersions[0])}) — the type-aware lint rules and the compile verdict are then reasoning on two different engine lines, which is assertion 1's problem arriving through the back door; bring them back onto one line`,
      );
    else
      notes.push(
        `one engine line: ${ENGINE} ${String(engineVersions[0])} and ${TSGOLINT} ${String(tsgolintVersions[0])} share major ${String(engineMajor)} — MAJOR ONLY, which is a declared limit: ${TSGOLINT} self-releases on its own cadence, so "same line" is not "same binary" and nothing here compares their verdicts (${MAJOR_ONLY_DEBT})`,
      );
  }

  notes.push(`${String(manifests.length)} manifest(s) in HEAD judged across ${GROUPS.join(' + ')}`);

  const summary = [...new Set(notes)].join(' · ');
  if (problems.length) return { id, severity, status: 'fail', detail: `${String(problems.length)} problem(s): ${problems.join(' || ')} · ${summary}` };
  if (unverifiable.length)
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail: `${String(unverifiable.length)} premise(s) could not be read: ${unverifiable.join(' || ')} · ${summary} · uniqueness nobody could check is not uniqueness`,
    };
  return { id, severity, status: 'pass', detail: `exactly one type engine in HEAD · ${summary}` };
}
