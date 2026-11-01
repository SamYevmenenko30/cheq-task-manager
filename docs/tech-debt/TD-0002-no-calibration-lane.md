# TD-0002: There is no calibration lane — no seconds figure, bundle size or duration target is measured, so none may be promised

**Status:** Open · `status.mjs` prints `BUDGETS=unavailable (no calibration lane)`; the deliberate-failure half survives as `.ci/probe.json`
**Area:** `tools/gates/status.mjs` · `tools/gates/ready.mjs` · `tools/gates/gate-probes.mjs --real` · `.ci/probe.json`
**Raised:** 2026-11-01

## What is unproven

Every duration claim about this repository. Nothing measures and records how long a typecheck, a test
project, a lint run or the pre-commit hook takes, so the usual "the hook stays under N seconds" target
is **not checked by anything**. There is no record file of timings, by design: the port this repository
comes from had one and ADR-0003 explains why its figures were a liability in prose.

The loss is narrower than it looks. What a calibration record carried was two different things:

- a **promise** ("this step costs about N seconds") — dropped entirely, and no document may contain
  such a number (ADR-0003);
- a **precondition** ("a deliberately bad fixture was OBSERVED failing on this machine, so a green
  answer from this lane means something") — kept, and it is the half that matters.

Without the second half, a `reporters: ['default']` config, a typo in `--outputFile` or a `--project`
that matches nothing produces permanent silent green. That is the failure this entry exists to keep
visible.

## Why it is safe right now

- `node tools/gates/status.mjs` prints `BUDGETS=unavailable (no calibration lane)` rather than a
  figure, and the only figures anyone sees are the ACTUAL seconds `ready` prints for the steps it just
  ran — a report of what happened, not a budget (ADR-0003).
- The precondition half is `.ci/probe.json`: written ONLY by `node tools/gates/gate-probes.mjs --real`,
  read ONLY through `tools/gates/lib/probe.mjs`, gitignored with the rest of `.ci/`
  (`.gitignore:9-10`). A light with a probe that has not been observed answers CANNOT VERIFY **naming
  the missing precondition**, and cannot-verify blocks exactly like a failure (ADR-0002 items 4 and 7).
- Nothing in the repository promises a duration today, so there is no stale promise to find. That is
  checkable: a figure in a document is a defect by ADR-0003 and a reviewer removes it.

## What closing it involves

Deliberately NOT a calibration record. This entry closes in one of two ways:

1. **It stays open as a recorded decision** — a run-time budget is never promised in this repository,
   and the `status` line keeps saying so. In that case the entry is the documentation of the choice and
   is never struck.
2. **A lane appears because something needs one.** The honest trigger would be a concrete need: a hook
   that has become too slow to use, or a performance assertion somebody wants to write. Then the lane
   is a probe-written record read by exactly one reader, with the same rules as `.ci/probe.json`
   (written only by `gate-probes --real`, gitignored, stale on a toolchain change), and this entry is
   replaced by the ADR that introduces it.

Either way, a performance *constraint* does not become an assertion by itself: with no measured lane
there is no `perf` kind, no threshold file and no bundle measurement, so such a sentence goes into a
spec's `## Lights` or `## Syrup` section and is never a `verify:` target.
