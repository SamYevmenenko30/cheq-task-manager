# Testing

There is one type engine, four Jest projects and one wrapper. The wrapper
(`node tools/gates/run.mjs`) is the verdict of record for every kind; a bare `pnpm exec jest` is the
fast loop and never a verdict. No verdict is read from an exit code, and a missing artifact is
CANNOT VERIFY, never green (ADR-0002, [docs/decisions/](../decisions/)).

A hand-run carries one obligation the wrapper discharges for you:
`NODE_OPTIONS=--experimental-vm-modules` must be in the environment, or every test dies with
`Cannot use import statement outside a module` — which reads like a broken source and is not one
(measured 2026-11-02). The wrapper sets it for every child (`tools/gates/run.mjs:157`).

Every artifact shape quoted here was measured on this Mac: re-captured against jest 30 on
2026-11-02, and the GREEN shape is the one captured on 2026-11-01, because the reporter is
configured to reproduce it (see "The two channels" below). The four places where the artifact does
differ are written where each one bites — the channel separator below, the `.todo` counters, and the
two failure facts under red-check. [loop.md](loop.md) Part 2 holds the transcriptions and the
provenance marks, and this file does not restate them.

Two halves on **every** run of record, because **the runner typechecks nothing** — `@swc/jest`
strips types in Rust, so a missing export reaches the XML as a runtime error indistinguishable from
an assertion ([TD-0004](../tech-debt/TD-0004-runner-does-not-typecheck.md)): the type log and the
test artifacts. A green test run over code that does not compile is the most expensive lie available
here, and it costs one extra command to refuse it.

## The four projects

Declared once, at `jest.config.mjs:84-114`. A project's `displayName` **is** the spec `kind` — one
chain from file path to kind to project to artifact, with no registry in the middle to drift from
either end — and it is also the token `--selectProjects` takes.

| project | environment | rootDir | testMatch | what it is for |
|---|---|---|---|---|
| `core` | node | `./packages/core` (`:89`) | `test/**/*.test.ts` (`:90`) | the rules, under the engine the api runs on |
| `core-dom` | jsdom | `./packages/core` (`:96`) | `test/**/*.test.ts` (`:97`) | the SAME files, under the engine the web app runs on — the parity lane |
| `api` | node | `./apps/api` (`:103`) | `test/**/*.test.ts` (`:104`) | the HTTP adapter, through `app.inject()` |
| `web` | jsdom | `./apps/web` (`:110`) | `test/**/*.test.{ts,tsx}` (`:111`) | the screen, through `@testing-library/react` |

Each `testMatch` is written with a leading `<rootDir>/` token and resolved against that project's
own `rootDir`; the table drops the token, which says nothing the `rootDir` column does not already
hold. `tools/gates/lib/test-project.mjs` carries the same table as a DECLARATION and does not parse
the config — a gate does not parse the language it judges — so `L-orphans` is the one light that
compares the two, and it asks the runner itself which files it collects
(`jest --selectProjects <p> --listTests --json`, measured to print an array of ABSOLUTE file paths;
there is no `jest list` subcommand).

**`--passWithNoTests` is not passed at all**, and the absence is part of the verdict (`jestArgv`,
`tools/gates/run.mjs:650`); the wrapper also refuses a caller who passes it
(`tools/gates/run.mjs:196-199`). Measured during the fixture capture: a filter matching no file
exits 1 without the flag and 0 with it, so passing it is the dangerous spelling and
`--passWithNoTests=false` — the previous runner's required form — must not be written here at all
(`tools/gates/fixtures/manifest.json` → `jest/empty-run.junit.xml`). What the flag governs is
whether test FILES were found, which is never the question a verdict turns on: a run can find every
file, execute no case and still exit 0 (below).

The `web` project loads `./test/setup.ts` through `setupFilesAfterEnv` (`jest.config.mjs:112`), and
that file is `afterEach(cleanup)` (`apps/web/test/setup.ts:4-7`). It is not hygiene theatre: without
it a second `render()` in one file leaves the first mounted and a single-match query finds two.
`apps/web/test/skeleton/stub.test.tsx` renders twice in one file (`:10`, `:15`) and is the standing
proof that the setup is wired.

## Kind → runner → command → artifact

`kind:` on an assertion names the only runner that can falsify it. `verify:` is DERIVED from the kind
by spec-gate and names the runner only — never a version, never a path, never machine state.

| kind | tests live in | fast loop (after every edit) | VERDICT OF RECORD | artifacts the verdict is read from | `verify:` |
|---|---|---|---|---|---|
| `core` | `packages/core/test/CHQ-<nnn>/S<n>_<slug>.test.ts` | `pnpm exec tsc --noEmit -p packages/core/tsconfig.json` then `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --selectProjects core` | `node tools/gates/run.mjs test --kind core --label <l>` | `.ci/runs/<ts>-<l>/{core.junit.xml, core.json, tsc.core.log, core.console.log, run.json}` | `tsc-noemit + jest-core` |
| `api` | `apps/api/test/CHQ-<nnn>/S<n>_<slug>.test.ts` | the same with `-p apps/api/tsconfig.json`, `--selectProjects api` | `node tools/gates/run.mjs test --kind api --label <l>` | `.ci/runs/<ts>-<l>/{api.junit.xml, api.json, tsc.api.log, api.console.log, run.json}` | `tsc-noemit + jest-api` |
| `web` | `apps/web/test/CHQ-<nnn>/S<n>_<slug>.test.tsx` | the same with `-p apps/web/tsconfig.json`, `--selectProjects web` | `node tools/gates/run.mjs test --kind web --label <l>` | `.ci/runs/<ts>-<l>/{web.junit.xml, web.json, tsc.web.log, web.console.log, run.json}` | `tsc-noemit + jest-web` |
| `e2e` | `e2e/CHQ-<nnn>/S<n>_<slug>.spec.ts` | **none honest** | `node tools/gates/run.mjs e2e --label <l>` | `.ci/runs/<ts>-<l>/{e2e.junit.xml, run.json}` — **and this lane is CANNOT VERIFY while `.ci/probe.json` does not carry `browser_probe: "pass"`** | `playwright-chromium` |

The fast loop runs the whole project on purpose. Narrowing it to one file or one case is a FILTER,
and a filter that matched nothing on this runner exits 0 and calls itself a success (below), so a
narrowed green loop is the cheapest way to believe something that was never executed.

The command the wrapper writes, in the form that was measured to work:

```
pnpm exec tsc --noEmit --pretty false --listFiles -p <pkg>/tsconfig.json  > .ci/runs/<ts>-<l>/tsc.<kind>.log
JEST_JUNIT_OUTPUT_FILE=.ci/runs/<ts>-<l>/<kind>.junit.xml \
NODE_OPTIONS=--experimental-vm-modules \
pnpm exec jest --selectProjects <kind> --ci --runInBand \
      --json --outputFile=.ci/runs/<ts>-<l>/<kind>.json
```

Every token of it is load-bearing, and `tools/gates/run.mjs` is the only place in the repository
that assembles it (`jestArgv` / `jestEnv`, `tools/gates/run.mjs:650-662`):

- `--selectProjects <kind>`, **not** `--project`: the project name IS the kind, so a spec of another
  kind can never run under this label.
- `--ci` replaces the previous runner's `--retry=0`. Without it a MISSING snapshot is WRITTEN and
  the case PASSES — measured 2026-11-02, "1 snapshot written", exit 0 — so the first run of a
  snapshot assertion would be green by construction.
- `--runInBand` replaces `--no-file-parallelism`: one schedule per run.
- `--json --outputFile=<path>` is the second channel, and **one bare `--outputFile` is the only
  legal form.** Measured 2026-11-02: the dotted `--outputFile.json=<path>` is accepted without a
  word, every test runs and NO FILE is written. `L-artifacts` refuses the dotted spelling for that
  reason — a run that looks complete and left no artifact is worse than one that crashed.
- **Half the artifact contract travels in the ENVIRONMENT, not the argv.** `jest-junit` is declared
  in `jest.config.mjs:70-82` with no `outputFile`, so it takes its path from
  `JEST_JUNIT_OUTPUT_FILE`; measured without it, the reporter writes `junit.xml` into the CWD — one
  file every run overwrites. `runTool` records what it added to the child's environment as
  `envExtra` in `run.json`, and `L-artifacts` judges that field (`REQUIRED_ENV`) exactly as it
  judges the argv.
- `--listFiles` on the type half: `filesChecked` is the positive evidence the compiler read
  something, because zero diagnostics over zero inputs is CANNOT VERIFY, not green.

Flags that **do not exist** on this runner and must never be written: `--retry`,
`--no-file-parallelism`, `--reporter=junit`, the dotted `--outputFile.<reporter>=`, and
`--passWithNoTests=false` as a required flag. A snapshot IS updated with `jest -u`, which the
wrapper refuses as an argument (`tools/gates/run.mjs:200-203`) because rewriting a snapshot rewrites
the assertion — so it stays a deliberate act by a human, outside any run of record.

*History, and the reason the dotted form is written down at all:* on the previous runner
`--outputFile=<x.xml>` together with `--outputFile.json=<y.json>` crashed Vitest 5.0.5 with
`TypeError: Cannot create property 'json' on string '<x.xml>'`, exit 1, writing nothing (measured
2026-11-01; loop.md Part 3). The failure mode has moved from a crash to silence, which is why the
refusal moved from "remember the dotted form" to "a gate rejects it".

`TZ=UTC` and `LANG=C` are pinned in the wrapper's environment. A task manager is deadlines all the
way down, and `toLocaleDateString` / `Intl.DateTimeFormat` read the machine's zone and locale — a
suite that is green here and red in UTC has measured nothing.

## The two channels, and the one place they disagree

The reporter is configured to reproduce the artifact shape every reader in `tools/gates/lib`
already knew (`jest.config.mjs:70-82`):

```
classNameTemplate: '{filepath}'   titleTemplate: '{classname} > {title}'
ancestorSeparator: ' > '          suiteNameTemplate: '{filepath}'
```

so a case is `<testcase classname="<repo-relative file path>" name="<describe> > <test>">`. Those
templates are load-bearing, not cosmetic: the runner's own default `classname` is the describe
block, and the file-path spelling is what every reader and the collection-failure predicate rest on
— **the FORMAT is what those modules know, not the producer.** (The JSON reader,
`tools/gates/lib/jest-json.mjs`, reads this runner's report with no change at all: it was renamed
with the runner, but not one line of its parsing moved, because the field names are identical.)

The JSON channel (`--json`) carries the field names the reader already used — `numTotalTests`,
`numPassedTests`, `numFailedTests`, `numPendingTests`, `numTodoTests` — and per file
`{ name (ABSOLUTE path), status, message, assertionResults: [{ ancestorTitles, fullName, title,
status, … }] }`.

**The measured difference between the two channels is the separator.** The JSON's `fullName` joins
ancestor titles with a SPACE (`"D row 1 is a"`); the XML's `name` joins them with `' > '`, our
`ancestorSeparator`. A name taken from one channel is therefore not a key in the other, and anything
that matches by name has to say which channel it is reading. `crossCheck` compares COUNTS, so it is
unaffected by this.

## Why `tests="0"` is CANNOT VERIFY, and when "nothing to run" is `n/a`

A filter that matched no case exits 0 and calls itself a success. Measured 2026-11-02 on `core` with
a `-t` pattern matching nothing: exit 0, `success: true`, `numTotalTests: 17`, `numPassedTests: 0`,
`numPendingTests: 17`. No flag prevents it — `--passWithNoTests` governs whether test FILES were
found, and they were — so the guard is in the READER: the JSON reader refuses a report in which
`passed + failed` is zero, because a run that executed no case says nothing about the code
(`tools/gates/lib/jest-json.mjs:91`). So:

- `tests="0"` ⇒ CANNOT VERIFY. The run happened and judged nothing — and on this runner it is also
  what a file that failed to COLLECT looks like in the XML (see red-check below), so `tests="0"` is
  never read as "nothing was wrong".
- Any `<skipped/>` among the cases a spec declared ⇒ CANNOT VERIFY. The passed count is
  `tests − failures − errors − Σ skipped` per suite; `<testsuites>` carries no `skipped` attribute,
  only each `<testsuite>` does (measured — loop.md Part 2).
- A `.todo` is worse than a skip, because the XML barely admits it: measured 2026-11-02, it is a
  `<testcase>` with an EMPTY body — no `<skipped/>` child — and the `tests` / `skipped` counters
  exclude it, while the JSON counts it in `numTodoTests`
  (`tools/gates/fixtures/jest/skipped-only.junit.xml` and `…/skipped-only.json`). A declared case
  that reaches the artifact this way ⇒ CANNOT VERIFY.
- `numPendingTests > 0` over declared cases ⇒ CANNOT VERIFY, and `success: true` is never a verdict.
- A `classname` outside the kind's own project ⇒ CANNOT VERIFY (a foreign project ran), and
  `tools/gates/fixtures/jest/foreign-file.junit.xml` is a real run of another project captured for
  exactly that question.

**`n/a` is decided from the SOURCES, before anything is launched.** `tools/gates/lib/test-project.mjs`
reads the files: a kind whose sources carry no `it(`/`test(` call site at all — in any of the head
spellings below — is `n/a` in `ready`'s tests of record and is not run. The artifact never gets to
make that call, because "nothing to run" and "ran and found nothing" look identical in it and mean
opposite things.

## Naming contract

It is what makes the file path a sufficient filter, makes case selection exact on the artifact, and
makes S coverage greppable (`ready.mjs` counts `S<n>_` tokens under the test trees).

- File: `<tree>/test/CHQ-<nnn>/S<n>_<slug>.test.ts` (`.test.tsx` for `web`), `e2e/CHQ-<nnn>/S<n>_<slug>.spec.ts`.
  At most ~7 cases per file, grouped **by where the test is red**, not by which package owns the subject.
- **Heads and `expect` are imported from `@jest/globals`**, never taken as ambient globals and never
  from a bare runner name — `apps/web/test/setup.ts:5` is the shape, and `@jest/globals` is the one
  of the runner's packages the test files name (`package.json:11`).
- **The first argument of `it(`/`test(` is a STRING LITERAL beginning `S<n>_`.** `L-testshape` requires
  it, and that requirement is what makes the case enumerator (`tools/gates/lib/test-cases.mjs`) exact
  inside its own jurisdiction: a template literal or a computed title makes the expected count
  underivable, and then the enumerator says so (`expected: null`) instead of guessing.
- A file covering several S names the first one in the file name and every S in its case names.
- One case per `inputs:` declaration of the S, named `S<n>_influence_<name>_differs` or
  `…_invariant`: it builds the Given **twice through the same public surface**, varies exactly that
  one value, and asserts on the observable — for `kind: core`, on the structural digest from
  `@cheq/core/testing` (`packages/core/package.json:10`, `digest()` at
  `packages/core/src/testing/digest.ts:86`), `expect(digestB).not.toBe(digestA)` or `.toBe(…)`.
  The limit is declared: such a case proves the value REACHES the observable, not that it is used
  with the intended meaning (TD-0011).
- One top-level `describe` per spec test file. The enumerator keys a case as
  `<repo-relative file>::<innermost describe>::<case name>` (`.each` parameters in a separate `args`
  field), so renaming an OUTER describe does not make every nested case look new. A second top-level
  `describe` was expected to drop cases silently; measured on this version it does not
  (loop.md Part 3), so the rule stands for key stability and readability, not as a defence.
- `e2e` keeps `test(` from `@playwright/test`; the `S<n>_` literal rule is the same.

## The heads and modifiers the enumerator knows

`tools/gates/lib/test-cases.mjs` counts the cases a file DECLARES, and red-check compares that set
with what the artifact carries. Its vocabulary is measured against the runner's own declarations
rather than chosen generously, because a head it does not know is a case nobody notices:

- **Heads** (`@jest/globals@30.5.2/build/index.d.ts:11-24`): `describe`, `fdescribe`, `xdescribe`,
  `it`, `test`, `fit`, `xit`, `xtest`. The focus and skip spellings are HEADS here, not modifiers,
  and an enclosing one applies to everything inside it: a case under `xdescribe` is reported skipped
  with an empty chain of its own.
- **Modifiers** (`@jest/types@30.5.1/build/index.d.ts`): `only` / `skip` / `each` on describe
  (`:459-465`); `only` / `skip` / `todo` / `each` / `failing` / `concurrent` on it/test
  (`:845-857`). An unknown modifier makes the case **unresolved**, never silently ignored.
- **Not defined by this runner at all**, so a file using one does not lose a case — it fails to
  COLLECT, because the call is on `undefined`: the heads `suite(` and `bench(`, and the modifiers
  `for`, `fails`, `sequential`, `shuffle`, `skipIf`, `runIf`, `extend` and `scoped`. Such a file is
  made non-enumerable and the head is named, instead of claiming cases the artifact can never carry.
- **`.each` row names are FORMATTED by the runner.** Measured: `%i`, `%s` and `%p` are substituted
  from the row, and `$prop` from an object row — so a row's name cannot be derived from the source.
  That is why the enumerator keys `.each` parameters in a separate `args` field instead of
  pretending to know the title.
- **`test.todo` emits a record with status `"todo"`**: a case that exists, judged nothing, and is
  therefore CANNOT VERIFY wherever a spec declared it.

## Skeleton fixtures

Spec-less files under `<tree>/test/skeleton/`: **guarded** by test-guard, **never** red-checked,
never a spec's `check:`, never counted as a test phase by spec-gate. They exist so that no project is
ever empty — an empty suite must not be able to read as green — and they are green by design, which
is exactly why red-check prints and skips them (a green file in its added-test set would fail the
gate forever).

On disk today: `packages/core/test/skeleton/marker.test.ts` (1 case, names the package),
`packages/core/test/skeleton/digest.test.ts` (16 cases: the published SHA-256 vectors, the encoder,
what the digest depends on, and what it refuses to serialise), `apps/api/test/skeleton/marker.test.ts`
(1), `apps/web/test/skeleton/stub.test.tsx` (2, asserting rule 9 on the stub screen). The `core`
project therefore reports 17 cases over 2 files, which was measured as `tests="17"` with 2
`<testsuite>` elements.

Editing one needs the same per-file `spec-change:` / `spec-conflict:` declaration as any guarded test.

## The portable subset (`L-testshape` plus lint)

**`it.failing` / `test.failing` is refused outright**, not merely discouraged. Measured 2026-11-02:
`it.failing('x', () => { expect(1).toBe(2); })` is reported `"passed"` — the modifier INVERTS the
verdict, so a spec test written that way is green exactly when its assertion fails, and red-check
could never prove it red on the base. It is the one modifier that makes red and green swap places,
which is why `L-testshape` fails on it instead of printing a note
(`tools/gates/lights/testshape.mjs:157-165`).

The rest, each forbidden because it erases a distinction some gate is reading:

`toMatchSnapshot` / `toMatchInlineSnapshot` (an absent snapshot is WRITTEN and the case PASSES —
measured 2026-11-02, "1 snapshot written", exit 0 — so it is green by construction on its first run,
and `jest -u` rewrites the file in bulk afterwards) · `it.only` / `describe.only`, and the head
spellings `fit` / `fdescribe` (they disable the rest of the file without touching it) · `it.skip` /
`it.todo`, and the head spellings `xit` / `xtest` / `xdescribe`, in a commit (they read as CANNOT
VERIFY) · fake timers without a FIXED system time and a teardown that restores the real ones (they
leak into the next test, and advancing them makes "after 10 fixed steps" green without stepping the
domain once) · `new Date()` / `Date.now()` without an injected clock · `Math.random()` without a
seed · `Intl` / `toLocaleString` / `toLocaleDateString` in an assertion · `float.toString()` in an
assertion (use `toBeCloseTo`) · `structuredClone` · `process.env` · `node:*` in a `core` test ·
`.concurrent` over shared state · `expect.objectContaining` / `expect.any` as the ONLY assertion
about a shape · an `await` with no assertion behind it · a retry of any kind (there is no `--retry`
flag to pass on this runner, and a case that is green on the second attempt is a red case) ·
`@ts-expect-error` / `@ts-nocheck` / `as any` — these three silence exactly the diagnostics red-check
classifies redness by, and they are caught by a token scan, not by a lint rule: `typescript/ban-ts-comment`
exists in oxlint but did not fire on `// @ts-expect-error nope` (measured), so nothing here leans on it.

`expect.hasAssertions()` is required in every async test. The escape is per line,
`// subset-ok: <why>`; the reason is PRINTED to the reviewer and is never judged by a gate.

## red-check: a route per kind, one verdict vocabulary

Every test file **added** in the range must FAIL on the base, and so must every **case** a modified
test file gained. Each added file is staged alone onto a worktree reset to the base — the file, the
branch-added `support/`/`fixtures/` of its own tree, and `packages/core/src/contracts/CHQ-<nnn>/`
only when a touched spec says `contracts: allowed`. The staged list is printed on every run.

`node tools/gates/red-check.mjs [--base <ref> | --since <sha>] [--route <kind>|all]` — the route set
is whatever `red-check.mjs` accepts; the `e2e` route cannot run at all today (below).

**The vocabulary — the five labels the gate speaks, and the only ones it prints about a file**
(`LABELS`, `tools/gates/red-check.mjs:204-210`), in order of strength:

| label | when | counts as red? |
|---|---|---|
| `✓ red on base` | `tsc.<kind>.log` has no `error TS` line **and** every case of the file failed on an assertion | yes — the honest one, prefer it |
| `crash-red (weaker)` | the type log is clean and every case carries a measured "not written yet" signature: `TypeError: … is not a function`, `ReferenceError: … is not defined`, `Error: Cannot find module …` | yes, labelled — and it cannot tell a vacuous new case from a real one |
| `crash-red (weaker, PENDING IMPLEMENTATION)` | `tsc` is RED, every diagnostic is in the CLOSED missing-symbol set **and** located in a file this run STAGED | yes, labelled — and re-proven by the next red-check once the implementation lands |
| `✗ GREEN ON BASE` | ANY case passed. One red case never covers a green sibling | no — the file AND the case are named, and the gate fails |
| `CANNOT VERIFY` | everything else | **never** red, and it always fails the gate |

The signatures are measured, not inferred, and in the XML they are the FIRST LINE OF THE `<failure>`
BODY rather than attributes (`tools/gates/fixtures/jest/all-failed.junit.xml`, captured 2026-11-02):
`Error: expect(received).toBe(expected) // Object.is equality` = an honest assertion;
`TypeError: core.completeTask is not a function` = the module is there and the export is not;
`ReferenceError: absentFn is not defined` = the identifier was never imported or declared —
**the commonest shape of the test phase**, a spec test calling a function nobody has written, and the
one a two-signature reader drops into "red for a reason I cannot name". A fourth signature never
reaches the XML on this runner: a file that never COLLECTED is visible in the JSON channel only
(`Cannot find module '…'` behind `Test suite failed to run`). A fifth is not about the code under
test at all: `Cannot find package '@cheq/core' …` means the worktree was never installed ⇒ CANNOT
VERIFY, never `crash-red`.

**Two things INSIDE the artifact are not what the readers know — measured 2026-11-02, and they cost
this gate every verdict it has** (`tools/gates/fixtures/manifest.json` →
`runnerMigration.measuredDifferences`; `tools/gates/red-check.mjs:106-131` states the same two as
the gate's own premise):

1. **`<failure>` carries no `type` and no `message` attribute.** `jest-junit` 17.0.0 writes both in
   the element body. `parseJUnit` fills `failure.message` from the attribute, and therefore with
   `''`, and `redReason` reads `failure?.message ?? failure?.body` — `''` is not nullish, so the
   body is never reached and the closed set is matched against an empty string. Measured end to end:
   a plain `expect(1).toBe(2)` reads `{ reason: 'unknown' }`, so `✓ red on base` cannot be printed
   at all today.
2. **A file that failed to collect has no row in the XML at all.** The whole artifact is
   `<testsuites tests="0" failures="0" errors="0">` with no `<testsuite>` and no `<testcase>` —
   shaped exactly like an empty run, while the run exits 1
   (`tools/gates/fixtures/jest/collection-failure.junit.xml` against `…/empty-run.junit.xml`). The
   JSON channel is the only one that sees it: `numRuntimeErrorTestSuites: 1`, `numTotalTests: 0`,
   `success: false`, and `testResults[0]` with `status: "failed"` and `assertionResults: []`. So
   `isCollectionFailure` has nothing to match, `crossCheck`'s arithmetic no longer closes, and the
   commonest shape of the test phase reaches the gate through the channel-disagreement branch.

**So every route lands on CANNOT VERIFY until the two readers learn this shape** —
`tools/gates/lib/junit-xml.mjs` (`parseJUnit`'s `failure` object and `ASSERTION_TYPES`) and
`tools/gates/lib/jest-json.mjs`. That blocks exactly like a green, which is fail-closed and
honest, and it is not a verdict about any test. Nothing under `docs/tech-debt/` carries this yet,
which is itself the gap: rule 13 wants the entry alongside the measurement.

*History, and why the reader looks the way it does:* on the previous runner an uncollected file DID
produce one synthetic `<testcase>`, and its two attributes carried the same file in two spellings —
`classname` from the repository root, `name` from that project's own root
(`classname="packages/core/test/__v/b.test.ts" name="test/__v/b.test.ts"`, measured 2026-11-01). So
`name === classname` was false and so was `name === basename(classname)`, and the predicate had to
be the suffix form `classname.endsWith('/' + name)` — `isCollectionFailure` in
`tools/gates/lib/junit-xml.mjs`. A gate written on the equality accepted a file that never parsed as
an ordinary red case; that scar is why the predicate is a suffix, and on a jest artifact the shape it
looks for cannot occur at all.

CANNOT VERIFY, concretely: any other TS diagnostic · a `TS2307` naming a workspace package
(`@cheq/core`) rather than a path inside one — the base worktree was never installed (measured) ·
`tests="0"` · either artifact missing · the two channels failing `crossCheck` — whose three
identities were measured on a shape that counted every collection failure as one `<testcase>` in the
XML and **absent** from `numTotalTests`, and which no longer close for the reason above · a
`<skipped/>` or a todo among the new cases · a case from another project · a crash whose cause is
outside the staged files or outside the missing-symbol set.

A **modified** test file is judged per case, never per file: its old cases may be green on the base by
right. The enumerator reads both versions; a file with no new case is printed and not run (that is a
`spec-change:` / `spec-conflict:` matter for test-guard, not a redness matter). A file that gained
cases runs twice on the base — its HEAD version staged over the base's own file, then the base version
alone — and every case present in the first run and absent from the second must be Failed.

There is no `red-check-exempt:` trailer. The base worktree installs from the committed lockfile, so a
green verdict is always about the test.

## The parity lane: `core` vs `core-dom`

`L-env-parity` runs the same `packages/core/test/**` set under both projects — `--selectProjects
core` and `--selectProjects core-dom`, each with its own `JEST_JUNIT_OUTPUT_FILE`, because the JUnit
path is never a flag (`tools/gates/lights/env-parity.mjs:348-351`) — and diffs the two artifacts
case by case: same name, different verdict ⇒ fail, naming the case. An artifact older than its
source is a RE-RUN, never a comparison.

**Why this is the only honest parity lane in this repository.** `@cheq/core` is the one code that
really ships to both engines: `apps/api` declares it (`apps/api/package.json:8`) and runs under node,
`apps/web` declares it (`apps/web/package.json:8`) and runs in a browser. Both environments are real
deployment targets for the same source, so a disagreement between them is a real defect in code that
is supposed to be environment-free. Running the `api` suite under jsdom, or the `web` suite under
node, would compare each against an environment it never meets and manufacture differences that mean
nothing.

It is also narrow by construction, which is what makes a disagreement informative: `packages/core`
compiles with `lib: ["ES2023"]` and `types: []` (`packages/core/tsconfig.json:7-8`), so no
environment's globals are even visible to the compiler there. Anything the lane finds is therefore a
RUNTIME difference between two engines on plain ES — the only thing a parity lane should be hunting.

The honest limit: no case has ever disagreed, so today the lane is a green lamp (TD-0006). The rule
recorded with it is that it stays hard until a review finds no real divergence over a month, and then
becomes soft or is removed — it does not get to stay green and decorative.

## What is NOT proven, and says so

- **`kind: e2e`**: `@playwright/test` is installed, the browsers are NOT downloaded (measured), so no
  e2e assertion has ever been red or green. No e2e test is written and nothing runs until
  `.ci/probe.json` carries `browser_probe: "pass"` (TD-0001, `playwright.config.ts:3-5`).
- **`L-env-parity` finding anything**: one data point class, all green (TD-0006, above).
- **The coverage floor**: 80% on statements, branches, functions and lines is declared in
  `jest.config.mjs:135` over `packages/core/src/**` + `apps/api/src/**` (`:130-134`), and no lane of
  record asks for it — `jestArgv` passes no `--coverage` (`tools/gates/run.mjs:650`), so no verdict
  reads it ([TD-0013](../tech-debt/TD-0013-coverage-floor-is-declared-but-unenforced.md)). Measured
  by hand 2026-11-02 on the skeleton: statements 94.44%, lines 95.53%, functions 100%, **branches
  72.54%** — so the floor FAILS today, in the hand-written digest support code, and that is the
  honest state rather than a number to soften.
- **Perf and bundle size**: there is no bench lane and `vite build` is in no verdict — every project
  is `noEmit` (TD-0010).
- **Mutation testing / test strength**: a test that asserts nothing useful still passes every gate
  here (TD-0012).
- **The two test channels cross-checked as a GATE**: `crossCheck` implements three counter
  identities, and no gate reads it (TD-0005). Two things on top of that are now measured rather than
  assumed: the identities were derived from a collection-failure shape this runner does not produce
  (above), and no run has been observed producing two channels that disagree about a well-formed
  run — `tools/gates/fixtures/jest/counter-mismatch.json` is a DERIVED fixture, the only way to
  exercise the refusal at all. The one real disagreement this toolchain does produce is a `.todo`:
  the XML counters exclude it, the JSON counts it in `numTodoTests`
  (`tools/gates/fixtures/jest/skipped-only.*`).
- **The gates themselves**: each one is proven only by its pair of fixtures in
  `tools/gates/gate-probes.mjs`. Until a probe has shown a gate FAIL on known-bad code, "the gate
  passed" means only that it exited 0.
