# The agent ⟷ toolchain loop

How an agent gets fast, truthful feedback from this repository: which command to run, what it reads
back, and what it must not trust. The stack is node 22, pnpm 9, TypeScript 7 (the native compiler),
Jest 30 with the `@swc/jest` transform, and oxlint — one type engine, four test projects, one wrapper
that writes the artifacts a verdict is read from.

**In this stack the danger is the opposite of a noisy tool: a successful `tsc` prints NOTHING.**
Silence looks exactly like green, and so does a run that never happened. Therefore: *silence is not
a marker — the wrapper writes its own*, and every reader needs a positive sign that the tool really
read something (`filesChecked > 0`, `tests > 0`, `number_of_files > 0`, and for the test runner
`passed + failed > 0`, because a filter that matched no case exits 0 and calls itself a success)
before it may say green.
A missing artifact is CANNOT VERIFY, never green (ADR-0002 in [docs/decisions/](../decisions/)).

Provenance marks, used on every fact below:

- **(m)** — measured on this Mac with the command named. Two dates matter and they are never merged:
  **2026-11-02** is the runner of record, and **2026-11-01** is the stack as it stood before the
  runner changed. A dated 2026-11-01 measurement of the PREVIOUS runner is kept where it explains why
  something is built the way it is, marked `(m, previous runner)`, and it is never re-dated to look
  like a measurement of this one. Where the artifact survives, its path is given; those under `.ci/`
  are gitignored (`.gitignore:10`) and will not exist in a fresh clone, which is why the shapes are
  transcribed here instead of linked.
- **(d)** — documented: a `path:line` in this repository, or a URL.
- **UNVERIFIED** — nobody has seen it on this machine. Part 4 lists these.

No figure here is a budget. A seconds figure describes ONE run on one tree; there is no calibration
record in this repository and therefore nothing may be promised (TD-0002, indexed in
[docs/tech-debt/README.md](../tech-debt/README.md) — every TD id below is listed there).

Pre-flight, every session: `node tools/gates/status.mjs` — one call, flat flags, each line with its
source. The flags are READ, never assumed, and nothing else in this repository may restate them
(machine state has one source: ADR-0003, named at `.gitignore:9`). What each one PERMITS:

| flag | false / absent means |
|---|---|
| `CI_TREE_READY` | no run of record at all — the ci worktree is missing or its install failed |
| `WATCHERS` > 0 | a run of record in the main checkout is FORBIDDEN (a watcher shares state with it); advisory reads are labelled `mode=watcher-running(UNVERIFIED)` |
| `BROWSER_PROBE=absent` | `kind: e2e` gets no test, no run and no `green:` — the lane is CANNOT VERIFY (TD-0001; `playwright.config.ts:3-5`) |
| `LOCKFILE_CLEAN=false` | `--record` refuses: a run pinned to a tree whose dependency graph is uncommitted proves nothing |
| `JEST=unavailable` | the runner of record is not in `node_modules/.bin` — this checkout is not installed, and a global `jest` on PATH would be a different engine than the lock names. `status.mjs` prints the premise under this key (`tools/gates/status.mjs:77`) |

`status.mjs` prints `NODE`, `PNPM`, the four tool premises (`TSC`, `OXLINT`, `TSGOLINT`, `JEST`),
`LOCKFILE_CLEAN`, `INSTALLED_LOCK`, `TREE_CLEAN`, `WATCHERS`, `CI_LOCK`, `CI_TREE_READY`,
`BROWSER_PROBE`, `GENERATED_FRESH` and `BUDGETS`. It does **not** report whether the pre-commit hook
is installed — that is UNVERIFIED from the pre-flight, so check `git config core.hooksPath` by hand
if a commit went through suspiciously fast. The script names in the table below are the ones
`package.json:31-49` already binds; where a gate's actual output disagrees with this file, **the gate
is right and this file is the defect**, fixable in the same commit (AGENTS.md rule 12).

## Part 1 — the loop table

| # | step | command | reads back | must NOT trust |
|---|---|---|---|---|
| 1 | inspect the project as text | `node tools/gates/project.mjs packages \| config <pkg> \| exports <pkg> \| routes \| imports <file>`; generated projections under `docs/digests/` FIRST; `git log --oneline -20 -- <paths>` | the effective compiler options, the export surface, the import graph, route table — as `path:line` a spec may cite (AGENTS.md rule 4) | a digest as proof that the code typechecks; **`tsconfig.json` as TEXT** — `extends` hides the effective value, so quote `project.mjs config <pkg>`, which is the `tsc --showConfig` answer (m: `--showConfig -p packages/core/tsconfig.json` exits 0 and prints `lib: ["es2023"]`, `types: []` resolved) |
| 2 | edit | Write / Edit | — | that a file you added is in any project: step 3 or `L-orphans` says so |
| 3 | types, fast | `pnpm exec tsc --noEmit --pretty false -p <pkg>/tsconfig.json` | `path(line,col): error TSxxxx: msg` lines, one per diagnostic (m, 4 planted diagnostics in `.ci/probe-junit/tsc.bad.log`); nothing at all when clean (m: core exits 0 with 0 bytes of output) | anything about another package — each project is typechecked alone; anything the test runner will do at runtime (**the runner typechecks NOTHING** — `@swc/jest` strips types in Rust); exit 0 as "it read my files" — add `--listFiles` for that |
| 4 | tests, fast | `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --selectProjects <core\|core-dom\|api\|web> [<repo-relative path>]` — a positional argument is a REGEX over the test path, so it matches a path FRAGMENT: `…/test/skeleton` collected two files, and a pattern nobody wrote exited 1 and wrote a `tests="0"` report (m, recorded at `tools/gates/red-check.mjs:65-78`) | per-case pass/fail on the terminal | a green from a filter that matched nothing (step 4's biggest lie — Part 3); `-t` as an exact selector (it is an unanchored match over the full case name, `red-check.mjs:59-61`); this as a verdict of record; the run without `NODE_OPTIONS` — every test then dies with `Cannot use import statement outside a module`, which reads like a broken source and is not one |
| 5 | lint, fast | `pnpm exec oxlint --type-aware` | diagnostics with rule ids of the form `plugin(rule-name)` | a run WITHOUT `--type-aware`: the type-aware rules silently do not run (m: `number_of_rules` 243 with the flag, 211 without, same tree, both exit 0) ; lint as a verdict about types — it never is |
| 6 | dev server / IDE language service | `pnpm dev:web`, `pnpm dev:api` (`package.json:48-49`) | a running app, a browser console | as evidence, EVER: it is advisory. A watch artifact older than your edit is STALE, and a dev server resolves imports by Vite's rules, not the compiler's |
| 7 | types OF RECORD | `node tools/gates/run.mjs types --kind <core\|api\|web\|all>` (`package.json:42`) | `.ci/runs/<ts>-<label>/tsc.<kind>.log` + `run.json` (argv, exit code, seconds, head sha) | the exit code (Part 3: it lied); a clean log with no positive sign that files were read |
| 8 | tests OF RECORD | `node tools/gates/run.mjs test --kind <kind> --label <l>` (`package.json:43-45`) | `.ci/runs/<ts>-<label>/<kind>.junit.xml` + `<kind>.json` + `tsc.<kind>.log` + `run.json` — BOTH halves every time, because the runner does not typecheck | the exit code; `tests="0"`; a `<skipped/>` case; a case whose `classname` is outside the kind's project; `success: true` in the JSON (m: a run that executed no case prints exactly that); a `run.json` whose `envExtra` does not carry `JEST_JUNIT_OUTPUT_FILE` — half the artifact contract is in the environment |
| 9 | the browser lane | `node tools/gates/run.mjs e2e --label <l>` (`package.json:46`) | nothing yet — it refuses while `.ci/probe.json` lacks `browser_probe: "pass"` (`playwright.config.ts:3-5`) | any e2e claim at all: the browsers are not downloaded (m), so this lane is CANNOT VERIFY, never red and never green (TD-0001) |
| 10 | lint OF RECORD | `node tools/gates/run.mjs lint --label <l>` (`package.json:47`) | `.ci/runs/<ts>-<label>/oxlint.json` + `run.json` recording that `--type-aware` was in `argv` | a JSON file that did not parse — on a config error oxlint writes PLAIN TEXT to stdout (m, below) |
| 11 | gates | `node tools/gates/ready.mjs [--quick]` (`package.json:36-37`) | the verification block; `NOT READY` on any step ≠ 0 | a gate that did not run; a green a gate cannot explain; `--quick` as the check of record (it reads HEAD, not the index — `.githooks/pre-commit:2-7`) |

WHERE THINGS LAND: every run of record writes its own directory `.ci/runs/<ts>-<label>/`, never
reused, with `run.json` holding the exact argv, **the environment the wrapper added (`envExtra`)**,
the tool's own exit code, the seconds and the head sha. `.ci/` is gitignored (`.gitignore:10`), so a
`green:` trailer names a path that exists only on this machine, and `ready.mjs` prints
`(artifact present)` / `(ARTIFACT MISSING)` rather than assuming. The runner of record writes no
in-repo cache directory of its own; `--coverage` lands in `coverage/`, gitignored at
`.gitignore:11`, and no gate reads it.

RULES THE LOOP CARRIES: never pipe the output of the tool being judged (Part 3); capture the tool's
exit code on its own and treat it as advisory; ask for the JSON artifact by name with ONE bare
`--outputFile=<path>` and steer the JUnit one with `JEST_JUNIT_OUTPUT_FILE` — never the dotted
`--outputFile.<reporter>=` form, which this runner swallows in silence (Part 3); never
`--passWithNoTests`; never `--watch` or `-u` for a verdict, and `--ci` on every run of record so a
missing snapshot cannot be written into existence; never `git commit --no-verify`; one run of record
at a time (`.ci/lock`).

## Part 2 — how to read each artifact

One reader per format, under `tools/gates/lib/`. Nothing else parses these files.

### JUnit XML — `lib/junit-xml.mjs`

Shape, measured (m) from `.ci/runs/…/core.junit.xml` and the probe run in `.ci/probe-junit/out.junit.xml`:

```
<testsuites name="…" tests="17" failures="0" errors="0" time="0.035891882">
  <testsuite name="packages/core/test/skeleton/digest.test.ts" timestamp="…" hostname="…"
             tests="16" failures="0" errors="0" skipped="0" time="…">
    <testcase classname="packages/core/test/skeleton/digest.test.ts"
              name="sha256 against the published vectors &gt; hashes the empty string" time="…"/>
```

The file-path spelling of `name` and `classname` is NOT the reporter's default — it is bought by four
templates in the config, and they are load-bearing rather than cosmetic: `classNameTemplate:
'{filepath}'`, `titleTemplate: '{classname} > {title}'`, `ancestorSeparator: ' > '`,
`suiteNameTemplate: '{filepath}'` (`jest.config.mjs:75-78`). They reproduce the previous runner's
artifact shape exactly, which is why every reader in `tools/gates/lib` parses this file unchanged —
**the FORMAT is what those modules know, not the producer**. Delete a template and the `classname`
becomes the describe block, and every reader, every probe over them and the collection-failure
predicate all stop meaning what they say. The `<testsuites name>` attribute is the reporter's own and
no gate reads it.

- `classname` is the file path from the repository root; `name` is `"<describe> > <test>"`, joined by
  ` &gt; ` — the entity, not a literal `>`. Decode `&amp; &lt; &gt; &quot; &apos;` before comparing a
  name with a declared case name (m: a case named `fails an honest assertion <&>` came back as
  `probe &apos;assert&apos; &gt; fails an honest assertion &lt;&amp;&gt;`).
- **`<testsuites>` carries no `skipped` attribute — only each `<testsuite>` does.** So the passed
  count is `tests − failures − errors − Σ skipped`, never `tests − failures`
  (`tools/gates/lib/junit-xml.mjs:13`, `:159`).
- Verdict rules: file absent ⇒ CANNOT VERIFY · `tests="0"` ⇒ CANNOT VERIFY · a `classname` outside
  the kind's own project ⇒ CANNOT VERIFY (foreign project) · any `<skipped/>` among the cases a spec
  declared ⇒ CANNOT VERIFY · otherwise green/red from `failures`/`errors`.
- **Four `<failure type>` signatures, each planted and read back (m, previous runner, 2026-11-01)**:
  `AssertionError` — an honest assertion, the only one that is proof · `TypeError` +
  `… is not a function` — the module is there and the export is not · `ReferenceError` +
  `… is not defined` — the identifier was never imported or declared at all, which is what a spec
  test calling an unwritten function actually produces · `Error` + `Cannot find module '…'` —
  collection never reached a case. **The two middle ones are one defect by two roads**; a reader that
  knows only the `TypeError` form drops the commonest shape of the test phase into "red for a reason
  I cannot name" (`tools/gates/lib/junit-xml.mjs:314-334`). A fifth is not about the code under test:
  `Error` + `Cannot find package '@cheq/core' …` means the worktree was never installed ⇒ CANNOT
  VERIFY, never pending.
  **This table is the vocabulary the readers expect, not a measurement of the runner of record.**
  `tools/gates/red-check.mjs:113-120` records (m, 2026-11-02) that this reporter writes the failure
  text as the element BODY and emits **no `type` and no `message` attribute**, so `redReason` matches
  the closed set against an empty string, answers `unknown`, and red-check cannot print
  `✓ red on base` at all. That is fail-closed, not wrong — and until `lib/junit-xml.mjs` learns the
  body form, **an assertion-red verdict is UNVERIFIED on this runner**. Do not "confirm" red by
  reading the console; read the artifact and accept CANNOT VERIFY.
- **Collection failure** — the import of the test module threw, so no case ever ran. On the previous
  runner one `<testcase>` stood for the whole file, carrying the same file in TWO spellings:
  `classname` from the repository root, `name` from that project's own `root` — e.g.
  `classname="packages/core/test/__v/b.test.ts" name="test/__v/b.test.ts"` (m, previous runner).
  **The predicate is `classname.endsWith('/' + name)`, NOT `name === classname` and NOT
  `name === basename(classname)`** — that example makes both equalities false, and the slash is
  load-bearing (`b.test.ts` must not match `…/ab.test.ts`). The fallback, independent of either
  spelling: a `name` with no ` > ` separator that ends in a test-file extension is a file, not a case
  (`tools/gates/lib/junit-xml.mjs:219-246`). With the roots this repository configures —
  `./packages/core`, `./apps/api`, `./apps/web` (`jest.config.mjs:89,96,103,110`) — an equality would
  never fire, and a file that never parsed would be read as an ordinary red case.
  **On the runner of record there is nothing for that predicate to match.**
  `tools/gates/red-check.mjs:121-130` records (m, 2026-11-02) that a file which failed to collect
  gets **no `<testsuite>` row in the XML at all** and is counted only in the JSON channel
  (`status: "failed"`, `assertionResults: []`, message `Test suite failed to run`). So the
  cross-channel arithmetic below no longer closes on such a run, and the commonest shape of the test
  phase — a new test importing an unwritten module — reaches red-check as CANNOT VERIFY through the
  channel-disagreement branch. Blocking is the right answer to a premise nobody has re-measured.

### The runner's JSON report — `lib/jest-json.mjs`

The module keeps the previous runner's filename and reads this one's `--json` report unchanged,
because the FORMAT is what it knows, not the producer. Its name is a wart, not a claim.

The second channel, and on two points it is the BETTER one. Top-level keys (m):
`numTotalTestSuites, numPassedTestSuites, numFailedTestSuites, numPendingTestSuites, numTotalTests,
numPassedTests, numFailedTests, numPendingTests, numTodoTests, snapshot, startTime, success,
testResults`.

- Per file the record is `{ name, status, message, assertionResults: [{ ancestorTitles, fullName,
  title, status, … }] }`, and **`name` is an ABSOLUTE path** while the XML's `classname` is
  repository-relative. Join on the suffix, never on equality.
- Cross-check the XML on test COUNTS only, and **not on suite counts**: the JSON counts each file's
  suite *plus* every `describe`, the XML counts files, so the two numbers legitimately differ on a
  green tree (`tools/gates/lib/jest-json.mjs:208`). A gate comparing them fails on a clean run.
- `fullName` in JSON joins ancestors with a **space** (`"D row 1 is a"`); the XML's `name` joins them
  with the configured ` > ` separator. Two spellings, one run — so a name taken from one channel is
  not a key in the other. `crossCheck` compares COUNTS and is unaffected.
- A collection failure is unmistakable here: the file record is `{"status":"failed",
  "assertionResults":[]}` with a message, and **its cases are missing from `numTotalTests`
  altogether**. The three identities that reconcile the channels by counting those failures
  explicitly, never through a raw `tests === numTotalTests`, are
  `tools/gates/lib/jest-json.mjs:201-203`:

  ```
  XML tests    === JSON numTotalTests  + collection failures
  XML failures === JSON numFailedTests + collection failures
  XML skipped  === JSON numPendingTests + numTodoTests
  ```

  A gate that compares `tests` with `numTotalTests` directly is therefore not strict, it is WRONG,
  and it is wrong on exactly the runs the test phase consists of. The third identity is also the only
  place the `.skip` / `.todo` distinction survives, the XML writing `<skipped/>` for both. The
  identities were measured on the PREVIOUS runner's artifacts (m, 2026-11-01, twice on independent
  runs); whether they close on this runner is UNVERIFIED, because this one omits an uncollected
  file's XML row entirely (`tools/gates/red-check.mjs:121-130`) — which the first two identities
  would read as a disagreement, i.e. CANNOT VERIFY.
- **`crossCheck` returns `{ ok, agree, verdict: 'agree' | 'cannot-verify' }`** — `agree`, not a
  verdict about tests, because the question it answers is "do these two artifacts describe the same
  run?". Two channels agreeing that three tests failed is a RED run with agreeing channels, so a
  field named `verdict` holding `'green'` would be misread by everyone who wrote
  `if (… === 'green')`. The verdict about tests comes from `fileVerdict` in `junit-xml.mjs` and
  nowhere else (`jest-json.mjs:210-221`).
- Skip and todo are DISTINCT here (`status: "skipped"` vs `"todo"`, and `test.todo` emits a record
  with status `"todo"`) and identical in the XML, where both render `<skipped/>` — which is why
  `skipped` is counted, not inferred.
- **`success: true` means "the process is content", not "something was verified".** Measured on
  `core` with a `-t` pattern matching no case: exit 0, `success: true`, `numTotalTests: 17`,
  `numPassedTests: 0`, `numFailedTests: 0`, `numPendingTests: 17`. Every case is reported PENDING and
  the run calls itself a success, so `numTotalTests` does not catch it and neither does any flag —
  `--passWithNoTests` governs whether test FILES were found, and they were. **The guard is in the
  READER:** `readJestJson` refuses any report where `passed + failed === 0`, because a run that
  executed no case says nothing about the code (`tools/gates/lib/jest-json.mjs:79-92`, `:167-174`).

### tsc log — `lib/tsc-log.mjs`

- Diagnostic line, measured: `path(line,col): error TSxxxx: message` — e.g.
  `packages/core/src/__probe_tsc.ts(5,18): error TS2584: Cannot find name 'document'.` (m,
  `.ci/probe-junit/tsc.bad.log`). Deduplicate on `path|line|col|code`.
- GREEN needs zero diagnostics **and** a positive sign the compiler read something: `filesChecked > 0`
  from `--listFiles`. Exit 0 with no such sign ⇒ CANNOT VERIFY. Measured on TS 7.0.2:
  `--listFiles -p packages/core/tsconfig.json` exits 0 and prints 92 absolute paths, 5 of them under
  `packages/core` (`src/index.ts`, `src/testing/sha256.ts`, `src/testing/digest.ts`,
  `test/skeleton/digest.test.ts`, `test/skeleton/marker.test.ts`).
- **The lib files are not where a TS-6-shaped allowlist expects them.** With the native compiler they
  resolve under `node_modules/.pnpm/@typescript+typescript-darwin-x64@7.0.2/node_modules/@typescript/typescript-darwin-x64/lib/lib.es*.d.ts`
  (m) — not `typescript/lib/…`. The type library lives in a PLATFORM package, named for the host, and
  a filter written as `node_modules/typescript/lib/` matches **not one line** of `--listFiles`
  output. Both ways that goes wrong are worse than a typo: the light reddens on a clean tree, and the
  obvious cure — widen the filter to `node_modules` — turns a boundary check into a check of nothing,
  silently and forever. An allowlist for the core-boundary walk matches the native path, the
  platform segment is not hard-coded to this Mac's, and the light asserts it matched something.
- The missing-symbol set that distinguishes "not written yet" from "broken": `TS2304, TS2305, TS2307,
  TS2339, TS2551, TS2552, TS2554, TS2555, TS2694, TS2724, TS2792`. One exception measured:
  `TS2307: Cannot find module '@cheq/nonexistent-pkg'` naming a WORKSPACE package rather than a path
  inside one means the worktree was never installed ⇒ CANNOT VERIFY, not pending
  (m, `.ci/probe-junit/tsc.pkg.log`).

### oxlint JSON — `lib/oxlint-json.mjs`

Shape (m, `.ci/probe-junit/oxlint.bad.json` and a clean run of the whole tree):

```
{ "diagnostics": [ { "message": "Unexpected `any`. Specify a different type.",
                     "code": "typescript(no-explicit-any)", "severity": "error",
                     "url": "…", "help": "…", "filename": "packages/core/src/__probe_lint.ts",
                     "labels": [ { "span": { "offset": 118, "length": 3, "line": 5, "column": 25 } } ] } ],
  "number_of_files": 14, "number_of_rules": 243, "threads_count": 16, "start_time": 0.688 }
```

- `code` is `plugin(rule-name)`, **not** `plugin/rule-name` — parse `/^([a-z-]+)\(([^)]+)\)$/`;
  `eslint(...)` is the core-rule plugin name.
- `number_of_files === 0` ⇒ CANNOT VERIFY: the linter ran and judged nothing.
- Line and column live in `labels[].span`, not on the diagnostic.
- There is no total-error field: count `diagnostics` by `severity`.
- **The file may not be JSON at all.** On a configuration error oxlint writes plain text to stdout
  and exits 1: `Failed to parse oxlint configuration file.` + `x Rule 'no-such-rule-at-all' not found
  in plugin 'typescript'` (m, `.ci/probe-junit/oxlint.cfgfail.json`). So `JSON.parse` in a try/catch,
  and a parse failure is CANNOT VERIFY with the raw text printed. The upside of this strictness: a
  typo in `.oxlintrc.jsonc` cannot become a lint lane that quietly checks nothing.
- `--format=junit` exists and is **not** used, so that a JUnit XML under `.ci/` means exactly
  "a test run happened".

## Part 3 — the agent playbook (traps, each one paid for)

**Measured in this repository.** Every trap about the runner of record was measured on 2026-11-02 and
its header is cited; the rest was measured on 2026-11-01, and where that belongs to the PREVIOUS
runner the bullet says so instead of pretending otherwise. Where any two could disagree, re-run it and
correct this file (rule 12).

The five traps that cost this toolchain the most are the five in the wrapper's own header
(`tools/gates/run.mjs:16-55`), and all five are below: the artifact path that travels in the
ENVIRONMENT, the dotted `--outputFile` that is swallowed in silence, `oxlint` without
`--type-aware`, a runner that does not typecheck, and a `-t` filter that matches nothing and calls
itself a success.

- **`cmd | head` reports the exit code of `head`.** Measured twice while the toolchain was assembled
  (`eslint … | head` said 0 while eslint had crashed with 2; `tsc … | head -12` said 0 over four
  `error TS6059`), and re-measured while this file was written: the same bad `tsc` invocation gives
  `exit=0` through a pipe and `exit=1` on its own. No gate pipes the output of the tool it judges;
  the exit code is captured alone and written to `run.json`, and the verdict still comes from the
  artifact.
- **A watcher pattern without anchors reports watchers nobody can find.** The obvious spelling — a
  plain alternation of the executable names — is a SUBSTRING match over every process's whole command
  line, and on 2026-11-01 it reported **seventeen** live watchers on this machine: shells whose argv
  merely CONTAINED the runner's name at the time, because the text they were running happened to
  mention it. A wrapper that refuses on that number refuses every run of record for as long as such a
  shell lives. That count is a DATED OBSERVATION of the previous runner's name and not current state —
  the same naive alternation returned 0 on 2026-11-02, because no process's argv happened to mention
  the words then. **The hazard is the substring match, which does not go away between measurements;
  only its visibility does**, which is exactly why `WATCHER_PATTERN` anchors every executable name at
  a path or argv boundary (`tools/gates/run.mjs:354-380`).
- **Half the artifact contract is in the ENVIRONMENT, not in the argv.** The JUnit reporter is
  declared in `jest.config.mjs:70-82` with **no `outputFile`**, so its path comes from
  `JEST_JUNIT_OUTPUT_FILE` and from nothing else. Measured 2026-11-02 without it: the reporter writes
  `junit.xml` into the current directory — one file every run overwrites, which is the defect
  `L-artifacts` exists to refuse. `runTool` records what it added to the child's environment as
  `envExtra` in `run.json`, and `L-artifacts` judges that field (`REQUIRED_ENV`) exactly as it judges
  the argv (`tools/gates/lights/artifacts.mjs:171-177`). A second caller that assembles its own
  command line is one forgotten variable away from a run with no artifact to be judged from.
- **The dotted `--outputFile.<reporter>=` form is SWALLOWED IN SILENCE.** It was the previous
  runner's required spelling. Measured 2026-11-02 on this one: the parser takes `--outputFile.json=B`
  without a word, runs every test and **writes no file** — worse than the crash it used to cause,
  because the run looks complete: an exit code from the tests, full console output, no artifact. One
  bare `--outputFile=<path>` is the only legal form, and `L-artifacts` refuses the dotted one by name
  (`tools/gates/lights/artifacts.mjs:300-310`).
- **ESM needs `NODE_OPTIONS=--experimental-vm-modules` in the child's environment.** Without it every
  test dies with `Cannot use import statement outside a module`, which reads like a broken source and
  is not one. The wrapper sets it (`tools/gates/run.mjs:157`); a hand-run must too.
- **A `-t` filter that matches nothing exits 0 and calls itself a success.** Measured 2026-11-02 on
  `core` with a pattern matching no case: exit 0, `success: true`, `numTotalTests: 17`,
  `numPassedTests: 0`, `numPendingTests: 17`. **No flag prevents it** — `--passWithNoTests` governs
  whether test FILES were found, and they were. Three guards, all required: the READER refuses
  `passed + failed === 0` (`tools/gates/lib/jest-json.mjs:167-174`); `n/a` is decided from the
  SOURCES before the run (`lib/test-project.mjs`); and the case count is compared with the
  enumerator's.
- **`-t` selects by NAME, and not exactly.** `tools/gates/red-check.mjs:59-61` records it as an
  unanchored match over the full case name, so `-t 'adds a task'` also selects `adds a task twice`,
  and there is no fully-qualified spelling to anchor it with. The honest filter is the file PATH as a
  positional argument — which is itself a regex over the test path and matches path FRAGMENTS
  (`red-check.mjs:65-78`), so every run of record compares the artifact's file set against the set it
  asked for and reports a surplus as CANNOT VERIFY. Selection among cases happens AFTER the run, on
  the artifact, by exact name.
- **A path pattern nobody wrote fails CLOSED.** Measured 2026-11-02:
  `… packages/core/test/NOBODY_WROTE_THIS` exits non-zero, writes both artifacts, and the XML reads
  `<testsuites tests="0">` with JSON total 0 — which `readJUnit` already refuses as CANNOT VERIFY
  (`red-check.mjs:65-78`). That is why no `--passWithNoTests` is ever passed: this runner needs none.
- **The collection listing is FILES, not cases.** `jest --selectProjects <p> --listTests --json`
  prints an array of absolute test-FILE paths (m, 2026-11-02; `tools/gates/lights/orphans.mjs:627-647`).
  There is no `jest list`, and nothing on the command line enumerates case names — so the textual
  enumerator `lib/test-cases.mjs` has **no runner-side second opinion at the case level any more**,
  and the case count is reconciled against the artifact instead. The listing stays ADVISORY
  (ADR-0002 item 6): it answers which files a project claims, never how many cases passed.
- **A project name that does not exist is not the dangerous case.** On the previous runner a typo'd
  project selector exited 1 and wrote NO artifact (m, previous runner, 2026-11-01), which the
  "missing artifact ⇒ CANNOT VERIFY" rule already handles; whether this runner answers the same way
  is UNVERIFIED. It is the *name that exists but matches no file* that is dangerous, not the typo.
- **`oxlint` without `--type-aware` silently runs fewer rules.** Same tree, same config, both exit 0:
  243 rules with the flag, 211 without (m). Nothing in the output says the type-aware rules were
  skipped — but `number_of_rules` differs, so the gate can cross-check numerically as well as by
  recording `argv`. The two absolute numbers belong to this config on this oxlint version; the
  DIFFERENCE is the signal, and a gate that hard-codes either figure breaks on the next upgrade.
- **A line-level suppression does not suppress a type-aware rule; a file-level one does.**
  `// oxlint-disable-next-line no-floating-promises` (and the `typescript/`-prefixed and
  `eslint-disable-next-line` spellings) left the diagnostic standing; `// oxlint-disable
  no-floating-promises` at file level removed it (m). So `L-lint` hunts the FILE-level form naming a
  boundary rule, and also reports the `eslint-disable` spellings — they suppress nothing, but their
  presence means somebody tried. For non-type-aware rules the `-next-line` behaviour is **UNVERIFIED**.
- **`pnpm install` can answer "lockfile is up to date" and leave the old tree in place** — three times
  while this toolchain was assembled (m, that session; not re-observed while this file was written).
  The cure that worked: `rm -rf node_modules pnpm-lock.yaml && pnpm install`. An install that printed
  success is not an installed tree; check the package you need actually resolves.
- **`rootDir` together with `include: ["test/**"]` gives `error TS6059` for every test file** (m). A
  noEmit typecheck config carries no `rootDir` and no `outDir` — which is why none of the three
  `tsconfig.json` files has either.
- **An import that keeps its `.ts`/`.tsx` extension is `error TS5097`** unless
  `allowImportingTsExtensions` is on; it is legal here only because every project is `noEmit`
  (`tsconfig.base.json:13-17`).
- **`@testing-library/react` leaks between cases without `afterEach(cleanup)`**: a second `render()`
  in one file leaves the first mounted and a single-match query finds two — a failure that says
  nothing about the code (m; the cure is `apps/web/test/setup.ts:4-7`, wired as `setupFilesAfterEnv`
  at `jest.config.mjs:112`). The hook itself is imported from `@jest/globals`, like every head and
  matcher in a test file (`apps/web/test/setup.ts:5`).
- **`git ls-files` is empty before the first commit** (m: 0 lines right now). Every numeric check
  built on the index — the file-count comparison in the core-boundary walk, the content freshness key
  `sha256` over `git ls-files -s` — reads CANNOT VERIFY until commit 1 exists, and must say so rather
  than comparing against zero.

**Carried over from the design, and still true here**

- **`tsc --noEmit` is green on an empty program.** A narrowed `include`, a file in `exclude`, a
  `// @ts-nocheck`, `files: []`, a stale `.tsbuildinfo` — all look like success. Cure:
  `filesChecked > 0` from `--listFiles`, plus the numeric comparison with the tracked file list.
- **A second top-level `describe` was expected to drop cases silently** — and it did NOT, in a plain
  run, when it was last checked (m, previous runner, 2026-11-01):
  `packages/core/test/skeleton/digest.test.ts` has four top-level `describe` blocks and 16 `it(`
  calls, and the artifact reported `tests="16"` for that file, every case executed. So the design's
  claim is **UNVERIFIED**, and this file says so rather than repeating it; whatever the mechanism was,
  the case-count comparison is what would catch it, which is the guard that exists anyway.
- **Snapshots are a self-fulfilling assertion, and `--ci` is the flag that stops it.** Measured
  2026-11-02 without `--ci`: a MISSING snapshot is WRITTEN and the case PASSES — `1 snapshot
  written`, exit 0 — so the first run of a snapshot assertion is green by construction, and `-u`
  rebases the claim onto current behaviour afterwards. That measurement is the reason `--ci` is a
  REQUIRED flag on every run of record, asserted in the argv by `L-artifacts`
  (`tools/gates/lights/artifacts.mjs:145-151`). Snapshots are forbidden in spec tests outright.
- **`.failing` INVERTS the verdict.** Measured 2026-11-02: `it.failing('x', () => { expect(1).toBe(2); })`
  is reported `"passed"`. A spec test written that way is green exactly when its assertion fails, so
  red-check could never prove it red — which is why `L-testshape` refuses `.failing` in a spec test
  (`tools/gates/lights/testshape.mjs:157-165`).
- **The focus and skip spellings are HEADS, not modifiers**, and a file using a head this runner does
  not define fails to COLLECT rather than reporting a red case. The heads are `describe`, `fdescribe`,
  `xdescribe`, `it`, `test`, `fit`, `xit`, `xtest`; the modifiers are `only`/`skip`/`each` on
  `describe` and `only`/`skip`/`todo`/`each`/`failing`/`concurrent` on `it`/`test`. `suite(` and
  `bench(` are the PREVIOUS runner's heads and are collected as foreign, as are the modifiers `for`,
  `fails`, `sequential`, `shuffle`, `skipIf`, `runIf`, `extend` and `scoped`
  (`tools/gates/lib/test-cases.mjs:76-117`).
- **`.each` row names are FORMATTED by the runner** — `%i`, `%s` and `%p` are substituted from the
  row and `$prop` from an object row (m, 2026-11-02) — so a row's case name **cannot be derived from
  the source**. An enumerator that tries is reporting a name the artifact will never carry
  (`tools/gates/lib/test-cases.mjs:674`).
- **A test without an assertion passes** — an `async` body with no `await`, an `expect` inside an
  unawaited `.then()`. `expect.hasAssertions()` is required in every async test.
- **`it.only` disables every other case in its file** without changing a line of them. Lint error
  plus the case-count comparison.
- **Lint as the only boundary is a boundary with a published bypass** (`ignorePatterns`, a file-level
  disable, an override that forgot a path, a `files` glob that missed a new package). Here the first
  layer is the COMPILER — `packages/core/tsconfig.json:7-8` has `lib: ["ES2023"]` and `types: []`, so
  `document` is `TS2584` and `node:fs` is `TS2591` (m): not a rule, the absence of a type. The second
  is the graph of files the compiler actually read. Lint is third and never alone.
- **The hole none of those three closes: a relative path out of the package.**
  `import { API_PACKAGE } from '../../../apps/api/src/index.ts'` inside `packages/core` typechecks
  with exit 0 and no diagnostic (m) — a package import would not resolve (`dependencies: {}` at
  `packages/core/package.json:7` plus `node-linker=isolated` at `.npmrc:4`), but a relative path is
  not a package. That specifier walk is `L-core-purity`'s job and nothing else does it.
- **`import type { X } from 'react'` is erased** and slips past a naive import check; symmetrically, a
  check that only looks at `import` misses `require()` and `await import()`. And a substring check
  hits the string literal `'node:fs'` inside a comment — so a false-positive probe is mandatory.
- **The pnpm symlink farm.** `node_modules/@cheq/core` is a symlink to `packages/core`, and `.pnpm`
  points into a store outside the tree. Staging a file "into the base worktree" through a symlink
  writes into the real `packages/core`, and the base run then judges branch code.
- **A base worktree whose install failed makes every added test vacuously crash-red** — nothing
  resolves, and the gate reports a clean sweep of red. Cure: refuse on a failed install, and read a
  `TS2307` naming a workspace package as CANNOT VERIFY (m, above).
- **Clocks and time zones are this domain's defining hole.** `new Date()`, `toLocaleDateString` and
  `Intl.DateTimeFormat` read the machine's zone and locale, so a test is green here and red in UTC —
  and the other way round across midnight and a DST boundary. Runs of record pin `TZ=UTC` and `LANG=C`;
  the clock is injected; `L-core-purity` fails a bare `new Date()` or `Date.now(` anywhere under
  `packages/core/**`, **including `packages/core/test/**`**, while allowing `new Date(<argument>)`,
  `x instanceof Date` and `Date` as a type. A blanket lint rule was tried and dropped for exactly that
  reason: `no-restricted-globals` on `Date`/`Math` refused a type, a fixed value and `Math.floor`
  (`.oxlintrc.jsonc:18-23`).
- **Fake timers are this stack's `Thread.Sleep`.** Advancing the fake clock by 600 ms makes "after 10
  fixed steps" green without stepping the domain once, and fake timers LEAK into the next test when
  the real ones are not restored. The config restores mocks between cases
  (`clearMocks` / `restoreMocks`, `jest.config.mjs:55-56`) — timers are not mocks and are not covered
  by that, so a test that installs them restores them itself.
- **A transitive upgrade touches no `package.json`** — the drift lives in `pnpm-lock.yaml` and is
  counted and named separately.
- **Judging only `dependencies` is not enough**: in this stack `devDependencies` execute code
  (postinstall, Vite plugins, lint plugins). All three dependency fields are judged.
- **A reused run directory lets a failed run be read through last run's artifact.** Unique directory,
  refuse if it exists, `run.json` records the head sha.
- **`git diff` argument order**: a `--` before the revisions turns them into paths, and the gate
  checks NOTHING while looking green.
- **A gate written in TypeScript and run by the project's own toolchain breaks exactly when it is the
  only source of truth.** The gates are `.mjs`, zero dependencies, and `tools/gates` is deliberately
  not a workspace package (`package.json:5`).
- **A formatter or `--fix` in the hook rewrites the tree the gates just judged.** The hook writes
  nothing; lint and format run in check mode only.
- **A trailer example at column zero becomes a real declaration** — it will fire in the first `docs:`
  commit that documents the conventions. Indent every example trailer.
- **Copying a version into prose.** node and pnpm look stable enough to write down; `.nvmrc:1` and
  `package.json:9` are the sources, `status.mjs` prints them, and nothing mechanical fully prevents a
  copy — a reviewer does (ADR-0003).
- **`kind: api` looks like it has an honest fast loop.** `curl` against a running dev server is an
  advisory lane. The honest fast loop is `app.inject()` inside the `api` project.
- **Five role files are not a process.** They work only because the three phases run in FRESH sessions
  with a human signature in git between them. A port that merges the phases "because TypeScript is
  fast" gets tests written by the same context as the code — a mirror of the implementation, with a
  fully green pipeline.

## Part 4 — UNVERIFIED in this repository

Nobody has observed these on this machine. Each is CANNOT VERIFY until a probe closes it, and the
line is struck through when one does.

- ~~**Whether `tsc --listFiles` and `--showConfig` behave on TypeScript 7 as the design assumed**~~ —
  CLOSED (m, 2026-11-01): both exit 0 and answer on `-p packages/core/tsconfig.json`; `--listFiles`
  printed 92 absolute paths, `--showConfig` printed the resolved options. These two flags, with the
  runner's own collection listing, were named the design's main risk; all three answer, so the levels
  of `L-core-purity`, `L-orphans` and `L-tsc` that rest on them stand, and `--listFiles` was observed
  catching the hole they exist for — a relative import out of the package put
  `apps/api/src/index.ts` in `packages/core`'s own file list. No tech-debt entry is owed for a risk
  that closed by measurement. What the flags do NOT fix is the lib-path shape (Part 2 — a filter on
  the familiar `typescript/lib/` path matches nothing), the empty index before commit 1 (Part 3), and
  the fact that the collection listing answers in FILES rather than cases (Part 3), so the case-level
  second opinion the design assumed does not exist.
- **The browser lane in full**: `@playwright/test` is installed, the browsers are not downloaded
  (m), so no e2e test has ever run — not red, not green (TD-0001, `playwright.config.ts:3-5`).
- **The coverage floor as a lane.** `--coverage` instruments through the transform and produces real
  per-file numbers (m, 2026-11-02), and the floor is declared at 80% on all four metrics over
  `packages/core/src/**` + `apps/api/src/**` (`jest.config.mjs:130-135`). Measured on the skeleton:
  statements 94.44%, lines 95.53%, functions 100%, **branches 72.54%** — so the floor FAILS today.
  That is the honest state and not a defect to hide: the uncovered branches are in the hand-written
  sha256/digest support code, and the product does not exist yet. No run of record asks for coverage,
  and no gate reads it, so the figure is a measurement and never a verdict.
- **The pre-commit hook's total cost.** Individual lanes are seconds (m: `tsc` on core prints nothing
  and returns immediately; `oxlint --type-aware` over 14 files took 1.40 s wall, one run), the SUM of
  twelve lights plus spec-gate plus test-guard is unmeasured, and there is no calibration lane to
  measure it with (TD-0002). The `< 15 s` in the design is a target, never a promise.
- **Every gate under `tools/gates/`, as a behaviour.** They are written in commit 1 together with
  their probes; until `gate-probes` has shown each one failing on a known-bad fixture, "the gate
  passed" means only that it exited 0.
- **The `-next-line` suppression form on NON-type-aware rules** (only the type-aware case was
  measured — Part 3).
- **The parity lane finding anything.** `core` and `core-dom` run the same files under node and jsdom
  (`jest.config.mjs:85-98`); no case has ever disagreed, so `L-env-parity` is a lane with no observed
  signal (TD-0006; testing.md explains why it is nonetheless the one honest parity lane here).
- **An assertion-red verdict on this runner.** `tools/gates/red-check.mjs:113-120` records that the
  JUnit `<failure>` arrives with no `type` and no `message` attribute — the text is the element body —
  so `redReason` answers `unknown` and red-check cannot print `✓ red on base` until
  `lib/junit-xml.mjs` learns the body form. Everything in the test phase therefore reaches a verdict
  of CANNOT VERIFY rather than `red`, which blocks exactly as a green would.
- **The collection-failure shape on this runner.** A file that failed to collect gets no XML row at
  all and is counted only in the JSON channel (`red-check.mjs:121-130`), so the three counter
  identities measured on the previous runner's artifacts (Part 2) do not close on such a run and
  `isCollectionFailure` has nothing to match. `crash-red` is unreachable until both readers learn the
  shape.
- **The dual-channel cross-check as a GATE.** Nothing reads `crossCheck` yet, and no fixture has made
  the two channels disagree on purpose, so `agree: true` has only ever been observed where agreement
  was the expected answer (TD-0005).
- **`vite build` as any kind of verdict.** Every project is `noEmit`; nothing in this repository has
  ever built `apps/web` for real, and bundle size is not a lane (TD-0010).
- **A run of record with a watcher alive, and two runs of record at once.** `WATCHERS` and `.ci/lock`
  exist to forbid it; the failure mode they forbid has not been observed here.
- **`require-await`** — the one defect class the lint lane does not catch (m: eslint caught it, oxlint
  did not), recorded in `docs/tech-debt/` rather than papered over.
