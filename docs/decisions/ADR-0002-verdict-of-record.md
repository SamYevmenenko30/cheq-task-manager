# ADR-0002: The verdict of record is an artifact on disk; an exit code is advisory, and "did not run" is a third verdict

**Status:** Accepted · **Date:** 2026-11-01 · amended the same day on three measurements: the
collection-failure signature is a SUFFIX, not an equality (the first reading here was wrong); a
missing symbol reaches the artifact as `ReferenceError` as well as `TypeError`, so item 5 names four
forms; and the JSON channel's behaviour on a collection failure is no longer unverified. What is
decided — a verdict is read from an artifact named before the run, and the weaker forms are
labelled rather than promoted — is unchanged.

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
rule was skipped. The same class of silence is why `passWithNoTests` is never set in
`vitest.config.ts` and its absence is documented there as part of the verdict
(`vitest.config.ts:9-11`), and why a JSON lint artifact is read for `number_of_files` — measured
shape `{diagnostics, number_of_files, number_of_rules, threads_count, start_time}`, with
`number_of_files: 1` on a one-file run (2026-11-01).

**Vitest will not tell a gate where it put the report unless the gate names it.** Measured during
setup: `outputFile` inside a `projects` entry is IGNORED and the reports land in Vitest's own
`.vitest/` (gitignored at `.gitignore:25`). The artifact is therefore requested on the command line
by the wrapper, which means the gate names the file it will read before the run starts.

**The JUnit XML distinguishes the reasons a test is red** (measured from planted probes):
`<failure type="AssertionError">` with an `expected … to be …` message is an honest assertion;
`type="TypeError"` with `… is not a function` means the export is not written yet;
`type="ReferenceError"` with `… is not defined` means the identifier was never declared — the same
defect by the other road, and the commonest shape of the test phase; `type="Error"` with
`Cannot find module …` on a testcase that names its FILE means collection never reached the case.
The first is proven-red; the others are PENDING IMPLEMENTATION. The XML also carries
`<testsuites tests failures errors time>`, so `tests="0"` is distinguishable from a real run.

**"Names its FILE" is a suffix, not an equality** — and the first reading of it here was wrong.
Measured: on a collection failure both attributes carry the same file in two spellings, `classname`
from the repository root and `name` from that project's own `root`
(`classname="packages/core/test/__v/b.test.ts" name="test/__v/b.test.ts"`). So `name === classname`
is false, `name === basename(classname)` is false, and the predicate that fires is
`classname.endsWith('/' + name)` (`tools/gates/lib/junit-xml.mjs:219-246`). With the roots this
repository configures (`vitest.config.ts:21,32,40,48`) an equality would never fire at all, and a
file that never parsed would be read as an ordinary red case.

**One lane has no artifact at all.** `playwright.config.ts` is committed and points `testDir` at
`./e2e` (`playwright.config.ts:10`), which does not exist, and the browser build this Playwright
pins is not installed (TD-0001, measured). A lane with no artifact must answer CANNOT VERIFY, and the
config says so in its own header (`playwright.config.ts:3-5`).

## Decision

1. **Every spec assertion names its kind** — `core | api | web | e2e` — and `verify:` names the
   RUNNER only: `vitest-core`, `vitest-api`, `vitest-web`, `playwright-chromium`. It never carries a
   machine-local word (no `pending-calibration` suffix, no version, no seconds), because a spec is
   committed and machine state is not (ADR-0003). A sentence no runner can falsify is not an
   assertion: it is Syrup (quoted verbatim, never blocking) or a question (blocking).

2. **Verdicts are read from artifacts, named before the run.** A run of record writes into its own
   directory `.ci/runs/<ts>-<label>/`, never reused, and the directory carries `run.json` with the
   head commit, whether the tracked tree was clean, the full `argv` (including `--type-aware`) and
   the captured `exitCode`. The artifacts:

   | lane | artifact | read for |
   |---|---|---|
   | types | `tsc.<kind>.log` (`tsc --pretty false`), plus `tsc --showConfig` | `path(line,col): error TSxxxx` diagnostics; the options the compiler actually used |
   | tests | `<kind>.junit.xml` | `<testsuites tests failures errors>`, per `<testcase>`, `<failure type>` |
   | tests, second channel | `<kind>.json` | counter cross-check only; a disagreement with the XML is CANNOT VERIFY, never a tie-break |
   | lint | `oxlint.json` (`--format=json`) | `number_of_files`, `diagnostics[].code` of the form `plugin(rule-name)` |
   | e2e | `e2e.junit.xml` + `e2e.json` (`playwright.config.ts:13-16`) | as tests — and only once `browser_probe: "pass"` exists |

3. **The exit code is captured, not believed, and never measured through a pipe.** The wrapper
   captures the judged tool's own status and writes it to `run.json`; no gate puts the judged tool on
   the left of a `|`. An exit code may contradict the artifact — then the artifact wins and the
   contradiction is printed.

4. **A missing artifact is CANNOT VERIFY — never green and never red.** So are: `tests="0"` while the
   project's sources contain at least one test; a `<testcase>` from a file outside the lane's expected
   glob; `number_of_files === 0` from the linter; a run whose `argv` lacks `--type-aware`; a lane
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
   worktree was never installed.

6. **The advisory lane is advisory.** A watch-mode `vitest`, a `vite` dev server (`package.json:28-29`),
   the editor's own language service, `vitest list --json`, and any lint run without `--type-aware` may
   accelerate the loop. No gate reads them, no `green:` trailer cites them, and no claim in a document
   rests on them. `tools/gates/status.mjs` reports a running watcher as `mode=watcher-running(UNVERIFIED)`
   rather than pretending the tree is quiet.

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
- Costs: every lane needs a directory and a `run.json`, so the fast inner loop (`vitest --watch`) is
  structurally not a verdict and the loop has two speeds. The e2e lane answers CANNOT VERIFY until
  somebody runs a probe (TD-0001).
- What was UNVERIFIED and is now measured: the Vitest **JSON** reporter's output on a collection
  failure. A file that never loaded is a record with `status: "failed"`, no `assertionResults` and a
  message, and its cases are **absent** from `numTotalTests` — so the two channels reconcile through
  three identities that count the collection failures explicitly (`tests === numTotalTests + cf`,
  `failures === numFailedTests + cf`, `skipped === numPendingTests + numTodoTests`), recorded at
  `tools/gates/lib/vitest-json.mjs:165-175` and observed agreeing on a green and on a red run.
  This does NOT promote the channel: row three of item 2 stands unchanged, because a raw
  `tests === numTotalTests` would now fail on exactly the runs the test phase consists of, and
  because `crossCheck` answers only "do the two channels describe the same run?" — it returns
  `agree: true | false` with `verdict: 'agree' | 'cannot-verify'`, deliberately not a `verdict` field
  that could hold `'green'` and be read as a test result (`vitest-json.mjs:179-187`).
- What stays UNVERIFIED: the cross-check **as a gate**. No gate reads it yet, and no fixture has made
  the two channels disagree on purpose, so "they agreed" has only ever been observed where agreement
  was the expected answer (TD-0005). `tsc --showConfig` and `tsc --noEmit --listFiles` ARE measured
  working on 7.0.2 (2026-11-01, exit 0; see ADR-0005).
- Changing any row of item 2, or the classification in item 5, is a `gate:` commit amending this ADR:
  the artifact a gate reads is the contract between the gate and the person reading its output.
