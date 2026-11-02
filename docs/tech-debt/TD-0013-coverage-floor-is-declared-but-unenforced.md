# TD-0013: the 80% coverage floor is declared in the config and read by nothing

**Status:** Open · the number is written down correctly and no lane asserts it
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

Until then the honest statement is the one at the top: the number is right and nothing checks it.
