/**
 * L-deps — a dependency enters this repository through a DECLARATION, and the
 * manifest, the lockfile and the vendor digest must be saying the same thing.
 *
 * Zero dependencies, Node 22 ESM. RANGE-BASED: every judged fact is read with
 * `git show <rev>:<path>` through `../lib/git.mjs`, never with `readFileSync`.
 * A gate that read the work tree would go green on the very `pnpm add` the
 * commit it guards does not contain, and no gate here reads the index.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE SIX THINGS THIS LIGHT SAYS, AND WHY EACH ONE IS SEPARATE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. AN ADDITION NEEDS A DECLARATION. A name that is in a judged group at HEAD
 *    and was not at the base is declared by a `package: <name> — <why>` line
 *    beginning at COLUMN ZERO of a commit message in the range, or by the
 *    package allowlist a spec's wave named (`ctx.allow`). `../lib/trailers.mjs`
 *    is the one reader of that line, and its whole property is the negative
 *    one: an indented, quoted, bulleted or mis-cased copy declares NOTHING, so
 *    a doc or a skill may quote the form as an example. Near-misses are
 *    REPORTED rather than dropped — the author who believes they declared
 *    something is the one person a silent gate hurts most.
 *
 * 2. A REMOVAL IS DECLARED BY THE TRAILER ALONE. `ctx.allow` never excuses one.
 *    An allowlist is permission for a wave to REACH for something; taking a
 *    dependency away changes what already-written code may call, and the only
 *    thing that records that is a human sentence in the commit.
 *
 * 3. devDependencies, peerDependencies AND optionalDependencies ARE JUDGED TOO.
 *    Not for symmetry: a dev dependency EXECUTES CODE on this machine — a
 *    postinstall script, a vite plugin, a reporter the gates read the output of
 *    — and an optional one executes it when it happens to install. A gate that
 *    watched `dependencies` only would watch the group with the least reach.
 *    (The port plan names the first three; the fourth is here for the same
 *    stated reason, and the detail lists which groups were judged.)
 *
 * 4. LOCKFILE DRIFT THAT TOUCHED NO MANIFEST IS NAMED ON ITS OWN. A changed
 *    `pnpm-lock.yaml` with no changed manifest is a moved dependency tree that
 *    no manifest and no trailer mentions — it cannot be found by looking at
 *    additions, because there are none. The reverse pairing is named too: a
 *    manifest whose dependency set moved while the lock stood still.
 *
 * 5. A PRERELEASE SPECIFIER NEEDS A TECH-DEBT ENTRY. `-beta`, `-rc`, `-alpha`,
 *    `-next`, `-exp`, `-canary` or a bare dist-tag: something whose API may
 *    move under us is a debt, and a debt in this repository is a file under
 *    `docs/tech-debt/`, not a memory.
 *
 * 6. A RUNTIME DEPENDENCY NEEDS `docs/vendor/<package>.md`. The rule and its
 *    asymmetry are stated in `docs/vendor/README.md`: our own code calls a
 *    runtime package's members, and a wrong member name is a bug no probe will
 *    find for us, while a dev dependency is a TOOL pinned by the measured shape
 *    of its artifact (ADR-0002). A newly added runtime dependency needs the
 *    digest IN THE SAME RANGE, and every runtime dependency's digest must carry
 *    a `Version:` line equal to the lockfile's resolved version — that line is
 *    the only thing that makes a stale digest visible.
 *
 *    A `workspace:` / `link:` / `file:` specifier is not a vendor dependency and
 *    is exempt: `@cheq/core` is a workspace package whose surface is covered by
 *    a generated digest, never by a hand-written one (docs/vendor/README.md).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE MEASURED DEFECT THIS LIGHT EXISTS FOR (TD-0007)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * On 2026-11-01 the root `package.json` declared NO `devDependencies` at all
 * while `pnpm-lock.yaml:9-46` listed twelve for importer `.` — typescript,
 * vitest, oxlint, oxlint-tsgolint, jsdom, @playwright/test, tsx, @types/node,
 * @vitest/coverage-v8 and the three @testing-library packages. Every lane in the
 * repository ran on packages the manifest did not declare, everything kept
 * working locally because `node_modules` and the lock were intact, and NOT ONE
 * LANE SAID SO. It surfaced only because `pnpm install --frozen-lockfile` —
 * the default in CI — refuses the pair outright with
 * `ERR_PNPM_OUTDATED_LOCKFILE`, i.e. a fresh checkout would have died at
 * install before any gate could run.
 *
 * So this light compares, at HEAD, the SPECIFIER SET of every lockfile importer
 * against the `package.json` at that directory, in both directions, and names
 * the disagreement. It is the one check that would have caught that defect on
 * the commit that introduced it.
 *
 * `readLockImporters` below is a NARROW reader of the lockfile's `importers:`
 * block, written here because no module in `../lib` reads it and the one
 * hand-written YAML subset that exists (`parseYamlSubset` in
 * `../lib/spec-parse.mjs`) CANNOT parse this file — measured: it throws
 * `not a key: ".:"` on `pnpm-lock.yaml`, because `.:` is a legal pnpm importer
 * key and not a key shape that subset accepts. It reads the `importers:` block
 * and nothing else: the `packages:` section, with its resolutions and peer
 * suffixes, is somebody else's question (`L-type-engines` asks the lock which
 * type engines are present).
 *
 * MEASURED SHAPE, 2026-11-01, lockfileVersion '9.0' (indentation is the whole
 * grammar: importer 2, group 4, package 6, field 8):
 *
 *     importers:
 *
 *       .:
 *         devDependencies:
 *           '@playwright/test':
 *             specifier: ^1.64.1
 *             version: 1.64.1
 *
 *       packages/core: {}          <- a member with no dependency, in FLOW form
 *
 * Two details that would each break a naive reader: an importer key may be
 * `.` (the repository root) and a member with nothing declared appears as the
 * flow mapping `{}` rather than as an absent key; and a resolved `version` may
 * carry a PEER SUFFIX — `19.3.1(react@19.3.1)` for react-dom, measured — so the
 * version a digest is compared against is the part before the first `(`.
 */

import { basename, dirname } from 'node:path';

import { EMPTY_TREE, diffNames, hasCommits, logBodies, lsFiles, showAtHead, showAtRev } from '../lib/git.mjs';
import { byCodepoint } from './_shared.mjs';
import { parseTrailers } from '../lib/trailers.mjs';

export const id = 'L-deps';
export const severity = 'hard';

/** Every group whose entries can execute code or be imported — see point 3. */
export const JUDGED_GROUPS = Object.freeze(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']);

/** The group whose members our own code CALLS, and which therefore needs a digest. */
export const RUNTIME_GROUP = 'dependencies';

export const LOCK_REL = 'pnpm-lock.yaml';
export const VENDOR_DIR = 'docs/vendor';
export const TECH_DEBT_DIR = 'docs/tech-debt';

/** A specifier that names a package in this workspace, not a registry one. */
const LOCAL_SPEC_RE = /^(workspace|link|file|portal):/;

/** A prerelease, in either of the two forms a specifier takes: a semver
 * prerelease (`1.2.3-beta.1`, `0.9.0-exp.1`) or a bare dist-tag (`next`). */
const PRERELEASE_RE = /\d+\.\d+\.\d+-[0-9A-Za-z][0-9A-Za-z.-]*/;
const DIST_TAG_RE = /^(alpha|beta|rc|next|canary|experimental|exp|dev|nightly|insiders)$/i;

/** `docs/vendor/<package>.md`. A scoped name keeps its slash, so the digest of
 * `@scope/pkg` is `docs/vendor/@scope/pkg.md` — the same spelling the manifest
 * uses, which is what makes the path derivable instead of mapped. */
export const digestRel = (pkg) => `${VENDOR_DIR}/${pkg}.md`;

/** `**Version:** 1.2.3` → `1.2.3`, from the digest template's header line. */
const DIGEST_VERSION_RE = /^[-*\s]*\*\*Version:\*\*\s*`?([^`·|\n]+?)`?\s*(?:·|$)/m;

/** A resolved lock version without its peer suffix: `19.3.1(react@19.3.1)` → `19.3.1`. */
export const bareVersion = (v) => String(v ?? '').replace(/\(.*$/, '').trim();

/**
 * The `importers:` block of a pnpm lockfile.
 * → { ok, reason, importers: { [dir]: { [group]: { [name]: {specifier, version} } } } }
 *
 * Indentation is the grammar (see the header). Anything outside the block is
 * ignored; a line this reader does not understand INSIDE the block is reported
 * in `problems`, never skipped in silence.
 */
/** Strip one layer of matching quotes a lockfile scalar may carry. */
function unquote(s) {
  return s.replace(/^['"]|['"]$/g, '');
}

export function readLockImporters(text) {
  const src = String(text ?? '');
  if (src.trim() === '') return { ok: false, reason: `${LOCK_REL} is empty`, importers: {}, problems: [] };
  const lines = src.split('\n').map((l) => l.replace(/\r$/, ''));
  const start = lines.findIndex((l) => l === 'importers:');
  if (start === -1) return { ok: false, reason: `${LOCK_REL} has no top-level "importers:" block — this is not a pnpm lockfile shape this reader knows`, importers: {}, problems: [] };

  const importers = {};
  const problems = [];
  let dir = null;
  let group = null;
  let pkg = null;

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    // A new top-level key ends the block (`packages:`, `snapshots:`).
    if (/^\S/.test(line)) break;
    const indent = line.length - line.trimStart().length;
    const body = line.trim();

    if (indent === 2) {
      const m = /^(.+?):\s*(\{\s*\}|)$/.exec(body);
      if (m === null) {
        problems.push(`${LOCK_REL}:${i + 1}: expected an importer directory key, got ${JSON.stringify(body)}`);
        continue;
      }
      dir = unquote(m[1].trim());
      group = null;
      pkg = null;
      importers[dir] = importers[dir] ?? {};
      continue;
    }
    if (dir === null) {
      problems.push(`${LOCK_REL}:${i + 1}: ${JSON.stringify(body)} is indented under no importer`);
      continue;
    }
    if (indent === 4) {
      group = unquote(body.replace(/:$/, '').trim());
      pkg = null;
      importers[dir][group] = importers[dir][group] ?? {};
      continue;
    }
    if (indent === 6) {
      if (group === null) {
        problems.push(`${LOCK_REL}:${i + 1}: ${JSON.stringify(body)} is indented under no dependency group`);
        continue;
      }
      pkg = unquote(body.replace(/:$/, '').trim());
      importers[dir][group][pkg] = { specifier: null, version: null };
      continue;
    }
    if (indent >= 8) {
      if (group === null || pkg === null) {
        problems.push(`${LOCK_REL}:${i + 1}: ${JSON.stringify(body)} is indented under no package`);
        continue;
      }
      const m = /^(specifier|version):\s*(.*)$/.exec(body);
      if (m === null) continue; // a field this reader does not need; the two it does are named
      importers[dir][group][pkg][m[1]] = unquote(m[2].trim());
      continue;
    }
    problems.push(`${LOCK_REL}:${i + 1}: indent ${indent} is outside the 2/4/6/8 grammar of an importers block`);
  }

  return { ok: true, reason: null, importers, problems };
}

/** The four judged groups of one parsed manifest, as `name → { spec, group }`. */
function declaredOf(raw) {
  const out = new Map();
  for (const group of JUDGED_GROUPS) {
    const g = raw?.[group];
    if (g === null || typeof g !== 'object' || Array.isArray(g)) continue;
    for (const [name, spec] of Object.entries(g)) out.set(`${group}\u0000${name}`, { name, group, spec: String(spec) });
  }
  return out;
}

function manifestAt(rev, path, cwd) {
  const r = rev === EMPTY_TREE ? { ok: false, text: null, reason: 'the empty tree holds no file' } : showAtRev(rev, path, { cwd });
  if (!r.ok) return { exists: false, raw: null, declared: new Map(), reason: r.reason, text: null };
  try {
    const raw = JSON.parse(r.text);
    return { exists: true, raw, declared: declaredOf(raw), reason: null, text: r.text };
  } catch (e) {
    return { exists: true, raw: null, declared: new Map(), reason: `not valid JSON at ${rev.slice(0, 7)}: ${String(e.message)}`, text: r.text };
  }
}

/** The 1-based line of a `"name":` key inside a manifest's text, for a citation. */
function lineOfKey(text, key) {
  const lines = String(text ?? '').split('\n');
  for (let i = 0; i < lines.length; i += 1) if (lines[i].includes(`"${key}"`)) return i + 1;
  return null;
}

function isPrerelease(spec) {
  const s = String(spec ?? '').trim();
  if (LOCAL_SPEC_RE.test(s)) return false;
  if (DIST_TAG_RE.test(s)) return true;
  return PRERELEASE_RE.test(s);
}

export function run({ root = process.cwd(), mb = null, allow = [], rangeKind = null } = {}) {
  const cwd = root;
  if (!hasCommits({ cwd }))
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail:
        'this repository has no commits — L-deps is range-based and reads every manifest with `git show <rev>:<path>` on purpose ' +
        '(reading the work tree would make an uncommitted `pnpm add` invisible to the commit that lands it). ' +
        'Cure: commit the scaffold, then run again. "It never ran" is not green.',
    };

  // Annotated because the type engine cannot prove this is a string from the
  // narrowing alone (`mb` defaults to null), and an unproven type in a template
  // literal is a lint error. A JSDoc type is read by tsgolint, which IS the type
  // engine — it is an annotation, not a cast that hides anything.
  /** @type {string} */
  const base = typeof mb === 'string' && mb.length > 0 ? mb : EMPTY_TREE;
  const wholeHistory = base === EMPTY_TREE;
  const logRange = wholeHistory ? 'HEAD' : `${base}..HEAD`;
  const rangeLabel = `${wholeHistory ? 'empty tree' : base.slice(0, 7)}..HEAD (${rangeKind ?? 'range kind not declared by the pack'})`;

  const problems = [];
  const notes = [];

  // -------------------------------------------------------------- the range
  const diff = diffNames(base, 'HEAD', { cwd });
  if (!diff.ok) return { id, severity, status: 'cannot-verify', detail: `cannot read the range ${rangeLabel}: ${diff.reason}` };
  const changed = new Set(diff.files);

  const changedManifests = [...changed].filter((f) => basename(f) === 'package.json' && !f.split('/').includes('node_modules')).toSorted(byCodepoint);
  const lockChanged = changed.has(LOCK_REL);

  // ------------------------------------------------------- the declarations
  const log = logBodies(logRange, { cwd });
  if (!log.ok) return { id, severity, status: 'cannot-verify', detail: `cannot read the commit messages of ${rangeLabel}: ${log.reason}` };
  if (wholeHistory) notes.push('the trailer log spans the whole history (the base is the empty tree, where every file IS an addition)');

  const declarations = [];
  const nearMisses = [];
  for (const message of log.messages) {
    const parsed = parseTrailers(message);
    const subject = (message.split('\n')[0] ?? '').trim() || '(no subject)';
    for (const t of parsed.trailers) {
      if (t.name !== 'package') continue;
      if (t.parsed.shapeOk !== true) {
        nearMisses.push({ subject, line: t.line, text: `package: ${t.value}`, reasons: [`does not match \`${t.parsed.expected}\` — the em dash is the declared separator`] });
        continue;
      }
      declarations.push({ pkg: t.parsed.pkg, why: t.parsed.why, subject, line: t.line });
    }
    for (const r of parsed.rejected) if (r.name === 'package') nearMisses.push({ subject, line: r.line, text: r.text.trim(), reasons: r.reasons });
  }
  const declaredNames = new Set(declarations.map((d) => d.pkg));
  const allowed = new Set(allow ?? []);

  const nearMissFor = (pkg) =>
    nearMisses.filter((n) => n.text.includes(pkg)).map((n) => `commit "${n.subject}":${n.line} "${n.text}" declares nothing (${n.reasons.join('; ')})`);

  // ------------------------------------- additions and removals, per manifest
  let added = 0;
  let removed = 0;
  let bumped = 0;
  /** Every name that entered or left a manifest in this range — what a
   * `package:` declaration can legitimately be about. */
  const touchedNames = new Set();
  for (const rel of changedManifests) {
    const before = manifestAt(base, rel, cwd);
    const after = manifestAt('HEAD', rel, cwd);
    if (before.exists && before.raw === null) problems.push(`${rel}: ${before.reason}`);
    if (after.exists && after.raw === null) {
      problems.push(`${rel}: ${after.reason} — a manifest a gate cannot parse is a manifest nobody judged`);
      continue;
    }
    if (!after.exists) {
      notes.push(`${rel} was deleted in this range (${before.declared.size} declared entr(y/ies) went with it)`);
      continue;
    }

    for (const [key, entry] of after.declared) {
      const old = before.declared.get(key);
      const where = `${rel}:${lineOfKey(after.text, entry.name) ?? '?'}`;
      if (old === undefined) {
        added += 1;
        touchedNames.add(entry.name);
        if (declaredNames.has(entry.name) || allowed.has(entry.name)) continue;
        problems.push(
          `${where}: ${entry.name} entered ${entry.group} and nothing declares it — add a line BEGINNING at column zero of the commit message: ` +
            `\`package: ${entry.name} — <why>\` (or name it in the spec wave's allow list).` +
            (nearMissFor(entry.name).length > 0 ? ` Near-miss: ${nearMissFor(entry.name).join('; ')}` : ''),
        );
        continue;
      }
      if (old.spec !== entry.spec) {
        bumped += 1;
        notes.push(`${where}: ${entry.name} moved ${old.spec} → ${entry.spec} in ${entry.group} (a bump; the digest Version check below is what catches a stale digest)`);
      }
    }

    for (const [key, entry] of before.declared) {
      if (after.declared.has(key)) continue;
      removed += 1;
      touchedNames.add(entry.name);
      // The allowlist deliberately does NOT reach here — see point 2.
      if (declaredNames.has(entry.name)) continue;
      problems.push(
        `${rel}: ${entry.name} LEFT ${entry.group} and nothing declares it — a removal changes what already-written code may call, and the package ` +
          `allowlist never excuses one: the only declaration is a line beginning at column zero, \`package: ${entry.name} — <why it goes>\`.` +
          (nearMissFor(entry.name).length > 0 ? ` Near-miss: ${nearMissFor(entry.name).join('; ')}` : ''),
      );
    }
  }

  // ------------------------------------------------- point 4: the two drifts
  if (lockChanged && changedManifests.length === 0)
    problems.push(
      `${LOCK_REL} changed in ${rangeLabel} and NOT ONE package.json did — the dependency tree moved with nothing in any manifest to point at, ` +
        'so no addition and no removal can be found by reading the manifests. Declare what moved (`package: <name> — <why>` at column zero), or ' +
        'reconcile the lock with the manifests and commit the pair together.',
    );
  if (!lockChanged && (added > 0 || removed > 0))
    problems.push(
      `${added} addition(s) and ${removed} removal(s) across ${changedManifests.length} manifest(s) in ${rangeLabel} while ${LOCK_REL} did not change — ` +
        'a manifest and a lock that disagree install differently from what either file says (TD-0007); run `pnpm install` and commit the lock with the manifest.',
    );

  // --------------------------------- point 6 + TD-0007: HEAD manifests vs lock
  const lockRead = showAtHead(LOCK_REL, { cwd });
  let lock = { ok: false, reason: `no ${LOCK_REL} at HEAD: ${lockRead.reason ?? 'absent'}`, importers: {}, problems: [] };
  if (lockRead.ok) lock = readLockImporters(lockRead.text);
  if (!lock.ok) problems.push(`${lock.reason} — the lock of record is HEAD's (ADR-0003), and without it no manifest can be checked against what is installed`);
  for (const p of lock.problems) problems.push(p);

  const tracked = lsFiles([], { cwd });
  if (!tracked.ok) return { id, severity, status: 'cannot-verify', detail: `git ls-files failed: ${tracked.reason}` };
  const headManifests = tracked.files.filter((f) => basename(f) === 'package.json' && !f.split('/').includes('node_modules')).toSorted();
  const headManifestDirs = new Set(headManifests.map((f) => (dirname(f) === '.' ? '.' : dirname(f))));

  const tdFiles = tracked.files.filter((f) => f.startsWith(`${TECH_DEBT_DIR}/`) && f.endsWith('.md') && basename(f).startsWith('TD-'));
  const tdTexts = new Map();
  for (const f of tdFiles) {
    const r = showAtHead(f, { cwd });
    if (r.ok) tdTexts.set(f, r.text);
  }
  const tdNaming = (pkg) => [...tdTexts].filter(([, text]) => text.includes(pkg)).map(([f]) => f);

  let runtimeChecked = 0;
  for (const rel of headManifests) {
    const dir = dirname(rel) === '.' ? '.' : dirname(rel);
    const m = manifestAt('HEAD', rel, cwd);
    if (!m.exists || m.raw === null) {
      if (m.exists) problems.push(`${rel}: ${m.reason}`);
      continue;
    }

    // --- the specifier sets, both directions (TD-0007)
    const lockImporter = lock.importers[dir];
    if (lock.ok) {
      if (lockImporter === undefined) {
        problems.push(
          `${rel} is a tracked manifest and ${LOCK_REL} has no importer "${dir}" — pnpm never resolved this package, so nothing anyone installs ` +
            'matches it (run `pnpm install` and commit the lock)',
        );
      } else {
        for (const [key, entry] of m.declared) {
          void key;
          const inLock = lockImporter[entry.group]?.[entry.name];
          const where = `${rel}:${lineOfKey(m.text, entry.name) ?? '?'}`;
          if (inLock === undefined) {
            problems.push(
              `${where}: ${entry.group}.${entry.name} is declared and ${LOCK_REL} importer "${dir}" does not list it — the manifest and the lock ` +
                'disagree, and `pnpm install --frozen-lockfile` (the CI default) refuses the pair with ERR_PNPM_OUTDATED_LOCKFILE',
            );
            continue;
          }
          if (inLock.specifier !== null && inLock.specifier !== entry.spec)
            problems.push(
              `${where}: ${entry.group}.${entry.name} is "${entry.spec}" in the manifest and "${inLock.specifier}" in ${LOCK_REL} importer "${dir}" — ` +
                'take the specifier from the lock or re-resolve it; a pair that disagrees installs what neither file says (TD-0007)',
            );
        }
        for (const [group, entries] of Object.entries(lockImporter)) {
          if (!JUDGED_GROUPS.includes(group)) continue;
          for (const name of Object.keys(entries)) {
            if (m.declared.has(`${group}\u0000${name}`)) continue;
            problems.push(
              `${LOCK_REL} importer "${dir}" lists ${group}.${name} and ${rel} declares no such entry — THIS IS THE MEASURED DEFECT (TD-0007): on ` +
                '2026-11-01 the root manifest had lost all twelve devDependencies while the lock still listed them, every lane ran on packages no ' +
                'manifest declared, and no lane said so. Copy the specifier out of the lock into the manifest (never from memory).',
            );
          }
        }
      }
    }

    // --- point 5: a prerelease needs a TD entry
    for (const [, entry] of m.declared) {
      if (!isPrerelease(entry.spec)) continue;
      const where = `${rel}:${lineOfKey(m.text, entry.name) ?? '?'}`;
      const named = tdNaming(entry.name);
      if (named.length === 0)
        problems.push(
          `${where}: ${entry.name} is pinned to the prerelease "${entry.spec}" and no ${TECH_DEBT_DIR}/TD-*.md names it — a package whose API may move ` +
            `under us is a debt this repository writes down (${tdFiles.length} TD entr(y/ies) read at HEAD, none mentioning it)`,
        );
      else notes.push(`${entry.name} ${entry.spec} is a prerelease, recorded in ${named.join(', ')}`);
    }

    // --- point 6: the vendor digest of every RUNTIME dependency
    const runtime = m.raw?.[RUNTIME_GROUP];
    if (runtime === null || typeof runtime !== 'object' || Array.isArray(runtime)) continue;
    for (const [name, specRaw] of Object.entries(runtime)) {
      const spec = String(specRaw);
      const where = `${rel}:${lineOfKey(m.text, name) ?? '?'}`;
      if (LOCAL_SPEC_RE.test(spec)) {
        notes.push(`${name} (${spec}) at ${where} is a workspace package, not a vendor one — its surface is a generated digest, never a hand-written docs/vendor file`);
        continue;
      }
      runtimeChecked += 1;
      const dRel = digestRel(name);
      const digest = showAtHead(dRel, { cwd });
      const known = tdNaming(name);
      if (!digest.ok) {
        problems.push(
          `${where}: ${name} is a RUNTIME dependency and ${dRel} does not exist at HEAD — our own code calls this package's members, and a wrong ` +
            `member name is a bug no probe finds for us (docs/vendor/README.md). Write the digest from the template in the commit that adds the dependency` +
            `${known.length > 0 ? `; recorded as known debt in ${known.join(', ')}, which does not excuse it` : ''}.`,
        );
        continue;
      }
      const wasAddedHere = [...changed].some((f) => f === rel) && manifestAt(base, rel, cwd).declared.get(`${RUNTIME_GROUP}\u0000${name}`) === undefined;
      if (wasAddedHere && !changed.has(dRel))
        problems.push(
          `${where}: ${name} entered ${RUNTIME_GROUP} in ${rangeLabel} and ${dRel} was not touched in the same range — the digest is written in the ` +
            'commit that adds the dependency, so the first caller has a surface to cite',
        );
      const vm = DIGEST_VERSION_RE.exec(digest.text);
      if (vm === null) {
        problems.push(
          `${dRel}: no \`**Version:**\` line — that line is the only thing that makes a stale digest visible (docs/vendor/README.md), so a digest ` +
            'without it cannot be checked against the lock',
        );
        continue;
      }
      const stated = vm[1].trim();
      const locked = bareVersion(lock.importers[dir]?.[RUNTIME_GROUP]?.[name]?.version ?? '');
      if (locked === '') {
        problems.push(`${dRel}: states Version ${stated} and ${LOCK_REL} importer "${dir}" resolves no version for ${name} — nothing to compare it against`);
        continue;
      }
      if (stated !== locked)
        problems.push(
          `${dRel}: states \`**Version:** ${stated}\` while ${LOCK_REL} importer "${dir}" resolves ${name} to ${locked} — a digest is updated in the ` +
            'same commit that bumps its package, and this line is how a stale one is seen',
        );
    }
  }

  // --- an importer the lock knows and no tracked manifest does
  if (lock.ok)
    for (const dir of Object.keys(lock.importers))
      if (!headManifestDirs.has(dir))
        problems.push(`${LOCK_REL} has an importer "${dir}" and no tracked package.json lives there — the lock describes a workspace member that is not in the repository`);

  // ---------------------------------------------------------------- the row
  for (const n of nearMisses)
    notes.push(`commit "${n.subject}":${n.line} — "${n.text}" is not a declaration (${n.reasons.join('; ')}); it declares nothing`);
  // A declaration that matched no change is printed on the GREEN path too, for
  // the same reason a near-miss is: "I declared it" and "the gate read it" must
  // never diverge in silence.
  for (const d of declarations)
    if (!touchedNames.has(d.pkg))
      notes.push(`commit "${d.subject}":${d.line} — \`package: ${d.pkg}\` matches no addition or removal in this range; it declares nothing here`);

  const summary = [
    `range ${rangeLabel}`,
    `${changedManifests.length} manifest(s) changed, ${added} addition(s), ${removed} removal(s), ${bumped} bump(s)`,
    `${declarations.length} \`package:\` declaration(s)${allowed.size > 0 ? `, allow [${[...allowed].join(', ')}]` : ''}`,
    `${LOCK_REL} ${lockChanged ? 'changed' : 'unchanged'}`,
    `${headManifests.length} manifest(s) at HEAD vs ${Object.keys(lock.importers).length} lock importer(s)`,
    `${runtimeChecked} runtime dependenc(y/ies) checked for a digest`,
    `groups judged: ${JUDGED_GROUPS.join(', ')}`,
  ];
  summary.push(...notes);

  if (problems.length > 0)
    return { id, severity, status: 'fail', detail: `${problems.length} dependency problem(s): ${problems.join(' · ')} [${summary.join(' · ')}]` };

  return { id, severity, status: 'pass', detail: summary.join(' · ') };
}
