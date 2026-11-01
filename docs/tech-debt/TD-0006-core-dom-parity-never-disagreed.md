# TD-0006: The `core` / `core-dom` parity lane has never been observed disagreeing

**Status:** Open · the lane exists in config; the light re-runs on a content-hash mismatch instead of comparing, and answers CANNOT VERIFY with no artifact
**Area:** `vitest.config.ts:26-36` · `tools/gates/lights/env-parity.mjs` · `tools/gates/gate-probes.mjs`
**Raised:** 2026-11-01

## What is unproven

`@cheq/core` is engine-free by construction (ADR-0001, ADR-0005), but it runs in two places: under
node, in `apps/api`, and in a browser, through `apps/web`. The repository therefore runs the SAME test
files twice — project `core` under `node` and project `core-dom` under `jsdom`
(`vitest.config.ts:18-36`), the second with the comment that this is the one honest parity lane here.

What has never been seen is a disagreement. Both projects have only ever been green, so it is unknown
whether the light that diffs them can tell apart:

- a genuine runtime difference (a case that passes under node and fails under jsdom), and
- two artifacts of different ages (one lane re-run after an edit, the other not) — which looks like a
  disagreement and is not one.

A parity light that cannot separate those two would report a stale artifact as a runtime bug, or, worse,
learn to ignore disagreements.

## Why it is safe right now

- The light does not compare artifacts of unknown age. Its freshness key is **content**, not mtime —
  `sha256` over `git ls-files -s packages/core` — because `git checkout` and a restored cache rewrite
  mtimes to "now". On a mismatch it RE-RUNS the lane rather than diffing what it has.
- With an artifact missing it answers CANNOT VERIFY, not pass: `node=green dom=absent` is not a
  disagreement about code (ADR-0002 item 4).
- A disagreement is reported with BOTH verdicts per case name, so a human sees which environment said
  what rather than a bare "parity failed".
- No assertion depends on the lane today: a `kind: core` assertion is falsified by project `core`, and
  `core-dom` adds a second observation of the same file.

## What closing it involves

One probe, in both directions:

1. Plant a test that is green under node and red under jsdom (a value whose representation differs
   between the two environments is enough) and observe `L-env-parity` FAIL, with both verdicts and the
   case name in its `detail`.
2. With the same planted file, delete one of the two artifacts and observe CANNOT VERIFY rather than a
   reported disagreement.
3. Touch a source under `packages/core` without re-running one lane and observe a RE-RUN rather than a
   comparison — this is the half that proves the content key works, and it is the half a casual probe
   would skip.

Until then "the parity lane discriminates" is UNVERIFIED, and the light's own `detail` should say which
of the three probes has been observed.
