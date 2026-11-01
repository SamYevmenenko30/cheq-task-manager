/**
 * argv-git — every git question the gates ask, as an ARGUMENT VECTOR.
 *
 * Zero dependencies, `node:` builtins only, so this runs in a fresh worktree
 * before an install finishes. Nothing here spawns a shell: `spawnSync('git',
 * [...])` with no `shell` option means no quoting rule, no glob expansion and
 * no `$(…)` in a branch name can change which command runs.
 *
 * `spawnSync` rather than `execFileSync`: `execFileSync` THROWS on a non-zero
 * exit, and the exit code and stderr then live only on the thrown error object.
 * That is precisely how an exit code gets lost. `git()` below never throws for
 * a non-zero exit — it returns `{ code, stdout, stderr, argv }`, every one of
 * the four, and the caller decides.
 *
 * Three facts measured in this repository on 2026-11-01, each of which would
 * silently make a gate lie:
 *
 * 1. GIT SPEAKS THE OS LOCALE. With no LANG, LC_ALL or LANGUAGE set in the
 *    agent's shell, `git rev-parse HEAD` reported
 *      `Schwerwiegend: mehrdeutiges Argument 'HEAD': unbekannter Commit …`
 *    A gate matching English stderr text would have found nothing.
 *    `env LANG=C git rev-parse --verify HEAD` → `fatal: Needed a single
 *    revision`. LANG=C in GIT_ENV is therefore load-bearing, not hygiene.
 *
 * 2. `git rev-parse HEAD` PRINTS THE LITERAL STRING `HEAD` TO STDOUT when HEAD
 *    does not resolve (exit 128, the error on stderr). A caller that trusts
 *    stdout gets the word "HEAD" where it expected a sha. `headSha()` uses
 *    `--verify` AND validates /^[0-9a-f]{40}$/ — both, not either.
 *    (rerun: `git rev-parse HEAD` in a repo with no commit)
 *
 * 3. ARGUMENT ORDER IN `git diff` IS LOAD-BEARING, and getting it wrong is
 *    SILENT. Measured in /Users/semenyevmenenko/Resonance:
 *      git diff --name-only --no-renames HEAD~2 HEAD -- docs   → 4 paths, exit 0
 *      git diff --name-only --no-renames -- HEAD~2 HEAD docs   → NOTHING, exit 0
 *    The second form reads the revisions as pathspecs, checks nothing, and
 *    looks green. `diffNames()` builds the order itself so no caller can get
 *    it wrong; see the comment above it.
 *
 * `EMPTY_TREE` is for the first commit, where there is no parent to diff
 * against: measured `git hash-object -t tree /dev/null` →
 * 4b825dc642cb6eb9a060e54bf8d69288fbee4904.
 */

import { spawnSync } from 'node:child_process';

/** The hash of the empty tree — the diff base when HEAD has no parent. */
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** A full object name. `git rev-parse` output is checked against this, always. */
export const SHA_RE = /^[0-9a-f]{40}$/;

// LANG=C: see fact 1 in the header. LANGUAGE='' because it outranks LANG when
// set. GIT_PAGER=cat and GIT_TERMINAL_PROMPT=0 so no child ever blocks on a
// pager or a credential prompt. TZ=UTC so a date a gate prints is one date.
const GIT_ENV = {
  LANG: 'C',
  LC_ALL: 'C',
  LANGUAGE: '',
  GIT_PAGER: 'cat',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  NO_COLOR: '1',
  TZ: 'UTC',
};

// 1 MiB (the spawnSync default) truncates a chatty child and the truncation is
// reported as a failure that never happened. `git log` over a long range and
// `git ls-files` on a big tree both exceed it.
const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Run git with an argv. NEVER throws for a non-zero exit.
 * → { code, stdout, stderr, argv, spawnError }
 * `code` is null when the process could not be spawned at all (git missing);
 * `spawnError` then carries the reason. stdout/stderr are always strings.
 */
export function git(args, { cwd, stdin } = {}) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    input: stdin,
    env: { ...process.env, ...GIT_ENV },
  });
  return {
    argv: ['git', ...args],
    code: r.error ? null : (r.status ?? null),
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    spawnError: r.error?.message ?? null,
  };
}

/**
 * The same, for the few places where a failure is a bug and not a verdict
 * (reading the repository root, say). The message carries the argv and the
 * stderr, so nothing is lost at the throw.
 */
export function mustGit(args, opts) {
  const r = git(args, opts);
  if (r.code !== 0)
    throw new Error(
      `${r.argv.join(' ')} → exit ${r.code ?? 'spawn failed'}${r.spawnError ? ` (${r.spawnError})` : ''}\n${r.stderr.trim()}`,
    );
  return r.stdout;
}

const firstLine = (s) => s.split('\n')[0].trim();
const lines = (s) =>
  s
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.length > 0);

/** The work tree root. Every gate chdir's here first: run from a subdirectory,
 * a relative pathspec silently matches nothing. → { ok, root, reason } */
export function repoRoot({ cwd } = {}) {
  const r = git(['rev-parse', '--show-toplevel'], { cwd });
  if (r.code !== 0) return { ok: false, root: null, reason: firstLine(r.stderr) || `git exit ${r.code}` };
  const root = r.stdout.trim();
  return root ? { ok: true, root, reason: null } : { ok: false, root: null, reason: 'rev-parse --show-toplevel printed nothing' };
}

/**
 * Resolve one revision to a full sha. → { ok, sha, reason }
 * `--verify` plus the SHA_RE check: header fact 2 is why both are here.
 */
export function revParse(ref, { cwd } = {}) {
  const r = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd });
  if (r.code !== 0) return { ok: false, sha: null, reason: firstLine(r.stderr) || `git rev-parse exit ${r.code}` };
  const sha = r.stdout.trim();
  if (!SHA_RE.test(sha))
    return { ok: false, sha: null, reason: `rev-parse printed ${JSON.stringify(sha)}, which is not a 40-hex object name` };
  return { ok: true, sha, reason: null };
}

/** HEAD as a full sha. → { ok, sha, reason } */
export function headSha(opts) {
  return revParse('HEAD', opts);
}

/** True only when HEAD resolves to a commit. A fresh `git init -b main` is false. */
export function hasCommits(opts) {
  return headSha(opts).ok;
}

/** The current branch name, or null on a detached HEAD. → { ok, branch, reason } */
export function currentBranch({ cwd } = {}) {
  const r = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  if (r.code !== 0) return { ok: false, branch: null, reason: firstLine(r.stderr) || `git exit ${r.code}` };
  const b = r.stdout.trim();
  return { ok: true, branch: b === 'HEAD' ? null : b, reason: null };
}

/** merge-base of two revisions. → { ok, sha, reason } */
export function mergeBase(a, b, { cwd } = {}) {
  const r = git(['merge-base', '--end-of-options', a, b], { cwd });
  if (r.code !== 0) return { ok: false, sha: null, reason: firstLine(r.stderr) || `git merge-base exit ${r.code}` };
  const sha = r.stdout.trim();
  if (!SHA_RE.test(sha)) return { ok: false, sha: null, reason: `merge-base printed ${JSON.stringify(sha)}` };
  return { ok: true, sha, reason: null };
}

/**
 * The revision a range-based gate diffs HEAD against.
 * → { ok, rev, kind: 'merge-base' | 'empty-tree' | 'none', reason }
 *
 * `empty-tree` is the honest answer for the first commit and for a branch with
 * no merge base: everything in the tree is then an addition, which is what a
 * first commit IS. `none` (ok:false) is a repo with no commit at all — the
 * caller must report CANNOT VERIFY rather than diff against nothing.
 */
export function baseRev(mainRef = 'main', { cwd } = {}) {
  const head = headSha({ cwd });
  if (!head.ok) return { ok: false, rev: null, kind: 'none', reason: `HEAD does not resolve: ${head.reason}` };
  const main = revParse(mainRef, { cwd });
  if (!main.ok)
    return { ok: true, rev: EMPTY_TREE, kind: 'empty-tree', reason: `${mainRef} does not resolve (${main.reason}); diffing against the empty tree` };
  const mb = mergeBase(main.sha, head.sha, { cwd });
  if (!mb.ok) return { ok: true, rev: EMPTY_TREE, kind: 'empty-tree', reason: `no merge base with ${mainRef} (${mb.reason}); diffing against the empty tree` };
  return { ok: true, rev: mb.sha, kind: 'merge-base', reason: null };
}

/**
 * Does `path` exist at a revision (HEAD by default)?
 * `cat-file -e` so nothing is read into memory. Measured in
 * /Users/semenyevmenenko/Resonance: exit 0 for a tracked path, exit 128 and
 * `fatal: path '…' does not exist in 'HEAD'` otherwise.
 */
export function existsAtRev(rev, path, { cwd } = {}) {
  return git(['cat-file', '-e', `${rev}:${path}`], { cwd }).code === 0;
}

/** `existsAtRev('HEAD', path)`. False — not an error — in a repo with no commit. */
export function existsAtHead(path, opts) {
  return existsAtRev('HEAD', path, opts);
}

/**
 * The content of one path AT a revision. → { ok, text, reason }
 *
 * This, not readFileSync, is how a range-based gate reads a committed file:
 * read from the work tree and the pre-commit hook turns green on an
 * uncommitted edit that the commit it is guarding does not contain.
 */
export function showAtRev(rev, path, { cwd } = {}) {
  const r = git(['show', '--end-of-options', `${rev}:${path}`], { cwd });
  if (r.code !== 0) return { ok: false, text: null, reason: firstLine(r.stderr) || `git show ${rev}:${path} exit ${r.code}` };
  return { ok: true, text: r.stdout, reason: null };
}

/** `showAtRev('HEAD', path)`. */
export function showAtHead(path, opts) {
  return showAtRev('HEAD', path, opts);
}

/**
 * `git status --porcelain --untracked-files=no [-- pathspec]`.
 * → { ok, entries: [{ xy, path }], reason }
 *
 * `--untracked-files=no` on purpose: a planted fixture or a staged-but-new test
 * file is not dirt. Measured on this repo (no commit yet): zero lines.
 */
export function statusPorcelain(pathspec = [], { cwd } = {}) {
  const args = ['status', '--porcelain', '--untracked-files=no'];
  if (pathspec.length) args.push('--', ...pathspec);
  const r = git(args, { cwd });
  if (r.code !== 0) return { ok: false, entries: null, reason: firstLine(r.stderr) || `git status exit ${r.code}` };
  const entries = lines(r.stdout).map((l) => ({ xy: l.slice(0, 2), path: l.slice(3) }));
  return { ok: true, entries, reason: null };
}

/** Tracked-tree cleanliness as one boolean plus the paths that made it false. */
export function isTreeClean(pathspec = [], opts) {
  const s = statusPorcelain(pathspec, opts);
  if (!s.ok) return { clean: null, entries: null, reason: s.reason };
  return { clean: s.entries.length === 0, entries: s.entries, reason: null };
}

/** `git ls-files [-- pathspec]` → { ok, files, reason }. Tracked paths only. */
export function lsFiles(pathspec = [], { cwd } = {}) {
  const args = ['ls-files', '-z'];
  if (pathspec.length) args.push('--', ...pathspec);
  const r = git(args, { cwd });
  if (r.code !== 0) return { ok: false, files: null, reason: firstLine(r.stderr) || `git ls-files exit ${r.code}` };
  const files = r.stdout.split('\0').filter((f) => f.length > 0);
  return { ok: true, files, reason: null };
}

/**
 * `git ls-files -s` — mode, blob sha, stage, path per line. This is the content
 * key a freshness check hashes: it changes when any tracked CONTENT changes and
 * not when a mtime does.
 * → { ok, entries: [{ mode, sha, stage, path }], raw, reason }
 */
export function lsFilesStaged(pathspec = [], { cwd } = {}) {
  const args = ['ls-files', '-s'];
  if (pathspec.length) args.push('--', ...pathspec);
  const r = git(args, { cwd });
  if (r.code !== 0) return { ok: false, entries: null, raw: null, reason: firstLine(r.stderr) || `git ls-files -s exit ${r.code}` };
  const entries = lines(r.stdout).map((l) => {
    const m = l.match(/^(\d{6}) ([0-9a-f]{40}) (\d)\t(.*)$/);
    return m ? { mode: m[1], sha: m[2], stage: Number(m[3]), path: m[4] } : { mode: null, sha: null, stage: null, path: l };
  });
  return { ok: true, entries, raw: r.stdout, reason: null };
}

/**
 * `git diff --name-only --no-renames [flags] <base> <head> -- <pathspec>`.
 *
 * THE ARGUMENT ORDER IS THE WHOLE POINT OF THIS FUNCTION, because getting it
 * wrong is silent. Measured in /Users/semenyevmenenko/Resonance on 2026-11-01:
 *   `git diff --name-only --no-renames HEAD~2 HEAD -- docs` → 4 paths, exit 0
 *   `git diff --name-only --no-renames -- HEAD~2 HEAD docs` → nothing,  exit 0
 * The second reads the revisions as pathspecs, checks NOTHING, and reports
 * success. Flags, then revisions, then `--`, then pathspec — built here so no
 * caller assembles it by hand.
 *
 * `--no-renames` is mandatory, not a preference: with rename detection on, a
 * renamed test file is one R entry, so red-check never sees it as an addition
 * to prove red and test-guard never sees it as a deletion to account for. One
 * rename would walk past both gates.
 *
 * `base` may be EMPTY_TREE, which is how the first commit diffs.
 * → { ok, files, reason }
 */
export function diffNames(base, head, { flags = [], pathspec = [], cwd } = {}) {
  const args = ['diff', '--name-only', '--no-renames', ...flags, '--end-of-options', base, head];
  if (pathspec.length) args.push('--', ...pathspec);
  const r = git(args, { cwd });
  if (r.code !== 0) return { ok: false, files: null, reason: firstLine(r.stderr) || `git diff exit ${r.code}`, argv: r.argv };
  return { ok: true, files: lines(r.stdout), reason: null, argv: r.argv };
}

/**
 * The same with `--diff-filter`, as a separate entry point so the filter letter
 * is visible at the call site: 'A' additions, 'M' modifications, 'D' deletions,
 * 'd' = everything EXCEPT deletions.
 */
export function diffNamesFiltered(base, head, filter, opts = {}) {
  return diffNames(base, head, { ...opts, flags: [...(opts.flags ?? []), `--diff-filter=${filter}`] });
}

/**
 * Full commit messages over a range, NUL-separated so a blank line inside a
 * message cannot end a record. → { ok, messages: [string], reason }
 *
 * Measured in /Users/semenyevmenenko/Resonance: `git log -z --format=%B -3`
 * yields exactly 3 NUL-terminated records.
 *
 * `range` is a single argument: 'base..HEAD', or a sha, or '-1' style flags via
 * `flags`. A trailer lives at column zero of one of these strings, which is why
 * %B (raw body) is used and not %s.
 */
export function logBodies(range, { flags = [], pathspec = [], cwd } = {}) {
  const args = ['log', '-z', '--format=%B', ...flags];
  if (range) args.push('--end-of-options', range);
  if (pathspec.length) args.push('--', ...pathspec);
  const r = git(args, { cwd });
  if (r.code !== 0) return { ok: false, messages: null, reason: firstLine(r.stderr) || `git log exit ${r.code}` };
  const messages = r.stdout.split('\0').filter((m) => m.trim().length > 0);
  return { ok: true, messages, reason: null };
}

/** One commit's raw body, by revision. → { ok, message, reason } */
export function commitBody(rev, opts) {
  const r = logBodies(rev, { ...opts, flags: ['-1'] });
  if (!r.ok) return { ok: false, message: null, reason: r.reason };
  return { ok: true, message: r.messages[0] ?? '', reason: null };
}
