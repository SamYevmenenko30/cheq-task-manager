---
name: implement-to-green
description: Implement a feature until the spec tests pass, with the runner named by each assertion's kind — tsc plus the kind's test project after every edit, a wrapped run of record before any green claim. Step 3 of the spec-first flow — run in a FRESH session, after tests-from-spec has committed red tests. Spec tests are read-only.
---

# Implement to green

Inputs: the spec (`docs/specs/CHQ-<nnn>.md`) INCLUDING its Appendix; the red tests; the `AGENTS.md`
of every package you will touch. Goal: make the tests green without touching them.

Load the `ts-loop` skill first and run its PRE-FLIGHT (`node tools/gates/status.mjs`).

## The one hard rule

**You do not edit the spec test files. Ever. Silently.**

If a test looks wrong — asserts something the spec does not say, uses a wrong fixture, contradicts
an ADR — you are holding a *spec conflict*, and the whole point of the two-context flow is that YOU
do not get to resolve it (the agent whose code a test blocks is the least neutral party there is):

1. Stop implementing against that test.
2. Write the conflict down: which test, which spec assertion, what you believe is wrong, and what
   the code would have to do to satisfy it as written.
3. Commit it with the trailer `test-guard` reads — `spec-conflict: <test file> — <one-line why>`
   (`pnpm test-guard`, `package.json:13`; the hook runs it through `ready.mjs --quick`) — and the
   detail in the body. The trailer is scoped to the file it names, one line per conflicting file,
   and must BEGIN its own line at column zero: quoted, indented, or inside a sentence it is prose
   about the mechanism and waives nothing.
4. Continue with the other tests. A human resolves the conflict — or a `spec-harden` revision
   followed by a `tests-from-spec` fix, each in its own session.

Editing the test instead is exactly how "assert after the save/load round-trip" becomes "assert the
in-memory object" — the failure this flow exists to prevent. In this stack the same move has
cheaper-looking disguises, and they are the same move: adding `@ts-expect-error` or `as any` over a
diagnostic the test was written to raise, loosening `toBe` to `expect.objectContaining`, wrapping a
synchronous assertion in `await waitFor()`, or running the suite with `-u` so a snapshot rebases
onto what the code now does.

Do NOT reach for `spec-conflict:` when the spec told you to change a test — e.g. an assertion that
says an obsolete test is replaced. Nothing is wrong there, so declare it as what it is:
`spec-change: <test file> — <what behaviour changed and why>`. Using the conflict trailer for a
sanctioned change inflates a signal the reviewer reads as "the two phases disagreed".

A disagreement with a benchmark, a profiler, a library's documentation or an LLM suggestion is not a
spec conflict: the tests are the contract, everything else is evidence.

## Procedure

1. Read the spec (body and Appendix), then the red tests, then the `AGENTS.md` of every package you
   will touch. Placement: rules, the state model, derivations, the persistence SHAPE and
   determinism go in `@cheq/core` as plain values and pure functions — no DOM, no `node:*`, no
   clock, no network, and `dependencies: {}` stays exactly that
   (`packages/core/package.json:7`, `packages/core/tsconfig.json:4-9`). Time, randomness, storage
   and I/O enter core as ARGUMENTS and are supplied at the edge: `@cheq/api` for the HTTP surface,
   `@cheq/web` for rendering and interaction. A rule implemented at the edge because that was
   quicker is a rule no core test can judge.
2. Work S by S in kind order **core → api → web → e2e**, and after every edit run the runner the
   S's `verify:` names (ts-loop, RUNNER BY KIND) — both halves, because **the runner does not
   typecheck at all**: `@swc/jest` strips types in Rust, so a missing export reaches the artifact as
   a runtime error indistinguishable from an assertion
   ([TD-0004](../../../docs/tech-debt/TD-0004-runner-does-not-typecheck.md)). That is why
   `tsc.<kind>.log` sits beside `<kind>.junit.xml` in every run directory.
   - `core` (`tsc-noemit + jest-core`):
     `pnpm exec tsc --noEmit --pretty false -p packages/core/tsconfig.json` then
     `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --selectProjects core packages/core/test/CHQ-<nnn>/S<n>_<slug>.test.ts`.
     Seconds. Remember that a zero-byte `tsc` output is also what "read no files" looks like (m) —
     the positive sign comes from the wrapped run, not from silence.
   - `api` / `web`: the same two halves with that package's `tsconfig.json` and
     `--selectProjects api` / `--selectProjects web`.
   - `e2e`: there is no test to make green while `BROWSER_PROBE=absent` (`playwright.config.ts:3-5`).
     Do not claim such an S, and do not install browsers to make the lane appear — that is the
     human's call and `gate-probes` is the only author of the probe record.
3. **Before CLAIMING an S green**, produce the artifact: `node tools/gates/run.mjs test --kind <k>
   --label <l>` (`pnpm test:core|test:api|test:web`, `package.json:23-25`), in a tree
   `status.mjs` reports as ready — with `WATCHERS>0` that means the ci worktree, never the checkout
   a watcher holds. For a `core` S, add a green `L-env-parity`: the same files under the jsdom
   project `core-dom` (`jest.config.mjs:94-97`), diffed case by case. A `core` S whose parity lane
   has not run is carried as `jest-core` on your honest word — it is not a closed S.
4. Read the verdict from the artifact, never from an exit code (ts-loop, HOW TO READ): the
   `<kind>.junit.xml` counters and each `<testcase>`, cross-checked against the `<kind>.json`
   counters, plus a `tsc.<kind>.log` with zero diagnostics AND `filesChecked > 0`. A missing
   artifact, `tests="0"`, a suite whose `skipped` equals its `tests`, a JSON report whose
   `passed + failed` is zero, or counters that disagree between the two channels is CANNOT VERIFY —
   not green, not red. A case name read out of the JSON is not a key in the XML: `fullName` joins
   ancestors with a SPACE there and with `' > '` here, so match counts, never names, across channels.
5. Commit per S, or per small group, with the trailer `ready.mjs` parses, exactly:
   `green: S<n>[,S<m>] via <jest-core|jest-api|jest-web|playwright-chromium> <path under .ci/runs>`
   e.g. `green: S1,S2 via jest-core .ci/runs/2026-11-02T09-14-02-331Z-chq-001/core.junit.xml`.
   `.ci/` is gitignored (`.gitignore:10`), so the artifact lives on this machine only — `ready.mjs`
   prints `(artifact present)` or `(ARTIFACT MISSING)` beside each trailer, and the human judges.
6. When behaviour you ship differs from any prose the branch already carries — an ADR, a TD entry, a
   package `AGENTS.md`, a knowledge doc, the spec's own `## Contradictions with the project as it
   stands` — update it in the SAME commit as the behaviour. A comment in code may state only an
   invariant THAT package enforces; a promise another package must keep is a TD entry or a
   cross-package row in the spec, never prose in a source file.
7. Done = `node tools/gates/ready.mjs` prints `READY` (`pnpm ready`, `package.json:16`: lights
   `--all` → spec-gate → test-guard → red-check → the runs of record). Hand the printed block to the
   human in chat — no push, no PR, nothing posted. A `NOT READY` whose cause is `BROWSER_PROBE=absent`
   is reported in exactly those words, not worked around.

## Rules of the edit

- **No dependency enters any `package.json` from this phase.** `L-deps` is hard and judges
  `dependencies`, `devDependencies` and `peerDependencies` alike — in this stack a devDependency
  executes code (postinstall scripts, Vite plugins, lint plugins), so "it is only a dev dependency"
  is not an argument. It also names lockfile drift separately, because a transitive upgrade touches
  no manifest at all. A missing dependency is a spec question for the human, who adds it by hand.
- **Do not widen a declared surface to go green.** `packages/core/tsconfig.json:11`'s `include`,
  `.oxlintrc.jsonc:60-68`'s `ignorePatterns`, `.npmrc:4`'s `node-linker`, and in `jest.config.mjs` a
  project's `testEnvironment`, its `testMatch`, or either ignore key
  (`testPathIgnorePatterns` / `modulePathIgnorePatterns` — `L-visible`'s fourth door) — each is a
  boundary a light reads. Narrowing or widening one is a `gate:` commit with an ADR line, decided by
  the human, never a step in making a test pass.
- `packages/core/src/contracts/**` files, when the spec allowed them, are production code now:
  giving an interface its implementation is your job; editing the interface the test phase wrote is
  a spec question.
- A generated file is a DRAFT until its generator ran and `L-generated` passed: `pnpm digest`
  rewrites `docs/digests/` and `pnpm digest:check` is what the light reports
  (`package.json:20-21`). Never hand-edit a generated file; never cite one as evidence that code
  typechecks.
- One run of record at a time (`.ci/lock`), and a run directory is never reused: a crashed run that
  wrote nothing leaves the PREVIOUS artifact in place, and the next read would take last week's
  green for its own.
- The determinism rules the test phase works under apply to the code too: no `new Date()` with no
  argument, no `Date.now()`, no `Math.random()`, no `performance.now()` inside `packages/core/**` —
  a clock or a dice there is a rule no test can pin down. They enter as arguments.
- Never pipe the output of the tool you are judging (`| head` returned 0 over a real failure, twice,
  measured), and never let a formatter or an `--fix` pass run inside the hook: it would change the
  tree the gates just judged.

## Honest limits today

- `kind: e2e` cannot be made green here: the Playwright browsers are not installed and the lane is
  CANNOT VERIFY, read live from `BROWSER_PROBE`, never from the spec.
- There is no calibration record in this repository, so no step has a budget: `ready.mjs` prints the
  seconds a run took as a REPORT of that run. Do not promise one, and do not write one into prose.
- **The coverage floor is declared and no gate runs it.** `jest.config.mjs:135` sets 80% on all four
  metrics over `packages/core/src/**` + `apps/api/src/**` (`:130-134`), and `--coverage` does
  produce real per-file numbers (measured). Measured on the skeleton: statements 94.44%, lines
  95.53%, functions 100%, **branches 72.54%** — so the floor FAILS today, on uncovered branches in
  the hand-written digest support code. `ready.mjs` does not read coverage, so going READY is not a
  statement about it; if a spec's `## Lights` makes the floor a check, it is yours to run and cite.
- `oxlint --type-aware` is not a verdict about types (`tsc` is the only one) and it does not report
  `require-await`; `typescript/ban-ts-comment` parses but did not fire on a described
  `@ts-expect-error` (m, 2026-11-01), so the token scan in `L-testshape` is what holds that ban.
- A relative import that climbs OUT of `packages/core` is invisible to `tsc`, to the dependency
  graph and to the linter (measured: `exit 0`, no diagnostics) — only `L-core-purity`, walking the
  import graph, refuses it. If that light is not in the run, the core boundary was not checked.
- Everything machine-local — which tree is installed, whether a watcher holds it, whether the probe
  passed — is printed by `node tools/gates/status.mjs` and is not written in this file (ADR-0003).
