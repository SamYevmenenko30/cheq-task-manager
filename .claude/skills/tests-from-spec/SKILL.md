---
name: tests-from-spec
description: Write failing tests from an approved spec (docs/specs/CHQ-nnn.md) BEFORE implementation exists, placed by assertion kind and proven red by red-check. Step 2 of the spec-first flow — run in a FRESH session that has not seen any implementation plan. Spec tests become read-only from the commit that adds them.
---

# Tests from spec

A test written by the same context as the code inherits its blind spots and mirrors the
implementation (asserting the optimistic state, re-deriving the rule under test from the same
misreading). This step breaks that: the tests are an independent formalization of the spec, written
before the code they will judge.

Load the `ts-loop` skill first and run its PRE-FLIGHT.

## Step 0 — the spec is approved, and still is

`node tools/gates/spec-gate.mjs --require-approved CHQ-<nnn>`. It passes only when a commit AFTER
the spec's last content change carries a line beginning `spec-approved: <name> <YYYY-MM-DD>`.
`approval stale: spec changed in <sha7> after spec-approved in <sha7> — re-sign with an empty
commit` ⇒ STOP and tell the human; do not write a test against a spec nobody has signed as it
stands.

## Ground rules

- **Inputs allowed**: the spec file *up to* its `## Appendix` heading (Vision, Premise check,
  Assertions with their sub-bullets, AC map, Lights, Syrup, Answered questions, Contradictions);
  `docs/knowledge/testing.md` and the `ts-loop` skill; existing files under `*/test/**/support/` and
  `*/test/**/fixtures/`; the skeleton fixtures as a style reference
  (`packages/core/test/skeleton/digest.test.ts:1-4` says what a skeleton fixture is and is not);
  neighbouring specs for style; `packages/core/src/contracts/**` ONLY when the spec's front-matter
  says `contracts: allowed`.
- **Inputs forbidden**: the Appendix; the feature's implementation plan or code from anywhere else.
  For a change to EXISTING behaviour you may read the current code to aim at it — but the assertions
  come from the spec, not from what the code happens to do.
- **The domain comes from the spec and from nothing else.** `packages/core/src/index.ts:1-8` is a
  marker; nothing in this repository models a task, a due date or a list. If an assertion needs a
  value the spec does not give, that is a spec question, not a fixture you invent.
- **Test what the assertion says, not what is convenient.** "restored after save/load" is asserted
  after a real round-trip through the real serializer, never on the in-memory object. "after ten
  steps" is ten calls of the stepping API. **NEVER** `await sleep()`; **NEVER**
  `vi.advanceTimersByTime()` in place of a domain step (that is this stack's `Thread.Sleep`: it makes
  "after ten steps" green without stepping the domain once, and fake timers LEAK into the next test
  when `vi.useRealTimers()` is forgotten); **NEVER** `await waitFor()` for state that is synchronous.
- Map coverage: the S-id is in the file name and in every case name, so the gap list is greppable —
  `ready.mjs` prints `S coverage: k/n` from exactly that grep.

## Placement by `kind:` — the runner that can falsify it

| kind | file | shape |
|---|---|---|
| `core` | `packages/core/test/CHQ-<nnn>/S<n>_<slug>.test.ts` | plain Vitest over pure values. No DOM, no `node:*`, no network, no clock: the package's own compiler forbids them (`packages/core/tsconfig.json:4-9` — `lib: ["ES2023"]`, `types: []`, so `document` is `TS2584` and `node:fs` is `TS2591`), and `dependencies: {}` with `node-linker=isolated` (`packages/core/package.json:7`, `.npmrc:4`) means an undeclared import does not resolve. Must end in `.test.ts` — the project's include is `test/**/*.test.ts` (`vitest.config.ts:23`), and the SAME files are also run under the jsdom project `core-dom` (`vitest.config.ts:28-35`), so a core test may not depend on which environment it is in |
| `api` | `apps/api/test/CHQ-<nnn>/S<n>_<slug>.test.ts` | the app through Fastify's in-process injection (`fastify` is declared at `apps/api/package.json:9`; no app is built yet — `apps/api/src/index.ts:1-7` is a marker, and the injection method's exact signature is cited from Fastify's own docs at first use, UNVERIFIED here until then). Asserted on status, headers and body. No listening port and no `fetch` at a dev server: that is an advisory read of a process nothing pinned (`vitest.config.ts:39-42`) |
| `web` | `apps/web/test/CHQ-<nnn>/S<n>_<slug>.test.tsx` | Testing Library over a rendered component; queries by role and label, not by class name. `apps/web/test/setup.ts` is loaded by the project (`vitest.config.ts:50`) and carries the `afterEach` cleanup — without it a second `render()` in one file leaves the first mounted and a single-match query finds two |
| `e2e` | `e2e/CHQ-<nnn>/S<n>_<slug>.spec.ts` | ONLY when `node tools/gates/status.mjs` in THIS session prints `BROWSER_PROBE=pass`. It does not today: the browsers are not installed (`playwright.config.ts:3-5`), so an `e2e` S gets **no test at all** and the handover says so. Never judged from the S's `verify:`, which names the runner only |

**Naming contract** — it is what makes the enumerator exact and the filters honest:

- one file per S, path as above, the S-id in the file name;
- exactly ONE top-level `describe` per file, named `'CHQ-<nnn> S<n>'`;
- every `it(` / `test(` takes a **string literal** first argument beginning `S<n>_`
  (`it('S1_restores_after_round_trip', …)`). `L-testshape` requires the literal: the gates enumerate
  cases from the source WITHOUT running it, and a computed title makes the count non-derivable;
- ≤ 7 cases per file;
- `test.each([...])` with a LITERAL table is fine and is counted; a table built from a variable or
  in a loop makes the count non-derivable — the artifact is then accepted as `>= 1` and the note is
  PRINTED, so prefer the literal table.

Two measured consequences of that contract. The JUnit `name` is `"<describe> > <test>"` (m,
2026-11-01), so the enumerator's key is `<file>::<innermost describe>::<case name>` and renaming the
OUTER describe does not make every case look new. And `-t` is a substring match on that joined
string: `-t '^S1_'` matches NOTHING when the case sits inside a describe, so the file path is the
filter and the artifact is the selector (ts-loop, row 4). A second top-level `describe` is banned by
`L-testshape`; the only thing that would catch one is the case-count check — the exact failure it
produces at runtime is UNVERIFIED here, which is reason enough not to write one.

## The portable subset (`L-testshape`, plus `L-core-purity` for the clock, plus lint)

Forbidden in a spec test, because each one erases a distinction the gates are built on:

- `toMatchSnapshot` / `toMatchInlineSnapshot` — a missing snapshot is WRITTEN on the first run and
  green forever after; `-u` rebases the assertion onto current behaviour without a diff anyone reads.
- `it.only` / `describe.only` — they disable every other case in the file without changing a line in
  it. `it.skip` / `it.todo` in a commit.
- `@ts-expect-error`, `@ts-nocheck`, `as any` — they silence exactly the diagnostics red-check
  classifies by. (`typescript/ban-ts-comment` parses in `.oxlintrc.jsonc` but did not fire on
  `// @ts-expect-error nope` (m, 2026-11-01), so this ban is a token scan, not a lint rule.)
- `new Date()` with no argument, `Date.now()`, `Math.random()`, `performance.now()` — a clock or a
  dice in a test is a test that is green in one timezone and red in another. `new Date(<literal>)`
  is fine, `instanceof Date` is fine, other `Math` members are fine. Inside `packages/core/**`,
  tests included, this one is `L-core-purity`'s token scan rather than `L-testshape`'s, and it is
  not a lint rule at all. `vi.useFakeTimers()` without both `vi.setSystemTime(<fixed>)` and
  `vi.useRealTimers()` in teardown.
- `Intl`, `toLocaleString`, `toLocaleDateString` in an assertion; a float's `toString()` in an
  assertion (use `toBeCloseTo`); `structuredClone`; `process.env`; `node:*`.
- `test.concurrent` over shared state; `--retry` above 0.
- `expect.objectContaining` / `expect.any` as the ONLY assertion about a shape; an `await` with no
  assertion after it (a dangling promise passes).
- Required in every `async` case: `expect.hasAssertions()`. A test with no assertion passes, and an
  `expect` inside a `.then()` nobody awaited is not an assertion.

Escape per line: `// subset-ok: <why>`. The reason is PRINTED for the reviewer and is never judged
by the gate.

One line worth keeping in front of you while writing fixtures: **if an assertion is only true for
one set of fixture values, it describes the fixture and not the rule — use `test.each` with at least
two sets.**

## One case per `inputs:` declaration

For every `name=differs` / `name=invariant` the S declares, write a case
`S<n>_influence_<name>_<differs|invariant>`: build the Given TWICE through the same public surface,
vary ONLY that value, and assert on the observable —
`expect(digest(b)).not.toBe(digest(a))` for `differs`, `.toBe(…)` for `invariant`, with `digest`
imported from `@cheq/core/testing` (`packages/core/package.json:10`;
`digest` and `stableStringify` are its exports, `packages/core/src/testing/digest.ts:81,86`).

`stableStringify` REFUSES a `Date`, `undefined`, `NaN`, `Infinity`, a function, a symbol and a cycle
(`packages/core/src/testing/digest.ts:3-8`). That is not an obstacle to work around — a digest that
swallowed a `Date` would make the test depend on the machine's timezone. A state shape that cannot
be digested is a spec question.

These are ordinary spec tests: red on the base, judged per case by red-check, green of record
through the S's own runner. An S with no `inputs:` predates the rule — say so in chat; do not invent
the declarations for it.

## Procedure

1. Read the spec. If an assertion is untestable as written — or contradicts another assertion, its
   own `kind:`, or the spec's own fixture values — do NOT improvise a weaker version: report it in
   chat and send it back to `spec-harden`. The spec is the contract; fixing it is a spec edit, not a
   test-phase liberty.
2. Write the tests. **Group assertions by where they are red, not by which package owns them.**
   red-check is per-file: a file mixing new behaviour with anti-regression assertions passes, but a
   file holding ONLY the anti-regression half is green on the base and fails the gate. Put an
   assertion in the file whose subject it shares, even when the AC map lists another home.

   **Prefer assertion-red.** Build the Given through what already exists so the case fails on an
   `expect`, not on a missing import. The three reasons a case is red are distinguishable in the
   JUnit XML, and only the first is proof (ADR-0005; m, 2026-11-01, planted in one run):

   | why it is red | `<failure type>` | message | `testcase name` | verdict |
   |---|---|---|---|---|
   | honest assertion | `AssertionError` | `expected 'x' to be 'y' // Object.is equality` | the case's own name | **assertion-red** |
   | the symbol is not written yet | `TypeError` | `<name> is not a function` | the case's own name | crash-red (weaker, PENDING IMPLEMENTATION) |
   | the module is not written yet | `Error` | `Cannot find module '…' imported from …` | **the file path** — collection never reached the case | crash-red (weaker, PENDING IMPLEMENTATION) |

   Anything else is CANNOT VERIFY and is NEVER red: a `tests="0"` artifact, a suite whose `skipped`
   equals its `tests` (the missed-filter shape — exit 0 and a clean report, measured), a missing
   artifact, counters that disagree between the XML and the JSON beyond the one collection-failure
   offset ts-loop measures, a `TS2307` naming a workspace
   package like `@cheq/core` rather than a path inside it (that means the base worktree was never
   installed, and every test there would be red for a reason that has nothing to do with the test).

   **Contracts opt-in** (front-matter `contracts: allowed`, core only): you may add
   `packages/core/src/contracts/CHQ-<nnn>/*.ts` holding types, interfaces and enums ONLY — no
   function bodies, no factories, no initialised values. red-check stages them onto the base and
   prints the staged list in every verdict; a contracts file never lifts a verdict past crash-red.
   Their purity is reviewed by the human, so say in the commit body that they exist.
3. **Prove they are red.** First run them yourself — `pnpm exec vitest run --project <kind> <file>`
   — and read the failure of every new case. Then
   `node tools/gates/red-check.mjs [--base main | --since <sha>] [--spec CHQ-<nnn>]`
   (`pnpm red-check`, `package.json:12`). What it proves, and why both halves matter:
   - **every ADDED test file individually**, staged alone onto a worktree reset to the merge-base
     (with its own branch-added support/fixtures and, when allowed, its contracts);
   - **every NEW CASE you appended to an EXISTING test file, by name** — a new case that PASSES on
     the base fails the gate, so appending to a file is as safe as adding one.

   It fails closed on anything it cannot execute, and labels crash-red as crash-red in the verdict
   that `ready.mjs` repeats. A file the gate reports as CANNOT VERIFY is **not red**: name it as such
   in the commit body and let the human decide. red-check never runs in the pre-commit hook
   (`.githooks/pre-commit:6-7`) — it needs a worktree and a base run.
4. **Commit the tests alone**: `test(CHQ-<nnn>): spec tests (red)` — the `*.test.ts(x)` files and
   their own support/fixtures, nothing else. Paste red-check's verdict lines into the body. From this
   commit on, these files ARE the spec: `implement-to-green` may not touch them, and `test-guard`
   flags any later modification that has no per-file `spec-conflict:` / `spec-change:` trailer.

   Tests naming types nobody has written yet do not typecheck — that is their red. The hook tolerates
   exactly that and nothing else: with `--pending-implementation-tolerance`
   (`.githooks/pre-commit:18`) `L-tsc` reads `pending implementation` as a WARNING when every
   diagnostic is a missing-symbol code located inside a spec test under `*/test/CHQ-<nnn>/` and the
   sources themselves typecheck. Every strict run (`lights --all`, the full `ready.mjs`) still fails
   on the same tree, by design. **Never reach for `CHEQ_SKIP_HOOKS=1` or `--no-verify` for this** —
   the tolerance already exists; a syntax error or a missing symbol OUTSIDE `*/test/CHQ-<nnn>/` is a
   real failure and must stay one.

Hand over in chat; the human pushes. The handover names, per S: the file, the red-check verdict label
(assertion-red / crash-red / CANNOT VERIFY), and every S that got no test — with the reason, which
for `kind: e2e` is `BROWSER_PROBE=absent` and is reported in those words.
