#!/usr/bin/env node
/**
 * test-guard — changing an established test is a spec change, never a silent edit by whoever
 * (human or agent) the failing test was inconveniencing.
 *
 * Two mechanically checkable rules, both read from git, neither from the work tree:
 *
 *  1. CROSS-BRANCH — a guarded file that existed at the base and is modified, deleted or
 *     type-changed over the range. `--no-renames` (lib/git.mjs) turns a rename into D+A, so a
 *     renamed test surfaces here as a deletion instead of walking past as one R entry.
 *  2. SAME-BRANCH — a MIXED COMMIT (one commit touching implementation AND tests) that modifies
 *     or deletes a guarded file this branch added in an EARLIER commit. That is the
 *     implementation phase reaching into the spec tests it was told not to touch. A test-only
 *     commit stays free, so the test phase can iterate on its own work.
 *
 * WHAT IS GUARDED, and why each form is on the list — the classification itself comes from
 * lib/test-file-patterns.mjs, the one reader of a path's shape:
 *
 *   spec-test / e2e-test   the assertions a spec is judged by
 *   skeleton               spec-less, green by design: never red-checked, still declared
 *   support / fixtures     a helper can fabricate green without a single test file changing
 *   test-config            vitest.config.ts, playwright.config.ts, any tsconfig*.json,
 *                          apps/web/test/setup.ts — narrowing an `include` throws tests OUT of
 *                          the run without touching one test file, and the run still says PASS
 *   __snapshots__/*.snap   `vitest -u` rewrites the ASSERTION itself, silently and in bulk
 *
 * The snapshot row is the one that does NOT follow from the Unity original by analogy. There the
 * companion file a tool rewrites (`.meta`) is importer churn and never a violation; a naive port
 * would put `.snap` in the same exception and open a hole exactly the size of the thing this gate
 * exists to close. A `.snap` holds the expected value; a `.meta` holds a guid. A MODIFIED snapshot
 * is a rewritten assertion and a DELETED snapshot is a deleted assertion — two violations with
 * two messages, not one.
 *
 * A file inside a test directory that lib/test-file-patterns.mjs cannot place is neither guarded
 * nor ignored: it is CANNOT VERIFY, and CANNOT VERIFY blocks. MEASURED 2026-11-01 against the
 * previous revision of this gate: `packages/core/test/CHQ-001/helpers.ts` — a helper a spec test
 * imports, in no Support/ directory, matching no legal form — was MODIFIED over the range and the
 * gate printed "no change to an established … file ✓" and exited 0. Dropping a form nobody can
 * name is how a hole the size of a rewritten helper stays invisible, so the unnameable form is
 * reported here with the cure (give it a legal shape) rather than skipped.
 *
 * `isImpl` IS DEFINED POSITIVELY: `packages/<pkg>/src/**` or `apps/<app>/src/**`. The Unity
 * original defines it negatively (`!guarded && !isMeta`), and in a pnpm monorepo that negative
 * would count `pnpm-lock.yaml`, `docs/specs/*.md`, `.github/**` and every README as
 * implementation, so an ordinary test-phase commit that touches its own spec would read as a
 * mixed commit. A rule that cries wolf gets switched off; this one only fires on source.
 *
 * DECLARATIONS are per-file and there are two, because a test changes for two different reasons:
 *
 *   spec-conflict: <file> — <why the old assertion was wrong>   the TEST was wrong
 *   spec-change:   <file> — <what behaviour changed and why>    the BEHAVIOUR changed
 *
 * Both are read by lib/trailers.mjs, which anchors a trailer to COLUMN ZERO. An indented, quoted,
 * bulleted or differently-cased copy declares nothing and is REPORTED as a near-miss — the author
 * who believes they declared something is the one person a silent gate hurts most. A trailer that
 * matches no violated file is printed on the GREEN path too, for the same reason. There is no
 * blanket waiver: this repository has no pull requests and therefore no label.
 *
 * A token matching MORE THAN ONE violated file is an ERROR, not a waiver. In a monorepo
 * `packages/core/test/CHQ-001/S1_x.test.ts` and `apps/api/test/CHQ-001/S1_x.test.ts` are both
 * normal, and a basename declaration would otherwise amnesty both while naming one.
 *
 * HONEST LIMITS, stated rather than papered over:
 *   - an implementation phase that guts a spec in a SEPARATE test-only commit evades rule 2. It
 *     stays visible in history, and red-check re-runs the final tests against the base.
 *   - a suffix declaration covers the file it uniquely identifies; write the repo-relative path
 *     when a basename is ambiguous (the gate refuses the ambiguous one rather than guessing).
 *   - a contract (`packages/core/src/contracts/CHQ-<nnn>/*.ts`) lives under `src/`, so it IS
 *     implementation by the definition above. A test-phase commit that edits a contract AND a
 *     test this branch added is therefore a mixed commit and must be declared. Put the contract
 *     in its own commit to keep the test phase quiet.
 *   - a MERGE commit contributes nothing to rule 2: `git diff-tree -r` prints no paths for a
 *     merge without `-m`/`-c`, and this gate does not ask for a combined diff. Rule 1 compares
 *     the range endpoints, so content that arrived through a merge is still judged there.
 *   - rule 2 walks the range one commit at a time, two git invocations per commit. When the base
 *     is a tree the range is the whole history; that is printed, not hidden.
 *   - Playwright's own snapshot directory (`<spec>.ts-snapshots/`) is NOT guarded. Its shape was
 *     not measured in this repository, and the e2e lane reads CANNOT VERIFY until a browser probe
 *     passes. UNVERIFIED, deliberately, rather than guarded on a guess.
 *   - this gate reads HEAD, never the index and never the work tree. In the pre-commit hook that
 *     means it judges the PREVIOUS commit; the commit being written is judged by the next run.
 *
 * Usage: node tools/gates/test-guard.mjs [--base <ref>] [--since <rev|tree>] [--summary <path>]
 * Exit:  0 pass · 1 an undeclared or ambiguous change · 2 CANNOT VERIFY. Both non-zero codes
 *        block: "it never ran" is not green, and neither is "I could not classify it".
 */

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EMPTY_TREE,
  baseRev,
  commitBody,
  diffNamesFiltered,
  git,
  hasCommits,
  repoRoot,
  revParse,
} from './lib/git.mjs';
import { TEST_DIR, classify } from './lib/test-file-patterns.mjs';
import { parseTrailers } from './lib/trailers.mjs';

const TAG = '[test-guard]';
const out = (msg) => console.log(`${TAG} ${msg}`);
const err = (msg) => console.error(`${TAG} ${msg}`);

// An explicit comparator, by code point: the default sort is locale-free but unspecified for the
// caller, and a gate's output is diffed between runs.
function byCodePoint(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

const short = (sha) => (typeof sha === 'string' && sha.length >= 7 ? sha.slice(0, 7) : String(sha));

export const USAGE = `Usage: node tools/gates/test-guard.mjs [--base <ref>] [--since <rev|tree>] [--summary <path>]

  --base <ref>      the branch to take a merge base with (default: main). An EXPLICIT --base that
                    does not resolve is CANNOT VERIFY: the gate will not answer about a range it
                    was not asked about
  --since <rev>     diff from this revision instead; may name a TREE (the empty tree), which is
                    the ordinary case in a repository whose history starts at the scaffold
  --summary <path>  write the machine summary JSON here (ready.mjs passes a path in its run dir)`;

// --------------------------------------------------------------------------- argv

/**
 * Flags only, no positional arguments. An unknown flag is CANNOT VERIFY rather than ignored: a
 * caller who passed `--sice` meant to narrow the range, and a gate that silently judged a
 * different range than it was asked to is the failure mode this whole file is about.
 */
export function parseArgv(argv) {
  const known = new Set(['--base', '--since', '--summary']);
  // The annotation is not decoration: without it the initialisers make `since` and `summary` of
  // type `null`, every later `!== null` narrows to `never`, and the type-aware lint rules then
  // report the honest consequence (`restrict-template-expressions` on a `never` in a message).
  /** @type {{ base: string, baseExplicit: boolean, since: string | null, summary: string | null, help: boolean }} */
  const flags = { base: 'main', baseExplicit: false, since: null, summary: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (!known.has(a)) return { ok: false, reason: `unknown argument "${a}"`, flags };
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return { ok: false, reason: `${a} needs a value`, flags };
    i += 1;
    if (a === '--base') {
      flags.base = v;
      flags.baseExplicit = true;
    }
    if (a === '--since') flags.since = v;
    if (a === '--summary') flags.summary = v;
  }
  if (flags.since !== null && flags.baseExplicit) {
    return { ok: false, reason: '--base and --since name two different ranges — pass one', flags };
  }
  return { ok: true, reason: null, flags };
}

// --------------------------------------------------------- what is guarded, and why

// A snapshot is a test by content and a companion file by shape. The regex is written here rather
// than in test-file-patterns.mjs because `classify()` answers about files a RUNNER collects, and
// no runner collects a .snap; it is read by the test that owns it. Measured consequence worth
// knowing: `classify()` returns form 'unclassified-test' for a snapshot path, so the snapshot
// check runs FIRST below and the "nobody can place this file" reason never shadows it.
const SNAPSHOT_RE = /(^|\/)__snapshots__\/[^/]+\.snap$/;
export const isSnapshot = (p) => SNAPSHOT_RE.test(String(p ?? ''));

// Implementation, positively. See the header for why a negative definition is unusable here.
const IMPL_RE = /^(packages|apps)\/[^/]+\/src\//;
export const isImpl = (p) => IMPL_RE.test(String(p ?? ''));

/** Why each guarded form is guarded — printed with the violation, so the author learns the rule. */
const WHY_GUARDED = Object.freeze({
  'spec-test': 'a spec test: the assertion a spec is judged by',
  'e2e-test': 'an e2e spec test',
  skeleton: 'a skeleton fixture: spec-less and green by design, and still a declared change',
  support: 'test support: a helper can fabricate green with no test file changed',
  'test-config':
    'test configuration: narrowing an include throws tests out of the run while the run still says PASS',
  snapshot: 'a snapshot: `vitest -u` rewrites the ASSERTION itself',
});

/**
 * → { guarded, unnameable, form, why, cure } for one repo-relative path.
 *
 * One call to `classify()` per path: reading its `form` IS reading that module (the exported
 * predicates each call it again), so there is still exactly one classification of a path in this
 * repository. `unnameable` is that module's own `cannotVerify` answer carried through instead of
 * being dropped — a file under `test/` that no legal form matches may be the helper a spec test
 * asserts through, and the gate must not pretend to have judged it.
 */
export function guardOf(path) {
  if (isSnapshot(path)) return { guarded: true, unnameable: false, form: 'snapshot', why: WHY_GUARDED.snapshot, cure: null };
  const c = classify(path);
  if (Object.prototype.hasOwnProperty.call(WHY_GUARDED, c.form)) {
    return { guarded: true, unnameable: false, form: c.form, why: WHY_GUARDED[c.form], cure: null };
  }
  if (c.cannotVerify) {
    return {
      guarded: false,
      unnameable: true,
      form: c.form,
      why: null,
      cure:
        c.reason ??
        `give it one of the legal shapes under ${Object.values(TEST_DIR).join(' / ')} (see tools/gates/lib/test-file-patterns.mjs)`,
    };
  }
  return { guarded: false, unnameable: false, form: c.form, why: null, cure: null };
}

// ------------------------------------------------------------------ declarations

const DECLARATION_NAMES = new Set(['spec-conflict', 'spec-change']);

/**
 * The path token of a declaration value: everything before the first DASH SEPARATOR, i.e. a dash
 * with whitespace on both sides. Requiring the whitespace is what lets a slug keep its hyphens —
 * `S1_rejects-empty.test.ts` is one token, `S1_a.test.ts — why` is a path and a reason. Quotes,
 * backticks and a leading `./` are stripped. No separator at all means the whole value is the
 * token: it still names a file, and the missing half is reported rather than guessed at.
 */
export function pathToken(value) {
  return String(value ?? '')
    .split(/\s+[—–-]{1,2}\s+/)[0]
    .trim()
    .replace(/[`'"]/g, '')
    .replace(/^\.\//, '');
}

/** Does the value carry a reason after the dash separator? */
const hasReason = (value) => /\s+[—–-]{1,2}\s+\S/.test(String(value ?? ''));

/** Exact path, or a unique path SUFFIX at a segment boundary. Ambiguity is resolved by refusing. */
export const tokenMatches = (token, file) => file === token || file.endsWith(`/${token}`);

// A mention INSIDE a sentence: the lexicon of a declaration on a line it does not begin, and not
// even at the start of one. MEASURED 2026-11-01: lib/trailers.mjs reports the indented, quoted and
// mis-cased forms in `rejected`, but its near-miss pattern anchors at column zero after punctuation
// only, so `we should NOT use spec-conflict: x.test.ts — …` is neither a trailer nor a rejection
// there. This scan runs ONLY over lines that module claimed neither way, so no line gets two
// answers about it.
const MID_LINE_RE = /\S.*?\b(spec-conflict|spec-change):\s*(\S.*)$/;

/**
 * Read declarations, near-misses and mid-sentence mentions out of a set of commits.
 *
 * `trailers.mjs` owns the decision "is this a declaration"; this function only asks it per line
 * and keeps what it says. Each finding carries the commit it came from, so a note cites
 * `<sha>:<line>` and not a subject that two commits may share.
 *
 * @param {Array<{sha: string|null, subject: string, body: string}>} commits
 */
export function readDeclarations(commits) {
  const declarations = [];
  const rejected = [];
  const mentions = [];

  for (const commit of commits ?? []) {
    const body = typeof commit?.body === 'string' ? commit.body : '';
    const where = `${short(commit?.sha ?? '???????')} "${commit?.subject ?? ''}"`;
    const parsed = parseTrailers(body);

    const claimed = new Set();
    for (const t of parsed.trailers) {
      claimed.add(t.line);
      if (!DECLARATION_NAMES.has(t.name)) continue;
      const token = pathToken(t.value);
      if (token === '') {
        rejected.push({ name: t.name, text: t.value, where, sha: commit?.sha ?? null, line: t.line, reasons: ['no path token before the dash separator'] });
        continue;
      }
      declarations.push({
        name: t.name,
        token,
        value: t.value,
        where,
        sha: commit?.sha ?? null,
        line: t.line,
        hasReason: hasReason(t.value),
      });
    }
    for (const r of parsed.rejected) {
      claimed.add(r.line);
      if (!DECLARATION_NAMES.has(r.name)) continue;
      rejected.push({ name: r.name, text: r.text.trim(), where, sha: commit?.sha ?? null, line: r.line, reasons: r.reasons });
    }

    body.split('\n').forEach((raw, index) => {
      const lineNo = index + 1;
      if (claimed.has(lineNo)) return;
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      const m = MID_LINE_RE.exec(line);
      if (m === null) return;
      const token = pathToken(m[2]);
      if (token === '') return;
      mentions.push({ name: m[1], token, where, sha: commit?.sha ?? null, line: lineNo, text: line.trim() });
    });
  }

  return { declarations, rejected, mentions };
}

// ------------------------------------------------------------------------- range

/**
 * Resolve the diff base and the trailer log range. They are resolved SEPARATELY because
 * `--since` may name a TREE: the empty tree is how a history that starts at the scaffold diffs
 * its first branch, and ready.mjs passes it for a spec added in the root commit. A diff takes a
 * tree; a commit RANGE does not. When the base is not a commit the trailer log spans the whole
 * history, which is printed — a wider log quietly honouring an older declaration is exactly the
 * kind of silent widening this gate exists to refuse.
 *
 * → { ok, reason, diffBase, logRange, wholeHistory, label, notes }
 */
export function resolveRange({ base, baseExplicit, since }) {
  const notes = [];
  const wide =
    'a declaration is honoured only in a commit that actually touched the file it names';

  if (since !== null) {
    const asCommit = revParse(since);
    if (asCommit.ok) {
      return {
        ok: true,
        reason: null,
        diffBase: asCommit.sha,
        logRange: `${asCommit.sha}..HEAD`,
        wholeHistory: false,
        label: `--since ${since} (${short(asCommit.sha)})..HEAD`,
        notes,
      };
    }
    const type = git(['cat-file', '-t', '--end-of-options', since]);
    if (type.code !== 0 || type.stdout.trim() !== 'tree') {
      return {
        ok: false,
        reason:
          `--since ${since} resolves to neither a commit nor a tree (${asCommit.reason})\n` +
          `  What to do: pass a commit, a ref, or the empty tree ${EMPTY_TREE}.`,
        diffBase: null,
        logRange: null,
        wholeHistory: false,
        label: null,
        notes,
      };
    }
    notes.push(`trailer log spans the whole history (--since names a tree, so there is no commit range) — ${wide}`);
    return {
      ok: true,
      reason: null,
      diffBase: since,
      logRange: 'HEAD',
      wholeHistory: true,
      label: `--since ${short(since)} (a tree)..HEAD`,
      notes,
    };
  }

  const b = baseRev(base);
  if (!b.ok) {
    return { ok: false, reason: b.reason, diffBase: null, logRange: null, wholeHistory: false, label: null, notes };
  }
  if (b.kind === 'empty-tree') {
    // An EXPLICIT --base that does not resolve is CANNOT VERIFY, not a widening. MEASURED
    // 2026-11-01 against the previous revision of this gate: `--base no-such-branch` fell back to
    // the empty tree and printed a PASS, i.e. it answered about a range nobody asked for. The
    // DEFAULT `main` not resolving is a different fact — a repository whose only branch is named
    // something else, or a detached HEAD — and there the empty tree is the honest base.
    if (baseExplicit) {
      return {
        ok: false,
        reason:
          `--base ${base} does not resolve (${b.reason})\n` +
          '  This gate will not answer about a range it was not asked about: an explicit --base\n' +
          '  that names nothing is CANNOT VERIFY, not a silent fall back to the whole history.\n' +
          `  What to do: pass a ref that exists, or drop --base to take a merge base with main.`,
        diffBase: null,
        logRange: null,
        wholeHistory: false,
        label: null,
        notes,
      };
    }
    notes.push(`trailer log spans the whole history (the base is the empty tree) — ${wide}`);
    return {
      ok: true,
      reason: null,
      diffBase: b.rev,
      logRange: 'HEAD',
      wholeHistory: true,
      label: `empty tree..HEAD (${b.reason})`,
      notes,
    };
  }
  return {
    ok: true,
    reason: null,
    diffBase: b.rev,
    logRange: `${b.rev}..HEAD`,
    wholeHistory: false,
    label: `merge-base(${base}, HEAD) ${short(b.rev)}..HEAD`,
    notes,
  };
}

// -------------------------------------------------------------------- the commits

/**
 * Walk the range oldest-first, carrying each commit's name-status and its raw body.
 *
 * One `diff-tree` and one `log -1 --format=%B` per commit. `--root` is what makes the FIRST
 * commit of a history report its content: MEASURED 2026-11-01 in /Users/semenyevmenenko/Resonance,
 * `git diff-tree --no-commit-id --name-only -r <root sha>` prints NOTHING and exits 0, while the
 * same command with `--root` prints all 48 files. Without it a root commit reads like a
 * documentation-only commit — not a wrong verdict here (a root commit holds additions only), but
 * a wrong FACT, and this list is read by rule 2.
 *
 * → { ok, reason, commits: [{ sha, subject, body, status: Map<path, letter> }] }
 */
export function walkRange(logRange) {
  const revList = git(['rev-list', '--reverse', '--end-of-options', logRange]);
  if (revList.code !== 0) {
    return { ok: false, reason: `git rev-list ${logRange} → exit ${revList.code}: ${revList.stderr.trim()}`, commits: null };
  }
  const shas = revList.stdout.split('\n').filter((l) => l.length > 0);
  const commits = [];
  for (const sha of shas) {
    const r = git([
      'diff-tree',
      '--root',
      '--no-commit-id',
      '--name-status',
      '--no-renames',
      '-r',
      '--end-of-options',
      sha,
    ]);
    if (r.code !== 0) {
      return { ok: false, reason: `git diff-tree ${short(sha)} → exit ${r.code}: ${r.stderr.trim()}`, commits: null };
    }
    const status = new Map();
    for (const line of r.stdout.split('\n')) {
      if (line.length === 0) continue;
      const tab = line.indexOf('\t');
      if (tab < 0) continue;
      status.set(line.slice(tab + 1), line.slice(0, tab).trim());
    }
    const body = commitBody(sha);
    if (!body.ok) {
      return { ok: false, reason: `git log -1 ${short(sha)} → ${body.reason}`, commits: null };
    }
    commits.push({
      sha,
      subject: (body.message.split('\n')[0] ?? '').trim() || '(no subject)',
      body: body.message,
      status,
    });
  }
  return { ok: true, reason: null, commits };
}

// A letter from `--name-status` that means the content under that path changed. T is a type
// change (a file became a symlink, say) and it changes what the runner reads, so it counts.
const CHANGED_LETTERS = new Set(['M', 'D', 'T']);

// --------------------------------------------------------------------------- main

function writeSummary(path, body) {
  const target = resolve(path);
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    out(`summary: ${target}`);
    return null;
  } catch (e) {
    // A summary that cannot be written is not a verdict about the tests. It is reported and the
    // verdict stands on its own, because ready.mjs reads the exit code as well as the file.
    return `could not write the summary to ${target} (${e.message})`;
  }
}

function main(argv = process.argv.slice(2)) {
  const parsed = parseArgv(argv);
  if (parsed.flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (!parsed.ok) {
    err(`CANNOT VERIFY: ${parsed.reason}`);
    console.error(USAGE);
    return 2;
  }
  const { base, baseExplicit, since, summary } = parsed.flags;

  const root = repoRoot();
  if (!root.ok) {
    err(`CANNOT VERIFY: not inside a git repository (${root.reason}) — run this from the work tree`);
    return 2;
  }
  process.chdir(root.root);

  if (!hasCommits()) {
    err(
      'CANNOT VERIFY: this repository has no commits yet.\n' +
        '  test-guard is range-based: it compares a base revision with HEAD and reads trailers from\n' +
        '  the commit messages in between. With no HEAD there is no range, no established test to\n' +
        '  protect, and nothing a declaration could be attached to.\n' +
        `  What to do: commit the scaffold first (${root.root}), then run this gate again.\n` +
        '  "It never ran" is not green — this is CANNOT VERIFY and it blocks like a failure.',
    );
    return 2;
  }

  const range = resolveRange({ base, baseExplicit, since });
  if (!range.ok) {
    err(`CANNOT VERIFY: ${range.reason}`);
    return 2;
  }
  const { diffBase, logRange, wholeHistory } = range;
  const notes = [...range.notes];
  out(`range: ${range.label}`);

  // ----------------------------------------------------------------- the commits
  const walk = walkRange(logRange);
  if (!walk.ok) {
    err(`CANNOT VERIFY: ${walk.reason}`);
    return 2;
  }
  const commits = walk.commits;
  if (commits.length === 0) {
    // An empty range is not a pass about anything. MEASURED 2026-11-01 against the previous
    // revision of this gate: committing straight on main makes merge-base(main, HEAD) == HEAD, the
    // diff is empty, and the gate printed "no change to an established … file ✓". It had gated
    // nothing. ready.mjs derives the range from the spec for exactly this reason; said here too,
    // because this gate is also run by hand.
    notes.push(
      'the range holds no commit — this gate judged nothing. ' +
        'On main, merge-base(main, HEAD) IS HEAD; pass --since <rev> or the empty tree to name a real range',
    );
  }

  /** Which commits in the range touched a path, and how. */
  const touchedIn = (file) => commits.filter((c) => c.status.has(file));

  // ------------------------------------------------------------------- the diffs
  const violations = [];
  const unnameable = [];

  const seen = new Set();
  function addUnnameable(file, g, how, whereList) {
    const key = `${file}|${how}`;
    if (seen.has(key)) return;
    seen.add(key);
    unnameable.push({ file, form: g.form, how, cure: g.cure, commits: whereList });
  }

  // Rule 1 — cross-branch, from the range ENDPOINTS. Deletions and type changes are read with
  // their own filters rather than folded into one, because a deleted assertion, a rewritten
  // assertion and a file that became something else are three different sentences to the author.
  function namesFiltered(filter) {
    const r = diffNamesFiltered(diffBase, 'HEAD', filter);
    if (!r.ok) return { ok: false, reason: `${r.reason} (${(r.argv ?? []).join(' ')})`, files: null };
    return { ok: true, reason: null, files: r.files };
  }
  // No 'A' filter here on purpose: rule 2's "added by this branch" set is accumulated during the
  // walk below, because the endpoint diff cannot see a file that was added AND removed inside the
  // range. See the measurement above rule 2.
  const changed = namesFiltered('MDT');
  const deleted = namesFiltered('D');
  const retyped = namesFiltered('T');
  for (const r of [changed, deleted, retyped]) {
    if (!r.ok) {
      err(`CANNOT VERIFY: ${r.reason}`);
      return 2;
    }
  }
  const deletedSet = new Set(deleted.files);
  const retypedSet = new Set(retyped.files);

  for (const file of changed.files) {
    const g = guardOf(file);
    const where = touchedIn(file);
    if (g.unnameable) {
      addUnnameable(
        file,
        g,
        deletedSet.has(file) ? 'deleted' : 'modified',
        where.map((c) => short(c.sha)),
      );
      continue;
    }
    if (!g.guarded) continue;
    const gone = deletedSet.has(file);
    const retypedHere = retypedSet.has(file);
    const how = gone ? 'deleted' : retypedHere ? 'type-changed' : 'modified';
    const inCommits =
      where.length > 0
        ? ` (in ${where.map((c) => `${short(c.sha)} "${c.subject}"`).join(', ')})`
        : ' (no commit in the trailer range touched it — the base may not be an ancestor of HEAD)';
    violations.push({
      file,
      rule: 'cross-branch',
      form: g.form,
      how,
      desc:
        g.form === 'snapshot'
          ? gone
            ? `deleted snapshot ${file}${inCommits} — the expected value is gone, so the test no longer asserts it`
            : `rewritten snapshot ${file}${inCommits} — \`vitest -u\` replaced the assertion, not the code`
          : `${how} established ${g.form} ${file}${inCommits} (${g.why})`,
    });
  }

  // Rule 2 — same-branch. Scope: the files THIS branch added in an EARLIER commit of the range.
  //
  // The added set is accumulated DURING the walk, not taken from the range endpoints. MEASURED
  // 2026-11-01 against the previous revision of this gate, which took it from the endpoints: a
  // guarded file added in commit 1 and deleted by a mixed commit in commit 3 appears in NEITHER
  // the endpoint A set (it is absent at HEAD) nor the endpoint D set (it was absent at the base),
  // so both rules missed it and the gate exited 0. Walking makes the scope what the rule says it
  // is — "added by this branch" — rather than "added by this branch and still present at HEAD".
  const addedEarlier = new Set();
  for (const commit of commits) {
    // Every letter counts, deletions included: a commit that REMOVES an implementation file and
    // edits the test that asserted on it in the same breath is the shape this rule is named for.
    // A guarded path is never implementation, however, or a `__snapshots__` directory under src/
    // would make a commit mixed with itself.
    const impl = [...commit.status.keys()].filter((file) => isImpl(file) && !guardOf(file).guarded);
    if (impl.length > 0) {
      for (const [file, letter] of commit.status) {
        if (!CHANGED_LETTERS.has(letter)) continue;
        if (!addedEarlier.has(file)) continue;
        const g = guardOf(file);
        if (g.unnameable) {
          addUnnameable(file, g, letter === 'D' ? 'deleted' : 'modified', [short(commit.sha)]);
          continue;
        }
        if (!g.guarded) continue;
        violations.push({
          file,
          rule: 'same-branch',
          form: g.form,
          how: letter === 'D' ? 'deleted' : 'modified',
          desc:
            `mixed commit ${short(commit.sha)} "${commit.subject}" ${letter === 'D' ? 'deletes' : 'changes'} ${file}, ` +
            `a ${g.form} this branch added, in the same commit as implementation under src/ ` +
            `(${impl.join(', ')}) (${g.why})`,
        });
      }
    }
    for (const [file, letter] of commit.status) if (letter === 'A') addedEarlier.add(file);
  }

  // ------------------------------------------------------------------- trailers
  const { declarations, rejected, mentions } = readDeclarations(commits);

  /**
   * When the log spans the whole history, a declaration counts only in a commit that actually
   * touched the file it names. Without that narrowing, any `spec-change:` ever written in this
   * repository would waive every later change to that path. The commit's own name-status answers
   * it, so no extra git call is needed.
   */
  function declarationsFor(file) {
    if (!wholeHistory) return declarations;
    const touching = new Set(touchedIn(file).map((c) => c.sha));
    return declarations.filter((d) => d.sha !== null && touching.has(d.sha));
  }

  const violatedFiles = [...new Set([...violations.map((v) => v.file), ...unnameable.map((u) => u.file)])].toSorted(byCodePoint);

  // A token that matches more than one VIOLATED file is an error, not a waiver: it names one file
  // and would amnesty several. Counted against the violated set, because a token that is ambiguous
  // across the whole tree but hits exactly one violation still says which change it is about.
  const ambiguous = [];
  for (const d of declarations) {
    const hits = violatedFiles.filter((f) => tokenMatches(d.token, f));
    if (hits.length > 1) ambiguous.push({ ...d, hits });
  }
  const ambiguousTokens = new Set(ambiguous.map((a) => `${a.name}:${a.token}`));

  const waivedBy = (file) =>
    declarationsFor(file).find((d) => tokenMatches(d.token, file) && !ambiguousTokens.has(`${d.name}:${d.token}`)) ?? null;

  const undeclared = [];
  const declared = [];
  for (const v of violations) {
    const d = waivedBy(v.file);
    if (d === null) undeclared.push(v);
    else declared.push({ ...v, declaredAs: d });
  }

  const unmatched = declarations.filter((d) => !violatedFiles.some((f) => tokenMatches(d.token, f)));

  // ------------------------------------------------------------------- reporting
  for (const n of notes) out(`note: ${n}`);
  // A declaration cannot cure a file nobody can classify, so an author who wrote one for such a
  // file is told why the gate still blocks. Said once per declaration, not once per file.
  const unnameableFiles = new Set(unnameable.map((u) => u.file));
  for (const d of declarations) {
    const hits = violatedFiles.filter((f) => tokenMatches(d.token, f));
    if (hits.length === 0 || hits.some((f) => !unnameableFiles.has(f))) continue;
    out(
      `note: ${d.where}:${d.line} — "${d.name}: ${d.token}" names ${hits.join(', ')}, which this gate cannot ` +
        'classify; a declaration says WHY a test changed, it does not give a file a legal shape',
    );
  }

  // A declaration that names a file and gives no reason still waives — it names the file — but the
  // missing half is said out loud, because `<file> — <why>` is the declared form and the "why" is
  // the part a reviewer reads.
  for (const d of declared) {
    if (d.declaredAs.hasReason) continue;
    out(
      `note: ${d.declaredAs.where}:${d.declaredAs.line} — "${d.declaredAs.name}: ${d.declaredAs.value}" names a file and no reason; ` +
        `the declared form is "${d.declaredAs.name}: <file> — <why>"`,
    );
  }

  // A near-miss and a mid-sentence mention are printed whenever they name a violated file, on the
  // green path as well as the red one: "I declared it" and "the gate read it" must never diverge
  // in silence.
  for (const r of rejected) {
    const token = pathToken(r.text.replace(/^[^:]*:\s*/, ''));
    if (!violatedFiles.some((f) => tokenMatches(token, f))) continue;
    out(`note: ${r.where}:${r.line} — "${r.text}" is not a declaration (${r.reasons.join('; ')}); it waives nothing`);
  }
  for (const m of mentions) {
    if (!violatedFiles.some((f) => tokenMatches(m.token, f))) continue;
    out(
      `note: ${m.where}:${m.line} — a line mentioning "${m.name}: ${m.token}" inside a sentence is not a ` +
        'declaration; a declaration must BEGIN its own line at column zero, and it waives nothing',
    );
  }
  for (const d of unmatched) {
    out(
      `note: ${d.where}:${d.line} — trailer "${d.name}: ${d.token}" ` +
        (violatedFiles.length === 0
          ? 'waives nothing: no guarded file changed in this range'
          : `matches none of the ${violatedFiles.length} changed guarded file(s); it waives nothing`),
    );
  }
  for (const a of ambiguous) {
    err(
      `${a.where}:${a.line} — trailer "${a.name}: ${a.token}" matches ${a.hits.length} changed files ` +
        `(${a.hits.join(', ')}) — write the repo-relative path of the ONE file it is about. ` +
        'An ambiguous token waives nothing.',
    );
  }

  const verdict =
    undeclared.length > 0 || ambiguous.length > 0 ? 'fail' : unnameable.length > 0 ? 'cannot-verify' : 'pass';

  if (summary !== null) {
    const problem = writeSummary(summary, {
      gate: 'test-guard',
      verdict,
      range: { label: range.label, diffBase, logRange, wholeHistory, commits: commits.length },
      counts: {
        violations: violations.length,
        declared: declared.length,
        undeclared: undeclared.length,
        ambiguous: ambiguous.length,
        cannotVerify: unnameable.length,
        unmatchedTrailers: unmatched.length,
        mentions: mentions.length,
        nearMisses: rejected.length,
      },
      // `warnings` in the shared summary shape is the non-verdict prose: a note never moves a
      // verdict, and ready.mjs is required never to let one.
      warnings: [...notes],
      details: [
        ...undeclared.map((v) => ({ verdict: 'undeclared', rule: v.rule, file: v.file, form: v.form, how: v.how, desc: v.desc })),
        ...unnameable.map((u) => ({ verdict: 'cannot-verify', file: u.file, form: u.form, how: u.how, cure: u.cure })),
        ...declared.map((v) => ({
          verdict: 'declared',
          rule: v.rule,
          file: v.file,
          form: v.form,
          how: v.how,
          via: `${v.declaredAs.name}: ${v.declaredAs.token}`,
        })),
        ...ambiguous.map((a) => ({ verdict: 'ambiguous', trailer: `${a.name}: ${a.token}`, files: a.hits })),
      ],
    });
    if (problem !== null) out(`warning: ${problem}`);
  }

  // A file nobody can classify is printed whatever the verdict is: it is the reason the gate
  // cannot stand behind its own coverage, and it must not be buried under a FAILED block.
  if (unnameable.length > 0) {
    err(
      `\n${TAG} CANNOT VERIFY — ${unnameable.length} changed file(s) inside a test directory that ` +
        'no legal form matches, so this gate cannot say whether a test changed:\n' +
        unnameable.map((u) => `  - ${u.how} ${u.file} (in ${u.commits.join(', ') || 'no commit of this range'})\n      ${u.cure}`).join('\n') +
        '\n\nA file under a test directory is judged by its shape. One of these is not an opinion:\n' +
        '  a case      <test dir>/CHQ-<nnn>/S<n>_<kebab-slug>.test.ts(x)\n' +
        '  a helper    <test dir>/**/support/*.ts  (or fixtures/)\n' +
        '  a fixture   <test dir>/skeleton/<name>.test.ts\n' +
        'Rename or move the file, and this gate can guard it. CANNOT VERIFY blocks like a failure.',
    );
  }

  if (verdict === 'pass') {
    if (violations.length === 0) {
      out('no change to an established or branch-added guarded file ✓');
    } else {
      const kinds = [...new Set(declared.map((v) => v.declaredAs.name))].toSorted(byCodePoint);
      out(`every guarded change is declared per file (${declared.length} change(s), via ${kinds.join(' + ')}) ✓`);
    }
    return 0;
  }
  if (verdict === 'cannot-verify') return 2;

  err(
    `\n${TAG} FAILED — ${undeclared.length} undeclared change(s) to guarded files` +
      (ambiguous.length > 0 ? ` and ${ambiguous.length} ambiguous declaration(s)` : '') +
      ':\n' +
      undeclared.map((v) => `  - ${v.desc}`).join('\n') +
      (unmatched.length > 0
        ? '\n\nTrailers that match none of those files (a declaration names ONE file):\n' +
          unmatched.map((d) => `  - ${d.where}:${d.line} ${d.name}: ${d.token}`).join('\n')
        : '') +
      '\n\nChanging or deleting an established test — or editing a test this branch added, in the\n' +
      'same commit as implementation under src/ — is a spec change, not an implementation detail.\n' +
      'Declare it PER FILE, at column zero of a commit message, with the trailer that says which it is:\n' +
      '  spec-conflict: <file> — <why the old assertion was wrong>   (the TEST was wrong)\n' +
      '  spec-change:   <file> — <what behaviour changed and why>    (the BEHAVIOUR changed)\n' +
      'There is no blanket waiver. If an agent hit this during implement-to-green: do NOT edit the\n' +
      'test to make it pass — write the spec-conflict report and stop.',
  );
  return 1;
}

export { main };

/**
 * Was this module invoked as a script, rather than imported?
 *
 * The obvious form of this check — `resolve(process.argv[1]) === fileURLToPath(import.meta.url)`
 * — IS WRONG ON THIS MACHINE, and wrong in the one direction a gate must never fail in.
 * MEASURED 2026-11-01, a file under `os.tmpdir()`:
 *
 *   argv[1]                       /var/folders/…/x/probe.mjs
 *   fileURLToPath(import.meta.url) /private/var/folders/…/x/probe.mjs
 *
 * Node resolves symlinks for the main module's URL and leaves argv[1] as typed, and on macOS
 * `/var` is a symlink to `/private/var` (so is `/tmp`). The comparison is therefore `false` for a
 * script run through any symlinked directory, `main()` never runs, and the gate exits 0 having
 * printed NOTHING — green and blind, the exact failure these gates exist to refuse. It was caught
 * by running L-testguard, whose two-channel check reported "exited 0 (pass): it printed nothing".
 *
 * So: compare REAL paths on both sides, and when either cannot be resolved, BIAS TOWARDS RUNNING.
 * A gate that runs when it was only imported is loud and harmless; a gate that stays silent when
 * it was invoked is the measured hazard above.
 */
export function isMain(entry = process.argv[1], self = fileURLToPath(import.meta.url)) {
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(self);
  } catch {
    // Neither path could be resolved on disk (a deleted file, a permission). Run.
    return true;
  }
}

// Run only when invoked as a script, so gate-probes can import the helpers above and assert on
// them without the gate judging the probe's own repository on import.
if (isMain()) {
  process.exit(main());
}
