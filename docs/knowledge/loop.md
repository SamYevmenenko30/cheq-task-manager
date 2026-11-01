# The agent ⟷ toolchain loop

How an agent gets fast, truthful feedback from this repository: which command to run, what it reads
back, and what it must not trust. The stack is node 22, pnpm 9, TypeScript 7 (the native compiler),
Vitest 5 and oxlint — one type engine, four test projects, one wrapper that writes the artifacts a
verdict is read from.

**In this stack the danger is the opposite of a noisy tool: a successful `tsc` prints NOTHING.**
Silence looks exactly like green, and so does a run that never happened. Therefore: *silence is not
a marker — the wrapper writes its own*, and every reader needs a positive sign that the tool really
read something (`filesChecked > 0`, `tests > 0`, `number_of_files > 0`) before it may say green.
A missing artifact is CANNOT VERIFY, never green (ADR-0002 in [docs/decisions/](../decisions/)).

Provenance marks, used on every fact below:

- **(m)** — measured on this Mac on 2026-11-01 with the command named. Where the artifact survives,
  its path is given; those under `.ci/` are gitignored (`.gitignore:10`) and will not exist in a fresh
  clone, which is why the shapes are transcribed here instead of linked.
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
| the hook-existence flag | `core.hooksPath` does not resolve to `.githooks` — commits are passing unchecked. `status.mjs` names this flag; the four above are fixed names |

`status.mjs` and the gates it reports on are part of commit 1 of this repository (process.md,
"Commit sequence"). The script names in the table below are the ones `package.json:11-27` already
binds; where a gate's actual output disagrees with this file, **the gate is right and this file is
the defect**, fixable in the same commit (AGENTS.md rule 12).

## Part 1 — the loop table

| # | step | command | reads back | must NOT trust |
|---|---|---|---|---|
| 1 | inspect the project as text | `node tools/gates/project.mjs packages \| config <pkg> \| exports <pkg> \| routes \| imports <file>`; generated projections under `docs/digests/` FIRST; `git log --oneline -20 -- <paths>` | the effective compiler options, the export surface, the import graph, route table — as `path:line` a spec may cite (AGENTS.md rule 4) | a digest as proof that the code typechecks; **`tsconfig.json` as TEXT** — `extends` hides the effective value, so quote `project.mjs config <pkg>`, which is the `tsc --showConfig` answer (m: `--showConfig -p packages/core/tsconfig.json` exits 0 and prints `lib: ["es2023"]`, `types: []` resolved) |
| 2 | edit | Write / Edit | — | that a file you added is in any project: step 3 or `L-orphans` says so |
| 3 | types, fast | `pnpm exec tsc --noEmit --pretty false -p <pkg>/tsconfig.json` | `path(line,col): error TSxxxx: msg` lines, one per diagnostic (m, 4 planted diagnostics in `.ci/probe-junit/tsc.bad.log`); nothing at all when clean (m: core exits 0 with 0 bytes of output) | anything about another package — each project is typechecked alone; anything Vitest will do at runtime (Vitest typechecks NOTHING); exit 0 as "it read my files" — add `--listFiles` for that |
| 4 | tests, fast | `pnpm exec vitest run --project <core\|core-dom\|api\|web> [<repo-relative path>.test.ts]` — the positional path filters even though each project sets its own `root` (m: `--project core packages/core/test/skeleton/marker.test.ts` ran 1 file, 1 test) | per-case pass/fail on the terminal | a green from a filter that matched nothing (step 4's biggest lie — Part 3); `-t` as a selector (substring match); this as a verdict of record |
| 5 | lint, fast | `pnpm exec oxlint --type-aware` | diagnostics with rule ids of the form `plugin(rule-name)` | a run WITHOUT `--type-aware`: the type-aware rules silently do not run (m: `number_of_rules` 243 with the flag, 211 without, same tree, both exit 0) ; lint as a verdict about types — it never is |
| 6 | dev server / IDE language service | `pnpm dev:web`, `pnpm dev:api` (`package.json:28-29`) | a running app, a browser console | as evidence, EVER: it is advisory. A watch artifact older than your edit is STALE, and a dev server resolves imports by Vite's rules, not the compiler's |
| 7 | types OF RECORD | `node tools/gates/run.mjs types --kind <core\|api\|web\|all>` (`package.json:22`) | `.ci/runs/<ts>-<label>/tsc.<kind>.log` + `run.json` (argv, exit code, seconds, head sha) | the exit code (Part 3: it lied); a clean log with no positive sign that files were read |
| 8 | tests OF RECORD | `node tools/gates/run.mjs test --kind <kind> --label <l>` (`package.json:23-25`) | `.ci/runs/<ts>-<label>/<kind>.junit.xml` + `<kind>.json` + `tsc.<kind>.log` + `run.json` — BOTH halves every time, because Vitest does not typecheck | the exit code; `tests="0"`; a `<skipped/>` case; a case whose `classname` is outside the kind's project; `success: true` in the JSON (m: a run that executed nothing prints exactly that) |
| 9 | the browser lane | `node tools/gates/run.mjs e2e --label <l>` (`package.json:26`) | nothing yet — it refuses while `.ci/probe.json` lacks `browser_probe: "pass"` (`playwright.config.ts:3-5`) | any e2e claim at all: the browsers are not downloaded (m), so this lane is CANNOT VERIFY, never red and never green (TD-0001) |
| 10 | lint OF RECORD | `node tools/gates/run.mjs lint --label <l>` (`package.json:27`) | `.ci/runs/<ts>-<label>/oxlint.json` + `run.json` recording that `--type-aware` was in `argv` | a JSON file that did not parse — on a config error oxlint writes PLAIN TEXT to stdout (m, below) |
| 11 | gates | `node tools/gates/ready.mjs [--quick]` (`package.json:16-17`) | the verification block; `NOT READY` on any step ≠ 0 | a gate that did not run; a green a gate cannot explain; `--quick` as the check of record (it reads HEAD, not the index — `.githooks/pre-commit:2-7`) |

WHERE THINGS LAND: every run of record writes its own directory `.ci/runs/<ts>-<label>/`, never
reused, with `run.json` holding the exact argv, the tool's own exit code, the seconds and the head
sha. `.ci/` is gitignored (`.gitignore:10`), so a `green:` trailer names a path that exists only on
this machine, and `ready.mjs` prints `(artifact present)` / `(ARTIFACT MISSING)` rather than assuming.
`.vitest/` is Vitest's own dump (`.gitignore:25`) and no gate reads it.

RULES THE LOOP CARRIES: never pipe the output of the tool being judged (Part 3); capture the tool's
exit code on its own and treat it as advisory; always ask for the artifact by name on the command
line; never `--passWithNoTests`; never `--watch`, `-u` or `--retry > 0` for a verdict; never
`git commit --no-verify`; one run of record at a time (`.ci/lock`).

## Part 2 — how to read each artifact

One reader per format, under `tools/gates/lib/`. Nothing else parses these files.

### JUnit XML — `lib/junit-xml.mjs`

Shape, measured (m) from `.ci/runs/…/core.junit.xml` and the probe run in `.ci/probe-junit/out.junit.xml`:

```
<testsuites name="vitest tests" tests="17" failures="0" errors="0" time="0.035891882">
  <testsuite name="packages/core/test/skeleton/digest.test.ts" timestamp="…" hostname="…"
             tests="16" failures="0" errors="0" skipped="0" time="…">
    <testcase classname="packages/core/test/skeleton/digest.test.ts"
              name="sha256 against the published vectors &gt; hashes the empty string" time="…"/>
```

- `classname` is the file path from the repository root; `name` is `"<describe> > <test>"`, joined by
  ` &gt; ` — the entity, not a literal `>`. Decode `&amp; &lt; &gt; &quot; &apos;` before comparing a
  name with a declared case name (m: a case named `fails an honest assertion <&>` came back as
  `probe &apos;assert&apos; &gt; fails an honest assertion &lt;&amp;&gt;`).
- **`<testsuites>` carries no `skipped` attribute — only each `<testsuite>` does.** So the passed
  count is `tests − failures − errors − Σ skipped`, never `tests − failures`. (m: a `-t` filter that
  matched nothing produced `tests="17" failures="0"` with `skipped="16"` + `skipped="1"` and a
  `<skipped/>` child in every `<testcase>`, exit 0.)
- Verdict rules: file absent ⇒ CANNOT VERIFY · `tests="0"` ⇒ CANNOT VERIFY · a `classname` outside
  the kind's own project ⇒ CANNOT VERIFY (foreign project) · any `<skipped/>` among the cases a spec
  declared ⇒ CANNOT VERIFY · otherwise green/red from `failures`/`errors`.
- **Four `<failure type>` signatures, each planted and read back** (m):
  `AssertionError` + `expected 'a' to be 'b' // Object.is equality` — an honest assertion, the only
  one that is proof · `TypeError` + `completeTask is not a function` — the module is there and the
  export is not · `ReferenceError` + `absentFn is not defined` — the identifier was never imported
  or declared at all, which is what a spec test calling an unwritten function actually produces ·
  `Error` + `Cannot find module '…' imported from …` — collection never reached a case. **The two
  middle ones are one defect by two roads**; a reader that knows only the `TypeError` form drops the
  commonest shape of the test phase into "red for a reason I cannot name"
  (`tools/gates/lib/junit-xml.mjs:314-334`). A fifth is not about the code under test:
  `Error` + `Cannot find package '@cheq/core' …` means the worktree was never installed ⇒ CANNOT
  VERIFY, never pending.
- **Collection failure** — the import of the test module threw, so no case ever ran. One
  `<testcase>` stands for the whole file, carrying the same file in TWO spellings: `classname` from
  the repository root, `name` from that project's own `root`. Both spellings were measured —
  `classname=".ci/probe-junit/c-module.test.ts" name="c-module.test.ts"` and
  `classname="packages/core/test/__v/b.test.ts" name="test/__v/b.test.ts"` — with
  `<failure type="Error" message="Cannot find module './nope/schedule.ts' imported from …">`.
  **The predicate is `classname.endsWith('/' + name)`, NOT `name === classname` and NOT
  `name === basename(classname)`** — the second example makes both equalities false, and the slash
  is load-bearing (`b.test.ts` must not match `…/ab.test.ts`). The fallback, independent of either
  spelling: a `name` with no ` > ` separator that ends in a test-file extension is a file, not a case
  (`tools/gates/lib/junit-xml.mjs:219-246`). With the roots this repository configures —
  `./packages/core`, `./apps/api`, `./apps/web` (`vitest.config.ts:21,32,40,48`) — an equality would
  never fire, and a file that never parsed would be read as an ordinary red case.

### Vitest JSON — `lib/vitest-json.mjs`

The second channel, and on two points it is the BETTER one. Top-level keys (m):
`numTotalTestSuites, numPassedTestSuites, numFailedTestSuites, numPendingTestSuites, numTotalTests,
numPassedTests, numFailedTests, numPendingTests, numTodoTests, snapshot, startTime, success,
testResults`.

- Cross-check the XML on test COUNTS only. The `core` run read `numTotalTestSuites: 7` in JSON while
  the XML had 2 `<testsuite>` elements — the JSON counts each file's suite **plus** every `describe`
  (2 files + 5 `describe` blocks = 7; `digest.test.ts:10,36,46,76` and `marker.test.ts:8`), the XML
  counts files (m). A gate comparing suite counts across channels fails on a green tree.
- `fullName` in JSON joins describe and title with a **space**; XML joins them with ` > ` (m). Two
  separators, one run — normalise or compare counts, never raw strings across channels.
- A collection failure is unmistakable here: the file record is `{"status":"failed",
  "assertionResults":[]}` with a message — failed with zero cases (m, `.ci/probe-junit/out.json`).
  **Its cases are missing from `numTotalTests` altogether**, while the XML emits a synthetic
  `<testcase>` for the file and counts it. So the two channels reconcile only through identities that
  count the collection failures explicitly (m, twice, on independent runs — the second a live run
  with one collection failure):

  ```
  XML tests    === JSON numTotalTests  + collection failures
  XML failures === JSON numFailedTests + collection failures
  XML skipped  === JSON numPendingTests + numTodoTests
  ```

  A gate that compares `tests` with `numTotalTests` directly is therefore not strict, it is WRONG,
  and it is wrong on exactly the runs the test phase consists of. The third identity is also the only
  place the `.skip` / `.todo` distinction survives, the XML writing `<skipped/>` for both.
  `crossCheck` implements all three (`tools/gates/lib/vitest-json.mjs:165-175`) and has answered
  `agree: true` on a green run and on a red one.
- **`crossCheck` returns `{ ok, agree, verdict: 'agree' | 'cannot-verify' }`** — `agree`, not a
  verdict about tests, because the question it answers is "do these two artifacts describe the same
  run?". Two channels agreeing that three tests failed is a RED run with agreeing channels, so a
  field named `verdict` holding `'green'` would be misread by everyone who wrote
  `if (… === 'green')`. The verdict about tests comes from `fileVerdict` in `junit-xml.mjs` and
  nowhere else (`vitest-json.mjs:179-187`).
- Skip and todo are DISTINCT here (`status: "skipped"` vs `"todo"`) and identical in the XML, where
  both render `<skipped/>` (m). A file whose only cases are skipped reads file-level
  `status: "passed"` (m) — which is why `skipped` is counted, not inferred.
- `success: true` means "the process is content", not "something was verified": a run whose filter
  matched nothing printed `numTotalTests: 17, numPassedTests: 0, numPendingTests: 17, success: true`
  (m). `numPendingTests > 0` over declared cases ⇒ CANNOT VERIFY.

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

**Measured in this repository, 2026-11-01.** A bullet that names its command was re-observed while
this file was written; a bullet without one was measured in the session that assembled this toolchain
and is recorded there. Where the two could disagree, re-run it and correct this file (rule 12).

- **`cmd | head` reports the exit code of `head`.** Measured twice while the toolchain was assembled
  (`eslint … | head` said 0 while eslint had crashed with 2; `tsc … | head -12` said 0 over four
  `error TS6059`), and re-measured while this file was written: the same bad `tsc` invocation gives
  `exit=0` through a pipe and `exit=1` on its own. No gate pipes the output of the tool it judges;
  the exit code is captured alone and written to `run.json`, and the verdict still comes from the
  artifact.
- **Two `--outputFile` forms in one Vitest command CRASH the run.** The obvious spelling
  `--reporter=junit --outputFile=<x.xml> --reporter=json --outputFile.json=<y.json>` dies with
  `TypeError: Cannot create property 'json' on string '<x.xml>'`, exit 1, and **writes no artifact at
  all** (m, vitest 5.0.5). Both must use the dotted form:
  `--outputFile.junit=<x.xml> --outputFile.json=<y.json>` (m: exit 0, both files written).
- **`outputFile` inside a `projects` entry is IGNORED** — the reports land in Vitest's own `.vitest/`
  instead. The artifact is asked for on the command line, which is better anyway: the gate names the
  file it will read (m; encoded as a comment at `vitest.config.ts:3-7`).
- **A filter that matches nothing is green and loud about nothing.** `-t 'S9_…'` with no match:
  exit 0, `tests="17" failures="0"`, every case `<skipped/>`, JSON `numPassedTests: 0,
  numPendingTests: 17, success: true` (m). Three guards, all required: `--passWithNoTests=false`
  always; `n/a` decided from the SOURCES before the run (`lib/test-project.mjs`); the case count
  compared with the enumerator's.
- **`-t` is a substring match** — `-t "adds a task"` also selects `"adds a task twice"`. The honest
  filter is the file PATH; selection among cases is done on the artifact, by exact name.
- **`vitest list --json` double-escapes a quote; the XML does not.** Measured: exit 0 and an array of
  `{ name, file, projectName, location: { line, column } }`, `file` ABSOLUTE, and `name` in the same
  `"<describe> > <test>"` form as a `testcase name`. But a quote inside a title comes back as
  `hashes \\"abc\\"` from the list and as `&quot;` from the XML. The XML is the artifact of record,
  so the comparison unescapes the LIST and leaves the XML's own decoding to `junit-xml.mjs` — invert
  that and every quoted title looks like a case the enumerator invented. After unescaping, the
  textual enumerator (`lib/test-cases.mjs`) agreed with the runner's own collection on all 17 cases
  of the `core` project (m). The list stays ADVISORY regardless (ADR-0002 item 6): it is a second
  opinion on the enumerator, never a count a gate reads.
- **A typo'd `--project` fails cleanly.** `--project coer` exits 1 and writes NO artifact (m) — which
  the "missing artifact ⇒ CANNOT VERIFY" rule already handles. It is the *name that exists but
  matches no file* that is dangerous, not the typo.
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
  nothing about the code (m; the cure is `apps/web/test/setup.ts:4-7`, wired at `vitest.config.ts:50`).
- **`git ls-files` is empty before the first commit** (m: 0 lines right now). Every numeric check
  built on the index — the file-count comparison in the core-boundary walk, the content freshness key
  `sha256` over `git ls-files -s` — reads CANNOT VERIFY until commit 1 exists, and must say so rather
  than comparing against zero.

**Carried over from the design, and still true here**

- **`tsc --noEmit` is green on an empty program.** A narrowed `include`, a file in `exclude`, a
  `// @ts-nocheck`, `files: []`, a stale `.tsbuildinfo` — all look like success. Cure:
  `filesChecked > 0` from `--listFiles`, plus the numeric comparison with the tracked file list.
- **A second top-level `describe` was expected to drop cases silently** — and it does NOT, in a plain
  run, on this version. Measured: `packages/core/test/skeleton/digest.test.ts` has four top-level
  `describe` blocks (`:10, :36, :46, :76`) and 16 `it(` calls, and the artifact reports `tests="16"`
  for that file, every case executed (m). So the design's claim is **UNVERIFIED here**, and this file
  says so rather than repeating it; whatever the mechanism was, the case-count comparison is what
  would catch it, which is the guard that exists anyway.
- **Snapshots are a self-fulfilling assertion.** `toMatchSnapshot` WRITES the snapshot when none
  exists and is green forever after; `-u` rebases the claim onto current behaviour. Forbidden in spec
  tests; runs of record set `CI=1`.
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
- **Fake timers are this stack's `Thread.Sleep`.** `vi.advanceTimersByTime(600)` makes "after 10 fixed
  steps" green without stepping the domain once, and they LEAK into the next test when
  `vi.useRealTimers()` is forgotten.
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
- **Six role files are not a process.** They work only because the three phases run in FRESH sessions
  with a human signature in git between them. A port that merges the phases "because TypeScript is
  fast" gets tests written by the same context as the code — a mirror of the implementation, with a
  fully green pipeline.

## Part 4 — UNVERIFIED in this repository

Nobody has observed these on this machine. Each is CANNOT VERIFY until a probe closes it, and the
line is struck through when one does.

- ~~**Whether `tsc --listFiles` and `--showConfig` behave on TypeScript 7 as the design assumed**~~ —
  CLOSED (m, 2026-11-01): both exit 0 and answer on `-p packages/core/tsconfig.json`; `--listFiles`
  printed 92 absolute paths, `--showConfig` printed the resolved options. These two flags, with
  `vitest list --json`, were named the design's main risk; all three answer, so the levels of
  `L-core-purity`, `L-orphans` and `L-tsc` that rest on them stand, and `--listFiles` was observed
  catching the hole they exist for — a relative import out of the package put
  `apps/api/src/index.ts` in `packages/core`'s own file list. No tech-debt entry is owed for a risk
  that closed by measurement. What the flags do NOT fix is the lib-path shape (Part 2 — a filter on
  the familiar `typescript/lib/` path matches nothing), the double-escaped quote in the list
  (Part 3) and the empty index before commit 1 (Part 3).
- **The browser lane in full**: `@playwright/test` is installed, the browsers are not downloaded
  (m), so no e2e test has ever run — not red, not green (TD-0001, `playwright.config.ts:3-5`).
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
  (`vitest.config.ts:19-36`); both read `tests="17" failures="0"` on the same tree (m) and no case has
  ever disagreed, so `L-env-parity`
  is a lane with no observed signal (TD-0006; testing.md explains why it is nonetheless the one honest
  parity lane here).
- **The dual-channel cross-check as a GATE.** The collection-failure shape is measured on BOTH
  channels and the three counter identities hold on a green and on a red run (Part 2), so the
  unverified part is no longer the artifact — it is the gate: nothing reads `crossCheck` yet, and no
  fixture has made the two channels disagree on purpose, so `agree: true` has only ever been observed
  where agreement was the expected answer (TD-0005).
- **`vite build` as any kind of verdict.** Every project is `noEmit`; nothing in this repository has
  ever built `apps/web` for real, and bundle size is not a lane (TD-0010).
- **A run of record with a watcher alive, and two runs of record at once.** `WATCHERS` and `.ci/lock`
  exist to forbid it; the failure mode they forbid has not been observed here.
- **`require-await`** — the one defect class the lint lane does not catch (m: eslint caught it, oxlint
  did not), recorded in `docs/tech-debt/` rather than papered over.
