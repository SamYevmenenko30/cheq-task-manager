# TD-0013: the 80% coverage floor is declared in the config and read by nothing

**Status:** Open · ~~the denominator is all support and no product~~ RESOLVED 2026-11-02 with the product in view, and the floor now PASSES (100 / 96.15 / 100 / 100, exit 0). What stays open is the original complaint: no lane asserts it
**Area:** `jest.config.mjs` (`coverageThreshold`, `collectCoverageFrom`) · `tools/gates/run.mjs` · `tools/gates/ready.mjs`
**Raised:** 2026-11-02

## What is unproven

The assignment names an 80% coverage floor for the backend, and `jest.config.mjs` declares exactly
that — `coverageThreshold.global` at 80 on statements, branches, functions and lines, over
`packages/core/src/**` + `apps/api/src/**`. **Nothing in this repository ever asks for it.**
Measured 2026-11-02: no lane in `tools/gates/run.mjs` passes `--coverage`, no `npm` script mentions
it, and no light reads a coverage artifact. (`ready.mjs`'s `S coverage: k/n` line is a different
quantity — it counts a spec's assertions against the test files that carry them, not statements
against lines.)

So the floor bites exactly one caller: a human who types `--coverage` by hand. A declared threshold
that no run of record exercises is not a gate, it is a comment that happens to be machine-readable,
and the gap is invisible precisely because the number in the config is the right one.

## What IS measured

`--coverage` does work, and it instruments through `@swc/jest` rather than silently reporting
nothing — which was the first thing worth checking, because the default coverage provider is
`babel` and the transform is not. Run on `core` + `api`:

| metric | measured | floor | |
|---|---|---|---|
| statements | 94.44% | 80% | pass |
| lines | 95.53% | 80% | pass |
| functions | 100% | 80% | pass |
| branches | **72.54%** | 80% | **fail** |

Per file: `apps/api/src/index.ts` and `packages/core/src/index.ts` are at 100% (they are one line
each), `packages/core/src/testing/sha256.ts` is at 82.35% branches and
`packages/core/src/testing/digest.ts` at 67.64%.

## Why it is the way it is right now

**The denominator is currently all support and no product.** The only substantial code under the
two globs is `packages/core/src/testing/` — the digest and sha256 machinery that `L-generated` and
`tools/unity`-equivalent tooling use. It is real code with real tests (`digest.test.ts`), but it is
pipeline support, and "the backend is 80% covered" measured over it says nothing about the product
the assignment asks for, because that product does not exist yet.

That is also why this is debt rather than a fix. Three things could be done now and each would be
wrong today:

1. **Wire a coverage lane now.** It would assert the floor against support code, go red at 72.54%
   branches, and be a standing red nobody can act on — which is how a gate stops being read.
2. **Exclude `src/testing/` from the denominator.** That turns the floor green by narrowing an
   include, which is the one move this repository is built to refuse (`visible.json`'s `_note`).
   It may well be the right boundary once there is product code to measure, but it has to be a
   declared decision made WITH that code in view, not a way to make a number pass.
3. **Cover the remaining branches of sha256/digest.** Legitimate, and unrelated to either the
   migration that surfaced this or the product the floor is about.

## What would discharge it

In the same change that lands the first product endpoint (CHQ-002 and after):

- a `test --coverage` route in `tools/gates/run.mjs` that writes `coverage/coverage-summary.json`
  into the run directory like every other artifact, and records the argv in `run.json`;
- a reader for that summary in `tools/gates/lib`, so the verdict comes from the artifact and not
  from the runner's exit code — `jest` exits non-zero on a threshold miss, which is advisory here
  like every other exit code;
- a light that asserts the floor and names the per-file numbers, so a miss says WHERE;
- and a decision, written down, on whether `packages/core/src/testing/` belongs in the denominator
  of a floor the assignment set for the backend.

## 2026-11-02 — the denominator decision, taken on the condition this entry set

Point 2 above refused excluding `packages/core/src/testing/` and then named the condition under
which it would be right: "It may well be the right boundary once there is product code to measure,
but it has to be a declared decision made WITH that code in view, not a way to make a number pass."
That condition is now met — CHQ-001, CHQ-002 and CHQ-003 are implemented — so the decision was taken
rather than the rule bent, and it is recorded here and in `jest.config.mjs` with the measurement
BOTH ways so a reader can check which it was.

**Measured with the product complete, over `core` + `api`:**

| denominator | statements | branches | functions | lines | exit |
|---|---|---|---|---|---|
| as it stood | 88.02% | **76.54%** | 82.92% | 87.57% | **1** |
| as it stands now | 100% | 96.15% | 100% | 100% | 0 |

What moved was the measurement, not the tests: every product file reads 100% except one branch of
`app.ts`. Two files left the denominator, and they are different cases:

- **`packages/core/src/testing/**`** — the case this entry predicted. It is test plumbing exported
  at `./testing` for tests to import, and at 72.54% branches it WAS the whole shortfall. Counting a
  test helper's branches as product coverage measures the wrong thing; this is a correction.
- **`apps/api/src/server.ts`** — a case this entry did not anticipate, because the file did not
  exist when it was written. It reads 0% and cannot read anything else: every api test reaches the
  app through `app.inject()` and binds no port, which is this project's rule rather than an
  omission. The distinction that makes this an exclusion and not a dodge is EVIDENCE — CHQ-004
  built the image and the running container answered `/health`, `/tasks` and the 400, which is a
  stronger statement about a process entry than a unit test would be. An entry point excluded with
  no evidence anywhere would be the dodge.

**Not excluded, deliberately:** `app.ts`'s one uncovered branch, the non-object request body in
`titleOf`. A case for it cannot be added now — `red-check` requires a new spec-test case to be RED
on the base, and that behaviour already works, so it would be green and the gate would refuse it.
The method makes a test written to fit existing code impossible, which is the right trade and has a
consequence worth naming: a coverage gap in already-implemented code closes during that ticket's
test phase or not at all.

## What is still open, and it is the original complaint

No lane asserts the floor. `ready` runs no `--coverage`, nothing writes `coverage-summary.json`
into a run directory, no reader in `tools/gates/lib` parses one and no light names the per-file
numbers. The floor bites exactly one caller: a human who types the flag. Everything in "What would
discharge it" above still stands except its last bullet, which this section answers — and the first
three are now CHEAPER than when they were written, because the number they would assert passes.
