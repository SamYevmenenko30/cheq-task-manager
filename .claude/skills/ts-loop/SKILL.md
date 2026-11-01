---
name: ts-loop
description: The agent⟷toolchain working loop as an operating procedure — pre-flight flags, which runner is the verdict of record for which assertion kind, what an exit code, a dev server or a linter may never be trusted for, how to read the JUnit XML / the Vitest JSON / the tsc log / the oxlint JSON. Loaded FIRST by spec-harden, tests-from-spec and implement-to-green; load it at the start of any session that touches /Users/semenyevmenenko/work/cheq-task-manager.
---

# TS loop

Every claim this agent makes about the project is read back from a tool, and every verdict about
types, tests, lint or a browser run is read from an ARTIFACT on disk — never from a process exit
code (ADR-0002). Here that rule is needed more than it would be in a compiled stack with a noisy
build log, because **`tsc` prints nothing at all on success**: silence is indistinguishable from
"read no files".

Measured on this machine, 2026-11-01, and the whole reason the wrapper exists:

- `pnpm exec tsc --noEmit --pretty false -p packages/core/tsconfig.json` → exit 0, **0 bytes** of
  output. A narrowed `include`, a `// @ts-nocheck`, a stale `.tsbuildinfo` and a clean tree are the
  same observation. (m)
- One planted `error TS2322` → exit 1 and one line `path(line,col): error TSxxxx: msg`. The **same
  command** with `| head -2` appended → **exit 0**, with the diagnostic still on screen: the shell
  reported `$?` of `head`. (m)
- `pnpm exec vitest run --project core -t 'S9_nothing_matches'` → **exit 0**, the JUnit artifact
  written, `<testsuites tests="17" failures="0">`, every suite `skipped="16"`, a `<skipped/>` child
  on every case. A filter that matched nothing is a clean green run. (m)

So: **silence is not a marker — the wrapper writes its own.** A GREEN verdict needs a positive sign
that the tool read something: `filesChecked > 0` from `tsc --listFiles`, a `<testcase>` for every
case the enumerator expected in the file under judgement, `number_of_files > 0` from oxlint. An
artifact that is absent is CANNOT VERIFY, never green; a third verdict exists and is used.

**Provenance markers.** This repository has no calibration record, so there is no such thing as a
promised budget here. `(m)` = measured on this machine on the date given, with the command shown —
re-observe it rather than quote it; the artifact was not kept. `(r)` = read from a run artifact
under `.ci/runs/`, cited WITH its path, valid in that session only. `(d)` = documented: a
`path:line` in this repo or a URL. Anything else is **UNVERIFIED** and is written as that word. No
seconds figure is a budget: quote one only as `(r)` with its path, describing one run.
Tool versions are not written into prose either — `.nvmrc:1`, `package.json:9` (`packageManager`)
and `pnpm-lock.yaml` are the only sources, and `status.mjs` prints what is installed (ADR-0003).

## PRE-FLIGHT — every session, before anything else

`node tools/gates/status.mjs` (`pnpm status`, `package.json:18`). Read the flags; do not assume
them. Its output is the contract — when a flag below is missing from what it prints, treat that
flag as unread and say so, rather than inferring it from the filesystem yourself.

| flag | source | what it permits |
|---|---|---|
| `CI_TREE_READY=true\|false` | the install state of the tree a run of record would use (`node_modules` present, `pnpm-lock.yaml` satisfied) | `false` ⇒ **no run of record at all**. A base worktree without a successful install makes every added test crash-red for a reason that has nothing to do with the test — the gate would report a clean sweep of red and nothing in that report would be about the spec |
| `LOCKFILE_CLEAN=true\|false` | `pnpm-lock.yaml` against the manifests at HEAD | `false` ⇒ `run.mjs --record` refuses. "lockfile is up to date" from a package manager is not this flag and is never trusted for it |
| `WATCHERS=<n>` | vitest/vite/tsx processes holding this tree | `> 0` ⇒ a run of record in the main checkout is FORBIDDEN (a watcher rewrites `.vitest/` and may hold stale module state); advisory reads are labelled `mode=watcher-running(UNVERIFIED)` |
| `BROWSER_PROBE=pass\|absent` | `.ci/probe.json`, written only by `gate-probes` | `absent` ⇒ `kind: e2e` gets no test, no run and no `green:` — the lane is CANNOT VERIFY, reported as exactly that. Playwright is installed; its browsers are not (`playwright.config.ts:3-5` (d)) |
| `HOOKS_INSTALLED=true\|false` | `git config core.hooksPath` vs `.githooks/pre-commit` | `false` ⇒ commits are unguarded. The hook is `.githooks/pre-commit:18` = `ready.mjs --quick --pending-implementation-tolerance`; the escape it prints is `CHEQ_SKIP_HOOKS=1` (`.githooks/pre-commit:10,21`) |

Nothing in the fast loop needs any of these flags: `tsc` and `vitest` on your own tree are yours to
run at will. The flags gate the runs of RECORD and the `green:` claims that cite them.

## THE TABLE — one row per loop step

| # | step | command (as the code spells it) | reads back | must NOT trust |
|---|---|---|---|---|
| 1 | inspect the project as text | `docs/digests/*.md` FIRST (generated; `pnpm digest:check`, `package.json:20-21`), then `node tools/gates/project.mjs` (`pnpm project`, `package.json:19`): `packages` · `config <pkg>` · `exports <pkg>` · `routes` · `imports <file>`; plus `git log --oneline -20 -- <paths>` | the workspace as declared; a package's EFFECTIVE compiler options; what a module imports | a digest as evidence that the code typechecks — it is a projection, not a verdict; **a `tsconfig.json` read as text**: every one of them `extends` (`packages/core/tsconfig.json:2`), so the effective options come from `project.mjs config`, never from the file you just read |
| 2 | edit | Write / Edit | — | that a passing fast loop in one package says anything about another |
| 3 | types, fast (after every edit) | `pnpm exec tsc --noEmit --pretty false -p <pkg>/tsconfig.json` | `path(line,col): error TSxxxx: msg` lines (m) | **silence** as proof the compiler read your file; anything about another package; anything Vitest will do at runtime — **Vitest does not typecheck at all**, which is why every run of record is two halves |
| 4 | tests, fast (after every edit) | `pnpm exec vitest run --project <kind> <path to the one test file>` — the FILE PATH is the honest filter; both repo-relative and project-root-relative resolve (m) | the terminal summary; `.ci/tests/<kind>.junit.xml` for the fast lane | this as the verdict of record; green from a filter that matched nothing (m: exit 0, all cases `<skipped/>`); `-t` as a selector — it is a SUBSTRING/regex match on `"<describe> > <test>"`, so `-t 'adds a task'` also takes `'adds a task twice'`, and `-t '^S1_'` matches NOTHING when the case sits inside a `describe` (m) |
| 5 | dev server, Vite HMR, the editor's language service | `pnpm dev:web` / `pnpm dev:api` (`package.json:28-29`) | that a human can look at it | as evidence — **never**. An artifact a watcher wrote before your edit is STALE, and a watcher in the tree makes a run of record forbidden (`WATCHERS`) |
| 6 | types OF RECORD | `node tools/gates/run.mjs types --kind <core\|api\|web\|all>` (`pnpm types`, `package.json:22`) | `.ci/runs/<ts>-<label>/tsc.<kind>.log` + `run.json` (argv, captured exit, seconds) | the exit code; a zero-diagnostic log without `filesChecked > 0` — that is CANNOT VERIFY, because never ran is not green |
| 7 | tests OF RECORD | `node tools/gates/run.mjs test --kind <k> --label <l>` (`pnpm test:core\|test:api\|test:web`, `package.json:23-25`) | `.ci/runs/<ts>-<label>/<kind>.junit.xml` + `<kind>.json` + `tsc.<kind>.log` + `run.json` | the exit code; `tests="0"`; a suite whose `skipped` equals its `tests`; a `<testcase>` whose `classname` is outside the files under judgement (another project's cases are in the same XML); counters that disagree between the XML and the JSON |
| 8 | the browser lane | `node tools/gates/run.mjs e2e --label <l>` (`pnpm e2e`, `package.json:26`) | nothing yet | anything: while `BROWSER_PROBE=absent` this lane is CANNOT VERIFY and the refusal is reported verbatim, not worked around |
| 9 | lint, standing lane | `node tools/gates/run.mjs lint` (`pnpm lint`, `package.json:27`) → `oxlint --type-aware --format=json` | `.ci/runs/<ts>-<label>/oxlint.json`: `{diagnostics[], number_of_files, number_of_rules, …}` (m) | the linter as a verdict about TYPES — `tsc` is the only type verdict; a run whose argv lacked `--type-aware` (the type rules then do not run and **nothing says so** (m)); `number_of_files === 0` (CANNOT VERIFY) |
| 10 | gates | `node tools/gates/ready.mjs --quick` (hook path) · `node tools/gates/ready.mjs [--since <sha>] [--spec CHQ-<nnn>]` (full, the check of record before a push) · `node tools/gates/lights/run.mjs --fast\|--all` (`pnpm lights`, `package.json:15-17`) | the verification block (`READY` / `NOT READY`) and the lights table | a gate that did not run; a green a gate cannot explain; the hook's horizon — the range gates read HEAD, i.e. the PREVIOUS commit, while the filesystem lights see the working tree (`.githooks/pre-commit:2-7`) |

## RUNNER BY KIND (`verify:` is derived from `kind:` by spec-gate — never typed by hand)

| kind | test file | fast loop | verdict of record | `verify:` |
|---|---|---|---|---|
| `core` | `packages/core/test/CHQ-<nnn>/S<n>_<slug>.test.ts` | row 3 with `-p packages/core/tsconfig.json`, then row 4 with `--project core` | row 6 + row 7 `--kind core`, **and** a green `L-env-parity` (the same files under `--project core-dom`, `vitest.config.ts:28-35`) | `tsc-noemit + vitest-core` |
| `api` | `apps/api/test/CHQ-<nnn>/S<n>_<slug>.test.ts` | the same with `-p apps/api/tsconfig.json`, `--project api` | row 6 + row 7 `--kind api` | `tsc-noemit + vitest-api` |
| `web` | `apps/web/test/CHQ-<nnn>/S<n>_<slug>.test.tsx` | the same with `-p apps/web/tsconfig.json`, `--project web` | row 6 + row 7 `--kind web` | `tsc-noemit + vitest-web` |
| `e2e` | `e2e/CHQ-<nnn>/S<n>_<slug>.spec.ts` | there is no honest fast loop | row 8 — and CANNOT VERIFY until `BROWSER_PROBE=pass` | `playwright-chromium` |

A `kind` name IS the Vitest project name (`vitest.config.ts:20,31,39,47`): one chain from file path
to kind to project to artifact, with no registry in the middle to drift. `verify:` names the RUNNER
only — no versions, no paths, no machine state — and spec-gate compares it character for character
with what it derives. Whether an `e2e` test may be written is decided by reading `BROWSER_PROBE` in
THIS session, never from a field in the spec.

`kind: api` has no fast loop through a live server: a `curl` against `pnpm dev:api` is an advisory
read of a process nothing pinned. The honest fast loop for `api` is Fastify's in-process injection
inside the `api` project (`fastify` at `apps/api/package.json:9`; no app exists yet —
`apps/api/src/index.ts:1-7` is a marker), which is why `api` tests are ordinary Vitest files and not
a lane of their own.

## NEVER

- Trust an exit code as a verdict, or **pipe the output of the tool you are judging** — measured
  twice: `| head` returned 0 over a real failure (m).
- Call anything green that produced no artifact, or `tests="0"` / an all-skipped suite anything but
  CANNOT VERIFY.
- `--passWithNoTests` (the wrapper passes `=false`; its absence from `vitest.config.ts:9-11` is
  deliberate (d)). `--watch` for a verdict. `--retry` above 0.
- `-t` as proof: it may only narrow a run you then check case by case against the enumerator's count.
- `toMatchSnapshot` / `toMatchInlineSnapshot` / `-u` in a spec test: a missing snapshot is WRITTEN on
  first run and is green forever after, and `-u` silently rebases the assertion onto current
  behaviour.
- `@ts-expect-error`, `@ts-nocheck`, `as any` or `skipLibCheck` as a way past a diagnostic: those are
  the diagnostics red-check classifies by.
- A file-level `// oxlint-disable <rule>` naming a boundary rule. (Measured: only the FILE-level form
  suppresses a type-aware rule; `-disable-next-line` does not suppress one. Its effect on non-type
  rules is UNVERIFIED (m, 2026-11-01).)
- Edit `pnpm-lock.yaml`, a `tsconfig`'s `include`, or `.oxlintrc.jsonc`'s `ignorePatterns` to make a
  gate go green. Each is a declared surface; narrowing one is how a gate stops checking.
- `git commit --no-verify`; `CHEQ_SKIP_HOOKS=1` for anything other than a once-off the human asked
  for, and never for a `pending implementation` warning the hook already tolerates.
- Quote a seconds figure as a budget. There is no calibration record in this repository.
- Write `.ci/probe.json` by hand — `gate-probes` is its only author.

## HOW TO READ — one reader per format, in `tools/gates/lib/`

Use the module, never an ad-hoc parse in a session; a format with two readers has two verdicts.
When a reader module is absent, the verdict is CANNOT VERIFY — do not substitute your own grep.

- **`junit-xml.mjs`** — `<testsuites tests failures errors time>`, `<testsuite name tests failures
  errors skipped>`, `<testcase classname name time>` with an optional `<failure message type>` or
  `<skipped/>` (m). In this repository `testsuite name` and `testcase classname` are the
  REPO-relative file path, and `name` is `"<describe> > <test>"` (m). Rules: no file ⇒ CANNOT
  VERIFY · `tests="0"` ⇒ CANNOT VERIFY · a suite whose `skipped` equals its `tests` ⇒ CANNOT VERIFY
  (that is the missed-filter shape) · a `classname` outside the expected files ⇒ CANNOT VERIFY ·
  a `name` that is a FILE PATH rather than a `>`-joined case name ⇒ the COLLECTION failed, not the
  case. That last one is `classname.endsWith(name)`, **not** equality: for a project with a `root`,
  the failed-collection `name` is the path relative to the PROJECT root while `classname` is
  repo-relative (m: `name="test/…/c_module.test.ts"` against
  `classname="packages/core/test/…/c_module.test.ts"`).
- **The three reasons a case is red** (ADR-0005; m, 2026-11-01, planted in one run and removed
  again) — this is the mechanic red-check classifies with:

  | why it is red | `<failure type>` | message | `testcase name` |
  |---|---|---|---|
  | honest assertion | `AssertionError` | `expected '@cheq/core' to be '@cheq/nope' // Object.is equality` | the case's own name |
  | the symbol is not written yet | `TypeError` | `completeTask is not a function` | the case's own name |
  | the module is not written yet | `Error` | `Cannot find module '…' imported from …` | **the file path** — collection never reached the case |

  Only the first is assertion-red. The other two are PENDING IMPLEMENTATION: a weaker verdict that
  must be labelled, never a proof that the assertion can fail.
- **`vitest-json.mjs`** — the second channel: `numTotalTests`, `numPassedTests`, `numFailedTests`,
  `numPendingTests`, `numTodoTests`, `numTotalTestSuites`, plus `testResults[]` with
  `{name, status, message, assertionResults[]}` (m). Counters disagreeing with the XML ⇒ CANNOT
  VERIFY — **with one measured exception that is the normal state of the test phase**: a file that
  failed to COLLECT contributes one synthetic `<testcase>` to the XML but ZERO `assertionResults` to
  the JSON, so `tests` exceeds `numTotalTests` by exactly the number of such files (m, 2026-11-01:
  XML `tests="20"` against `numTotalTests=19` with one unresolvable import). The JSON's shape for
  that file is `status: "failed"`, `assertionResults: []`, `message` holding the
  `Cannot find module …` text. Any OTHER difference between the two channels is CANNOT VERIFY. A
  reader that demands bare equality would call every pending-implementation run unverifiable.
- **`tsc-log.mjs`** — `path(line,col): error TSxxxx: msg`, deduped by `path|line|col|code` (m).
  GREEN needs zero diagnostics **and** `filesChecked > 0`. Measured for `packages/core`: 92 paths
  from `--listFiles`, 5 of them under `packages/core`, the rest `lib.*.d.ts` (m) — so the count that
  means anything is the one restricted to the package, compared against `git ls-files`.
- **`oxlint-json.mjs`** — `number_of_files` is the linted-file count (`0` ⇒ CANNOT VERIFY); `code`
  has the form `plugin(rule-name)`, not `plugin/rule-name`; `severity` is `"error"` or `"warning"`
  and there is NO total field — count `diagnostics`; line and column live in
  `labels[].span.line/column` (m). `--format=junit` exists and is deliberately unused, so that a
  JUnit XML under `.ci/` means a test run and nothing else.
- **`probe.mjs`** — the only reader of `.ci/probe.json`.

## WHERE THINGS LAND

`.ci/runs/<ts>-<label>/` per run of record — `<kind>.junit.xml`, `<kind>.json`, `tsc.<kind>.log`,
`oxlint.json`, `run.json` (argv including `--type-aware`, the captured exit code, seconds, HEAD).
`.ci/tests/<kind>.junit.xml` is the fast lane's own dump. `.ci/probe.json` holds the probe record.
`.vitest/` is Vitest's own output directory and is read by no gate (`vitest.config.ts:3-7` (d)).
All of `.ci/` and `.vitest/` is gitignored (`.gitignore:10,25`), so a `green:` trailer names a path
that exists on this machine only — `ready.mjs` prints `(artifact present)` or `(ARTIFACT MISSING)`
beside each trailer rather than assuming.

A run directory is never reused: a crashed run that overwrote nothing leaves the PREVIOUS artifact
in place, and a gate would read last week's green as its own.

## HOW TO

- **Re-observe a measurement** instead of quoting it: every `(m)` above carries the command. After
  any dependency change, re-observe rather than trust — the measurements are dated for that reason.
- **Read a config that `extends`**: `node tools/gates/project.mjs config <pkg>`, never the file.
- **Run one spec file**: row 4 with the file path. To narrow further inside it, add `-t` AND check
  the resulting case count against the enumerator — `-t` alone proves nothing.
- **Find out why a core test cannot see something**: `packages/core/package.json:7` declares
  `dependencies: {}` and `.npmrc:4` pins `node-linker=isolated`, so the package has no
  `node_modules` and an undeclared package import does not resolve. A RELATIVE path out of the
  package resolves fine and `tsc` says nothing about it (m, 2026-11-01) — that hole is closed by
  `L-core-purity` walking the import graph (its level 2), by nothing else.

## HONEST LIMITS TODAY

- `kind: e2e` has never run here: the browsers are not installed and `BROWSER_PROBE` is read, never
  assumed. No pixel fact is verifiable in this repository today.
- No calibration lane exists, so **no seconds figure is a budget** and the pre-commit target is an
  intention, not a check.
- `oxlint` does not report `require-await`; `typescript/ban-ts-comment` parses but did not fire on
  `// @ts-expect-error nope` (m, 2026-11-01), so the ban on `@ts-expect-error` / `@ts-nocheck` /
  `as any` in spec tests is carried by a token scan in `L-testshape`, not by the linter.
- The effect of `// oxlint-disable-next-line` on NON-type-aware rules is UNVERIFIED.
- Whether a run of record is sound while a watcher holds the tree is UNVERIFIED — hence the
  `WATCHERS` flag and the refusal, rather than a measurement.
- Machine state is not written in this file: `node tools/gates/status.mjs` prints it (ADR-0003).
