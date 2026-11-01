# TD-0011: An `inputs:` case proves a value REACHES the observable, never that it is used with the meaning the spec intends

**Status:** Open · deliberately, and nothing cheap closes it: the limit is declared in the template (`docs/templates/SPEC.md:95-98`) and beside the naming rule (`docs/knowledge/testing.md:103-105`), and "influences, but wrongly" is a reviewer's finding no gate can see
**Area:** `docs/templates/SPEC.md:91`, `:95-98` · `docs/knowledge/testing.md:99-105` · `tools/gates/spec-gate.mjs` · `tools/gates/lib/test-cases.mjs`
**Raised:** 2026-11-01

## What is unproven

The `inputs:` field is the strongest mechanical rule this repository has about the *content* of a
test, and it is weaker than it reads. A declaration is `name=differs` or `name=invariant`, mandatory
on a live `kind: core` S (`docs/templates/SPEC.md:91`), and the test phase writes one case per
declaration, named `S<n>_influence_<name>_differs` or `…_invariant`
(`docs/knowledge/testing.md:99-105`). The case builds the Given twice through the same public
surface, varies exactly that one value, and asserts on the observable — for `kind: core`, on the
structural digest from `@cheq/core/testing`.

What that proves is **reachability**: the value travels from the public surface to the observable, or
provably does not. What it does not prove is **meaning**. The template says so in the sentence that
defines the field (`docs/templates/SPEC.md:95-98`): a function may mix a parameter into a hash it
never otherwise reads and satisfy `differs` while being wrong. The symmetric hole is on the other
side — an implementation can satisfy `invariant` by ignoring a value it was supposed to validate.

So a fully green set of `inputs:` cases is consistent with an implementation that:

- reads the value, feeds it into the digest, and bases no decision on it;
- reads it with the wrong sign, the wrong unit, or the wrong timezone — the digest differs either
  way;
- ignores a value declared `invariant` for the wrong reason: because it is never read at all, rather
  than because it is read and deliberately does not affect the result.

The second and third items are the ones that will actually happen. "Influences, but wrongly" is a
reviewer's finding and no gate here can see it, which is a sentence this entry exists to keep from
being forgotten once a wall of green `_differs` cases makes the rule look stronger than it is.

## Why it is safe right now

- **The rule still catches the most common weak test**, which is a value nobody consumes. Before it,
  a spec could name an input and the implementation could silently ignore it, and the test suite
  would pass; with it, that case fails. The gap between "catches the common failure" and "proves
  correctness" is the entry, not a reason to drop the rule.
- **A value whose effect the spec does not decide cannot enter the field at all.** The value space
  explicitly forbids it: such a value becomes a `Qn`, never a guess, because an agent never invents
  the product (`docs/templates/SPEC.md:91`). So the rule cannot be satisfied by *inventing* an
  influence — the pressure it creates lands on the spec author, where it belongs, rather than on the
  test author.
- **The limit is written where the rule is read**, twice: in the template that defines the field and
  beside the naming rule in `docs/knowledge/testing.md`. A reader cannot meet the rule without
  meeting its limit, which is the only protection available against a mechanical rule being trusted
  past its range.
- **`differs` / `invariant` is a tri-state in practice, not a boolean.** The case asserts on a
  digest, and the digest is a structural observable with its own honest failure mode; a case that
  cannot build the Given twice through the public surface does not get to report green, it fails.

## What closing it involves

Nothing cheap, and this entry is written so the limit does not get rediscovered as a surprise.

The shape of a real answer is a check that a value is used with a *meaning*, which is property-based
or mutation-based rather than example-based: generate many Givens differing in exactly that value and
assert on the ORDER or the DIRECTION of the observable rather than merely on inequality. That raises
the cost of every `inputs:` declaration and needs a decision nobody has made. The adjacent entry is
TD-0012: a mutation run would detect the "mixes it into a hash it never reads" case directly, by
breaking the behaviour and observing that no test notices.

What would make this entry close: a rule that distinguishes "the value reaches the observable" from
"the value is used as the spec says", stated precisely enough for spec-gate to check the declaration
and for the test phase to write the case. What would make it **stay open with a different reason**: a
measured case where a wrong implementation passed its own `inputs:` cases in this repository. That
observation would move the entry from a known theoretical limit to a demonstrated one, and the
demonstration belongs here when it happens.
