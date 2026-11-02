# TD-0015: a `green:` trailer names an artifact produced at a different sha, and nothing checks the trees match

**Status:** Open · the mismatch is inherent to the order of operations; what is unchecked is whether the two trees are the same
**Area:** `tools/gates/ready.mjs` (the `green:` trailer block) · `tools/gates/lib/run-dir.mjs` (`run.json`'s `head`)
**Raised:** 2026-11-02

## What is unproven

A `green: S<n> via <runner> <artifact>` trailer cites a run of record. That run writes
`run.json` with the `head` it was made at — and that sha is NEVER the sha of the commit whose
message carries the trailer. It cannot be: the artifact does not exist until the run, the run
refuses a dirty tree, so the sequence is commit → run → amend the message with the trailers. The
amend rewrites the sha.

Measured on CHQ-001 (2026-11-02), the first `green:` trailers in this repository: the trailers live
in `a770a93` and name an artifact whose `run.json` says `head=dbc9074e`. `git diff dbc9074e a770a93`
is EMPTY — same tree, different sha — which is exactly right and is what makes the citation
meaningful.

**Nothing verifies that.** `ready.mjs` prints `(artifact present)` or `(ARTIFACT MISSING)` beside
each trailer; it reads the file's existence and not its provenance. So a trailer could cite an
artifact produced at a commit whose tree differs from the citing commit's — a run from before the
last edit, or from another branch — and the verification block would report it as present and
green.

## Why it is bounded today

The run directory is never reused (`tools/gates/lib/run-dir.mjs` stamps each one), so an artifact
cannot be silently overwritten by a later run; and `.ci/` is gitignored, so a trailer names a path
that exists on one machine only, which `ready` already says. The window is therefore "an artifact
from a real run of a DIFFERENT tree on this machine", not "a fabricated artifact".

## What would discharge it

The check is cheap and the data is already in hand: compare TREES, not shas.

```
git rev-parse <run.json head>^{tree}   ==   git rev-parse <citing commit>^{tree}
```

Equal trees mean the run judged the same bytes the commit carries, whatever the shas are — which is
the claim the trailer is making. `ready` has the citing commit (it walks the range for trailers) and
the artifact's `run.json`, so this is a comparison and not new machinery. Unequal trees are a FAIL
naming both shas, with the cure being to re-run and re-amend.

Deliberately not done on 2026-11-02: it was the sixth gate defect found in one pass through the
pipeline, and the product it exists to serve had not been started. Recorded rather than fixed, which
is the trade this file is for.
