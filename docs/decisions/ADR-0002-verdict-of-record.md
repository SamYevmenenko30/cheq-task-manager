# ADR-0002: The verdict of record is an artifact on disk; an exit code is advisory, and "did not run" is a third verdict

**Status:** Accepted · **Date:** 2026-11-01 · amended the same day on three measurements: the
collection-failure signature is a SUFFIX, not an equality (the first reading here was wrong); a
missing symbol reaches the artifact as `ReferenceError` as well as `TypeError`, so item 5 names four
forms; and the JSON channel's behaviour on a collection failure is no longer unverified. What is
decided — a verdict is read from an artifact named before the run, and the weaker forms are
labelled rather than promoted — is unchanged.

**Amended 2026-11-02, on the runner change.** The test runner of record is now Jest
(`jest.config.mjs`), and nothing that was DECIDED here moved: a verdict is still read from an artifact
this repository named before the run started, and an exit code is still evidence. What changed is the
PRODUCER of the artifact — and it brought one addition that belongs in the decision rather than in a
footnote: **half of the artifact contract now lives in the child's ENVIRONMENT**, not in its argv, so
the record of a run has to carry what the wrapper put there as well as what it typed (item 2). Every
figure and signature measured on the PREVIOUS runner keeps its own date below and is not re-attributed
to this one.

## Context

**An exit code lied twice while this repository was being set up, and lies again on demand.**
Re-observed 2026-11-01, in this repository, as two commands differing only by a pipe:

```
$ pnpm exec tsc --noEmit -p nosuch/tsconfig.json >/dev/null 2>&1 ; echo $?
1
$ pnpm exec tsc --noEmit -p nosuch/tsconfig.json 2>&1 | head -2 ; echo $?
error TS5058: The specified path does not exist: '…/cheq-task-manager/nosuch/tsconfig.json'.
0
```

The second `0` is `head`'s. The same shape produced two false greens during setup (recorded
2026-11-01, not re-observed here): `eslint … | head` reported `exit=0` while eslint had crashed with
2, and `tsc … | head -12` reported `exit=0` over four `error TS6059`. A gate that pipes the output of
the tool it is judging measures the pipe.

**A tool can succeed at doing nothing.** Measured 2026-11-01: `oxlint` with the rule
`typescript/require-await` enabled but WITHOUT `--type-aware` printed nothing and exited 0; with the
flag it printed `error typescript(require-await)` and exited 1. Nothing in the first run says a type
rule was skipped. The same class of silence is why a JSON lint artifact is read for
`number_of_files` — measured shape
`{diagnostics, number_of_files, number_of_rules, threads_count, start_time}`, with
`number_of_files: 1` on a one-file run (2026-11-01).

**The test runner does it too, and there is no flag to add.** Measured 2026-11-02 on the `core`
project with a `-t` pattern matching no case: exit **0**, `success: true`, `numTotalTests: 17`,
`numPassedTests: 0`, `numPendingTests: 17`. Every case is reported pending and the run calls itself a
success. `--passWithNoTests` does not catch it, because it governs whether test FILES were found and
they were. So the guard cannot be a flag; it has to be in the READER, and it is: a report in which
`passed + failed` is zero is CANNOT VERIFY, since a run that executed no case says nothing about the
code (`readJestJson`, `tools/gates/lib/jest-json.mjs:167-174`).

**The runner will not tell a gate where it put the report unless the gate names it — and half the
naming is not on the command line.** Measured 2026-11-02: `jest-junit` is declared in
`jest.config.mjs` with **no** `outputFile`, so it takes its path from the environment variable
`JEST_JUNIT_OUTPUT_FILE`; run without that variable, the reporter writes `junit.xml` into the current
directory — one file every run overwrites. And the dotted form `--outputFile.json=<path>`, which was
the previous runner's REQUIRED way of asking for a second channel, is now accepted **silently**:
measured, the parser takes it without a word, runs every test and writes NO FILE. That is worse than
the crash it used to cause, because the run looks complete — full console output, an exit code that
came from the tests, and no artifact to be judged from. One bare `--outputFile=<path>` plus the
environment variable is the only form that yields both channels, which is why exactly one place in
this repository builds a runner's command line (`tools/gates/run.mjs`) and why what it added to the
child's environment is part of the record.

**The JUnit XML distinguishes the reasons a test is red** (measured 2026-11-01 from planted probes,
on the runner of that day): `<failure type="AssertionError">` with an `expected … to be …` message is
an honest assertion; `type="TypeError"` with `… is not a function` means the export is not written
yet; `type="ReferenceError"` with `… is not defined` means the identifier was never declared — the
same defect by the other road, and the commonest shape of the test phase; `type="Error"` with
`Cannot find module …` on a testcase that names its FILE means collection never reached the case.
The first is proven-red; the others are PENDING IMPLEMENTATION. The XML also carries
`<testsuites tests failures errors time>`, so `tests="0"` is distinguishable from a real run.

**The new producer writes the same FORMAT, and that is not an accident.** `jest-junit` is configured
with `classNameTemplate: '{filepath}'`, `titleTemplate: '{classname} > {title}'`,
`ancestorSeparator: ' > '` and `suiteNameTemplate: '{filepath}'` (`jest.config.mjs`), which reproduces
`<testcase classname="<repo-relative file path>" name="<describe> > <test>">` exactly — measured
2026-11-02, and every reader in `tools/gates/lib` parsed the new producer's file with no change,
because what those modules know is the format and not the tool. Those four template lines are
therefore load-bearing: changing one changes the artifact this ADR's table is about.

**How a RED case is spelled inside that shape is a different question, and it is UNVERIFIED here.**
The closed set a reader accepts as an honest assertion is still the one measured on 2026-11-01
(`ASSERTION_TYPES` at `tools/gates/lib/junit-xml.mjs:63`). The four defects were planted again and
their artifacts captured verbatim (`tools/gates/fixtures/jest/`, with its own index), but item 5's
classification has not been re-derived from those bytes, and the measurement of record behind this
prose does not carry the result — so this ADR states no `<failure type>` string for the current
producer. The direction of the risk is the safe one: a closed set that no longer matches yields
`unknown` ⇒ CANNOT VERIFY, never green. The cost is that "proven-red" currently rests on a
measurement of a tool that no longer writes the artifact, and that is written down rather than
assumed (TD-0004).

**"Names its FILE" is a suffix, not an equality** — and the first reading of it here was wrong.
Measured 2026-11-01: on a collection failure both attributes carry the same file in two spellings,
`classname` from the repository root and `name` from that project's own `rootDir`
(`classname="packages/core/test/__v/b.test.ts" name="test/__v/b.test.ts"`). So `name === classname`
is false, `name === basename(classname)` is false, and the predicate that fires is
`classname.endsWith('/' + name)` (`tools/gates/lib/junit-xml.mjs:219-246`). With the per-project
roots this repository configures (`jest.config.mjs:89,96,103,110`) an equality would never fire at
all, and a file that never parsed would be read as an ordinary red case. The predicate therefore
accepts three spellings rather than one, and that width is the point: whether the CURRENT producer
emits such a synthetic case at all, and in which spelling, is UNVERIFIED in this ADR — the
measurement of record behind this prose does not cover it, and the captured artifacts under
`tools/gates/fixtures/jest/` are where a re-derivation would read it from. A predicate wider than the
artifact fails closed; one narrower than it reads a file that never parsed as a red case.

**One lane has no artifact at all.** `playwright.config.ts` is committed and points `testDir` at
`./e2e` (`playwright.config.ts:10`), which does not exist, and the browser build this Playwright
pins is not installed (TD-0001, measured). A lane with no artifact must answer CANNOT VERIFY, and the
config says so in its own header (`playwright.config.ts:3-5`).

## Decision

1. **Every spec assertion names its kind** — `core | api | web | e2e` — and `verify:` names the
   RUNNERS only: `tsc-noemit + jest-core`, `tsc-noemit + jest-api`, `tsc-noemit + jest-web`,
   `playwright-chromium` — derived from the kind and never typed (`deriveVerify`,
   `tools/gates/lib/spec-parse.mjs:96`). Two halves, because the runner does not typecheck and the
   test lane therefore runs both on every run of record (item 2, TD-0004). It never carries a
   machine-local word (no `pending-calibration` suffix, no version, no seconds), because a spec is
   committed and machine state is not (ADR-0003). A sentence no runner can falsify is not an
   assertion: it is Syrup (quoted verbatim, never blocking) or a question (blocking).

2. **Verdicts are read from artifacts, named before the run.** A run of record writes into its own
   directory `.ci/runs/<ts>-<label>/`, never reused, and the directory carries `run.json` with the
   head commit, whether the tracked tree was clean, the full `argv` (including `--type-aware`), the
   captured `exitCode` — and, since 2026-11-02, **what the wrapper added to the child's environment,
   as `envExtra`**. The environment field is the addition the runner change forced: an argv alone no
   longer says where a run put its JUnit report, so `L-artifacts` judges `envExtra` against its
   `REQUIRED_ENV` table exactly as it judges the argv
   (`tools/gates/lights/artifacts.mjs:171`). The artifacts:

   | lane | artifact | read for |
   |---|---|---|
   | types | `tsc.<kind>.log` (`tsc --pretty false`), plus `tsc --showConfig` | `path(line,col): error TSxxxx` diagnostics; the options the compiler actually used |
   | tests | `<kind>.junit.xml` — path from `JEST_JUNIT_OUTPUT_FILE`, not from a flag | `<testsuites tests failures errors>`, per `<testcase>`, `<failure type>` |
   | tests, second channel | `<kind>.json` — one BARE `--outputFile=<path>`, never the dotted form | counter cross-check only; a disagreement with the XML is CANNOT VERIFY, never a tie-break |
   | lint | `oxlint.json` (`--format=json`) | `number_of_files`, `diagnostics[].code` of the form `plugin(rule-name)` |
   | e2e | `e2e.junit.xml`, routed by `PLAYWRIGHT_JUNIT_OUTPUT_NAME` | as tests — and only once `browser_probe: "pass"` exists. This lane declares ONE reporter (`playwright.config.ts:20-26`), so row three has no counterpart here, and that asymmetry is a limit of the lane rather than something to paper over |

3. **The exit code is captured, not believed, and never measured through a pipe.** The wrapper
   captures the judged tool's own status and writes it to `run.json`; no gate puts the judged tool on
   the left of a `|`. An exit code may contradict the artifact — then the artifact wins and the
   contradiction is printed.

4. **A missing artifact is CANNOT VERIFY — never green and never red.** So are: `tests="0"` while the
   project's sources contain at least one test; a report in which cases were collected but
   `passed + failed` is **zero**, which is what a filter that matched nothing looks like from the
   outside (measured 2026-11-02; the run exits 0 and calls itself a success); a `<testcase>` from a
   file outside the lane's expected glob; `number_of_files === 0` from the linter; a run whose `argv`
   lacks `--type-aware`, or whose `envExtra` lacks the variable that steered its JUnit report; a lane
   whose runtime precondition is absent. A project whose SOURCES carry no test at all is `n/a` — decided
   from the sources, never from the XML — and is not launched; `n/a` and CANNOT VERIFY are different
   words and the block prints whichever is true.

5. **Red is classified from the artifact, not from redness.** `red-check` accepts a test as proven-red
   only when `<failure type>` is an assertion type AND the `testcase name` equals the declared case
   name. Four measured forms are PENDING IMPLEMENTATION instead — a weaker verdict, printed as such,
   re-proved once the implementation lands: `TypeError: … is not a function` (the export is missing),
   `ReferenceError: … is not defined` (the identifier was never declared), `Error: Cannot find
   module …`, and a testcase that names its file rather than a case. A fifth form is not about the
   code under test and is CANNOT VERIFY, never pending: `Error: Cannot find package …` means the
   worktree was never installed. The four forms are the 2026-11-01 measurement; what the current
   producer writes in `<failure type>` has not been re-measured, and the Context above says so
   plainly rather than letting the classifier look newer than its evidence.

6. **The advisory lane is advisory.** A watch-mode run of the test runner, a `vite` dev server
   (`package.json:48-49`), the editor's own language service, the runner's own collection listing
   (`jest --selectProjects <kind> --listTests --json`, which prints absolute FILE paths and not one
   per-case record), and any lint run without `--type-aware` may accelerate the loop. No gate reads
   them, no `green:` trailer cites them, and no claim in a document rests on them.
   `tools/gates/status.mjs` prints a `WATCHERS` flag naming every live one, and `tools/gates/run.mjs`
   REFUSES to start while one is alive (`WATCHER_PATTERN`, `tools/gates/run.mjs:379`): a dev server
   re-transforming the same files mid-run is shared state, not a quiet tree.

7. **`.ci/probe.json` is a precondition, not a cache.** It is written ONLY by
   `node tools/gates/gate-probes.mjs --real`, after a deliberately bad fixture was OBSERVED failing and a
   deliberately good one passing, and it is read ONLY through `tools/gates/lib/probe.mjs`. It is gitignored
   with the rest of `.ci/` (`.gitignore:9-10`). Every light that has a probe reads `observed: true` or
   answers CANNOT VERIFY **naming the missing precondition** (ADR-0003, TD-0002).

8. **Approval is a commit trailer**: `spec-approved: <name> <YYYY-MM-DD>` beginning a line of a commit
   after the spec's last content change. Not a header, not a label, not a field in the spec — a trailer,
   because a trailer is in the history and a field in the file can be edited after signing.

## Consequences

- Gains: a `green:` trailer always points at a file under `.ci/runs/<ts>-<label>/` that a human can
  open; a zero-test run can never pass; a type error can never be mistaken for a red test; a lane that
  cannot run says which precondition is missing instead of reporting success over nothing.
- Costs: every lane needs a directory and a `run.json`, so the fast inner loop — a watch-mode run of
  the runner — is structurally not a verdict and the loop has two speeds. The e2e lane answers CANNOT VERIFY until
  somebody runs a probe (TD-0001).
- What was UNVERIFIED and is now measured (2026-11-01, on the previous producer): the **JSON**
  channel's output on a collection failure. A file that never loaded is a record with
  `status: "failed"`, no `assertionResults` and a message, and its cases are **absent** from
  `numTotalTests` — so the two channels reconcile through three identities that count the collection
  failures explicitly (`tests === numTotalTests + cf`, `failures === numFailedTests + cf`,
  `skipped === numPendingTests + numTodoTests`), recorded at
  `tools/gates/lib/jest-json.mjs:198-203` and observed agreeing on a green and on a red run.
  This does NOT promote the channel: row three of item 2 stands unchanged, because a raw
  `tests === numTotalTests` would now fail on exactly the runs the test phase consists of, and
  because `crossCheck` answers only "do the two channels describe the same run?" — it returns
  `agree: true | false` with `verdict: 'agree' | 'cannot-verify'`, deliberately not a `verdict` field
  that could hold `'green'` and be read as a test result
  (`crossCheck`, `tools/gates/lib/jest-json.mjs:222`).
- What the runner change did to that channel: nothing the reader had to learn. Measured 2026-11-02,
  the JSON report carries the same field names it already used — `numTotalTests` / `numPassedTests` /
  `numFailedTests` / `numPendingTests` / `numTodoTests`, and per file
  `{ name (ABSOLUTE path), status, message, assertionResults: [{ ancestorTitles, fullName, title,
  status, … }] }`. **One cross-channel difference is measured and matters:** the JSON's `fullName`
  joins its ancestors with a SPACE while the XML's `name` joins them with `' > '` (this repository's
  `ancestorSeparator`), so a case name taken from one channel is not a key in the other. That is
  survivable only because `crossCheck` compares COUNTS; a cross-check written on names would have
  disagreed on every case of every run.
- What stays UNVERIFIED: the cross-check **as a gate**. No gate reads it yet, and no fixture has made
  the two channels disagree on purpose, so "they agreed" has only ever been observed where agreement
  was the expected answer (TD-0005). `tsc --showConfig` and `tsc --noEmit --listFiles` ARE measured
  working on 7.0.2 (2026-11-01, exit 0; see ADR-0005).
- Changing any row of item 2, or the classification in item 5, is a `gate:` commit amending this ADR:
  the artifact a gate reads is the contract between the gate and the person reading its output.
