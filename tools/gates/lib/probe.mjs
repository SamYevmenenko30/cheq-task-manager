/**
 * The ONE reader of `.ci/probe.json` — machine state, gitignored
 * (.gitignore:9-10, "machine state — never committed, always read").
 *
 * Zero dependencies, `node:` builtins only, plus tools/gates/lib/git.mjs for
 * the one git question this asks.
 *
 * WHAT THE FILE IS. Not a budget and not a timing table: a record of probes
 * that were OBSERVED TO FAIL ON PURPOSE. A gate is only evidence if it has been
 * seen to go red on a fixture that is deliberately bad, so the probe record is
 * what lets `ready` claim a lane means anything. A lane whose probe has never
 * been observed is CANNOT VERIFY — not broken, not green: unproven.
 *
 * WHY THERE IS EXACTLY ONE READER. Every gate that asks "may I trust this lane"
 * must get the same answer and the same WORDS for a no. Two readers drift, and
 * the drift shows up as one gate promising what another refuses.
 *
 * WHAT STALENESS MEANS HERE (the four reasons, each named back to the caller):
 *  - the file does not exist — `exists: false`, which is a state, not an error:
 *    a fresh clone has never probed anything;
 *  - `observedAt` is absent, unparsable, or older than STALE_AFTER_DAYS;
 *  - the dependency tree moved under it: `lockSha256` no longer matches
 *    sha256(`git show HEAD:pnpm-lock.yaml`). COMMITTED lock, not the working
 *    file — an uncommitted `pnpm add` must not invalidate a record, and
 *    committing one must;
 *  - a required probe CLASS has no probe with `observed: true`.
 *
 * The list of required classes is NOT in this file. It belongs to the gate that
 * writes the record (tools/gates/gate-probes.mjs), and hard-coding it here
 * would mean two files disagreeing about what a complete record is. Pass
 * `requiredClasses`; omit it and that one check is skipped, which is reported
 * in `checked` rather than being silently absent.
 *
 * THE SHAPE THIS READER EXPECTS — gate-probes.mjs owns it, this is what is read:
 *
 *     { "observedAt": "<ISO instant>",
 *       "lockSha256": "<sha256 of git show HEAD:pnpm-lock.yaml>",
 *       "probes": {
 *         "<name>": { "observed": true, "class": "<class>", "detail": "…" }
 *       } }
 *
 * Unknown fields are passed through in `data` untouched: a reader that drops
 * what it does not understand makes the writer's extra evidence disappear.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { showAtHead } from './git.mjs';

/** Where the record lives, relative to the repository root. */
export const PROBE_PATH = '.ci/probe.json';

/** A record older than this has not been observed against the current tree. */
export const STALE_AFTER_DAYS = 30;

/** sha256, lowercase hex. */
export const sha256 = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex');

/**
 * The content key the record is pinned to: sha256 of the COMMITTED lockfile.
 * → { ok, sha256, reason }
 *
 * `git show HEAD:pnpm-lock.yaml`, never `readFileSync`: an uncommitted
 * dependency edit is not yet a fact about the repository, so it must not
 * invalidate a record — and committing one must.
 */
export function lockKey({ root = process.cwd(), lockPath = 'pnpm-lock.yaml' } = {}) {
  const r = showAtHead(lockPath, { cwd: root });
  if (!r.ok) return { ok: false, sha256: null, reason: `cannot read ${lockPath} at HEAD: ${r.reason}` };
  return { ok: true, sha256: sha256(r.text), reason: null };
}

/**
 * Read the probe record. NEVER throws, never reports an absent file as an error.
 *
 * → { exists, data, stale, reason, reasons, path, checked,
 *     observedAt, ageDays, lockSha256, headLockSha256 }
 *
 *   `exists`  the file is there and parsed.
 *   `data`    the parsed record, verbatim, or null.
 *   `stale`   true whenever the record may not be relied on — including when it
 *             does not exist. `stale === false` is the only state in which a
 *             premise answer means anything.
 *   `reason`  the FIRST reason, for a one-line report.
 *   `reasons` all of them, so a caller can print the whole picture.
 *   `checked` which staleness checks actually ran, so "not stale" is never read
 *             as "everything was verified". `lockSha256` is absent from it when
 *             HEAD has no lockfile (a repo with no commit), and `classes` is
 *             absent when no `requiredClasses` were given.
 */
export function readProbe({ root = process.cwd(), requiredClasses = null, now = new Date(), lockPath = 'pnpm-lock.yaml' } = {}) {
  const path = resolve(root, PROBE_PATH);
  const checked = [];
  const reasons = [];
  const done = (extra = {}) => ({
    path,
    checked,
    reasons,
    reason: reasons[0] ?? null,
    stale: reasons.length > 0,
    exists: false,
    data: null,
    observedAt: null,
    ageDays: null,
    lockSha256: null,
    headLockSha256: null,
    ...extra,
  });

  if (!existsSync(path)) {
    reasons.push(`no probe record at ${path} — no gate has been observed to fail on a bad fixture in this worktree yet`);
    return done();
  }

  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    reasons.push(`${path} is unreadable or not JSON: ${String(e.message)}`);
    return done();
  }

  // --- age
  checked.push('observedAt');
  const observedAt = typeof data?.observedAt === 'string' ? data.observedAt : null;
  const t = observedAt ? Date.parse(observedAt) : NaN;
  let ageDays = null;
  if (!observedAt) reasons.push(`${PROBE_PATH} has no observedAt — a record with no date cannot be aged`);
  else if (Number.isNaN(t)) reasons.push(`${PROBE_PATH} observedAt=${JSON.stringify(observedAt)} is not a parsable instant`);
  else {
    ageDays = (now.getTime() - t) / 86_400_000;
    if (ageDays > STALE_AFTER_DAYS)
      reasons.push(`${PROBE_PATH} was observed ${ageDays.toFixed(1)} days ago, over the ${STALE_AFTER_DAYS}-day limit`);
  }

  // --- the committed lockfile
  const head = lockKey({ root, lockPath });
  let headLockSha256 = null;
  if (!head.ok) {
    reasons.push(`cannot pin the record to a dependency tree: ${head.reason}`);
  } else {
    checked.push('lockSha256');
    headLockSha256 = head.sha256;
    const recorded = typeof data?.lockSha256 === 'string' ? data.lockSha256 : null;
    if (!recorded) reasons.push(`${PROBE_PATH} has no lockSha256 — it is not pinned to any dependency tree`);
    else if (recorded !== headLockSha256)
      reasons.push(
        `${PROBE_PATH} was observed against ${lockPath} ${recorded.slice(0, 12)}…, HEAD now has ${headLockSha256.slice(0, 12)}… — the toolchain moved under the record`,
      );
  }

  // --- probe classes
  const probes = data?.probes && typeof data.probes === 'object' ? data.probes : null;
  if (!probes) reasons.push(`${PROBE_PATH} has no probes object`);
  else if (requiredClasses) {
    checked.push('classes');
    const observedClasses = new Set(
      Object.values(probes)
        .filter((p) => p?.observed === true)
        .map((p) => String(p?.class ?? '')),
    );
    for (const c of requiredClasses)
      if (!observedClasses.has(c)) reasons.push(`no probe of class ${JSON.stringify(c)} has observed: true — that lane has never been seen to fail on purpose`);
  }

  return {
    path,
    checked,
    reasons,
    reason: reasons[0] ?? null,
    stale: reasons.length > 0,
    exists: true,
    data,
    observedAt,
    ageDays,
    lockSha256: typeof data?.lockSha256 === 'string' ? data.lockSha256 : null,
    headLockSha256,
  };
}

/**
 * The answer to "may I rely on premise `<name>`" — and whoever asks gets THE
 * NAME of the premise back in the reason, so a lane that stays CANNOT VERIFY
 * reports which probe would lift it rather than just that something is missing.
 *
 * → { verdict: 'pass' | 'fail' | 'cannot-verify', reason, probe }
 *
 *   `pass`          the probe is recorded with `observed: true` in a record that
 *                   is not stale.
 *   `fail`          the probe is recorded and says it was NOT observed — the
 *                   premise is known to be absent (no browser downloaded, say).
 *   `cannot-verify` no record, a stale record, or no such probe in it. Nothing
 *                   is known, which is never the same as a no.
 */
export function premise(probe, name) {
  const named = JSON.stringify(name);
  if (!probe?.exists) return { verdict: 'cannot-verify', reason: `premise ${named}: ${probe?.reason ?? `no ${PROBE_PATH}`}`, probe: null };
  if (probe.stale) return { verdict: 'cannot-verify', reason: `premise ${named}: the record is stale — ${probe.reason}`, probe: null };
  const p = probe.data?.probes?.[name];
  if (p === undefined)
    return {
      verdict: 'cannot-verify',
      reason: `premise ${named} is not in ${PROBE_PATH} (it holds ${Object.keys(probe.data?.probes ?? {}).toSorted().join(', ') || 'no probes'}) — run gate-probes`,
      probe: null,
    };
  if (p?.observed === true) return { verdict: 'pass', reason: `premise ${named} observed${p.detail ? `: ${p.detail}` : ''}`, probe: p };
  return {
    verdict: 'fail',
    reason: `premise ${named} is recorded as NOT observed${p?.detail ? `: ${p.detail}` : ''}`,
    probe: p,
  };
}

/** Every probe name in a record, sorted. Empty when there is no usable record. */
export function probeNames(probe) {
  return Object.keys(probe?.data?.probes ?? {}).toSorted();
}
