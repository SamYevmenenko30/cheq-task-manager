# TD-0010: There is no performance lane — `perf` is not a kind, no threshold exists, and `vite build` has never been a verdict

**Status:** Open · a performance requirement cannot become an assertion: `deriveVerify` has no `perf` route, so such a sentence goes into a spec's `## Lights` or `## Syrup` and is never a `verify:` target
**Area:** `docs/templates/SPEC.md:87` (`kind:`) · `tools/gates/lib/spec-parse.mjs:96` (`deriveVerify`) · `tsconfig.base.json:13` · `apps/web/package.json:12` · `apps/web/vite.config.ts` · `docs/knowledge/testing.md` ("Perf and bundle size")
**Raised:** 2026-11-01

## What is unproven

Every statement this repository could make about speed, size or cost at runtime. Concretely, and each
of these is checkable:

- **`perf` is not a kind.** The value space of `kind:` is `core · api · web · e2e`
  (`docs/templates/SPEC.md:87`), and `verify:` is DERIVED from the kind rather than typed, so there
  is no spelling of a performance assertion that spec-gate would accept. A spec that wants one has
  nowhere to put it in the assertion table.
- **No threshold file exists**, so there is no number for an assertion to compare against even if a
  kind existed. Nothing in the repository names a budget, which is the deliberate state recorded in
  ADR-0003 and TD-0002 — but the consequence belongs here: a threshold nobody wrote cannot be
  exceeded, and *cannot be met either*.
- **Bundle size is not measured by anything.** `apps/web` has an empty `scripts` block
  (`apps/web/package.json:12`) and its Vite config is the React plugin and nothing else
  (`apps/web/vite.config.ts`). No script, gate or wrapper invokes `vite build`.
- **`vite build` has never run as a verdict.** Every project is `noEmit` — the compiler here is a
  verdict and not a build step (`tsconfig.base.json:13`, and the per-project settings at
  `packages/core/tsconfig.json:9`, `apps/api/tsconfig.json:6`, `apps/web/tsconfig.json:7`). So the
  type lane proves the sources typecheck and proves **nothing** about whether a production bundle
  can be produced at all: a defect that only appears when something is actually emitted — a bad
  import resolution, a plugin that throws, an asset that does not exist — is outside every lane here.

That last point is the one worth stating twice, because it is the easiest to misread: `pnpm types`
going green is not evidence that `apps/web` builds.

## Why it is safe right now

- **A performance requirement has no legal spelling as an assertion.** `deriveVerify` is a four-case
  switch over `core | api | web | e2e` and returns `null` for anything else
  (`tools/gates/lib/spec-parse.mjs:96`), so the only places such a sentence can land in a spec are
  `## Lights` (a rule a reviewer or a light checks) or `## Syrup` (an item that never blocks a phase)
  — never a `verify:` target. This is the same discipline as the browser lane (TD-0001): the lane
  that cannot answer does not get to answer green. The qualifier is narrower than it was:
  `spec-gate` is written and checks that a live `Sn` carries a `kind` in the known set and a
  `verify:` equal to the derived value to the character (`tools/gates/spec-gate.mjs:38`), so the
  refusal is implemented rather than only specified — what nobody has watched is the refusal firing
  on a spec that tried it.
- **The absence is written down where a reader will meet it**, not only here: the "Perf and bundle
  size" row of `docs/knowledge/testing.md` states that there is no bench lane and that `vite build`
  is in no verdict, and the UNVERIFIED list in `docs/knowledge/loop.md` carries the same line. Both
  are cited without a line number on purpose — they are prose under active revision, and a number
  into a moving file is worse than none. So nobody has to infer the gap from silence.
- **Nothing promises a figure**, so there is no stale promise to find — ADR-0003 makes a figure in a
  document a defect, and a reviewer removes it. An entry claiming "the build is fast" would be the
  dangerous state; an entry claiming nothing is the safe one.
- The one thing that *would* be unsafe — a decorative lane — does not exist. A `L-bundle` light with
  no measured threshold would be a lamp that is green because it compares nothing, and this
  repository has already reversed one piece of tooling for exactly that reason (ADR-0004).

## What closing it involves

Two things, and the second is a decision rather than a run:

1. **A bench run — and it is no longer the cheap half.** This step used to read "the previous runner
   ships a `bench` subcommand, so it should need no new dependency". That is gone with the runner: the
   measured command surface of the runner of record carries no benchmarking subcommand, and **what a
   bench lane would be built on here is UNVERIFIED** — nobody has named a tool, nothing has been
   invoked, and whether it would write an artifact a gate can read is unanswered. What has not changed
   is the shape the first run must have: a bench of a `packages/core` function whose output lands in a
   run directory like any other artifact of record (ADR-0002 item 2), so a reader sees a measurement
   rather than a claim. A new dependency for it is a `package:` trailer and a decision, not a
   convenience.
2. **A threshold file somebody agrees to maintain.** A number nobody owns rots into either a
   permanently red lane that gets skipped or a permanently green one that compares nothing — and
   both are worse than the current absence. Until a person commits to owning the file, **the honest
   state is no lane at all**, and that is what this entry records.

A separate, cheaper half can close on its own: running `vite build` once on `apps/web` and recording
what it produces would turn "nothing has ever built this" into a measured statement, without
introducing any threshold or any `perf` kind. If it fails, that is a finding today rather than a
surprise on the first release.

The trigger that would make a lane *necessary* is a concrete one, as in TD-0002: a spec with a
performance requirement a human refuses to demote to `## Syrup`. If that spec arrives, the lane is
introduced by the ADR that adds the kind, and this entry is replaced by it. If it never arrives, this
entry stays open as the record of a choice and is never struck.
