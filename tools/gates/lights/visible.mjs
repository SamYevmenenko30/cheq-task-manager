/**
 * L-visible — FOUR DOORS can hide a path from a gate, and this light is the one
 * that counts what went through each of them against what git says is there.
 *
 * Zero dependencies, Node 22 ESM. Nothing here parses TypeScript: the one
 * TypeScript file it reads (`vitest.config.ts`) is read through `scanSource`,
 * the masker `../lib/test-cases.mjs` owns, and only its string literals are
 * taken — a token scan, never an AST (rule 2).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE FOUR DOORS, AND WHAT A DOOR IS
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * A gate can only judge what it can see. Under `packages/`, `apps/` and `e2e/`
 * four separate mechanisms can make a path invisible, each one legitimate in its
 * own place and each one a silent hole when nobody wrote it down:
 *
 *   1. `gitignore`             — the path is not in the index, so every numeric
 *                                claim made against `git ls-files` is made about
 *                                a smaller tree than the one on disk.
 *   2. `oxlint-ignorePatterns` — `.oxlintrc.jsonc` → `ignorePatterns`; the lint
 *                                lane never reaches the file.
 *   3. `tsconfig-exclude`      — an `exclude` anywhere in a package's tsconfig
 *                                chain; the type lane never compiles the file,
 *                                and `L-tsc` still reports green.
 *   4. `vitest-exclude`        — `exclude` in `vitest.config.ts`, and the other
 *                                half of the same door: a tracked `*.test.ts(x)`
 *                                that NO project's `include` can match is a test
 *                                nobody runs, which reads exactly like a test
 *                                that passes.
 *
 * The declared blind zone is `tools/gates/visible.json`, and `isExcluded` in
 * `./_shared.mjs` — the predicate every `walk` skips by — reads that same file
 * through that same reader. So the hole and the guard of the hole are ONE fact.
 * `entries` is empty today and the manifest's `_note` says that is a statement
 * rather than a gap; this light is what makes the statement checkable.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * MEASURED 2026-11-01, AND IT CHANGED THE COMMAND — `--no-empty-directory` LIES
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * The port plan prescribed
 * `git ls-files --others --ignored --exclude-standard --directory --no-empty-directory`.
 * On this tree, with the pathspec `-- packages apps e2e`, that command printed
 * NOTHING. The same command without `--no-empty-directory` printed
 *
 *     apps/api/node_modules/
 *     apps/web/node_modules/
 *
 * and the file-by-file form (no `--directory` at all) printed TWELVE ignored
 * entries under `apps/`. pnpm's per-package `node_modules` holds only symlinks
 * and a `.bin`, which git counts as an "empty directory" — so the flag meant to
 * reduce noise deleted two real blind spots from the answer.
 *
 * Therefore THE FILE-BY-FILE FORM IS THE READ OF RECORD here, and `--directory`
 * is run only to print the collapsed view in the detail. That also satisfies the
 * plan's rule about re-querying an ancestor of a declared root file-by-file: the
 * primary read is already file-by-file, so there is no shallow answer to deepen.
 * The two counts are both printed, because their difference is the measurement
 * above and a future reader should be able to see it rather than rediscover it.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE CLAIM IS NUMERIC, AGAINST `git ls-files`
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * "I narrowed an include and everything went green" is a real way to pass a
 * lane, and it is invisible to every check that only looks at what a tool DID
 * read. So the central assertion is a set comparison: every path git tracks
 * under the three roots is either SEEN by `walk` or explained — self-hidden
 * (a `.`-prefixed segment or `node_modules`, which declaring would not change)
 * or declared in `visible.json`. The counts are in the detail on every status,
 * pass included, so the row says how big the tree it judged was.
 *
 * THE INDEX, NOT HEAD, AND ON PURPOSE. This light is not range-based: it answers
 * "what is in this tree now, and what is hidden from a walk now", which is a
 * question about the working tree and its index rather than about a commit. An
 * EMPTY index with files on disk is therefore CANNOT VERIFY naming the cure,
 * never a pass — the same reading `L-core-purity`'s numeric half takes.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE ONE GLOB MATCHER IN THE LIGHTS LIVES HERE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `visible.json` entries are literal paths by rule — a glob in a blind-spot
 * manifest is a small language nobody can audit. But three of the four doors are
 * configured WITH globs, written by other tools to their own rules, so this
 * light has to decide whether a pattern can hide a path. `globToRegex` supports
 * exactly the forms measured in this repository — a literal path, `*` inside a
 * segment, `**` as a whole segment, `{a,b}` alternation — and REFUSES anything
 * else by name, which becomes cannot-verify. A matcher that guessed at `?`,
 * `[a-z]` or `!(…)` would answer "hides nothing" about a pattern it did not
 * understand, and that answer is a pass. `L-lint` imports it for the one
 * question it has of the same shape (can an `overrides.files` pattern reach
 * `packages/core`?), the way `core-purity` imports the tsconfig reader from
 * `./tsc.mjs`: the module that owns "does this pattern hide that path" is the
 * light whose whole subject is hiding.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { git, lsFiles } from '../lib/git.mjs';
import { DOORS, isExcluded, normRel, readPackages, readVisible, relPosix, scanSource, selfHidden, under, walk } from './_shared.mjs';
import { cite, readJsoncFile, tsconfigChain } from './tsc.mjs';

export const id = 'L-visible';
export const severity = 'hard';

/**
 * The three roots a hidden path is a defect under. `tools/` is deliberately NOT
 * here: the gates are judged by `gate-probes`, which plants a defect and checks
 * the gate caught it, and `docs/` holds no code any lane claims to judge.
 */
export const JUDGED_ROOTS = Object.freeze(['packages', 'apps', 'e2e']);

/** The lint config, the one carrier of door 2. */
const OXLINT_CONFIG = '.oxlintrc.jsonc';
/** The vitest config, the one carrier of door 4. */
const VITEST_CONFIG = 'vitest.config.ts';

/** Suffixes that make a tracked path a test file for the include half of door 4. */
const TEST_SUFFIXES = Object.freeze(['.test.ts', '.test.tsx']);

/** How many paths a single problem prints before it says how many are left. A
 * row is an interface (rule 8): the first few paths plus a count is actionable,
 * nine hundred paths is not. */
const SHOW = 8;

// -------------------------------------------------------------- glob matching

/** Metacharacters this matcher does NOT understand. A pattern carrying one is
 * refused by name rather than answered wrongly — and the wrong answer would be
 * "it hides nothing", which is a pass. */
const GLOB_UNSUPPORTED_RE = /[?![\]()+]/;

const escapeRe = (s) => String(s).replaceAll(/[\\^$.|?*+()[\]{}]/g, (m) => `\\${m}`);

/** One path segment → a regex source, or null when it is outside the supported
 * forms (`*`, `{a,b}`, literal characters). */
function segmentRegex(seg) {
  let out = '';
  let i = 0;
  while (i < seg.length) {
    const c = seg[i];
    if (c === '*') {
      out += '[^/]*';
      i += 1;
      continue;
    }
    if (c === '{') {
      const close = seg.indexOf('}', i);
      if (close === -1) return null;
      const body = seg.slice(i + 1, close);
      if (body.includes('{') || body.includes('/') || body.trim() === '') return null;
      out += `(?:${body.split(',').map((alt) => escapeRe(alt.trim())).join('|')})`;
      i = close + 1;
      continue;
    }
    out += escapeRe(c);
    i += 1;
  }
  return out;
}

/**
 * A glob from another tool's config → a regex over repo-relative POSIX paths.
 * → { ok, re, form, reason }
 *
 * `form: 'literal'` is a pattern with no metacharacter at all, and it matches
 * "equals or lies under" — the same rule a `visible.json` entry follows, so a
 * declaration and a config pattern mean the same thing by the same words.
 */
export function globToRegex(pattern) {
  const p = String(pattern ?? '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
  if (p === '') return { ok: false, re: null, form: null, reason: 'the pattern is empty' };
  const bad = GLOB_UNSUPPORTED_RE.exec(p);
  if (bad !== null)
    return {
      ok: false,
      re: null,
      form: null,
      reason: `${JSON.stringify(p)} uses ${JSON.stringify(bad[0])}, which this matcher does not understand (supported: a literal path, * inside a segment, ** as a whole segment, {a,b}) — spell the pattern in a supported form or widen globToRegex in tools/gates/lights/visible.mjs; a matcher that guessed would answer "hides nothing", and that answer is a pass`,
    };
  if (!p.includes('*') && !p.includes('{')) return { ok: true, re: new RegExp(`^${escapeRe(p)}(?:/.*)?$`), form: 'literal', reason: null };

  const segs = p.split('/');
  let src = '^';
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    if (seg === '**') {
      src += last ? '.*' : '(?:[^/]+/)*';
      continue;
    }
    if (seg.includes('**'))
      return { ok: false, re: null, form: null, reason: `${JSON.stringify(p)}: \`**\` must be a whole path segment (got the segment ${JSON.stringify(seg)})` };
    const sr = segmentRegex(seg);
    if (sr === null) return { ok: false, re: null, form: null, reason: `${JSON.stringify(p)}: the segment ${JSON.stringify(seg)} is outside the supported forms` };
    src += sr;
    if (!last) src += '/';
  }
  return { ok: true, re: new RegExp(`${src}$`), form: 'glob', reason: null };
}

/** Does `pattern` hide `rel`? → { ok, matched, reason } — `ok: false` is a
 * pattern nobody could compile, which every caller turns into cannot-verify. */
export function globMatches(pattern, rel) {
  const c = globToRegex(pattern);
  if (!c.ok) return { ok: false, matched: false, reason: c.reason };
  const r = normRel(rel);
  return { ok: true, matched: r !== null && c.re.test(r), reason: null };
}

// -------------------------------------------------------------------- helpers

/** 1-based line of an offset. Local on purpose, exactly as in
 * `core-purity.mjs:179`: three lines of counting is not a reader of a
 * repository fact, and repeating it is cheaper than a shared module nobody can
 * place. `scanSource` keeps every offset on its original line so this works. */
function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/** The matching close bracket for the one at `open`, by depth, over MASKED text
 * where a string literal is spaces and cannot hold an unbalanced bracket. */
function matchBracket(code, open, openChar, closeChar) {
  if (code[open] !== openChar) return -1;
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === openChar) depth += 1;
    else if (code[i] === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The first non-whitespace offset at or after `i`. */
function skipWs(code, i) {
  let j = i;
  while (j < code.length && /\s/.test(code[j])) j += 1;
  return j;
}

const listOf = (paths) => {
  const sorted = paths.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const head = sorted.slice(0, SHOW).join(', ');
  return sorted.length > SHOW ? `${head} (+${String(sorted.length - SHOW)} more)` : head;
};

/** Is this path under one of the judged roots? */
const judged = (rel) => JUDGED_ROOTS.some((r) => under(rel, r));

// ----------------------------------------------------------- door 1: git

/**
 * What git itself refuses to track under the judged roots.
 * → { ok, files, collapsed, reason }
 *
 * The file-by-file form is the read of record — see the measurement in the
 * header. `--directory` is read too, for the collapsed view only.
 */
export function gitignoreDoor(root) {
  const args = ['ls-files', '--others', '--ignored', '--exclude-standard', '--', ...JUDGED_ROOTS];
  const byFile = git(args, { cwd: root });
  if (byFile.code !== 0)
    return { ok: false, files: [], collapsed: [], reason: `${byFile.argv.join(' ')} → exit ${String(byFile.code)}: ${byFile.stderr.split('\n')[0] ?? ''}` };
  const files = byFile.stdout
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);
  const dirs = git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--', ...JUDGED_ROOTS], { cwd: root });
  const collapsed =
    dirs.code === 0
      ? dirs.stdout
          .split('\n')
          .map((l) => l.replace(/\r$/, '').replace(/\/$/, ''))
          .filter((l) => l.length > 0)
      : [];
  return { ok: true, files, collapsed, reason: null };
}

// -------------------------------------------- doors 2-4: patterns in configs

/**
 * Every pattern of every door that is configured with globs, with where it was
 * written. → { patterns: [{ door, pattern, where, base }], problems }
 *
 * `base` is the directory the pattern is relative to, already folded into the
 * pattern, so a caller matches repo-relative paths and nothing else.
 */
export function patternDoors(root) {
  const patterns = [];
  const problems = [];

  // ---- door 2: .oxlintrc.jsonc ignorePatterns
  const ox = readJsoncFile(root, OXLINT_CONFIG);
  if (!ox.ok) problems.push(`${OXLINT_CONFIG}: ${String(ox.reason)} — door "oxlint-ignorePatterns" could not be read, so nothing about it is asserted`);
  else {
    const list = ox.data?.ignorePatterns;
    if (list === undefined || list === null) problems.push(`${OXLINT_CONFIG}: no "ignorePatterns" key — this reader expects the key even when it is an empty array, because its absence and an empty list say different things`);
    else if (!Array.isArray(list)) problems.push(`${OXLINT_CONFIG}: "ignorePatterns" is not an array`);
    else
      for (const pat of list)
        patterns.push({ door: 'oxlint-ignorePatterns', pattern: String(pat), where: cite(OXLINT_CONFIG, ox.text === null ? null : lineAt(ox.text, ox.text.indexOf(String(pat)))), base: '' });
  }

  // ---- door 3: exclude anywhere in a package's tsconfig chain
  const pkgs = readPackages(root);
  for (const p of pkgs.problems) problems.push(`door "tsconfig-exclude": ${p}`);
  for (const pkg of pkgs.packages) {
    if (pkg.tsconfigRel === null) continue;
    const chain = tsconfigChain(root, pkg.tsconfigRel);
    for (const prob of chain.problems) problems.push(`${pkg.tsconfigRel}: ${prob} — a chain this reader stopped walking may set "exclude" where nobody sees it`);
    for (const f of chain.files) {
      const ex = f.data?.exclude;
      if (ex === undefined || ex === null) continue;
      if (!Array.isArray(ex)) {
        problems.push(`${f.rel}: "exclude" is not an array — door "tsconfig-exclude" cannot be read`);
        continue;
      }
      const dir = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '';
      for (const pat of ex)
        patterns.push({
          door: 'tsconfig-exclude',
          pattern: dir === '' ? String(pat) : posix.join(dir, String(pat)),
          where: cite(f.rel, lineAt(f.text, f.text.indexOf('"exclude"'))),
          base: dir,
        });
    }
  }

  // ---- door 4: exclude in vitest.config.ts
  const v = vitestDoor(root);
  problems.push(...v.problems);
  patterns.push(...v.excludePatterns);

  return { patterns, problems, includePatterns: v.includePatterns, vitestRead: v.ok };
}

/**
 * `vitest.config.ts`, read as TEXT through `scanSource` and nothing more.
 * → { ok, excludePatterns, includePatterns, problems }
 *
 * WHAT THIS READER DOES NOT KNOW, stated rather than guessed: it cannot tell
 * which `projects` entry an `exclude` belongs to, because it does not parse the
 * config. A pattern is therefore tested repo-relative AND relative to every
 * workspace package root. That can only ever demand MORE declarations than the
 * truth, never fewer, which is the direction a blind-spot guard must err in.
 *
 * `include` is read for the other half of door 4 — a tracked test file no
 * project can match. `L-orphans` owns the stronger claim ("matched by EXACTLY
 * one project"); this light owns "matched by at least one, or declared", and the
 * two are deliberately different sentences about the same configuration.
 */
export function vitestDoor(root) {
  const problems = [];
  const path = join(root, VITEST_CONFIG);
  if (!existsSync(path)) {
    problems.push(`${VITEST_CONFIG}: does not exist — door "vitest-exclude" cannot be read, and the test lane's own include/exclude is then unknown`);
    return { ok: false, excludePatterns: [], includePatterns: [], problems };
  }
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    problems.push(`${VITEST_CONFIG}: unreadable (${String(e.message)}) — door "vitest-exclude" cannot be read`);
    return { ok: false, excludePatterns: [], includePatterns: [], problems };
  }

  const s = scanSource(text);
  for (const p of s.problems) problems.push(`${VITEST_CONFIG}: the mask itself may be wrong (${p}) — this file cannot be token-scanned, so neither half of door 4 is asserted`);
  if (s.problems.length) return { ok: false, excludePatterns: [], includePatterns: [], problems };

  const excludePatterns = [];
  const includePatterns = [];
  for (const key of ['exclude', 'include']) {
    const re = new RegExp(`\\b${key}\\s*:`, 'g');
    let m = re.exec(s.code);
    while (m !== null) {
      const where = cite(VITEST_CONFIG, lineAt(text, m.index));
      const open = skipWs(s.code, m.index + m[0].length);
      const close = matchBracket(s.code, open, '[', ']');
      if (close === -1) {
        problems.push(`${where}: "${key}" is not an array literal this reader can read — write it as a literal array of string literals, or door 4 asserts nothing about it`);
        m = re.exec(s.code);
        continue;
      }
      let found = 0;
      for (const lit of s.literals.values()) {
        if (lit.start < open || lit.end > close) continue;
        if (lit.isLiteral !== true || typeof lit.value !== 'string') {
          problems.push(`${cite(VITEST_CONFIG, lineAt(text, lit.start))}: a non-literal entry inside "${key}" — a computed pattern cannot be matched against a path, so door 4 cannot be read`);
          continue;
        }
        found += 1;
        (key === 'exclude' ? excludePatterns : includePatterns).push({ door: 'vitest-exclude', pattern: lit.value, where, base: '' });
      }
      if (found === 0) problems.push(`${where}: "${key}" holds no string literal — an empty list and an unreadable one are different facts and this reader cannot tell them apart`);
      m = re.exec(s.code);
    }
  }
  return { ok: true, excludePatterns, includePatterns, problems };
}

// --------------------------------------------------------------- the verdict

/**
 * Judge one path a NAMED door hid. → a problem string, or null when it is
 * explained. `doorName` is recorded in `hiddenBy`, which is how the per-entry
 * check below learns which doors really cover a declared root.
 *
 * The door name is load-bearing and must be the door that actually hid the
 * path. Passing a door that did not — "gitignore" for a path a walk skipped
 * because the MANIFEST declared it, say — made this light report "gitignore
 * also hides it" about files git tracks. Measured on a probe tree and fixed:
 * the question "was this path explained?" has its own function below, and only
 * a real door reaches this one.
 */
function judgeDoor(rel, doorName, visible, hiddenBy) {
  if (selfHidden(rel).hidden) return null;
  const ex = isExcluded(rel, visible);
  if (ex.why === 'declared') {
    const declaredDoors = Array.isArray(ex.entry?.doors) ? ex.entry.doors : [];
    hiddenBy.push({ rel, door: doorName, entry: ex.entry });
    if (!declaredDoors.includes(doorName))
      return `${rel} is hidden by the door "${doorName}" and tools/gates/visible.json declares it behind ${declaredDoors.join(' + ') || '(no door)'} — add "${doorName}" to that entry's "doors"; an entry that names one door while a second also hides the path describes a smaller blind spot than the real one`;
    return null;
  }
  if (ex.why === 'manifest-unreadable')
    return `${rel} is hidden by the door "${doorName}" and tools/gates/visible.json could not be read, so nothing is declared — fix the manifest (L-visible fails closed: the path is treated as undeclared)`;
  return `${rel} is hidden from every walk by the door "${doorName}" and tools/gates/visible.json declares nothing for it — add { "path": "<the root>", "doors": ["${doorName}"], "why": "<one sentence>" } or stop hiding it; an undeclared blind spot is how a subtree stops being checked without anyone noticing`;
}

/** Is a tracked path that no walk saw EXPLAINED? Self-hidden, or declared — and
 * no door is attributed, because the reason a walk skipped it is the
 * declaration itself (`isExcluded`), not any of the four doors. */
function explained(rel, visible) {
  if (selfHidden(rel).hidden) return true;
  return isExcluded(rel, visible).why === 'declared';
}

export function run({ root = process.cwd(), visible = null } = {}) {
  const manifest = visible ?? readVisible(root);
  const problems = [];
  const unverifiable = [];
  const notes = [];

  for (const p of manifest.problems) problems.push(`tools/gates/visible.json: ${p}`);

  // ------------------------------------------------- the tree, twice over
  const tracked = lsFiles(JUDGED_ROOTS, { cwd: root });
  const seen = walk(root, { roots: JUDGED_ROOTS, visible: manifest });
  for (const p of seen.problems) problems.push(`walk of ${JUDGED_ROOTS.join(' + ')}: ${p}`);
  if (seen.missing.length) notes.push(`${seen.missing.join(', ')} does not exist on disk`);

  let trackedFiles = [];
  if (!tracked.ok) unverifiable.push(`git ls-files -- ${JUDGED_ROOTS.join(' ')} failed (${String(tracked.reason)}) — the numeric claim of this light is made against the index and cannot be made without it`);
  else trackedFiles = tracked.files.filter((f) => judged(f));

  if (tracked.ok && trackedFiles.length === 0 && seen.files.length > 0)
    unverifiable.push(
      `git tracks NOTHING under ${JUDGED_ROOTS.join(' + ')} while ${String(seen.files.length)} file(s) are on disk — every door below is judged against the index, so stage or commit the tree first (git add -A). An index nobody filled makes every count zero, and zero hidden files out of zero files is not a pass`,
    );

  const seenSet = new Set(seen.files);
  const hiddenBy = [];
  if (trackedFiles.length > 0) {
    const notSeen = trackedFiles.filter((f) => !seenSet.has(f));
    const unexplained = notSeen.filter((f) => !explained(f, manifest));
    if (unexplained.length)
      problems.push(
        `${String(unexplained.length)} tracked file(s) under ${JUDGED_ROOTS.join(' + ')} that no walk SEES and visible.json does not declare: ${listOf(unexplained)} — a tracked file invisible to every walk is judged by nothing`,
      );
    const untracked = seen.files.filter((f) => !trackedFiles.includes(f));
    if (untracked.length) notes.push(`${String(untracked.length)} file(s) on disk that git does not track: ${listOf(untracked)}`);
    notes.push(`numeric: ${String(trackedFiles.length)} tracked == ${String(seenSet.size)} seen by walk, ${String(notSeen.length)} explained`);
  }

  // ---------------------------------------------------------- door 1: git
  const ignored = gitignoreDoor(root);
  if (!ignored.ok) unverifiable.push(`door "gitignore": ${String(ignored.reason)}`);
  else {
    const undeclared = [];
    let selfCount = 0;
    for (const f of ignored.files) {
      if (selfHidden(f).hidden) {
        selfCount += 1;
        continue;
      }
      const prob = judgeDoor(f, 'gitignore', manifest, hiddenBy);
      if (prob !== null) undeclared.push(prob);
    }
    for (const u of [...new Set(undeclared)].slice(0, SHOW)) problems.push(u);
    if (undeclared.length > SHOW) problems.push(`(+${String(undeclared.length - SHOW)} more path(s) ignored by git under ${JUDGED_ROOTS.join(' + ')} and undeclared)`);
    notes.push(
      `door gitignore: ${String(ignored.files.length)} ignored path(s) file-by-file, ${String(ignored.collapsed.length)} when collapsed with --directory (${ignored.collapsed.length ? listOf(ignored.collapsed) : 'none'}), ${String(selfCount)} self-hidden`,
    );
  }

  // ------------------------------------------------------ doors 2, 3 and 4
  const doors = patternDoors(root);
  for (const p of doors.problems) unverifiable.push(p);

  const byDoor = new Map(DOORS.map((d) => [d, 0]));
  for (const pat of doors.patterns) {
    const compiled = globToRegex(pat.pattern);
    if (!compiled.ok) {
      unverifiable.push(`${pat.where}: door "${pat.door}" pattern ${compiled.reason}`);
      continue;
    }
    const hits = trackedFiles.filter((f) => compiled.re.test(f));
    byDoor.set(pat.door, (byDoor.get(pat.door) ?? 0) + hits.length);
    const undeclared = [];
    for (const f of hits) {
      const prob = judgeDoor(f, pat.door, manifest, hiddenBy);
      if (prob !== null) undeclared.push(prob);
    }
    for (const u of [...new Set(undeclared)].slice(0, SHOW)) problems.push(`${pat.where}: the pattern ${JSON.stringify(pat.pattern)} — ${u}`);
    if (undeclared.length > SHOW) problems.push(`${pat.where}: (+${String(undeclared.length - SHOW)} more tracked file(s) hidden by ${JSON.stringify(pat.pattern)} and undeclared)`);
  }

  // The include half of door 4: a tracked test file no project can match.
  if (doors.vitestRead && trackedFiles.length > 0) {
    const roots = ['', ...readPackages(root).packages.map((p) => p.rel)];
    const testFiles = trackedFiles.filter((f) => TEST_SUFFIXES.some((e) => f.endsWith(e)));
    const unmatched = [];
    let patternProblem = false;
    for (const f of testFiles) {
      let matched = false;
      for (const pat of doors.includePatterns) {
        for (const base of roots) {
          const full = base === '' ? pat.pattern : posix.join(base, pat.pattern);
          const c = globToRegex(full);
          if (!c.ok) {
            patternProblem = true;
            continue;
          }
          if (c.re.test(f)) matched = true;
        }
      }
      if (!matched) unmatched.push(f);
    }
    if (patternProblem) unverifiable.push(`${VITEST_CONFIG}: at least one "include" pattern could not be compiled, so "no project matches this test file" cannot be asserted`);
    else if (doors.includePatterns.length === 0)
      unverifiable.push(`${VITEST_CONFIG}: no "include" pattern was found at all — with no include list this light cannot say which tracked test file is unreachable, and vitest's own default would then decide it`);
    else {
      const undeclared = unmatched.filter((f) => judgeDoor(f, 'vitest-exclude', manifest, hiddenBy) !== null);
      if (undeclared.length)
        problems.push(
          `${String(undeclared.length)} tracked test file(s) that NO "include" in ${VITEST_CONFIG} can match: ${listOf(undeclared)} — a test no project runs reads exactly like a test that passes; add it to a project's include or declare it with "doors": ["vitest-exclude"] (L-orphans owns the stronger claim that exactly one project matches it)`,
        );
      notes.push(`door vitest include: ${String(testFiles.length)} tracked test file(s), ${String(testFiles.length - unmatched.length)} matched by one of ${String(doors.includePatterns.length)} include pattern(s)`);
    }
  }

  notes.push(`doors: ${DOORS.map((d) => `${d}=${String(byDoor.get(d) ?? 0)}`).join(' ')} tracked file(s) hidden`);

  // ------------------------------------------- every declaration is checked
  const entries = Array.isArray(manifest.data?.entries) ? manifest.data.entries : [];
  if (entries.length === 0) notes.push('visible.json declares NOTHING hidden, which its _note states as a statement rather than a gap — this light is what makes that statement checkable');
  for (const e of entries) {
    const path = normRel(e?.path);
    if (path === null) continue;
    if (!existsSync(join(root, path))) {
      notes.push(`visible.json declares ${path}, which does not exist on disk — the declaration hides nothing today`);
      continue;
    }
    const claimed = Array.isArray(e.doors) ? e.doors : [];
    const inside = trackedFiles.filter((f) => under(f, path));
    // "A declared blind spot holds no tracked file" is TRUE OF THE gitignore
    // DOOR AND OF NOTHING ELSE, and reading it as a rule for all four was a
    // defect this light's own probe tree found. Door 1 means git does not track
    // the path, so a tracked file under such an entry makes the declaration
    // false. Doors 2-4 hide paths git tracks perfectly happily — a committed
    // generated file the linter does not judge is exactly that shape — and
    // demanding an empty subtree there would make the manifest unusable for
    // three of its four doors. What IS asserted for those is what the loops
    // above assert: the pattern really does hide the files, and no second,
    // unnamed door hides them too.
    if (claimed.includes('gitignore')) {
      if (inside.length)
        problems.push(
          `tools/gates/visible.json declares ${path} behind the door "gitignore" while git TRACKS ${String(inside.length)} file(s) under it: ${listOf(inside)} — door 1 means git does not track the path, so the declaration is false; untrack those files, or name the door that really hides them`,
        );
      const chk = git(['check-ignore', '--quiet', '--', path], { cwd: root });
      if (chk.code !== 0)
        problems.push(
          `tools/gates/visible.json declares ${path} behind the door "gitignore" and \`git check-ignore\` says it is NOT ignored (exit ${String(chk.code)}) — the declaration describes a door that is not there; fix .gitignore or the entry`,
        );
    } else if (inside.length) {
      notes.push(`visible.json declares ${path} behind ${claimed.join(' + ')} and git tracks ${String(inside.length)} file(s) under it — legitimate for a pattern door, and the doors above are what assert the pattern really hides them`);
    }
    const actual = hiddenBy.filter((h) => h.rel === path || under(h.rel, path)).map((h) => h.door);
    const unclaimed = [...new Set(actual)].filter((d) => !claimed.includes(d));
    if (unclaimed.length)
      problems.push(`tools/gates/visible.json declares ${path} behind ${claimed.join(' + ') || '(no door)'} while ${unclaimed.join(' + ')} also hides it — name every door, or the entry understates the blind spot`);
    const relCheck = relPosix(root, join(root, path));
    if (relCheck !== path) notes.push(`visible.json entry ${path} normalises to ${relCheck}`);
  }

  // ------------------------------------------------------------- the row
  const summary = [...new Set(notes)].join(' · ');
  if (problems.length) return { id, severity, status: 'fail', detail: `${String(problems.length)} problem(s): ${problems.join(' || ')} · ${summary}` };
  if (unverifiable.length)
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail: `${String(unverifiable.length)} premise(s) of the four doors could not be read: ${unverifiable.join(' || ')} · ${summary} · a door nobody could read is not a door nothing went through`,
    };
  return { id, severity, status: 'pass', detail: `four doors checked over ${JUDGED_ROOTS.join(' + ')} · ${summary}` };
}
