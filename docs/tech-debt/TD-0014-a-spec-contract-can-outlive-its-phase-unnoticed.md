# TD-0014: a spec contract that stays unreached after the implementation lands is reported by nothing

**Status:** Open · L-orphans reports the contract and names this debt; nothing detects when the state stops being temporary
**Area:** `tools/gates/lights/orphans.mjs` (`SPEC_CONTRACT_RE`) · `docs/templates/SPEC.md` (`contracts: allowed`)
**Raised:** 2026-11-02

## What is unproven

A spec whose front matter says `contracts: allowed` lets the TEST phase place types under
`packages/*/src/contracts/CHQ-<nnn>/` — the shape the spec fixed, with no function bodies. For the
whole of that phase only the spec tests import them, because the implementation they describe does
not exist yet; `implement-to-green` is what makes an entry point reach them.

`L-orphans` used to refuse exactly that state: "no entry point reaches this module and a test
imports it — a helper on the production side of the package. Move it under the test directory, or
publish it through an `exports` subpath of its own". Measured on CHQ-001 (2026-11-02), that refusal
blocked the test-phase commit, and the cure it offered was actively wrong — moving a contract under
the test directory would put the agreed shape where the production code may not import it.

The light now recognises the path and reports it as a note instead. **What nothing checks is
whether the state is still temporary.** If `implement-to-green` lands and never imports the
contract — because the implementation re-declared the types inline, or because the contract was
written for an assertion that was later withdrawn — the file stays on the production side of the
package, reached only by tests, forever, and the note keeps saying that this is the designed state.

## Why it is bounded

The exemption is by PATH and nothing else: `src/contracts/CHQ-<nnn>/<file>`, with the three-digit id
matched in full, and only when a test actually reaches the file. A module one directory away, or a
directory merely called `contracts`, is judged exactly as before. So the blind spot is as wide as
the contracts mechanism itself and no wider, and it cannot be entered by accident — a spec has to
declare `contracts: allowed` first, which is a line a human reads and approves.

It is also self-limiting in the ordinary case: once the implementation imports the contract, the
entry point reaches it and the note disappears without anyone doing anything.

## What would discharge it

The honest check needs a fact no light has today: whether CHQ-`<nnn>` has reached
`implement-to-green`. Two candidates, neither free:

- **From the spec**: a `green: S<n> via <runner> <artifact>` trailer is what the implementation
  phase writes. A spec with every live S carrying one has been implemented, and from that commit
  onward a contract no entry point reaches is a plain orphan. That couples `L-orphans` to trailer
  parsing it does not do today.
- **From the graph**: a contract whose types are also declared inline in the package's own sources
  is a duplicate shape, which is the failure mode worth catching rather than the unreachability
  itself. That is a different check and a better one, and it needs a type-level comparison this
  light's token-and-graph machinery cannot make.

Until one of them exists, the note is the record: it says what is being tolerated, names this entry,
and leaves the judgement to the human reading the row.
