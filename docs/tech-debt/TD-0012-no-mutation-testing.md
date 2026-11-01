# TD-0012: Nothing measures whether a test would NOTICE a behaviour change — there is no mutation lane and no coverage verdict

**Status:** Open · `red-check` proves each test was red on the base, which is stronger evidence than coverage and weaker than mutation; the only visibility into breadth is the `S coverage` line `ready` prints, and it counts names, not strength
**Area:** `tools/gates/red-check.mjs` · `tools/gates/ready.mjs` · `docs/knowledge/testing.md:90` · `docs/knowledge/process.md:16`, `:20`
**Raised:** 2026-11-01

## What is unproven

The strength of every test in this repository. Nothing here breaks a behaviour on purpose and
observes that a test notices. So for any green suite, these two states are indistinguishable by any
lane:

- the implementation is correct and the tests constrain it;
- the implementation is wrong in a way no assertion reaches, and the suite is green because it never
  looked.

Two narrower gaps sit under that one:

- **Breadth is reported, not checked.** The only visibility into how much of a spec a green suite
  actually covers is the `S coverage` line in the `ready` block, and it is a grep: `ready.mjs` counts
  `S<n>_` tokens under the test trees (`docs/knowledge/testing.md:90`, `docs/knowledge/process.md:20`).
  A spec whose assertions are covered in part reads as a fraction on that line — one line in a block
  a human is expected to read — and nothing fails. That is a deliberate choice, since a spec
  may legitimately be implemented in stages, but it means **"the pipeline is green" never implies
  "the spec is covered"**, and a reader who skips the line will believe otherwise.
- **Coverage is installed and is not a verdict.** `@vitest/coverage-v8` is declared at the root
  (`package.json:16`) and no lane reads a coverage report, no threshold exists, and nothing in the
  `ready` block mentions one. That is the right ordering — line coverage measures execution, not
  assertion, and a threshold on it rewards tests that call code without checking it — but it should
  be stated rather than left as an absence somebody later "fixes" with a percentage gate.

## Why it is safe right now

- **`red-check` is the substitute, and it is a strong one — on paper.** Every test file added in a
  range must fail on the BASE revision, and every case a modified file gained must fail **by name**,
  staged alone onto a worktree reset to the base (`docs/knowledge/process.md:16`). A test that
  asserts nothing cannot be red on a tree where the implementation is absent, so the laziest useless
  test — the one that passes before the feature exists — is caught at the gate rather than by a
  mutation run. This is strictly stronger evidence than coverage: coverage says a line ran, red-check
  says the assertion depended on the behaviour not being there. **The honest qualifier:**
  `tools/gates/` holds `lib/` and nothing else today — `red-check.mjs` and `ready.mjs` are specified
  and unwritten, like every gate here (TD-0005) — so what stands in for mutation testing right now is
  a specification plus the three-phase discipline with a human signature in git between the phases,
  not a run anyone has observed.
- **Its own limit is declared in the same vocabulary.** A test red for the wrong reason is classified
  and labelled, not accepted silently: `assertion-red` is the verdict of record and `crash-red
  (weaker)` is a distinct, weaker verdict for a test that was red because a symbol did not exist
  (`docs/knowledge/process.md:16`). So "red on the base" is never reported as one undifferentiated
  fact.
- **Red-check does not answer the question this entry asks.** It proves the test could fail when the
  behaviour was *absent*. Mutation testing asks whether it fails when the behaviour is *wrong* —
  present, running, and subtly different — and the two are not the same question. An off-by-one, an
  inverted comparison or a dropped branch all survive "was red before the implementation existed".
- Spec tests are read-only for the implementation phase, and a disagreement is declared as a
  per-file `spec-conflict:` or `spec-change:` line that test-guard reads
  (`docs/knowledge/process.md:17`) rather than as an edit. So the most dangerous
  way a suite loses its strength — the implementer weakening an assertion until it passes — is a
  rule violation visible in a diff, not an invisible drift.

## What closing it involves

A mutation run over `packages/core`, if its cost turns out to be acceptable. `packages/core` is the
right and only sensible target: it is engine-free by rule, its tests are plain ES with no DOM, and
its observable is a structural digest — so a mutant either changes the digest or it does not, with no
environment in the way.

What the run has to answer, in order:

1. **Cost.** Mutation testing runs the suite once per mutant. Whether that is minutes or hours here
   is unmeasured, and there is no calibration lane to measure it with (TD-0002), so the first run is
   also the measurement that decides whether the lane can exist at all.
2. **Where the verdict lives.** Like every other verdict here it would have to be an artifact in a
   run directory, read by exactly one reader (ADR-0002 item 2) — not a tool's own dashboard and not
   an exit code.
3. **What a surviving mutant means.** A mutation score is a number, and ADR-0003 forbids promising
   one in prose. The useful output is not a score but a LIST: each surviving mutant is either a
   missing assertion (a finding for the test phase) or a behaviour the spec never decided (a `Qn` for
   the spec phase). An entry that closes with a percentage would have replaced one blind spot with a
   number nobody can act on.

This entry closes when such a run has happened once and its surviving mutants have been triaged into
those two piles. It **stays open with a different reason** if the cost turns out to be prohibitive:
the honest statement then is that test strength in this repository is a reviewer's judgement plus
`red-check`, and that no machine will ever tell anyone the suite went weak.
