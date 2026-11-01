# TD-0008: `oxlint-tsgolint` and `tsc` are the same engine LINE, not the same binary, and no probe compares their type verdicts

**Status:** Open · the linter is never a verdict about types; `L-type-engines` pins the major version and nothing finer
**Area:** `.oxlintrc.jsonc` · `pnpm-lock.yaml:32-41` · `tools/gates/lights/type-engines.mjs` · `tools/gates/gate-probes.mjs`
**Raised:** 2026-11-01

## What is unproven

ADR-0004 rests on the claim that this repository has ONE type engine, because the linter's type-aware
rules run on typescript-go — the same line as the root compiler. "Same line" is not "same binary":
`pnpm-lock.yaml:32-41` records `oxlint-tsgolint` at a 7.0.2xxx version and `typescript` at 7.0.2, two
separately released artifacts. Nothing compares what they say.

So the honest statement is narrower than the ADR's headline: the repository has one type engine *line*
and no second type-checking configuration to maintain. Whether the two agree about a given program is
UNVERIFIED, and would only be visible as a typed lint rule reasoning about a type differently from the
verdict of record.

A related unknown: `oxlint-tsgolint` self-releases on its own cadence, so the two can drift apart by
minor or patch version at any install. `L-type-engines` compares majors only.

## Why it is safe right now

- The consequence of a disagreement is bounded by ADR-0004's division of labour: `tsc --noEmit` is the
  verdict about types, the linter is the verdict about bug classes `tsc` does not report (floating
  promises, misused promises, `await` on a non-thenable, the `any` family). A disagreement can make a
  lint rule fire wrongly or stay quiet wrongly; it cannot make a type verdict wrong.
- `L-type-engines` fails if a SECOND `typescript` version appears in HEAD's lock, if any manifest
  declares `eslint`/`typescript-eslint`/`@typescript-eslint/*`, or if the two majors diverge — so the
  property the ADR actually depends on (one engine line, declared) is checked, with both versions in
  the failure `detail`.
- The alternative that was measured and rejected is strictly worse: a `tools/lint` package with its own
  TypeScript 6 was a second engine with the same risk plus a named trigger for breaking entirely
  (ADR-0004).

## What closing it involves

1. A fixture set whose expected verdicts are written down — a handful of small programs each exercising
   one typed rule and one type error — run through both `tsc --noEmit` and `oxlint --type-aware`, with
   the comparison recorded in `.ci/probe.json` as an observed probe. Agreement closes this entry;
   a disagreement does not reopen the ADR, it gets named here, because a known disagreement that
   nobody can mistake for a type verdict is a smaller problem than an unknown one.
2. Tighten `L-type-engines` from major-equality to whatever the probe shows matters. If the probe finds
   the pair agrees across a minor drift, major-equality is justified rather than merely convenient; if
   it does not, the light pins minor as well and the lock becomes the single gate on both.
3. Re-run the probe after either package is bumped — the same re-probe discipline a self-updating tool
   always needs.
