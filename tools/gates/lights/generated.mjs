#!/usr/bin/env node
/**
 * L-generated (hard) — a committed projection is RE-GENERATED and compared byte
 * for byte with the committed bytes. The judge and the generator are the same
 * code, which is the only arrangement in which "the digest is current" means
 * anything: a light that re-implemented the rendering would be asserting that
 * two hand-written renderers agree, not that the file is a projection of the
 * sources.
 *
 *     node tools/gates/lights/generated.mjs
 *
 * Zero dependencies, Node 22 ESM. The module contract and the result shape live
 * in `./_shared.mjs`; the manifest is `tools/gates/generated.json`, read through
 * `readGenerated` — the ONE reader of that file — and its entry shape is checked
 * by `manifestProblems` there, not here.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * "NOTHING TO GUARD" IS NOT "GREEN" — the state this light is in TODAY
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `tools/gates/digest.mjs` is not written and neither digest is committed
 * (2026-11-01). The honest reading of that is `cannot-verify (producer not
 * written: tools/gates/digest.mjs)` for every entry — never `pass`. The
 * difference is the difference between "this file is stale" and "nothing can be
 * said about this file", and only the second is true now. `producerScript` is a
 * manifest field precisely so this state is DETECTABLE with `existsSync` instead
 * of being guessed at by parsing a command string. Hard plus cannot-verify
 * blocks exactly as a fail does, so this does not make the lane green — it makes
 * it honest, and it stops being cannot-verify the day the producer lands.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE RENDER CONTRACT — what this light requires of a producer, and why
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *     node <producerScript> --render <dir>
 *
 * must write every path `generated.json` declares, at that same repo-relative
 * path UNDER `<dir>`, and must not touch the work tree. Three consequences, each
 * load-bearing:
 *
 *  1. A GATE NEVER REWRITES THE REPOSITORY. The manifest's `producer`
 *     (`… --fix`) rewrites files in place; running it to judge would mean the
 *     check and the cure are the same act, and a "stale digest" would be fixed
 *     by the gate that was supposed to report it. `producer` is therefore only
 *     ever PRINTED here, as the cure.
 *  2. THE MANIFEST'S COMMAND STRING IS NEVER EXECUTED. The argv is built from
 *     `producerScript` (which `manifestProblems` already pins under `tools/`)
 *     plus `RENDER_FLAG` and a tmpdir, with `process.execPath` as the
 *     interpreter — no shell, no PATH lookup, no quoting rule, and no way for a
 *     manifest edit to make a gate run an arbitrary command.
 *  3. A PRODUCER WITHOUT `--render` IS cannot-verify, NOT A FAIL. The file may be
 *     perfectly current; what is missing is the ability to ask. The detail names
 *     the flag, so the gap is a contract to implement rather than a mystery.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE COMMITTED SIDE IS HEAD, AND THE THIRD STATE IS AN ORPHAN
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * The comparison is against `git show HEAD:<path>`, never the work tree: a light
 * that read the tree would go green on an uncommitted hand-edit of the very file
 * the commit it guards does not contain. A repository with no commit therefore
 * has no committed bytes to compare, which is cannot-verify with that named as
 * the reason.
 *
 * Three states are judged, not one: a declared file that DIFFERS (fail, with the
 * cure), a declared file that is MISSING from HEAD (fail — a declaration with no
 * file), and a file sitting in a declared directory that NO entry declares
 * (fail — an orphan, the shape a hand-written "digest" takes). The orphan scan
 * enumerates HEAD with `diffNames(EMPTY_TREE, 'HEAD', { pathspec })`: every path
 * is an addition relative to the empty tree, which is what "every file at HEAD
 * under this directory" means in terms of the one git reader this repository
 * has. `git ls-files` is deliberately not used — it reads the INDEX, and no gate
 * here reads the index.
 *
 * The comparison is over TEXT decoded as UTF-8, because `showAtHead` decodes:
 * a generated file is text by definition (it carries a `GENERATED — do not edit`
 * header a human reads). A rendered file holding a NUL byte is cannot-verify
 * rather than a diff of mojibake.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EMPTY_TREE, baseRev, diffNames, hasCommits, repoRoot, showAtHead } from '../lib/git.mjs';
import { byCodepoint, normalizeResult, readGenerated, readPremises, sh, under } from './_shared.mjs';

export const id = 'L-generated';
export const severity = 'hard';

/** The one flag this light passes a producer. See THE RENDER CONTRACT above. */
export const RENDER_FLAG = '--render';

/** How much of a differing line is quoted in a detail. A detail is one table
 * cell; the cure command is what a human acts on, not the whole diff. */
const QUOTE = 72;

const clip = (s) => {
  const one = String(s ?? '').replace(/\s+/g, ' ');
  return one.length > QUOTE ? `${one.slice(0, QUOTE)}…` : one;
};

/**
 * The first line at which two texts differ, 1-based, with both sides quoted.
 * → { line, committed, rendered } or null when they are identical.
 *
 * Trailing-newline-only differences are real differences and are reported as
 * such (a projection that gained or lost its final newline is not current), so
 * the comparison is on the raw strings and this function only LOCATES it.
 */
export function firstDifference(committedText, renderedText) {
  if (committedText === renderedText) return null;
  const a = String(committedText).split('\n');
  const b = String(renderedText).split('\n');
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i])
      return {
        line: i + 1,
        committed: a[i] === undefined ? '(end of file)' : clip(a[i]),
        rendered: b[i] === undefined ? '(end of file)' : clip(b[i]),
      };
  }
  // Same lines, different text: only a trailing-newline difference can do that.
  return { line: n, committed: `${String(committedText.length)} byte(s)`, rendered: `${String(renderedText.length)} byte(s)` };
}

/**
 * Judge ONE entry. → { path, status, detail }
 * `status` is a LIGHT_STATUSES value for that entry alone; `run` combines them.
 *
 * `tmp` is a directory this function may write into and which the caller
 * removes. A null `tmp` means the caller could not make one, which is
 * cannot-verify with the reason the caller already has.
 */
function judgeEntry(root, entry, { headPresent, tmp }) {
  const path = String(entry?.path ?? '(no path)');
  const producer = String(entry?.producer ?? '(no producer command declared)');
  const scriptRel = String(entry?.producerScript ?? '');
  const at = (status, detail) => ({ path, status, detail });

  if (!scriptRel) return at('cannot-verify', `${path}: the entry declares no producerScript, so whether a producer exists cannot be answered`);
  const scriptAbs = join(root, scriptRel);
  if (!existsSync(scriptAbs))
    return at('cannot-verify', `${path}: producer not written: ${scriptRel} — nothing can be said about this file until it exists (cure: write it, then \`${producer}\`)`);

  if (!headPresent)
    return at(
      'cannot-verify',
      `${path}: no commit yet, so there are no committed bytes to compare — this light reads \`git show HEAD:${path}\`, never the work tree (a work-tree read would go green on an uncommitted hand-edit)`,
    );

  const committed = showAtHead(path, { cwd: root });
  if (!committed.ok)
    return at('fail', `${path}: declared generated in tools/gates/generated.json and absent from HEAD (${committed.reason}) — run \`${producer}\` and commit the result`);

  if (tmp === null) return at('cannot-verify', `${path}: no temporary directory to render into`);

  const outDir = join(tmp, path.replaceAll('/', '_'));
  const r = sh(process.execPath, [scriptAbs, RENDER_FLAG, outDir], { cwd: root });
  if (r.code === null)
    return at('cannot-verify', `${path}: could not run ${scriptRel} (${r.spawnError ?? 'spawn failed'})`);
  const renderedPath = join(outDir, path);
  if (r.code !== 0 || !existsSync(renderedPath))
    return at(
      'cannot-verify',
      `${path}: \`node ${scriptRel} ${RENDER_FLAG} <dir>\` exited ${String(r.code)} and left no ${path} under <dir> — this light never lets a producer rewrite the work tree, so a producer with no ${RENDER_FLAG} cannot be judged (first line: ${clip(r.combined.split('\n').find((l) => l.trim() !== '') ?? 'no output')})`,
    );

  let rendered;
  try {
    rendered = readFileSync(renderedPath, 'utf8');
  } catch (e) {
    return at('cannot-verify', `${path}: the rendered file at ${renderedPath} is unreadable: ${String(e.message)}`);
  }
  if (rendered.includes('\0'))
    return at('cannot-verify', `${path}: the rendered file holds a NUL byte — this light compares text (a generated file carries a header a human reads), so a binary projection is outside what it can judge`);

  const diff = firstDifference(committed.text, rendered);
  if (diff === null) return at('pass', `${path}: re-generated byte-identical to HEAD`);
  return at(
    'fail',
    `${path}:${String(diff.line)}: the committed file is NOT what ${scriptRel} renders — HEAD has "${diff.committed}", a fresh render has "${diff.rendered}". CURE: ${producer}`,
  );
}

/**
 * Files at HEAD under the directories the manifest declares, that no entry
 * declares. → [path]
 *
 * An orphan is the shape a hand-written "digest" takes: a file in the generated
 * directory that nothing re-generates, which a reader cannot tell from a
 * projection.
 */
function orphansAtHead(root, declared) {
  const dirs = [...new Set(declared.map((p) => dirname(p)).filter((d) => d !== '' && d !== '.'))].toSorted(byCodepoint);
  const out = [];
  const problems = [];
  for (const dir of dirs) {
    const d = diffNames(EMPTY_TREE, 'HEAD', { pathspec: [dir], cwd: root });
    if (!d.ok) {
      problems.push(`${dir}: cannot enumerate at HEAD (${String(d.reason)})`);
      continue;
    }
    for (const f of d.files) if (!declared.some((p) => p === f || under(f, p))) out.push(f);
  }
  return { orphans: out.toSorted(byCodepoint), problems };
}

export function run(ctx = {}) {
  const root = ctx.root ?? process.cwd();
  const man = readGenerated(root);

  if (!man.exists || man.data === null) return { id, severity, status: 'cannot-verify', detail: man.problems.join('; ') };
  if (!man.ok)
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail: `${man.rel} does not pass its shape check, so what it declares cannot be judged: ${man.problems.join('; ')}`,
    };

  const entries = Array.isArray(man.data.entries) ? man.data.entries : [];
  if (entries.length === 0)
    return {
      id,
      severity,
      status: 'pass',
      detail: `${man.rel} declares no generated file — nothing in this repository is a committed projection, which is a statement its "_note" makes and not a gap`,
    };

  const headPresent = hasCommits({ cwd: root });
  let tmp = null;
  let tmpProblem = null;
  try {
    tmp = mkdtempSync(join(tmpdir(), 'cheq-generated-'));
  } catch (e) {
    tmpProblem = `no temporary directory to render into: ${String(e.message)}`;
  }

  const results = [];
  try {
    for (const entry of entries) results.push(judgeEntry(root, entry, { headPresent, tmp }));
  } finally {
    if (tmp !== null) rmSync(tmp, { recursive: true, force: true });
  }

  const notes = [];
  if (tmpProblem !== null) notes.push(tmpProblem);

  const declared = entries.map((e) => String(e?.path ?? '')).filter(Boolean);
  if (headPresent) {
    const o = orphansAtHead(root, declared);
    notes.push(...o.problems);
    for (const f of o.orphans)
      results.push({
        path: f,
        status: 'fail',
        detail: `${f}: at HEAD inside a generated directory and declared by no entry of ${man.rel} — a file nothing re-generates cannot be told from a projection; declare it or delete it`,
      });
  } else {
    notes.push('the orphan scan needs HEAD and was not run — a repository with no commit has nothing to enumerate');
  }

  const fails = results.filter((r) => r.status === 'fail');
  const unknown = results.filter((r) => r.status === 'cannot-verify');
  const status = fails.length > 0 ? 'fail' : unknown.length > 0 ? 'cannot-verify' : 'pass';
  const head = `${String(entries.length)} declared in ${man.rel}: ${String(results.filter((r) => r.status === 'pass').length)} byte-identical, ${String(fails.length)} fail, ${String(unknown.length)} cannot-verify`;
  const detail = [head, ...fails.map((r) => r.detail), ...unknown.map((r) => r.detail), ...notes].join(' · ');
  return { id, severity, status, detail };
}

// ------------------------------------------------------------------------- cli

/**
 * `node tools/gates/lights/generated.mjs` — the command a spec's `## Lights` row
 * cites (docs/templates/SPEC.md). It prints the same row the pack prints and
 * applies the pack's own rule: a HARD light that is not `pass` exits 1, a soft
 * one reports and exits 0. A refusal is a sentence naming the cure, never a
 * stack trace.
 */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rr = repoRoot();
  if (!rr.ok) {
    console.error(`[${id}] REFUSED: not a git work tree (${rr.reason}) — this light reads HEAD through git.`);
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
