# Testing

There is one type engine, four Vitest projects and one wrapper. The wrapper
(`node tools/gates/run.mjs`) is the verdict of record for every kind; a bare `pnpm exec vitest` is
the fast loop and never a verdict. No verdict is read from an exit code, and a missing artifact is
CANNOT VERIFY, never green (ADR-0002, [docs/decisions/](../decisions/)).

Every artifact shape quoted here was measured on this Mac on 2026-11-01; [loop.md](loop.md) Part 2
holds the transcriptions and the provenance marks, and this file does not restate them.

Two halves on **every** run of record, because **Vitest typechecks nothing**: the type log and the
test artifacts. A green test run over code that does not compile is the most expensive lie available
here, and it costs one extra command to refuse it.

## The four projects

Declared once, at `vitest.config.ts:17-54`. A project's `name` **is** the spec `kind` — one chain
from file path to kind to project to artifact, with no registry in the middle to drift from either end.

| project | environment | root | include | what it is for |
|---|---|---|---|---|
| `core` | node | `./packages/core` (`:21`) | `test/**/*.test.ts` (`:23`) | the rules, under the engine the api runs on |
| `core-dom` | jsdom | `./packages/core` (`:32`) | `test/**/*.test.ts` (`:34`) | the SAME files, under the engine the web app runs on — the parity lane |
| `api` | node | `./apps/api` (`:40`) | `test/**/*.test.ts` (`:42`) | the HTTP adapter, through `app.inject()` |
| `web` | jsdom | `./apps/web` (`:48`) | `test/**/*.test.{ts,tsx}` (`:51`) | the screen, through `@testing-library/react` |

`passWithNoTests` is deliberately absent from that config (`vitest.config.ts:9-11`): the wrapper
passes `--passWithNoTests=false` explicitly, so a run that matched nothing fails loudly instead of
reporting success over an empty suite.

The `web` project loads `./test/setup.ts` (`vitest.config.ts:50`), which is `afterEach(cleanup)`
(`apps/web/test/setup.ts:4-7`). It is not hygiene theatre: without it a second `render()` in one file
leaves the first mounted and a single-match query finds two. `apps/web/test/skeleton/stub.test.tsx`
renders twice in one file (`:10`, `:15`) and is the standing proof that the setup is wired.

## Kind → runner → command → artifact

`kind:` on an assertion names the only runner that can falsify it. `verify:` is DERIVED from the kind
by spec-gate and names the runner only — never a version, never a path, never machine state.

| kind | tests live in | fast loop (after every edit) | VERDICT OF RECORD | artifacts the verdict is read from | `verify:` |
|---|---|---|---|---|---|
| `core` | `packages/core/test/CHQ-<nnn>/S<n>_<slug>.test.ts` | `pnpm exec tsc --noEmit -p packages/core/tsconfig.json` then `pnpm exec vitest run --project core packages/core/test/CHQ-<nnn>/S<n>_<slug>.test.ts` | `node tools/gates/run.mjs test --kind core --label <l>` | `.ci/runs/<ts>-<l>/{core.junit.xml, core.json, tsc.core.log, run.json}` | `tsc-noemit + vitest-core` |
| `api` | `apps/api/test/CHQ-<nnn>/S<n>_<slug>.test.ts` | the same with `-p apps/api/tsconfig.json`, `--project api` | `node tools/gates/run.mjs test --kind api --label <l>` | `.ci/runs/<ts>-<l>/{api.junit.xml, api.json, tsc.api.log, run.json}` | `tsc-noemit + vitest-api` |
| `web` | `apps/web/test/CHQ-<nnn>/S<n>_<slug>.test.tsx` | the same with `-p apps/web/tsconfig.json`, `--project web` | `node tools/gates/run.mjs test --kind web --label <l>` | `.ci/runs/<ts>-<l>/{web.junit.xml, web.json, tsc.web.log, run.json}` | `tsc-noemit + vitest-web` |
| `e2e` | `e2e/CHQ-<nnn>/S<n>_<slug>.spec.ts` | **none honest** | `node tools/gates/run.mjs e2e --label <l>` | `.ci/runs/<ts>-<l>/{e2e.junit.xml, run.json}` — **and this lane is CANNOT VERIFY while `.ci/probe.json` does not carry `browser_probe: "pass"`** | `playwright-chromium` |

The command the wrapper writes, in the form that was measured to work:

```
pnpm exec tsc --noEmit --pretty false -p <pkg>/tsconfig.json   > .ci/runs/<ts>-<l>/tsc.<kind>.log
pnpm exec vitest run --project <kind> \
      --reporter=junit --outputFile.junit=.ci/runs/<ts>-<l>/<kind>.junit.xml \
      --reporter=json  --outputFile.json=.ci/runs/<ts>-<l>/<kind>.json \
      --retry=0 --no-file-parallelism --passWithNoTests=false
```

**Both artifacts are asked for in the dotted form.** `--outputFile=<x.xml>` together with
`--outputFile.json=<y.json>` in one command crashes Vitest 5.0.5 with
`TypeError: Cannot create property 'json' on string '<x.xml>'`, exit 1, and writes nothing at all
(measured 2026-11-01; loop.md Part 3). `outputFile` set inside a `projects` entry is ignored
altogether (`vitest.config.ts:3-7`), which is why the gate names on the command line the file it will
then read.

`TZ=UTC` and `LANG=C` are pinned in the wrapper's environment. A task manager is deadlines all the
way down, and `toLocaleDateString` / `Intl.DateTimeFormat` read the machine's zone and locale — a
suite that is green here and red in UTC has measured nothing.

## Why `tests="0"` is CANNOT VERIFY, and when "nothing to run" is `n/a`

A runner that matched no test exits 0 and reports success. Measured on this tree: a `-t` filter with
no match gave exit 0, `tests="17" failures="0"` with `<skipped/>` on every case, and
`numPassedTests: 0, numPendingTests: 17, success: true` in the JSON channel. So:

- `tests="0"` ⇒ CANNOT VERIFY. The run happened and judged nothing.
- Any `<skipped/>` among the cases a spec declared ⇒ CANNOT VERIFY. The passed count is
  `tests − failures − errors − Σ skipped` per suite; `<testsuites>` carries no `skipped` attribute,
  only each `<testsuite>` does (measured — loop.md Part 2).
- `numPendingTests > 0` over declared cases ⇒ CANNOT VERIFY, and `success: true` is never a verdict.
- A `classname` outside the kind's own project ⇒ CANNOT VERIFY (a foreign project ran).

**`n/a` is decided from the SOURCES, before anything is launched.** `tools/gates/lib/test-project.mjs`
reads the files: a kind whose sources carry no `it(`/`test(` at all is `n/a` in `ready`'s tests of
record and is not run. The artifact never gets to make that call, because "nothing to run" and "ran
and found nothing" look identical in it and mean opposite things.

## Naming contract

It is what makes the file path a sufficient filter, makes case selection exact on the artifact, and
makes S coverage greppable (`ready.mjs` counts `S<n>_` tokens under the test trees).

- File: `<tree>/test/CHQ-<nnn>/S<n>_<slug>.test.ts` (`.test.tsx` for `web`), `e2e/CHQ-<nnn>/S<n>_<slug>.spec.ts`.
  At most ~7 cases per file, grouped **by where the test is red**, not by which package owns the subject.
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

Forbidden in a spec test, each because it erases the distinction some gate is reading:

`toMatchSnapshot` / `toMatchInlineSnapshot` (an absent snapshot is WRITTEN and green forever) ·
`it.only` / `describe.only` (disables the rest of the file without touching it) · `it.skip` /
`it.todo` in a commit (reads as CANNOT VERIFY) · `vi.useFakeTimers()` without
`vi.setSystemTime(<fixed>)` and a `vi.useRealTimers()` teardown (they leak into the next test, and
`advanceTimersByTime` makes "after 10 fixed steps" green without stepping the domain once) ·
`new Date()` / `Date.now()` without an injected clock · `Math.random()` without a seed ·
`Intl` / `toLocaleString` / `toLocaleDateString` in an assertion · `float.toString()` in an assertion
(use `toBeCloseTo`) · `structuredClone` · `process.env` · `node:*` in a `core` test ·
`test.concurrent` over shared state · `expect.objectContaining` / `expect.any` as the ONLY assertion
about a shape · an `await` with no assertion behind it · `--retry > 0` ·
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

**The vocabulary, in order of strength:**

| label | when | counts as red? |
|---|---|---|
| `assertion-red` | `tsc.<kind>.log` has no `error TS` line **and** the case has `<failure type="AssertionError">` **and** the testcase `name` is a case name, not the file (`classname.endsWith('/' + name)` is false) **and** it ends with the declared case name | yes — the honest one, prefer it |
| `crash-red (weaker)` | every `tsc` diagnostic is in the missing-symbol set **and** located in a staged file under `*/test/CHQ-<nnn>/`; or, with a clean type log, `<failure type="TypeError">` carrying `… is not a function`, `type="ReferenceError"` carrying `… is not defined`, or `type="Error"` carrying `Cannot find module …` on a testcase that names its file as that project spells it | yes, labelled — and it cannot tell a vacuous new case from a real one |
| `CANNOT VERIFY` | everything else | **never** red, and it always fails the gate |

The signatures are measured, not inferred, and there are FOUR of them (loop.md Part 2 transcribes the
artifact): `AssertionError` + `expected 'x' to be 'y' // Object.is equality` = an honest assertion;
`TypeError` + `completeTask is not a function` = the module is there and the export is not;
`ReferenceError` + `absentFn is not defined` = the identifier was never imported or declared —
**the commonest shape of the test phase**, a spec test calling a function nobody has written, and the
one a three-signature reader drops into "red for a reason I cannot name";
`Error` + `Cannot find module '…' imported from …` on a testcase that names its FILE = the module is
not written yet and collection never reached a case.

**The file-naming signature is a suffix, not an equality.** On a collection failure the two
attributes carry the same file in two spellings — `classname` from the repository root, `name` from
that project's own `root` (`classname="packages/core/test/__v/b.test.ts"
name="test/__v/b.test.ts"`) — so `name === classname` is false and so is
`name === basename(classname)`. The predicate is `classname.endsWith('/' + name)`
(`tools/gates/lib/junit-xml.mjs:219-246`). A gate written on the equality accepts a file that never
parsed as an ordinary red case. A fifth signature is not about the code under test at all:
`Error` + `Cannot find package '@cheq/core' …` means the worktree was never installed ⇒ CANNOT
VERIFY, never `crash-red`.

CANNOT VERIFY, concretely: any other TS diagnostic · a `TS2307` naming a workspace package
(`@cheq/core`) rather than a path inside one — the base worktree was never installed (measured) ·
`tests="0"` · either artifact missing · the two channels failing `crossCheck` — which compares them
through three measured identities that count the collection failures explicitly, because a file that
never loaded is one `<testcase>` in the XML and **absent** from `numTotalTests`, so a raw
`tests === numTotalTests` would reject every honest crash-red run (loop.md Part 2) · a `<skipped/>` or
a todo among the new cases · a case from another project · a crash whose cause is outside the staged
files or outside the missing-symbol set.

A **modified** test file is judged per case, never per file: its old cases may be green on the base by
right. The enumerator reads both versions; a file with no new case is printed and not run (that is a
`spec-change:` / `spec-conflict:` matter for test-guard, not a redness matter). A file that gained
cases runs twice on the base — its HEAD version staged over the base's own file, then the base version
alone — and every case present in the first run and absent from the second must be Failed.

There is no `red-check-exempt:` trailer. The base worktree installs from the committed lockfile, so a
green verdict is always about the test.

## The parity lane: `core` vs `core-dom`

`L-env-parity` runs the same `packages/core/test/**` set under both projects and diffs the two
artifacts case by case: same name, different verdict ⇒ fail, naming the case. An artifact older than
its source is a RE-RUN, never a comparison.

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
- **Perf and bundle size**: there is no bench lane and `vite build` is in no verdict — every project
  is `noEmit` (TD-0010).
- **Mutation testing / test strength**: a test that asserts nothing useful still passes every gate
  here (TD-0012).
- **The two test channels cross-checked as a GATE**: the collection-failure shape and the three
  counter identities are measured on both channels and `crossCheck` implements them, but no gate
  reads it and no fixture has made the channels disagree on purpose (TD-0005).
- **The gates themselves**: each one is proven only by its pair of fixtures in
  `tools/gates/gate-probes.mjs`. Until a probe has shown a gate FAIL on known-bad code, "the gate
  passed" means only that it exited 0.
