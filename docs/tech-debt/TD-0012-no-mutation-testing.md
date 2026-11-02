# TD-0012: Nothing measures whether a test would NOTICE a behaviour change — there is no mutation lane and no coverage verdict

**Status:** Open · `red-check` proves each test was red on the base, which is stronger evidence than coverage and weaker than mutation; the only visibility into breadth is the `S coverage` line `ready` prints, and it counts names, not strength. A coverage FLOOR now exists in the runner's config and no lane asks for it, which is its own entry (TD-0013) and not a substitute for this one
**Area:** `tools/gates/red-check.mjs` · `tools/gates/ready.mjs` · `tools/gates/lights/testshape.mjs` · `jest.config.mjs` (`coverageThreshold`) · `docs/knowledge/testing.md` (the naming contract) · `docs/knowledge/process.md:16`, `:20`
**Raised:** 2026-11-01 · re-checked 2026-11-02 against the new runner: the substitute still holds, and it acquired one new way to be defeated

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
  `S<n>_` tokens under the test trees (the naming contract in `docs/knowledge/testing.md`, cited without a
  line number because that file is under active revision; `docs/knowledge/process.md:20`).
  A spec whose assertions are covered in part reads as a fraction on that line — one line in a block
  a human is expected to read — and nothing fails. That is a deliberate choice, since a spec
  may legitimately be implemented in stages, but it means **"the pipeline is green" never implies
  "the spec is covered"**, and a reader who skips the line will believe otherwise.
- **Coverage is measurable, a floor is declared, and neither is a verdict.** What changed with the
  runner is that the absence this bullet described is now half-filled: the runner's own config
  declares a threshold on all four metrics over the backend sources (`jest.config.mjs`), and
  `--coverage` really does instrument rather than quietly reporting nothing. No lane passes
  `--coverage`, no light reads a coverage artifact, and nothing in the `ready` block mentions one, so
  the floor binds exactly one caller: a human who types the flag. That gap has its own entry with the
  measurement in it (TD-0013) and no number is copied here (ADR-0003). The previous runner's provider
  `@vitest/coverage-v8` is still declared at the root (`package.json:19`) and is now a dependency of
  nothing — a leftover, named here so it is not mistaken for the lane. The ORDERING stays right:
  line coverage measures execution, not assertion, and a threshold on it rewards tests that call code
  without checking it, which is why a percentage gate is not what closes this entry.

## Why it is safe right now

- **`red-check` is the substitute, and it is a strong one — on paper.** Every test file added in a
  range must fail on the BASE revision, and every case a modified file gained must fail **by name**,
  staged alone onto a worktree reset to the base (`docs/knowledge/process.md:16`). A test that
  asserts nothing cannot be red on a tree where the implementation is absent, so the laziest useless
  test — the one that passes before the feature exists — is caught at the gate rather than by a
  mutation run. This is strictly stronger evidence than coverage: coverage says a line ran, red-check
  says the assertion depended on the behaviour not being there. **The honest qualifier:**
  `tools/gates/red-check.mjs` and `tools/gates/ready.mjs` are written now, but no one has watched
  either refuse a test that was green on the base, so what stands in for mutation testing is still a
  specification plus the three-phase discipline with a human signature in git between the phases
  (TD-0005 is the same shape of gap one lane over).
- **The runner brought one new way to defeat that substitute, and it is refused by name.** A
  `.failing` modifier INVERTS the verdict: a case whose body throws is reported as passed, so a spec
  test written that way is green exactly when its assertion fails and `red-check` could never prove
  it red — the substitute above would report the strongest possible evidence about a test that
  asserts the opposite of what it says. `L-testshape` refuses `.failing` in a spec test by token scan
  (`tools/gates/lights/testshape.mjs:157-165` for the measurement and the pattern, `:317` for the
  refusal), by a token scan for the same reason the suppression directives are (TD-0004): a spec test
  may not be allowed to disguise its own verdict, and a lint rule is one comment wide (ADR-0005).
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
