#!/usr/bin/env node
/**
 * L-homes (SOFT) — one owner per shared file. The files `tools/gates/homes.json`
 * declares shared are the ones where "who owns this line" has to be answered by
 * a declaration rather than by whoever committed last. This light takes the
 * files changed in the range, intersects them with that list, and checks each
 * one against the UNION of the `home:` values of the specs touched in the SAME
 * range. It REPORTS; it does not block.
 *
 *     node tools/gates/lights/homes.mjs
 *
 * Zero dependencies, Node 22 ESM. The module contract lives in `./_shared.mjs`;
 * the manifest is read through `readHomes` — the ONE reader of that file — and
 * its entry shape is checked by `manifestProblems` there, not here.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY SOFT, AND WHAT WOULD MAKE IT HARD — the condition, not somebody's memory
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * In a three-package monorepo a HARD light on shared files would block ordinary
 * work before enough specs exist to have named homes: with no spec naming a
 * home, every union is empty and every edit of a shared file is a finding, which
 * is noise rather than evidence. The second half of the reason is about the
 * medium: a merge conflict in TypeScript is visible by itself. The Resonance
 * original was written against a Unity scene, where two systems editing one
 * `.unity` file produces a silently merged binary-ish YAML nobody reviews — that
 * is the risk soft would be wrong for, and this repository does not have it.
 *
 * THE REVISION CONDITION, stated so it is checkable and not remembered: the
 * severity is reconsidered once `homes.json` holds MORE THAN ONE entry. Until
 * then soft is the honest setting. `severity` is declared in TWO places on
 * purpose — the module below and `STANDING_LIGHTS` in `../lib/spec-parse.mjs`,
 * which is the table `normalizeResult` lets win — so flipping it is one edit in
 * the table plus one here, and a half-done flip is printed as a disagreement
 * rather than silently resolved. The same sentence is in `homes.json`'s own
 * `_note`, beside the empty list it explains.
 *
 * Soft is a property of the SEVERITY, never of the status: a finding here is a
 * `fail`, and `run.mjs` blocks only on `severity === 'hard'`. A soft light that
 * downgraded its own findings to `pass` would be a light that reports nothing.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHICH `home:` FORMS NAME A FILE — three answers, not one
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * A `home:` value is a ` + `-joined list (docs/templates/SPEC.md:88) and its
 * parts do not all name a file:
 *
 *   `module: <path>`, `screen: <path>`  a repo-relative FILE. These are what a
 *                                       changed path is compared against.
 *   `@cheq/<name>`                      a PACKAGE. Its directory is the home, so
 *                                       a changed file under that directory is
 *                                       covered. The package directory is read
 *                                       from the workspace (`readPackages`),
 *                                       never guessed from the name.
 *   `route: <METHOD /path>`             an HTTP route, NOT a path on disk
 *                                       (spec-gate.mjs:364 deliberately does not
 *                                       check it for existence). It contributes
 *                                       no file, and the row says so instead of
 *                                       reading `/tasks` as a directory.
 *   `new:` `deferred:` `out of scope:` `blocked:`   escapes. They contribute no
 *                                       file either, and each is named in the
 *                                       detail: "the specs in this range named
 *                                       no home" and "they named only escapes"
 *                                       are different states.
 *
 * `parseHome` in `../lib/spec-parse.mjs` is the one reader of ONE part's shape.
 * Splitting the ` + ` list is NOT in the library (see the report accompanying
 * this file): `spec-gate.mjs:342` does it in a private function inside a
 * top-level script that runs on import, so it cannot be reused. The split here
 * is the same literal ` + ` and nothing more.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE RANGE IS THE PACK'S RANGE, AND THE SPEC IS READ AT HEAD
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `ctx.mb` and `ctx.rangeKind` come from `run.mjs`, which is the one place that
 * answers which commit the range starts at; a light that re-derived it could
 * report about a different range than the row above it. The spec itself is read
 * with `git show HEAD:<path>` and never from the work tree: an uncommitted edit
 * of a spec must not be able to authorise a change in the commit being judged.
 *
 * A changed spec that does not exist at HEAD (deleted in the range) is reported
 * as a problem rather than silently contributing nothing — a deleted spec's
 * homes are exactly the ones whose files are now unowned.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHome, parseSpec, specIdOfPath } from '../lib/spec-parse.mjs';
import { baseRev, diffNames, hasCommits, repoRoot, showAtHead } from '../lib/git.mjs';
import { jsonLine, normalizeResult, normRel, readHomes, readPackages, readPremises, under } from './_shared.mjs';

export const id = 'L-homes';
export const severity = 'soft';

/** The `home:` forms whose value is a repo-relative FILE. See the header. */
export const HOME_FILE_FORMS = Object.freeze(['module', 'screen']);

/** The separator a `home:` value joins its parts with (docs/templates/SPEC.md:88). */
export const HOME_JOIN = ' + ';

/** How many names a detail lists before it says "and n more". A detail is one
 * table cell; the full list is what the spec file itself carries. */
const SHOWN = 6;

const list = (xs, shown = SHOWN) => {
  const a = [...xs];
  return a.length <= shown ? a.join(', ') : `${a.slice(0, shown).join(', ')} and ${String(a.length - shown)} more`;
};

/**
 * One ` + `-joined `home:` value → the homes it names.
 * → { files, packages, routes, escapes, bare }
 *
 * `bare` holds a part that is neither a known form nor a `@cheq/` package name:
 * it is reported, never read as the nearest known form. Nothing here touches the
 * filesystem — `packages` are NAMES, which the caller resolves to directories
 * through the workspace reader.
 */
export function homeParts(raw) {
  const out = { files: [], packages: [], routes: [], escapes: [], bare: [] };
  for (const part of String(raw ?? '')
    .split(HOME_JOIN)
    .map((s) => s.trim())
    .filter(Boolean)) {
    const h = parseHome(part);
    if (HOME_FILE_FORMS.includes(h.form)) {
      const p = normRel(h.path);
      if (p === null) out.bare.push(part);
      else out.files.push(p);
      continue;
    }
    if (h.form === 'route') {
      out.routes.push(part);
      continue;
    }
    if (h.unknownForm !== null) {
      out.escapes.push(part);
      continue;
    }
    if (/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(h.raw)) out.packages.push(h.raw);
    else out.bare.push(part);
  }
  return out;
}

/**
 * The union of homes named by the specs touched in the range.
 * → { files: Set, dirs: [{ name, rel }], routes, escapes, bare, specs, problems }
 *
 * `dirs` are package directories, resolved from the workspace: a bare
 * `@cheq/core` is the package's whole tree, and the tree is where the workspace
 * says it is, not where the name suggests.
 */
export function unionOfHomes(root, specPaths, packages) {
  const files = new Set();
  const dirs = [];
  const routes = [];
  const escapes = [];
  const bare = [];
  const specs = [];
  const problems = [];
  const notes = [];

  for (const rel of specPaths) {
    const specId = specIdOfPath(rel);
    const shown = specId ?? rel;
    const at = showAtHead(rel, { cwd: root });
    if (!at.ok) {
      problems.push(
        `${rel}: touched in this range and absent from HEAD (${at.reason}) — a deleted spec's homes are exactly the files that are now unowned, so its union cannot be read; re-add it or re-home its files in another spec`,
      );
      continue;
    }
    const spec = parseSpec(at.text, { path: rel });
    specs.push(shown);
    for (const a of spec.assertions) {
      if (a.withdrawn) continue;
      // A NOTE and not a problem: an assertion with no `home:` simply adds
      // nothing to the union, and the union stays readable — whereas a spec
      // absent at HEAD or a home part nobody can parse means the union may be
      // INCOMPLETE, which is the only thing that makes a verdict here
      // unreliable. A missing `home:` is spec-gate's finding (rule: `check:` and
      // `home:` are its jurisdiction), and reporting it as cannot-verify here
      // would turn one unfinished spec into a row that claims nothing.
      if (a.homeRaw === null) {
        notes.push(`${rel}:${String(a.line)}: ${String(a.id)} declares no \`home:\`, so it adds nothing to the union — that is spec-gate's finding, not this light's`);
        continue;
      }
      const parts = homeParts(a.homeRaw);
      for (const f of parts.files) files.add(f);
      for (const name of parts.packages) {
        const pkg = packages.byName?.get(name) ?? null;
        if (pkg === null) problems.push(`${rel}:${String(a.line)}: ${String(a.id)} homes in ${String(name)}, which is not a workspace package — the union gains no directory from it`);
        else dirs.push({ name, rel: pkg.rel });
      }
      routes.push(...parts.routes.map((r) => `${shown}/${String(a.id)}: ${String(r)}`));
      escapes.push(...parts.escapes.map((e) => `${shown}/${String(a.id)}: ${String(e)}`));
      bare.push(...parts.bare.map((b) => `${rel}:${String(a.line)}: ${String(a.id)} home part ${JSON.stringify(b)} is not a declared form`));
    }
  }

  return { files, dirs, routes, escapes, bare, specs, problems, notes };
}

/** What in the union covers `rel`, or null. A file covers it by equality, a
 * package directory by containment. */
export function coveredBy(rel, union) {
  for (const f of union.files) if (under(rel, f)) return `module/screen home ${f}`;
  for (const d of union.dirs) if (under(rel, d.rel)) return `package home ${d.name} (${d.rel}/)`;
  return null;
}

export function run(ctx = {}) {
  const root = ctx.root ?? process.cwd();
  const man = readHomes(root);

  if (!man.exists || man.data === null) return { id, severity, status: 'cannot-verify', detail: man.problems.join('; ') };
  if (!man.ok)
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail: `${man.rel} does not pass its shape check, so what it declares shared cannot be judged: ${man.problems.join('; ')}`,
    };

  const entries = (Array.isArray(man.data.entries) ? man.data.entries : [])
    .map((e) => ({ path: normRel(e?.path), why: String(e?.why ?? '') }))
    .filter((e) => e.path !== null);

  if (entries.length === 0) {
    const where = jsonLine(man.text, 'entries');
    return {
      id,
      severity,
      status: 'pass',
      detail:
        `${man.rel}${where === null ? '' : `:${String(where)}`}: "entries" is empty, which is a statement and not a gap — no spec file exists yet, so no file has an owner and nothing can be shared between owners. ` +
        'There is nothing to intersect a change with, so this light reports on no file. ' +
        `It starts judging with the first entry, and this light's severity (${severity}) is reconsidered once the list holds more than ONE entry (the condition is also in ${man.rel}'s own "_note")`,
    };
  }

  // The pack resolved the range; a light that asked git the same question again
  // could answer about a different range than the row above it.
  const mb = typeof ctx.mb === 'string' && ctx.mb.length > 0 ? ctx.mb : null;
  if (mb === null)
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail:
        'the pack passed no base for the range (ctx.mb), so there is no set of changed files to intersect with ' +
        `${man.rel} — run.mjs resolves the range once and hands it to every light, and this light never re-derives it`,
    };
  const rangeNote = `${mb.slice(0, 7)}..HEAD (${ctx.rangeKind ?? 'range kind not declared by the pack'})`;

  const d = diffNames(mb, 'HEAD', { cwd: root });
  if (!d.ok) return { id, severity, status: 'cannot-verify', detail: `git diff over ${rangeNote} failed: ${String(d.reason)} — a range nobody could read is never clean` };
  const changed = d.files;

  const touched = entries.filter((e) => changed.some((f) => under(f, e.path)));
  const specPaths = changed.filter((f) => specIdOfPath(f) !== null);

  if (touched.length === 0)
    return {
      id,
      severity,
      status: 'pass',
      detail:
        `${rangeNote}: ${String(changed.length)} changed file(s), none of the ${String(entries.length)} shared file(s) ${man.rel} declares among them` +
          (specPaths.length ? ` (${String(specPaths.length)} spec file(s) touched: ${list(specPaths.map((p) => String(specIdOfPath(p))))})` : ''),
    };

  const packages = readPackages(root);
  const union = unionOfHomes(root, specPaths, packages);

  const problems = [];
  // Kept apart all the way to the row rather than distinguished later by the
  // words in a message: a status decided by searching a string is a status that
  // changes when somebody rewords a sentence.
  const unknowns = [...union.problems, ...union.bare];
  const notes = [...union.notes];
  if (packages.problems.length) notes.push(`workspace: ${packages.problems.join('; ')}`);

  for (const e of touched) {
    const files = changed.filter((f) => under(f, e.path));
    for (const f of files) {
      const cover = coveredBy(f, union);
      if (cover !== null) continue;
      const where = jsonLine(man.text, e.path);
      const named =
        union.files.size === 0 && union.dirs.length === 0
          ? specPaths.length === 0
            ? 'no spec file was touched in this range, so no home was named at all'
            : `the ${String(union.specs.length)} spec(s) touched here (${list(union.specs)}) named no file or package home${union.routes.length ? `, only route(s): ${list(union.routes)}` : ''}${union.escapes.length ? `, only escape(s): ${list(union.escapes)}` : ''}`
          : `the homes named here are ${list([...union.files, ...union.dirs.map((x) => `${String(x.name)} (${String(x.rel)}/)`)])} — none covers it`;
      problems.push(
        `${f}: declared shared in ${man.rel}${where === null ? '' : `:${String(where)}`} (${e.why || 'no reason recorded'}) and edited in ${rangeNote}; ${named}. ` +
          'Name it as a `home:` in the spec that is changing it, or give the system its own module/screen with its own home rather than editing inside somebody else\'s',
      );
    }
  }

  const head =
    `${rangeNote}: ${String(changed.length)} changed file(s); ${String(touched.length)} of the ${String(entries.length)} shared file(s) ${man.rel} declares were touched; ` +
    `${String(specPaths.length)} spec file(s) in the range (${list(union.specs) || 'none readable at HEAD'}) name ${String(union.files.size)} file home(s) and ${String(union.dirs.length)} package home(s)`;

  // A finding outranks a cannot-verify in the row; both are printed, because "a
  // spec in this range could not be read" is not news a reader may lose because
  // something else was already red. Soft means run.mjs does not block on either.
  const status = problems.length > 0 ? 'fail' : unknowns.length > 0 ? 'cannot-verify' : 'pass';
  return { id, severity, status, detail: [head, ...problems, ...unknowns, ...notes].join(' · ') };
}

// ------------------------------------------------------------------------- cli

/**
 * `node tools/gates/lights/homes.mjs` — the command a spec's `## Lights` row
 * cites (docs/templates/SPEC.md). It prints the same row the pack prints and
 * applies the pack's own rule: a HARD light that is not `pass` exits 1, a SOFT
 * one reports and exits 0 — which is this light, so a finding here is readable
 * and never blocking. A refusal is a sentence naming the cure, never a stack
 * trace.
 */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rr = repoRoot();
  if (!rr.ok) {
    console.error(`[${id}] REFUSED: not a git work tree (${rr.reason}) — this light diffs a range and reads specs at HEAD through git.`);
    process.exit(1);
  }
  // Said HERE and not inside `run`: `run` takes the range the pack resolved, so
  // "there is no HEAD" is a fact about the invocation, not about the light. The
  // wording follows lights/run.mjs, which refuses the whole pack for the same
  // reason, so the two refusals read the same.
  if (!hasCommits({ cwd: rr.root })) {
    console.error(`[${id}] REFUSED: this repository has no commits yet.`);
    console.error('  A range-based light diffs <base>..HEAD and reads each touched spec with `git show HEAD:<path>`, never the');
    console.error('  work tree: a work-tree read would let an uncommitted spec edit authorise a change in the commit it guards.');
    console.error('  Cure: git add -A && CHEQ_SKIP_HOOKS=1 git commit -m "scaffold: …"  (the escape is .githooks/pre-commit:10), then run this again.');
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
