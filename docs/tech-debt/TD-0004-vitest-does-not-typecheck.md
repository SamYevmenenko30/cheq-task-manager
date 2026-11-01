# TD-0004: Vitest strips types, so "the symbol is not written yet" arrives as a runtime error — and `skipLibCheck: true` hides `.d.ts` errors

**Status:** Open · redness is classified from TWO artifacts with measured signatures; suppression directives are forbidden in spec tests
**Area:** `tsconfig.base.json:26` · `tools/gates/lib/junit-xml.mjs` · `tools/gates/red-check.mjs` · `tools/gates/lights/tsc.mjs`
**Raised:** 2026-11-01

## What is unproven

**Half of a test's verdict does not come from the test runner.** Vitest transforms TypeScript by
stripping types, so it never reports a type error. A missing export, a wrong signature or a renamed
symbol therefore reaches the report as a *runtime* failure, and a runtime failure is what an honest
assertion looks like too. Without a second artifact there is no way to tell "the implementation does
not exist yet" from "the implementation is wrong", which is the single distinction the whole red-test
phase rests on.

**And the type lane has a hole of its own.** `tsconfig.base.json:26` sets `"skipLibCheck": true`,
inherited by every project. Whatever is wrong inside a `.d.ts` — including the declarations of the test
runner and of React, which the core's closure legitimately contains (ADR-0005) — is not reported by
any lane. Nothing has measured whether it currently hides anything in this tree.

## Why it is safe right now

- Redness is classified from the artifact, not from the fact of being red. The three signatures are
  measured (recorded 2026-11-01, planted probes in one run): `<failure type="AssertionError">` with an
  `expected … to be …` message is proven-red; `type="TypeError"` with `… is not a function` and
  `type="Error"` with `Cannot find module …` are PENDING IMPLEMENTATION; and in the third case the
  `testcase name` is the FILE PATH, because collection never reached the case (ADR-0002 item 5).
- The two lanes are read together: a test run is accompanied by `tsc.<kind>.log` for the same tree, so
  a type error cannot hide behind a green test and a missing symbol cannot pass as an assertion.
- Spec tests may not carry `@ts-expect-error`, `@ts-nocheck` or `as any` — enforced by a token scan in
  `L-testshape`, deliberately not by a lint rule: `typescript/ban-ts-comment` exists in oxlint but did
  not fire on `// @ts-expect-error nope` (recorded 2026-11-01 during setup, not re-observed here — the
  rule has options and a description after the directive appears to satisfy it), so relying on it
  would have been a rule that looks configured and checks nothing.
- `skipLibCheck: true` is pinned by `L-tsc` with a reference to this entry: it is allowed, and its
  being allowed is recorded, so it cannot become invisible.

## What closing it involves

Two halves, independent:

1. **The classifier.** A `gate-probes` fixture per measured signature — an honest assertion, a missing
   symbol, a missing module — each observed producing its own signature and being classified
   correctly, including the "testcase name equals the file path" case. Until all three are probed, the
   classifier is believed rather than tested. The JSON side of the same question is TD-0005.
2. **`skipLibCheck`.** Either turn it off and see the tree stay clean — then this half closes — or
   record what it hides. Running `tsc --noEmit` per project with `skipLibCheck: false` is a one-command
   experiment that nobody has run; its result decides whether the flag stays. If it stays, the honest
   statement is that `.d.ts` errors in dependencies are outside every lane in this repository, and the
   entry stays open saying exactly that.
