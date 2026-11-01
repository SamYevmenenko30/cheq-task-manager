/**
 * L-testguard — `tools/gates/test-guard.mjs` as a row in the standing pack.
 *
 * Zero dependencies, Node 22 ESM.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY THIS LIGHT SPAWNS THE GATE INSTEAD OF IMPORTING ITS LOGIC
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * There were two ways to put test-guard in the pack, and only one of them is
 * available:
 *
 *   (a) import its logic and call it. NOT POSSIBLE as the gate stands, and not
 *       because of taste: `test-guard.mjs` is a top-level SCRIPT. It reads
 *       `process.argv` at line 258, calls `process.chdir` at 274 and
 *       `process.exit` at 266/289/562/583 — all during module evaluation. An
 *       `import` from a light would therefore RUN the gate while the pack is
 *       still loading its sixteen modules and then terminate the whole process
 *       from inside one of them, which the module contract forbids outright
 *       (`./_shared.mjs`: a light never calls `process.exit`, and a thrown
 *       exception is the only thing `run.mjs` can catch). Extracting the logic
 *       into a shared module would be an edit to somebody else's gate.
 *
 *   (b) run it as a child process and read the ARTIFACT it writes. This is what
 *       happens here, and it is not a workaround — it is the house rule:
 *       `--summary <path>` (test-guard.mjs:100) exists precisely so another lane
 *       can read a machine verdict instead of scraping stdout, and ADR-0002 says
 *       the verdict comes from the artifact while the exit code stays advisory.
 *
 * So the gate keeps its single copy of the rules, this light keeps no second
 * opinion about what a guarded file is, and the two can never drift: there is
 * nothing here to drift.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE EXIT CODE IS CAPTURED SEPARATELY AND IT IS ADVISORY
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `sh()` from `./_shared.mjs` spawns from an argv with no shell and returns
 * `{ code, stdout, stderr }` as four separate things. There is NO PIPE anywhere
 * in this file: `cmd | head` reports `$?` of `head`, which is how two runs in
 * the session that designed these gates reported `exit=0` over a crashed linter
 * and over four TS6059.
 *
 * The verdict is `summary.verdict` from the JSON. The exit code only
 * corroborates it, and a DISAGREEMENT between the two (`verdict: "pass"` with a
 * non-zero exit, say) is cannot-verify naming both — two channels that describe
 * the same run and do not agree mean nobody knows what the run said.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * HOW A STALE SUMMARY IS MADE IMPOSSIBLE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `../lib/run-dir.mjs` refuses to hand out "the newest run" because a reader
 * that finds its own artifact can read an older one and call it green. This
 * light writes the summary itself, one line before reading it, at a FIXED path,
 * and closes the same hole differently: the file is DELETED first, and if it is
 * absent afterwards the row is cannot-verify. A stale read is then not a risk
 * that was weighed, it is a state that cannot occur — there is no file to be
 * stale.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE RANGE IS THE PACK'S RANGE, PASSED EXPLICITLY
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `run.mjs` has already resolved the range and hands it over in `ctx.mb` (a
 * merge base, or the empty tree for a first commit) with `ctx.rangeKind` saying
 * which. It is passed on as `--since <mb>`, never re-derived: a light that asked
 * git the same question again could answer about a different range than the row
 * above it, and `--since` is also the one flag that accepts a TREE, which is
 * exactly what the empty-tree base is (test-guard.mjs:306-329).
 *
 * This light declares NO premise: test-guard needs git and node, nothing
 * installed, so it is as valid in `--thin` as in `--all`.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { EMPTY_TREE } from '../lib/git.mjs';
import { sh } from './_shared.mjs';

export const id = 'L-testguard';
export const severity = 'hard';

/** The gate this light is a row for. */
export const GATE_REL = 'tools/gates/test-guard.mjs';

/** Where the machine summary is written and read, in gitignored machine state
 * (`.gitignore:9-10`). Fixed, and emptied before the run — see the header. */
export const SUMMARY_REL = '.ci/lights/testguard.summary.json';

/** test-guard's own exit codes (test-guard.mjs:64-66). */
const EXIT = Object.freeze({ 0: 'pass', 1: 'fail', 2: 'cannot-verify' });

const firstLine = (s) =>
  String(s ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? '';

export function run({ root = process.cwd(), mb = null, rangeKind = null } = {}) {
  const summaryAbs = join(root, SUMMARY_REL);
  const gateAbs = join(root, GATE_REL);

  if (!existsSync(gateAbs))
    return { id, severity, status: 'cannot-verify', detail: `${GATE_REL} does not exist — this light is that gate's row and has no rules of its own to fall back on` };

  const since = typeof mb === 'string' && mb.length > 0 ? mb : EMPTY_TREE;
  const rangeNote = `--since ${since.slice(0, 7)} (${rangeKind ?? 'range kind not declared by the pack'})`;

  // Empty the artifact BEFORE the run, so "the file is there" can only mean
  // "this run wrote it".
  try {
    mkdirSync(dirname(summaryAbs), { recursive: true });
    rmSync(summaryAbs, { force: true });
  } catch (e) {
    return { id, severity, status: 'cannot-verify', detail: `cannot clear ${SUMMARY_REL} (${String(e.message)}) — a summary left from an earlier run would be read as this one's verdict` };
  }

  const r = sh(process.execPath, [gateAbs, '--since', since, '--summary', summaryAbs], { cwd: root });
  if (r.code === null)
    return { id, severity, status: 'cannot-verify', detail: `could not run ${GATE_REL}: ${r.spawnError ?? 'spawn failed'} (${r.argv.join(' ')})` };

  const byExit = EXIT[r.code] ?? null;

  if (!existsSync(summaryAbs)) {
    // The documented shape of a CANNOT VERIFY from this gate: it refuses before
    // it has anything to summarise (no commits, an unresolvable range, a failed
    // diff), prints why, and exits 2.
    const why = firstLine(r.stderr) || firstLine(r.stdout) || 'it printed nothing';
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail:
        `${GATE_REL} wrote no ${SUMMARY_REL} and exited ${r.code}${byExit === null ? ' (not one of its declared exit codes 0|1|2)' : ` (${byExit})`}: ` +
        `${why} · range ${rangeNote} · the verdict is read from the summary, so no summary is no verdict`,
    };
  }

  let summary;
  try {
    summary = JSON.parse(readFileSync(summaryAbs, 'utf8'));
  } catch (e) {
    return { id, severity, status: 'cannot-verify', detail: `${SUMMARY_REL} is unreadable or not JSON (${String(e.message)}) — ${GATE_REL} exited ${r.code}` };
  }

  if (summary?.gate !== 'test-guard')
    return { id, severity, status: 'cannot-verify', detail: `${SUMMARY_REL} says gate=${JSON.stringify(summary?.gate ?? null)}, not "test-guard" — this is somebody else's artifact` };

  const verdict = summary?.verdict;
  if (verdict !== 'pass' && verdict !== 'fail')
    return { id, severity, status: 'cannot-verify', detail: `${SUMMARY_REL} carries verdict=${JSON.stringify(verdict ?? null)}, which is neither "pass" nor "fail" — ${GATE_REL} exited ${r.code}` };

  // Two channels about one run. The artifact decides; a disagreement means
  // neither may be quoted.
  if ((verdict === 'pass') !== (r.code === 0))
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail:
        `${SUMMARY_REL} says verdict="${verdict}" while ${GATE_REL} exited ${r.code} (${byExit ?? 'undeclared code'}) — ` +
        'the summary and the exit code describe the same run and do not agree, so neither is evidence',
    };

  const c = summary?.counts ?? {};
  const label = String(summary?.range?.label ?? rangeNote);
  const counts =
    `${c.violations ?? '?'} guarded change(s): ${c.declared ?? '?'} declared, ${c.undeclared ?? '?'} undeclared, ${c.ambiguous ?? '?'} ambiguous declaration(s)` +
    `, ${c.unmatchedTrailers ?? '?'} trailer(s) matching nothing, ${c.nearMisses ?? '?'} near-miss(es), ${c.mentions ?? '?'} mid-sentence mention(s)`;
  const warnings = Array.isArray(summary?.warnings) && summary.warnings.length > 0 ? ` · ${summary.warnings.join(' · ')}` : '';

  if (verdict === 'fail') {
    const bad = (Array.isArray(summary?.details) ? summary.details : []).filter((d) => d?.verdict === 'undeclared' || d?.verdict === 'ambiguous');
    const shown = bad.map((d) => (d.verdict === 'ambiguous' ? `ambiguous "${d.trailer}" → ${(d.files ?? []).join(', ')}` : `${d.file}: ${d.desc ?? d.rule}`));
    return {
      id,
      severity,
      status: 'fail',
      detail:
        `${SUMMARY_REL} (${label}): ${shown.join(' · ') || counts} — declare the change per file at column zero with ` +
        '`spec-conflict: <file> — <why the old assertion was wrong>` or `spec-change: <file> — <what behaviour changed and why>`' +
        warnings,
    };
  }

  return { id, severity, status: 'pass', detail: `${SUMMARY_REL} (${label}): ${counts}${warnings}` };
}
