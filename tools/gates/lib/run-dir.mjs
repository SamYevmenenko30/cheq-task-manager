/**
 * The run of record: one directory per run, never reused, and a `run.json`
 * beside the artifacts that says what produced them.
 *
 * Zero dependencies, `node:` builtins only.
 *
 * `.ci/runs/<ts>-<label>/` where `<ts>` is an ISO instant with `:` and `.`
 * replaced by `-`, because a colon in a path is legal on APFS and a trap
 * everywhere else. `.ci/` is gitignored machine state (.gitignore:9-10, under
 * the heading "machine state — never committed, always read") — a run
 * directory is never committed and never read as a source of truth about the
 * repository, only about one run.
 *
 * TWO REFUSALS CARRY THE DESIGN:
 *
 * 1. `makeRunDir` REFUSES an existing directory. A reused directory mixes two
 *    runs' artifacts, and the reader cannot tell which run it is reading — the
 *    verdict would then be about nothing in particular.
 *
 * 2. NOTHING HERE RETURNS "THE NEWEST RUN". There is no glob, no sort by mtime,
 *    no `latest` symlink, on purpose: a reader that finds its own artifact can
 *    read a stale one from an earlier run and call it green. Every reader in
 *    tools/gates/lib takes an EXPLICIT path; `artifactPath(dir, name)` builds
 *    that path from the directory the caller was handed by `makeRunDir`, and
 *    `run.json` records which run that was.
 *
 * `run.json` is the only place a judged tool's exit code is written down, and
 * writing it there is what makes it advisory: the verdict comes from the
 * artifact, the exit code is evidence about the process. Two exit codes lied in
 * the session that designed this (`eslint … | head` reported 0 over a crash
 * whose real exit was 2; `tsc … | head -12` reported 0 over four TS6059) — both
 * times `$?` belonged to `head`. A caller must capture the child's own status
 * and pass it here; see tools/gates/lib/git.mjs for the spawn form that does.
 */

import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Where run directories live, relative to the repository root. */
export const RUNS_ROOT = '.ci/runs';

/** The fields `writeRunJson` requires. A missing KEY is refused; a null VALUE
 * is accepted, because "the tool never spawned, so there is no exit code" is a
 * fact worth recording and `null` says it without pretending to a number. */
export const RUN_JSON_REQUIRED = Object.freeze(['head', 'treeClean', 'argv', 'exitCode', 'startedAt', 'kind']);

const LABEL_RE = /^[a-z0-9][a-z0-9-]*$/;

/** An ISO instant with the characters that are hostile in a path replaced:
 * `2026-11-01T02:09:33.064Z` → `2026-11-01T02-09-33-064Z`. */
export function stampOf(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Create `.ci/runs/<ts>-<label>/` and return it.
 * → { dir, ts, label, kind, root }
 *
 * Throws on a label outside `[a-z0-9-]`, on an empty label, and on an existing
 * directory (refusal 1 in the header). `root` defaults to the process cwd,
 * which every gate pins to the repository root before doing anything.
 */
export function makeRunDir({ label, kind = null, root = process.cwd(), date = new Date() } = {}) {
  const l = String(label ?? '').trim();
  if (!l) throw new Error('makeRunDir: a label is required — it is how a run is named in a report');
  if (!LABEL_RE.test(l))
    throw new Error(`makeRunDir: label ${JSON.stringify(l)} is not [a-z0-9-] starting with [a-z0-9] — a label becomes a path segment`);
  const ts = stampOf(date);
  const dir = resolve(root, RUNS_ROOT, `${ts}-${l}`);
  if (existsSync(dir)) throw new Error(`makeRunDir: ${dir} already exists — a run directory is never reused (two runs' artifacts in one directory have no owner)`);
  mkdirSync(dir, { recursive: true });
  return { dir, ts, label: l, kind, root: resolve(root) };
}

/** The path of one named artifact inside a run directory. The ONLY way a reader
 * is told where to read: explicit directory plus explicit name, no glob. */
export function artifactPath(dir, name) {
  if (!dir) throw new Error('artifactPath: no run directory — a reader is never handed a pattern to search');
  if (!name || name.includes('/') || name.includes('\\'))
    throw new Error(`artifactPath: ${JSON.stringify(name)} is not a plain file name`);
  return join(dir, name);
}

/** `<dir>/run.json`. */
export function runJsonPath(dir) {
  return join(dir, 'run.json');
}

/**
 * Write `run.json`. Refuses when any of RUN_JSON_REQUIRED is absent, so a run
 * cannot be recorded without saying which commit it ran on, whether the tracked
 * tree was clean, what argv produced it, what the tool's own exit code was,
 * when it started and which kind it was.
 *
 * Extra fields are kept as given: a lane that measured something (`durationMs`,
 * tool versions, the `--type-aware` flag that oxlint needs or its type rules
 * silently do not run) records it here rather than in a second file.
 * → the absolute path written.
 */
export function writeRunJson(dir, data) {
  if (!dir) throw new Error('writeRunJson: no run directory');
  const missing = RUN_JSON_REQUIRED.filter((k) => !Object.prototype.hasOwnProperty.call(data ?? {}, k));
  if (missing.length)
    throw new Error(
      `writeRunJson: ${dir}/run.json is missing required field(s) ${missing.join(', ')} — a run with no ${missing[0]} cannot be cited as evidence`,
    );
  const path = runJsonPath(dir);
  writeFileSync(path, `${JSON.stringify({ ...data, writtenAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  return path;
}

/**
 * Read a run's `run.json` back. → { ok, data, reason, path }
 * A missing or unparsable file is `ok: false` with the reason named — never an
 * empty object that reads like a run with no findings.
 */
export function readRunJson(dir) {
  const path = runJsonPath(dir);
  if (!existsSync(path)) return { ok: false, data: null, reason: `no such file: ${path}`, path };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { ok: false, data: null, reason: `unreadable: ${String(e.message)}`, path };
  }
  try {
    return { ok: true, data: JSON.parse(text), reason: null, path };
  } catch (e) {
    return { ok: false, data: null, reason: `not JSON: ${String(e.message)}`, path };
  }
}

/** The plan's name for `makeRunDir({ label })`, kept so either spelling works. */
export function newRunDir(label, opts = {}) {
  return makeRunDir({ ...opts, label });
}
