# Specs

One file per spec: `docs/specs/CHQ-<nnn>.md`, copied from [docs/templates/SPEC.md](../templates/SPEC.md).

**Nothing in this repository describes the product.** The domain arrives through a spec and through
nothing else: not through a plan, not through an agent's idea of what a task manager usually does, not
through a test that assumes a field nobody wrote down. `packages/core/src/index.ts:8` exports one marker
constant and says so in its own header comment (`packages/core/src/index.ts:1`). That is the whole
domain today.

A spec is two things at once: the **contract** the test phase is allowed to read, and the **map** of the
feature — which sentence of the vision becomes an assertion, which becomes a question, which stays a
human's judgement call, and where each one lands.

> State of the machinery, verified 2026-11-01: the repository has no commits (`git log` on `main`:
> "your current branch 'main' has no commits yet"), `git ls-files` prints nothing, and `tools/` is an
> empty directory. Every command named below therefore describes the contract the gates are being
> written to — it is not a reading of running code. There is no `CHQ-001` yet; this README and the
> templates are the first thing in `docs/`.

## Id scheme

`CHQ-<nnn>`, three digits — `CHQ-001`, `CHQ-002`, … (`CHQ-\d{3,}` to the gates, so a four-digit id works
the day it is needed). The next free id:

    node tools/gates/spec-gate.mjs --next-id      # reads HEAD and the working tree

There is no ticket system behind the id. The vision text pasted under `## Vision (verbatim)` IS the
ticket, and it is pasted character for character, in whatever language the human wrote it.

The id is spelled `CHQ`, three letters, everywhere — in a filename, in a test directory
(`packages/core/test/CHQ-<nnn>/`), in a `spec-approved:` trailer and in a commit subject.

## Section order

Optional front-matter (`contracts:` only), then `# SPEC: CHQ-<nnn> — <title>`, `Revision: <n>`, and in
this order:

`## Vision (verbatim)` · `## Premise check` · `## Assertions` · `## AC map` ·
`## Cross-package effects` · `## Non-goals` · `## Lights` · `## Open questions` ·
`## Answered questions` · `## Syrup` · `## Contradictions with the project as it stands` ·
`## Appendix: implementation notes`

The order is prose here and composition is the gate's: `tools/gates/lib/spec-parse.mjs` is the ONE
reader of a spec, so the file means the same thing to every gate. Two shapes it refuses rather than
guesses at: a duplicated heading (a second `## Open questions` pasted into the appendix is reported as
`duplicate section`, not merged), and front-matter outside the YAML subset it parses.

**The test phase reads a spec up to `## Appendix: implementation notes` and nothing after it.** The
appendix is the wall between the phases: module names, call order, file layout and the dependencies a
`new:` package would need live there, and a test that was written from them is a test of someone's plan
rather than of the contract.

There is no `wave:` front-matter and no `## Network` section: Physarum waves are not ported to this
repository.

## The three phases

Each phase runs in a FRESH session, and the session boundary is the point — a session that has seen an
implementation plan cannot write an honest failing test.

| phase | skill | what it produces | gate that must pass first |
|---|---|---|---|
| 1. harden | `.claude/skills/spec-harden` | `docs/specs/CHQ-<nnn>.md`: vision → assertions, questions, syrup, lights | `pnpm spec-gate` |
| — | the human | answers every `Qn`, then signs | — |
| 2. tests | `.claude/skills/tests-from-spec` | failing tests, placed by `kind`, proven red | `pnpm spec-gate --require-approved CHQ-<nnn>`, then `pnpm red-check` |
| 3. implement | `.claude/skills/implement-to-green` | code until the runner each `kind` names is green | `pnpm ready` before the human pushes |

Phase 2 is blocked while any `## Open questions` item is live: spec-gate fails a range that adds or
modifies a test file while a spec it touched still lists a question. The accepted empty forms are
English and exact — `- none`, `- n/a`, `- <none>`; anything else under that heading is a live question,
including a localised "нет".

In phase 3 the spec tests are read-only. A disagreement with a test is declared per file as a
`spec-conflict:` or `spec-change:` trailer, never as an edit nobody announced (rule 7, enforced by
`test-guard`).

## How the human answers a question

Everything is said in git, not in a UI. A revision round commits
`docs(spec): CHQ-<nnn> revision — answers`, which:

- moves each `Qn` out of `## Open questions` into `## Answered questions` as
  `- Qn: <question> → <decision> (<who/when>): <why>`,
- re-homes every AC-map row that said `blocked: Qn` (a spec whose questions are all answered while a row
  still says `blocked: Qn` fails spec-gate),
- bumps `Revision:` and says in one clause what changed.

The record stays. Emptying the question list without writing the answer down destroys the only evidence
that a choice was made rather than guessed.

## What approval means

Approval is a git trailer and nothing else:

    git commit --allow-empty -m "docs(spec): CHQ-007 approved" \
                             -m "spec-approved: CHQ-007 <name> <YYYY-MM-DD>"

It must BEGIN a line of a commit that comes AFTER the spec's last content change, and it carries the
spec id, which the gate matches against the id it was asked about — so a signature on one spec cannot
pass for another.

Approval means: a human read the Vision, the AC map and the assertions, and decided that this is the
feature. It does not mean the tests are good, that the plan in the appendix is right, or that anything
absent from the spec may now be invented.

Any later edit to the spec makes the signature **stale, loudly**:
`pnpm spec-gate --require-approved CHQ-<nnn>` fails and names the two commits involved. Re-sign the same
way, with another empty commit.

`--require-approved` is an ADDITIVE mode: every structural check still runs in it. Passing it never
means "only the signature was checked".
