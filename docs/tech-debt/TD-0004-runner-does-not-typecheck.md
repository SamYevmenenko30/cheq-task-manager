# TD-0004: the test runner strips types, so "the symbol is not written yet" arrives as a runtime error — and `skipLibCheck: true` hides `.d.ts` errors

**Status:** Open · redness is classified from TWO artifacts, and the `test` lane runs both halves on every run of record; suppression directives are forbidden in spec tests. The signatures the classifier switches on were measured on the PREVIOUS runner and have not been re-derived from the current producer's captured artifacts, so that half of the entry got louder, not quieter, on 2026-11-02
**Area:** `tsconfig.base.json:26` · `jest.config.mjs` (the transform) · `tools/gates/run.mjs` (the two-half lane) · `tools/gates/lib/junit-xml.mjs` · `tools/gates/fixtures/jest/` · `tools/gates/red-check.mjs` · `tools/gates/lights/tsc.mjs`
**Raised:** 2026-11-01 · re-stated 2026-11-02, when the runner changed and this entry did not

## What is unproven

**Half of a test's verdict does not come from the test runner.** The runner transforms TypeScript by
stripping types, so it never reports a type error. That survived the change of runner unchanged and
for the same reason: the previous one stripped types in its own transform, this one strips them with
`@swc/jest` in Rust (`jest.config.mjs`), and neither consults `tsc`. Replacing the runner changed
nothing about this debt — which is itself the useful observation, because it says the debt belongs to
the ARRANGEMENT (a transform that is not a type checker) and not to a tool anybody could swap out of
it. A missing export, a wrong signature or a renamed symbol therefore reaches the report as a
*runtime* failure, and a runtime failure is what an honest assertion looks like too. Without a second artifact there is no way to tell "the implementation does
not exist yet" from "the implementation is wrong", which is the single distinction the whole red-test
phase rests on.

**And the type lane has a hole of its own.** `tsconfig.base.json:26` sets `"skipLibCheck": true`,
inherited by every project. Whatever is wrong inside a `.d.ts` — including the declarations of the test
runner and of React, which the core's closure legitimately contains (ADR-0005) — is not reported by
any lane. Nothing has measured whether it currently hides anything in this tree.

## Why it is safe right now

- Redness is classified from the artifact, not from the fact of being red. Four forms are
  distinguished and the weaker ones are LABELLED weaker rather than promoted — an honest assertion is
  proven-red, a missing symbol (by either road, `… is not a function` or `… is not defined`) and a
  missing module are PENDING IMPLEMENTATION, and a `<testcase>` standing for a file rather than a case
  means collection never reached the case (ADR-0002 item 5). **The qualifier, and it is the loud half
  of this entry:** those signatures were measured on 2026-11-01 from probes planted into the PREVIOUS
  runner. The same defects were planted again and their artifacts captured verbatim
  (`tools/gates/fixtures/jest/`), but the classification has not been re-derived from those bytes, so
  what the current producer writes for each form is UNVERIFIED here. The failure direction is the safe
  one — a signature the closed set does not match is `unknown` ⇒ CANNOT VERIFY, never green
  (`RED_REASONS` at `tools/gates/lib/junit-xml.mjs:58`, `ASSERTION_TYPES` at `:63`) — so the risk is a lane
  that refuses to answer, not one that answers wrongly.
- The two lanes are read together, and not by anyone's discipline: the `test` lane runs BOTH halves on
  every run of record, so `tsc.<kind>.log` sits beside `<kind>.junit.xml` in the same run directory
  (`tools/gates/run.mjs`). A type error therefore cannot hide behind a green test, and a missing
  symbol cannot pass as an assertion.
- Spec tests may not carry `@ts-expect-error`, `@ts-nocheck` or `as any` — enforced by a token scan in
  `L-testshape`, deliberately not by a lint rule: `typescript/ban-ts-comment` exists in oxlint but did
  not fire on `// @ts-expect-error nope` (recorded 2026-11-01 during setup, not re-observed here — the
  rule has options and a description after the directive appears to satisfy it), so relying on it
  would have been a rule that looks configured and checks nothing.
- `skipLibCheck: true` is pinned by `L-tsc` with a reference to this entry: it is allowed, and its
  being allowed is recorded, so it cannot become invisible.

## What closing it involves

Two halves, independent:

1. **The classifier, now against the current producer.** A `gate-probes` fixture per form — an honest
   assertion, a missing symbol by each of its two roads, a missing module, and a case that stands for a
   file rather than a case — each observed producing its own signature IN THE ARTIFACT THIS RUNNER
   WRITES and being classified correctly. The captured artifacts for those situations already exist
   (`tools/gates/fixtures/jest/`, each entry naming the command and the planted source that produced
   it), so the work is reading the classifier against them rather than planting anything new; until
   that is done, the classifier is believed rather than tested, and believed about a tool that no
   longer writes the file. The JSON side of the same question is TD-0005.
2. **`skipLibCheck`.** Either turn it off and see the tree stay clean — then this half closes — or
   record what it hides. Running `tsc --noEmit` per project with `skipLibCheck: false` is a one-command
   experiment that nobody has run; its result decides whether the flag stays. If it stays, the honest
   statement is that `.d.ts` errors in dependencies are outside every lane in this repository, and the
   entry stays open saying exactly that.
