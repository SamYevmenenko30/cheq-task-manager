# cheq-task-manager — agent guide

Canonical guide for AI agents working in this pnpm monorepo. Read before making any change.

cheq is a task manager whose product is not written yet: **nothing in this repository describes
the product** — no task model, no statuses, no schedule, no schema, no API shape — and no agent
invents it. What exists is the way a vision text becomes a spec, a spec becomes red tests, and
red tests become code that the toolchain itself has judged. The domain arrives through a spec
(`docs/specs/CHQ-<nnn>.md`) or it does not arrive.

Three things carry that honesty, and every section below is a consequence of one of them:

1. **A verdict is read from an artifact on disk, not from an exit code.** An exit code is
   advisory. A missing artifact is CANNOT VERIFY — a third verdict, never green.
2. **Every gate has a probe that fails on a knowingly bad fixture.** A gate nobody has seen
   fail is a gate nobody has seen.
3. **Machine state has one source and one reader.** No version, no seconds figure and no
   freshness verdict is written into this file; each is read from the file or the command that
   owns it (ADR-0003).

## Environment

- **Node and pnpm versions are not written here.** Node is `.nvmrc:1`; pnpm is the
  `packageManager` field, `package.json:9`. Every dependency's version is `pnpm-lock.yaml`, and
  the version **of record** is `git show HEAD:pnpm-lock.yaml` — the lock a base checkout installs
  from — never the working tree's copy (ADR-0003). `node tools/gates/status.mjs` (`pnpm run status`)
  prints each one with its key, or `unavailable (<reason>)`.
- **No budgets section exists, and no seconds figure appears in this file.** `status.mjs` prints
  `BUDGETS=unavailable (no calibration lane)`; `ready` reports the actual seconds of the steps it
  just ran. A figure a fix round timed on its own stays in the header of the script that measured
  it, labelled (TD-0002).
- **The workspace** is `packages/*`, `apps/*`, `tools/*` (`pnpm-workspace.yaml:1-4`). The linker is
  `node-linker=isolated` (`.npmrc:4`): with a hoisted layout `packages/core` could import what it
  never declared, and the empty-`dependencies` check that carries rule 1 would become cosmetic.
  Changing `.npmrc` is a `gate:` commit with an ADR line (`.npmrc:1-3`).
- **`tools/gates` has ZERO runtime dependencies and is deliberately NOT a workspace package**
  (`package.json:5`). Every gate is a Node ESM `.mjs` importing only node builtins, so a gate runs
  in a fresh worktree *before* an install finishes — which is exactly when it is needed. A gate
  never parses TypeScript itself: questions about types are delegated to `tsc`, and the gate reads
  `tsc`'s output. A token scan over text with comments and strings stripped is allowed and used;
  an AST walk is not.
- **One type engine.** The linter is `oxlint` with `oxlint-tsgolint`, whose type-aware engine is
  typescript-go — the same engine line as the root `tsc`. `eslint`, `typescript-eslint`,
  `@eslint/js` and the eslint React plugins are **absent from this repository on purpose**:
  typescript-eslint refuses TypeScript 7 outright
  ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940))
  and it is the only TypeScript parser for eslint, so with TS 7 eslint cannot lint a `.ts` file
  here at all. The alternative — a second `typescript` inside a lint-only package — was built,
  verified working and then **reversed**, because two type engines can disagree about the code
  while only one of them is the verdict. ADR-0004 keeps the reasons; `L-type-engines` keeps the
  second engine from coming back.
- **The lint config is `.oxlintrc.jsonc`** (jsonc, not json: oxlint's JSON config is strict about
  unknown fields, so a `"//"` comment key is a parse error, and with both files present oxlint
  refuses to start). Two measured traps live in its header: `--type-aware` is **required** or the
  type rules silently do not run (`.oxlintrc.jsonc:10-12`), and the `any`-leak family is in no
  default category and must be named by hand (`.oxlintrc.jsonc:13-15`, `:49-54`). A config written
  with `categories` alone checks less than it appears to.
- **Determinism in `packages/core` is not a lint rule.** oxlint has no `no-restricted-syntax`, and
  a blanket `no-restricted-globals` on `Date`/`Math` was the wrong shape — it refused
  `x instanceof Date` (a type), `new Date(0)` (a fixed value) and `Math.floor` (arithmetic), none
  of them a clock. The precise check is a token scan in `L-core-purity`
  (`.oxlintrc.jsonc:18-23`).
- **Suppression is file-level only** (measured): `// oxlint-disable <rule>` suppresses a type-aware
  rule, `// oxlint-disable-next-line <rule>` does not, with or without the plugin prefix. Behaviour
  of `-next-line` on *non*-type rules is UNVERIFIED. `L-lint` fails on a file-level disable naming a
  boundary rule, and also reports an `eslint-disable`-shaped comment: it suppresses nothing here,
  but its presence means somebody tried (`.oxlintrc.jsonc:24-26`).
- **The test runner of record is `jest.config.mjs`**, and a project's `displayName` **is** the spec
  `kind`: `core` (node, `jest.config.mjs:87`), `core-dom` (jsdom, the same files — the one honest
  parity lane this repository has, `:94`), `api` (node, `:101`), `web` (jsdom, `:108`). Each
  project's `testMatch` carries a leading `<rootDir>/` token resolved against that project's own
  `rootDir`, so the four includes are four different roots, not four globs over the repository.
  One measured fact is encoded there by ABSENCE: the `jest-junit` reporter is declared with **no
  `outputFile`**, so the JUnit path travels in the environment as `JEST_JUNIT_OUTPUT_FILE` and
  nothing else (`jest.config.mjs:60-69`). One more is absent from the ARGV: `--passWithNoTests` is
  never passed, because the default already exits non-zero when no test FILE matched — passing it is
  the dangerous spelling (`tools/gates/run.mjs:641-645`).
- **The runner does not typecheck at all** — `@swc/jest` strips types in Rust — so a missing export
  surfaces as a runtime error indistinguishable from an assertion without the second channel. Both
  channels — `tsc` for types, the JUnit XML for behaviour — are read on **every** run of record
  ([TD-0004](docs/tech-debt/TD-0004-runner-does-not-typecheck.md)). The repository therefore keeps
  exactly ONE type engine: `tsc` checks, swc only strips (`jest.config.mjs:6-11`).
- **The browser lane is CANNOT VERIFY.** `@playwright/test` is installed; the browsers are **not
  downloaded**. `playwright.config.ts` is committed with `retries: 0` and `forbidOnly: true`
  (`playwright.config.ts:10-12`) so a trimmed or retried run cannot look successful, and
  `tools/gates/run.mjs e2e` refuses while `.ci/probe.json` does not carry `browser_probe: "pass"`,
  printing `CANNOT VERIFY (playwright browsers not installed — TD-0001)` and exiting 2, never 0.
- **Runs of record use a second checkout**, not the developer's tree: a `git worktree` at
  `/Users/semenyevmenenko/work/cheq-task-manager-ci/<label>`, pinned to a named commit, with a clean
  tracked tree, installed by `pnpm install --frozen-lockfile --offline`. There is nothing to copy:
  the pnpm store is content-addressable. Measured trap (TD-0007): `pnpm install` once reported
  `Lockfile is up to date, resolution step is skipped` and kept a stale package — "the install
  succeeded" does not mean "the tree matches the lock", so red-check compares the sha256 of
  `git show <mergeBase>:pnpm-lock.yaml` against what it installed from, and a mismatch is
  CANNOT VERIFY. The other half of that trap is louder and was LIVE here: a root manifest declaring
  no `devDependencies` while the lock lists an importer's packages makes `--frozen-lockfile` refuse
  before a single gate runs (`ERR_PNPM_OUTDATED_LOCKFILE`, observed and then fixed 2026-11-01;
  `pnpm install --frozen-lockfile --lockfile-only` now exits 0 and rewrites nothing). A manifest and
  a lock that disagree are not a slow CI, they are no CI.
- **An exit code lied twice while this toolchain was being measured** (2026-11-01, recorded in
  ADR-0002): `eslint … | head` reported `exit=0` while eslint had crashed with 2, and
  `tsc … | head -12` reported `exit=0` over four `error TS6059`. Both times `$?` belonged to
  `head`. No gate pipes the output of the tool it is judging; the exit code is captured separately
  and written to `run.json`, where it stays advisory.
- **The pre-commit hook** is `.githooks/pre-commit` (executable, installed by
  `git config core.hooksPath .githooks`, already set). It runs
  `node tools/gates/ready.mjs --quick --pending-implementation-tolerance`
  (`.githooks/pre-commit:18`) and writes nothing — no formatter, no `--fix`: a hook that edits the
  tree changes the tree the gates just judged. What it sees is in its own header
  (`.githooks/pre-commit:2-7`): the range-based gates read **HEAD**, i.e. the previous commit,
  because no gate reads the index, while the filesystem lights see the working tree. The commit
  being created is checked in full by the next `pnpm run ready` — that is the check of record before a
  push. Escape once with `CHEQ_SKIP_HOOKS=1 git commit …` (`.githooks/pre-commit:10`). red-check
  never runs in a hook: it needs a worktree and a base run.
- **Line endings** are LF for every text file (`.gitattributes:3`), so a gate that diffs text never
  sees a `\r` it did not put there.
- Whether HEAD exists at all is machine state too: this repository is young enough that the
  range-based gates must handle an empty history, which they do through git's empty-tree object
  (`lib/git.mjs` `EMPTY_TREE`). Read the current state from `pnpm run status`, not from this file.

### npm scripts

Each is a bare `node tools/…` so a gate runs without pnpm filters and without installed workspace
binaries (`package.json:31-49`).

| script | command | what |
|---|---|---|
| `spec-gate` | `node tools/gates/spec-gate.mjs` | the spec is well-formed; `--require-approved CHQ-<nnn>` for the trailer |
| `red-check` | `node tools/gates/red-check.mjs` | proves new tests red on the base, per file and per case |
| `test-guard` | `node tools/gates/test-guard.mjs` | spec tests were not edited by the implementation phase |
| `gate-probes` | `node tools/gates/gate-probes.mjs` | each gate fails on its bad fixture; `--real` writes `.ci/probe.json` |
| `lights` | `node tools/gates/lights/run.mjs` | the standing lights pack (`--fast` / `--thin` / `--all`) |
| `ready` · `ready:quick` | `node tools/gates/ready.mjs` · `… --quick` | the verification block; `--quick` is the hook path |
| `status` | `node tools/gates/status.mjs` | PRE-FLIGHT: one call, flat flags, every machine-state key |
| `project` | `node tools/gates/project.mjs` | text inspector — what rule 4 cites `path:line` from |
| `digest` · `digest:check` | `node tools/gates/digest.mjs --fix` · `--check` | regenerate / verify `docs/digests/` |
| `types` | `node tools/gates/run.mjs types --kind all` | `tsc --noEmit` per project into an artifact |
| `test:core` · `test:api` · `test:web` | `node tools/gates/run.mjs test --kind <k>` | the run of record for that kind |
| `e2e` | `node tools/gates/run.mjs e2e` | the browser lane; CANNOT VERIFY until `browser_probe: pass` |
| `lint` | `node tools/gates/run.mjs lint` | `oxlint --type-aware` into `oxlint.json` |
| `dev:web` · `dev:api` | `pnpm --filter @cheq/{web,api} exec …` | ADVISORY only — no gate reads a dev server |

## Verdicts of record — kind → runner → command → artifact

The heart of the port. A spec's `verify:` is **derived** from its `kind` by `deriveVerify` and never
typed by hand; it names the runner only — no version, no path, no machine state. The `kind` name
**is** the runner's project name (`displayName`): one chain from file path to kind to project to
artifact, with no registry in the middle to drift.

| kind | test lives in | fast loop (after every edit) | VERDICT OF RECORD | ARTIFACT the verdict is read from | `verify:` |
|---|---|---|---|---|---|
| `core` | `packages/core/test/CHQ-<nnn>/S<n>_<slug>.test.ts` | `pnpm exec tsc --noEmit -p packages/core/tsconfig.json`, then `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --selectProjects core -t '^S<n>_'` | `node tools/gates/run.mjs test --kind core --label <l>` | `.ci/runs/<ts>-<l>/{core.junit.xml, core.json, tsc.core.log, run.json}` | `tsc-noemit + jest-core` |
| `api` | `apps/api/test/CHQ-<nnn>/S<n>_<slug>.test.ts` | the same with `-p apps/api/tsconfig.json`, `--selectProjects api`; the honest fast loop is `app.inject()`, never `curl` against a live port | `node tools/gates/run.mjs test --kind api --label <l>` | `.ci/runs/<ts>-<l>/{api.junit.xml, api.json, tsc.api.log, run.json}` | `tsc-noemit + jest-api` |
| `web` | `apps/web/test/CHQ-<nnn>/S<n>_<slug>.test.tsx` | the same with `-p apps/web/tsconfig.json`, `--selectProjects web` | `node tools/gates/run.mjs test --kind web --label <l>` | `.ci/runs/<ts>-<l>/{web.junit.xml, web.json, tsc.web.log, run.json}` | `tsc-noemit + jest-web` |
| `e2e` | `e2e/CHQ-<nnn>/S<n>_<slug>.spec.ts` | none that is honest | `node tools/gates/run.mjs e2e --label <l>` | `.ci/runs/<ts>-<l>/{e2e.junit.xml, run.json}` — **and this is CANNOT VERIFY until `.ci/probe.json` carries `browser_probe: "pass"`** | `playwright-chromium` |

Every fast loop needs `NODE_OPTIONS=--experimental-vm-modules` in its environment — the wrapper sets
it for a run of record, a hand-run must set it itself — and a fast-loop `-t` is a convenience, never a
verdict: a pattern that matches no case exits 0 and calls itself a success (measured; the reader below
is what refuses it).

Both halves of a run of record are mandatory on every run, because **the runner does not typecheck
at all**:

```
pnpm exec tsc --noEmit --pretty false --listFiles -p <pkg>/tsconfig.json  > .ci/runs/<ts>-<l>/tsc.<kind>.log
JEST_JUNIT_OUTPUT_FILE=.ci/runs/<ts>-<l>/<kind>.junit.xml \
NODE_OPTIONS=--experimental-vm-modules \
pnpm exec jest --selectProjects <kind> --ci --runInBand \
      --json --outputFile=.ci/runs/<ts>-<l>/<kind>.json
pnpm exec playwright test --reporter=junit        # only while browser_probe: pass
```

**Half of that contract is in the ENVIRONMENT, not in the argv.** `jest-junit` is declared with no
`outputFile`, so without `JEST_JUNIT_OUTPUT_FILE` it writes `junit.xml` into the current directory —
one file every run overwrites (measured 2026-11-02). `runTool` records what it added to the child's
environment as `envExtra` in `run.json`, and `L-artifacts` judges that field exactly as it judges the
argv (`REQUIRED_ENV`, `tools/gates/lights/artifacts.mjs:171-177`). `NODE_OPTIONS=--experimental-vm-modules`
is required for ESM; without it every test dies with `Cannot use import statement outside a module`,
which reads like a broken source and is not one.

**The dotted `--outputFile.<reporter>=` form is the PREVIOUS runner's and must never be written.**
Measured 2026-11-02: this runner's parser accepts `--outputFile.json=B` without a word, runs every
test and writes **no file** — worse than a crash, because the run looks complete. One bare
`--outputFile=<path>` is the only legal form, and `L-artifacts` refuses the dotted one
(`tools/gates/lights/artifacts.mjs:300-310`). `--retry`, `--no-file-parallelism` and
`--reporter=junit` do not exist on this runner either: `--ci` and `--runInBand` are what replaced
the first two, and the JUnit reporter is declared in the config, not on the command line.

Standing lanes, not tied to a `kind` (they produce no `green:` trailer but are part of `ready`):

| lane | command | artifact | label when the premise is missing |
|---|---|---|---|
| lint | `pnpm exec oxlint --type-aware --format=json` with stdout redirected to `.ci/runs/<ts>-<l>/oxlint.json` | `oxlint.json` | `number_of_files === 0` ⇒ CANNOT VERIFY |
| env-parity | the same `packages/core/test/**` under `--selectProjects core` and `--selectProjects core-dom`, each with its own `JEST_JUNIT_OUTPUT_FILE` (`tools/gates/lights/env-parity.mjs:339-352`) | two JUnit XML + `run.json` | artifact older than any source under `packages/core` ⇒ RE-RUN, never a comparison |
| type-engines | `git show HEAD:pnpm-lock.yaml` | `engines.json` | more than one `typescript`, or a declared `eslint`/`typescript-eslint` ⇒ fail |

**One reader per artifact format** (`tools/gates/lib/`), so the writer and the reader of a fact
cannot drift apart:

- `junit-xml.mjs` — the verdict from `<testsuites tests failures errors>` and each
  `<testcase classname name>`; `classname` is the file path **from the repository root** and `name`
  is `"<describe> > <test>"` — a shape the four `jest-junit` templates buy and that nothing else
  guarantees (`jest.config.mjs:75-78`). File absent ⇒ CANNOT VERIFY · `tests="0"` ⇒ CANNOT VERIFY ·
  a `classname` outside the expected file ⇒ CANNOT VERIFY (somebody else's project) · `skipped > 0`
  among a spec's cases ⇒ CANNOT VERIFY · a `name` that carries the FILE instead of a case ⇒ a
  **collection** failure, not a case (measured) · otherwise green/red. **That last one is not an
  equality.** On a collection failure both attributes carry the same file in two spellings —
  `classname` from the repository root, `name` from the project's own `root` — so
  `classname="packages/core/test/…/b.test.ts" name="test/…/b.test.ts"`: `name === classname` is
  false, `name === basename(classname)` is false, and the predicate that fires is
  `classname.endsWith('/' + name)` (`tools/gates/lib/junit-xml.mjs:219-246`). A gate written on the
  equality reads a file that never parsed as an ordinary red case, and red-check would accept
  "red on base" from a test nobody compiled. **That predicate is a dated observation of the PREVIOUS
  runner** (2026-11-01): `tools/gates/red-check.mjs:121-130` records that the runner of record omits
  an uncollected file's `<testsuite>` from the XML altogether and counts it only in the JSON channel,
  so `isCollectionFailure` has nothing to match and red-check blocks instead of guessing.
- `jest-json.mjs` — the second channel, reading this runner's `--json` report. The module was
  renamed with the runner; what it knows is the FORMAT, and the format did not change. The field names are the
  ones it already used — `numTotalTests` / `numPassedTests` / `numFailedTests` / `numPendingTests` /
  `numTodoTests`, and per file `{ name (an ABSOLUTE path), status, message, assertionResults }`. A
  counter that disagrees with the XML ⇒ CANNOT VERIFY. **The guard this reader exists for is the
  measured silent pass** (2026-11-02): a `-t` filter matching no case exits 0 with `success: true`,
  `numTotalTests: 17`, `numPassedTests: 0`, `numPendingTests: 17`, so the reader refuses any report
  where `passed + failed === 0` — a run that executed no case says nothing about the code
  (`tools/gates/lib/jest-json.mjs:79-92`, `:167-174`). The three counter identities that reconcile
  the two channels through the collection failures, never through a raw `tests === numTotalTests`,
  are at `:201-203`; they were measured on the previous runner's artifacts and whether they close on
  this one is UNVERIFIED (`tools/gates/red-check.mjs:121-130`). `crossCheck` returns
  `{ ok, agree, verdict: 'agree' | 'cannot-verify' }` and answers one question — do the two channels
  describe the same run — never "did the tests pass": a field named `verdict` carrying `'green'` is a
  label waiting to be misread (`jest-json.mjs:210-221`). One cross-channel difference is measured
  and permanent: the JSON's `fullName` joins ancestors with a SPACE while the XML's `name` joins with
  ` > `, so a name taken from one channel is not a key in the other; `crossCheck` compares COUNTS and
  is unaffected. What stays open is the cross-check **as a gate**: no gate reads it yet, and no
  fixture has made the channels disagree on purpose (TD-0005).
- `tsc-log.mjs` — lines `path(line,col): error TSxxxx: msg` (measured), deduplicated by
  `path|line|col|code`. Green needs zero diagnostics **and** a positive sign that the compiler read
  something: `filesChecked > 0` from `--listFiles`. `exit 0` without that sign ⇒ CANNOT VERIFY —
  never-ran is not green.
- `oxlint-json.mjs` — `number_of_files` is the lint-file counter, and `0` ⇒ CANNOT VERIFY. `code` has
  the shape `plugin(rule-name)` — **parentheses, not a slash** — so `eslint(...)` means a core rule;
  `severity` is `"error"` | `"warning"` and the error count is the length of `diagnostics`, as there
  is no total field; line and column live in `labels[].span`, not at the diagnostic's top level.
  oxlint's `--format=junit` exists and is **not** used, so a JUnit XML under `.ci/` means exactly
  "a test run happened".

**Four signatures a test is red by, and only one of them is proof** (ADR-0002 item 5). This is the
vocabulary red-check classifies with, and it is a DATED OBSERVATION: each defect was planted and the
XML read back **on 2026-11-01, on the previous runner** (`tools/gates/lib/junit-xml.mjs:25-41`,
`:314-334`). The `type` and `message` attributes have not been re-measured on the runner of record —
`tools/gates/red-check.mjs:113-120` records that `jest-junit` writes the failure text as the element
BODY and leaves `type` and `message` off, which makes `redReason` answer `unknown` and red-check
answer CANNOT VERIFY. The classification below is therefore the shape the readers expect, not a
verdict anyone has earned on this runner yet:

| why it is red | `<failure type=>` | message | `testcase name` | verdict |
|---|---|---|---|---|
| honest assertion | `AssertionError` | `expected … to be …` | the case's own name | **assertion-red** — proof |
| the export is not written yet | `TypeError` | `… is not a function` | the case's own name | pending implementation |
| the identifier was never declared | `ReferenceError` | `… is not defined` | the case's own name | pending implementation — **the commonest shape of the test phase**: a spec test calls a function nobody has written |
| the module is not written yet | `Error` | `Cannot find module …` | **the file**, in the project's own spelling | pending implementation — collection never reached the case |

The two middle rows are the SAME defect reaching the artifact two ways — a missing export is a
`TypeError`, a name that was never imported at all is a `ReferenceError` — and a reader that knows
only the first reads the second as "red for a reason I cannot name" and refuses the whole test phase
as inconclusive. A fifth signature is not about the code under test at all: `Error` +
`Cannot find package '@cheq/core'` means the worktree was never installed, and it is CANNOT VERIFY,
never pending (`junit-xml.mjs:35-41`).

Red is proof only when `tsc` is clean **and** the failure type is an assertion type **and** the
testcase names a case rather than its file. The tolerance for the others is narrow, named
(`--pending-implementation-tolerance`), applies to `L-tsc` only, and is granted by the state of the
world — `packages/core/src` clean and every error a missing symbol inside a spec test — never by a
flag alone. It is a hook tolerance: every strict run still fails on them.

## Repository map

`[is]` = exists on disk now (verified by `find` over the repository, 2026-11-02); `[not created]`
= named by the plan and still to be written. The gates, the roles and the knowledge base exist; what
is still missing is the product — every `CHQ-<nnn>` path below, the stub kit, and the e2e lane.

```
AGENTS.md                              [is]   this file
.gitattributes                         [is]   LF for every text file (:3) — a text-diffing gate sees no \r
.gitignore                             [is]   node_modules/ (:2) · .ci/ (:10) · coverage/ (:11) · /e2e/.auth/ (:28)
.githooks/pre-commit                   [is]   node tools/gates/ready.mjs --quick (:18); CHEQ_SKIP_HOOKS escape (:10)
.npmrc                                 [is]   node-linker=isolated (:4) — hoisting would make rule 1 cosmetic
.nvmrc                                 [is]   the ONLY source of the node version (ADR-0003)
.oxlintrc.jsonc                        [is]   the lint lane: plugins (:30, the `jest` plugin among them), categories (:32-37), rules (:39-58), ignorePatterns (:60-67), overrides (:69-93)
package.json                           [is]   scripts only; `packageManager` (:9) is the pnpm source; the zero-dependency rule for tools/gates is written in `description` (:5)
pnpm-workspace.yaml                    [is]   packages/* apps/* tools/* — tools/gates is NOT a package in it
pnpm-lock.yaml                         [is]   the only source of every dependency version (rule 4)
tsconfig.base.json                     [is]   strict (:19), noUncheckedIndexedAccess (:20), exactOptionalPropertyTypes (:23), allowImportingTsExtensions (:17); skipLibCheck (:26) is a declared debt (TD-0004)
jest.config.mjs                        [is]   four projects = four kinds (:87, :94, :101, :108); the jest-junit templates, load-bearing (:75-78); no outputFile on purpose (:60-69); the 80% coverage floor (:130-135)
playwright.config.ts                   [is]   chromium (:27), retries 0 + forbidOnly (:11-12) — committed; browsers NOT installed (TD-0001, :3-5)

packages/core/package.json             [is]   @cheq/core; `"dependencies": {}` (:7) IS the carrier of rule 1; exports "." and "./testing" (:8-11)
packages/core/tsconfig.json            [is]   lib ["ES2023"], types [] (:7-8), noEmit, NO rootDir/outDir (a rootDir with a test include is error TS6059 — measured)
packages/core/src/index.ts             [is]   the public barrel; a marker export only — the domain arrives through a spec
packages/core/src/testing/sha256.ts    [is]   SHA-256 in plain TypeScript: core may not import node:crypto, and has no TextEncoder either
packages/core/src/testing/digest.ts    [is]   `digest(state)` — the observable a `kind: core` case cites; stableStringify REFUSES Date, undefined, NaN, functions and cycles
packages/core/test/skeleton/*.test.ts  [is]   spec-less fixtures: guarded, NEVER red-checked, never a spec's `check:`
packages/core/src/contracts/CHQ-<nnn>/ [not created]  only when a spec says `contracts: allowed` — types only, no bodies
packages/core/test/CHQ-<nnn>/          [not created]  per spec: S<n>_<slug>.test.ts
packages/stubkit/                      [not created]  @cheq/stubkit — the only source of stub primitives (rule 9)
apps/api/{package,tsconfig}.json       [is]   @cheq/api — fastify adapter; depends on @cheq/core only
apps/api/src/index.ts                  [is]   marker; routes arrive through specs
apps/api/test/skeleton/marker.test.ts  [is]   guarded fixture
apps/api/test/CHQ-<nnn>/               [not created]  per spec
apps/web/{package,tsconfig}.json       [is]   @cheq/web — vite + react; lib includes DOM (tsconfig :4)
apps/web/{index.html,vite.config.ts}   [is]   the vite entry
apps/web/src/{main.tsx,App.tsx}        [is]   App.tsx is the rule-9 stub: honest empty state, one hypothesis sentence, a visible STUB tag, no invented data
apps/web/test/setup.ts                 [is]   afterEach(cleanup) (:7) — measured as mandatory: without it a second render() finds the first still mounted; wired as setupFilesAfterEnv (jest.config.mjs:112)
apps/web/test/skeleton/stub.test.tsx   [is]   guarded fixture; asserts what rule 9 demands
apps/web/src/stubs/                    [not created]  the ONLY place a stub screen may live (rule 9, L-stubkit)
e2e/CHQ-<nnn>/                         [not created]  per spec: S<n>_<slug>.spec.ts

tools/gates/{spec-gate,red-check,test-guard,gate-probes,ready}.mjs   [is]   the five gates
tools/gates/{run,status,project,digest}.mjs                          [is]   run of record · pre-flight · text inspector · docs/digests generator
tools/gates/{homes,visible,generated,role-scope}.json                [is]   the four declared manifests the lights read
tools/gates/lib/*.mjs                                               [is]   one reader per fact: spec-parse · test-file-patterns · test-cases · test-project · junit-xml · jest-json (the runner's --json report) · tsc-log · oxlint-json · trailers · probe · git · run-dir
tools/gates/lights/run.mjs + lights/*.mjs + lights/_shared.mjs       [is]   the registry, the sixteen lights, and the one walk/readPackages/codeOnly they share
tools/gates/fixtures/{jest,oxlint,tsc}/ + fixtures/manifest.json     [is]   probe fixtures, one directory per artifact format, declared in the manifest

.claude/skills/ts-loop/SKILL.md                                      [is]   loaded FIRST by the three phase skills
.claude/skills/{spec-harden,tests-from-spec,implement-to-green}/     [is]   the three phases, each in a FRESH session
.claude/agents/{core,api,web,verifier,reviewer}.md                    [is]   optional delegation roles; each names its write scope and the light that checks it
.claude/settings.json                                                [is]   permissions.deny — a deliberate divergence from Resonance, which has no settings file

docs/specs/README.md                                                 [is]   the spec IS the map; first section `## Vision (verbatim)`
docs/specs/CHQ-<nnn>.md                                              [not created]  per feature
docs/templates/{SPEC.md,ADR.md,AGENTS.package.md}                    [is]
docs/knowledge/{loop.md,testing.md,process.md}                       [is]   the working loop · the four kinds and their runners · what the machine checks and what a human reviews
docs/decisions/ADR-0001..0005                                        [is]   package layers · verdict of record (red is classified from the artifact, item 5) · machine state has one source · one type engine · core purity at three levels
docs/tech-debt/README.md + TD-<nnn>-<slug>.md                        [is]   what is not yet verified or deliberately deferred; README.md is the index every TD id is looked up in
docs/vendor/README.md + <package>.md                                 [is]   rule 15: an API digest before a dependency's first use
docs/digests/{core-exports.md,api-routes.md}                         [is]   GENERATED projections of what a human cannot diff; L-generated fails a stale one

.ci/                                   [is, gitignored]  runs/<ts>-<label>/ · probe.json · lock · tests/ (the fast loop's own output)
coverage/                              [gitignored (:11)]  where --coverage lands; the runner of record writes no in-repo cache directory of its own
Outside the repository:                /Users/semenyevmenenko/work/cheq-task-manager-ci/<label> — the git worktree every base run uses
```

Knowledge base (read when working in the corresponding area):

- `docs/knowledge/loop.md` — the agent ⟷ toolchain loop: which command, what it reads back, what
  it must never be trusted for, the UNVERIFIED list. Read first in every session.
- `docs/knowledge/testing.md` — the four kinds, kind → runner → command → artifact, the naming
  contract, red-check's routes and verdict labels.
- `docs/knowledge/process.md` — what the machine checks locally, the spec-first flow, what a human
  reviews, the doc-sync table, commit conventions.
- `docs/decisions/` — the ADRs. `docs/tech-debt/README.md` — the open debts and what closes each.

## Boundaries (enforced by the lights; a violation is NOT READY)

`tools/gates/lights/run.mjs` holds the registry. A light is
`{id, severity, run({root, mb, allow}) → {id, severity, status, detail}}` with
`status ∈ pass | fail | cannot-verify`, and `detail` is **mandatory**: it carries the artifact path
or the list of problems. Aggregation: a `hard` light that is not `pass` blocks — **cannot-verify
blocks exactly as fail does**, with the line `a light that cannot run is not green`. A thrown
exception becomes `cannot-verify · threw: <first line>`; a light that did not run prints an explicit
`not run (<reason>)` row and never disappears from the table.

| id | severity | what it checks | artifact / source |
|---|---|---|---|
| `L-tsc` | hard | the compile verdict of record per project; `filesChecked === 0` ⇒ cannot-verify; the allowed tsconfig fields are pinned (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and NO `rootDir`/`outDir` — the measured TS6059 defect); `skipLibCheck: true` is tolerated only with a TD-0004 reference | `tsc.<kind>.log` + `tsc --showConfig` |
| `L-core-purity` | hard | three levels: the declared boundary (`dependencies: {}`, `lib` without DOM, `types: []`), the **import graph** (no specifier in `packages/core` resolves outside it — the one hole neither the compiler nor the linter nor pnpm closes), and a token scan for a hidden clock (`Date.now(`, `new Date()` with an EMPTY argument list, `Math.random(`, `performance.now(` are refused; `new Date(<arg>)`, `instanceof Date`, `Date` as a type and every other `Math` member are allowed) — over `packages/core/**` **including `test/**`**. A nested `package.json`/`tsconfig.json` under `packages/core/src` ⇒ REFUSED; a non-literal `import(expr)` in core ⇒ REFUSED | `--listFiles`, `--showConfig`, `package.json`, token scan |
| `L-graph` | hard | edges are only `@cheq/api → @cheq/core` and `@cheq/web → @cheq/core`; `@cheq/core` depends on nobody; no cycle; **no relative import leaving its own package root**; no tsconfig `paths` and no `alias` **or `moduleNameMapper`** into another package's `src` — the alias scan reads both keys, in `vite.config.*` and in `jest.config.*`, because a module-name remap is the same hazard under another name (`tools/gates/lights/graph.mjs:143-153`); the declared edges equal the real `--listFiles` closure; `name` matches the directory | every `package.json` + `--listFiles` + `pnpm list --json --depth 0` |
| `L-lint` | hard | `oxlint --type-aware` with zero warnings tolerated; `number_of_files === 0` ⇒ cannot-verify; the run's `argv` must contain `--type-aware` (written into `run.json`); a FILE-level `oxlint-disable` naming a boundary rule ⇒ fail, and an `eslint-disable`-shaped comment is reported too; the required rule ids are asserted **numerically** present in `.oxlintrc.jsonc` → `rules` at severity `error`, because the `any`-leak family is in no category | `oxlint.json` + `.oxlintrc.jsonc` |
| `L-type-engines` | hard | exactly **ONE** type engine, and it stays one: `git show HEAD:pnpm-lock.yaml` holds exactly one `typescript` version; no `package.json` in HEAD declares `eslint`, `typescript-eslint` or `@typescript-eslint/*`; `oxlint-tsgolint` is declared and its major matches `typescript`'s major — if those two drift apart, the type-aware rules and the compile verdict are again about different things. Any mismatch ⇒ fail with both versions in `detail` | `git show HEAD:pnpm-lock.yaml` → `engines.json` |
| `L-testshape` | hard | only the declared test-file shapes; the first argument of `it(`/`test(` in a spec test is a string literal beginning `S<n>_`; one top-level `describe` per file; at most seven tests; no `.only`; no `toMatchSnapshot`/`toMatchInlineSnapshot` in a spec test; no `@ts-expect-error`, `@ts-nocheck` or `as any` (a token scan, **not** `typescript/ban-ts-comment` — measured: that rule stayed silent on `// @ts-expect-error nope`, so it is being configured and probed separately); **no `.failing`** — measured 2026-11-02, the runner reports a case whose body THROWS as `"passed"`, so a spec test written that way is green exactly when its assertion fails and red-check could never prove it red (`tools/gates/lights/testshape.mjs:157-165`); the number of executed cases is not below the static count | sources + JUnit XML |
| `L-testguard` | hard | the same judgement as `test-guard.mjs`, run as a light inside the pack | git |
| `L-deps` | hard | a `package:` trailer at column zero; `dependencies` **and** `devDependencies` **and** `peerDependencies` of **every** `package.json` are judged (devDeps execute code: postinstall, vite plugins); `pnpm-lock.yaml` drift that touched no manifest is named separately; a removal declared by nothing ⇒ always fail; a pre-1.0/beta/rc version additionally requires a TD; a runtime dependency with no `docs/vendor/<pkg>.md` in the same range ⇒ fail; a digest version that differs from the lock ⇒ fail | git log + `git show <rev>:<package.json>` + the lock |
| `L-env-parity` | hard | the same `packages/core/test/**` under `--selectProjects core` (node) and `--selectProjects core-dom` (jsdom), each run with its own `JEST_JUNIT_OUTPUT_FILE`, diffed tri-state **by case name**; a divergence ⇒ fail with both verdicts; **an artifact older than any source under `packages/core` ⇒ RE-RUN, not a comparison** (`node=green dom=absent` is not a disagreement about code); the freshness key is CONTENT (`sha256` over `git ls-files -s packages/core`), never mtime, because a checkout rewrites mtime to "now" | two JUnit XML + `run.json` |
| `L-artifacts` | hard | every run directory has a `run.json` with `head` / `treeClean` / `argv` / `exitCode`; the four halves are `tsc \| oxlint \| jest \| playwright`, and for each one the record's argv and its `envExtra` are judged — the required jest flags are `--ci` and `--json`, the required jest environment is `JEST_JUNIT_OUTPUT_FILE`, and a dotted `--outputFile.<reporter>=` in the argv is refused outright; no artifact is ever found by a "newest" glob; a run directory is never reused — a failed run must not leave the previous artifact for the next gate to read as its own green | `.ci/runs/**/run.json` |
| `L-generated` | hard | every entry of `generated.json` is regenerated into a tmpdir and compared BYTE for byte against the committed file; on failure `detail` prints the CURE command | tmpdir vs HEAD |
| `L-visible` | hard | **four doors, not one:** nothing under `packages/`, `apps/`, `e2e/` is hidden from a gate by `.gitignore`, by `ignorePatterns` in `.oxlintrc.jsonc`, by `exclude` in a tsconfig, or by the fourth door **`jest-ignorePatterns`** — `testPathIgnorePatterns` / `modulePathIgnorePatterns` in `jest.config.mjs` — except what `visible.json` declares; every declared entry is itself checked (ignored by git, holding no tracked file); and the claim is made NUMERICALLY against `git ls-files`, so "I narrowed an include and everything went green" shows up as a fail. **The fourth door HIDES, it does not NARROW:** a narrowed `testMatch` is `L-orphans`'s question, not this light's, and splitting them is deliberate (`tools/gates/visible.json:14-20`). Measured: `git ls-files --others --ignored --directory` answers SHALLOWLY — it listed the gitignored roots at the top level but not `apps/web/node_modules/`, which `git check-ignore` resolves to `.gitignore:2`, so an ancestor of a declared root must be re-asked file by file | `git check-ignore`, `git ls-files --others --ignored --exclude-standard --directory --no-empty-directory`, plus the three configs |
| `L-orphans` | hard | no file in the judged tree is an orphan: every tracked `.ts` under `packages/*/src` and `apps/*/src` is reached by its project's `--listFiles`, and every `*.test.ts(x)` is counted against the projects whose `testMatch` claims it — a file claimed by NONE is a failure, while `core` + `core-dom` claiming the same files is a declared parity BAND, not a double collection; no export is reachable from two barrels, and `./testing` is its own `exports` subpath so the digest cannot ride into the `apps/web` production bundle | `--listFiles`, `jest --selectProjects <p> --listTests --json` (advisory; it prints test FILE paths, not cases) + `jest.config.mjs` |
| `L-homes` | **soft** | edits to files listed in `homes.json` are checked against the union of the `home:` lines of the touched specs; it REPORTS, it does not block. Soft on purpose: in a three-package monorepo a hard light here would block ordinary work before enough specs exist to have named homes, and a TypeScript merge conflict is visible by itself. The decision is revisited once `homes.json` holds more than one entry — and that is written next to the file, not in somebody's head | git diff + `parseSpec` |
| `L-stubkit` | hard | stub screens only under `apps/web/src/stubs/`; the only non-relative imports there are `react` and `@cheq/stubkit`; the root element carries `data-stub`; no literal array of domain objects with length > 0; **an unresolvable specifier in a stub ⇒ fail** (the Resonance original promises this in its header and then skips, `if (!path) continue`; the port takes the promise) | git diff + import parse |
| `L-browser` | **soft** | the Playwright lane: `probe.browser_probe !== 'pass'` ⇒ cannot-verify `playwright browsers not installed — npx playwright install (TD-0001)`; and no test from a file outside the expected glob may appear in the JSON artifact | `.ci/probe.json` + the e2e JSON |

**Modes are different SETS, not different thresholds.** `--fast` (the hook path: offline, no
worktree) is the twelve lights that remain after the four `--all` adds. `--all` adds
`L-env-parity`, `L-artifacts`, `L-homes` (soft) and `L-browser` (soft). `--thin` (a checkout with
no `node_modules`) is `--fast` minus `L-tsc`, `L-lint` and `L-core-purity` levels 1–2: those print
`not run (no node_modules)` and **never** `pass`.

**Premises instead of a calibration record.** There is no budget lane, so the precondition for a
lane is not the freshness of a record but the presence of a **named** runtime premise:
`node_modules` for `L-tsc`/`L-lint`/`L-env-parity`, installed browsers for `L-browser`, and
`.ci/probe.json` with `observed: true` for every light that owns a probe. A missing premise is
cannot-verify **with its name in the detail**. This is the part of the dropped calibration that had
to survive: remove the check instead, and a lane that said "refuses until measured" quietly becomes
"always works" (TD-0002).

**Test file shapes.** `packages/core/test/CHQ-<nnn>/S<n>_<slug>.test.ts`,
`apps/{api,web}/test/CHQ-<nnn>/…`, `e2e/CHQ-<nnn>/…`, the support files
`**/test/{support,fixtures}/*.ts(x)`, and the guarded skeleton fixtures
`**/test/skeleton/*.test.ts(x)` (spec-less, never red-checked, never a spec's `check:`) are the
only shapes the gates classify (`tools/gates/lib/test-file-patterns.mjs`). Any other `.ts` under a
test directory is **CANNOT VERIFY** in `spec-gate` — not "none of our business".

## Rules that must not be broken

Each rule names what checks it. A rule with no mechanical check says so as plainly as rule 17 does.

1. **`@cheq/core` imports nothing outside itself.** `packages/core/package.json:7` declares
   `"dependencies": {}`, and with `node-linker=isolated` (`.npmrc:4`) the package has no
   `node_modules` at all, so an undeclared package specifier does not resolve.
   `packages/core/tsconfig.json:7-8` carries `"lib": ["ES2023"]` and `"types": []`, so `document`
   is `error TS2584` and `node:fs` is `error TS2591` — the absence of a type, not a rule somebody
   can disable with a comment. The compiler and the dependency graph hold the boundary FIRST, the
   linter only second. That is what makes the fast loop `tsc --noEmit` + `jest --selectProjects core`
   honest. Measured hole: a RELATIVE path out of the package
   (`import … from '../../../apps/api/src/index.ts'`) is caught by **nothing** — tsc exits 0 with no
   diagnostic — so walking the import graph is the light's own work.
   → `L-core-purity` (hard), three levels.
2. **A run of record shares no state with a live dev session.** No watch mode; it writes only into
   `.ci/runs/<ts>-<label>/`; red-check's base runs happen in a `git worktree` under
   `/Users/semenyevmenenko/work/cheq-task-manager-ci/<label>`, installed with
   `pnpm install --frozen-lockfile --offline`. One browser run at a time (`.ci/lock`); a lock whose
   PID is dead is **reported**, never removed silently. → `L-artifacts` (hard) + `status.mjs`.
3. **A verdict about types, tests or the browser lane is read from an artifact** —
   `tsc.<kind>.log`, `<kind>.junit.xml`, `<kind>.json`, `oxlint.json` — and the exit code is
   advisory. A missing artifact is CANNOT VERIFY, never green. `tests="0"` is CANNOT VERIFY when the
   sources DO declare cases; a suite whose sources declare none is `n/a` and is not launched
   (`lib/test-project.mjs` decides from the sources, never from the artifact).
   → every gate; the probes in `gate-probes.mjs`.
4. **A claim about the project cites `path:line`** from `node tools/gates/project.mjs` or from git,
   or a documentation URL; otherwise it is written as UNVERIFIED. Separately: a `tsconfig.json` may
   **not** be cited as text — `extends` hides the effective value — so what is cited is the output
   of `project.mjs config <pkg>` (i.e. `tsc --showConfig`). → reviewer; partly `L-visible`.
5. **No file in the judged tree is an orphan:** every tracked `.ts` under `packages/*/src` and
   `apps/*/src` is reached by its project's `tsc --listFiles`, and every `*.test.ts(x)` is claimed by
   at least one project's `testMatch` — `core` and `core-dom` claiming the same file is the declared
   parity band, not a double collection. A file that compiles nowhere is this repository's
   equivalent of a draft asset nobody has imported. → `L-orphans` (hard).
6. **A file a generator owns is never edited by hand.** It carries the header
   `GENERATED — do not edit (<command>)`, and `L-generated` re-runs that command and fails on any
   difference, printing the cure. → `L-generated` (hard).
7. **Spec tests are read-only for `implement-to-green`.** A disagreement is a `spec-conflict:` or
   `spec-change:` trailer **per file**, never an edit nobody declared. → `test-guard` (hard).
8. **`## Syrup` items never block the test phase and are never reworded:** a `Yn` is quoted from
   `## Vision (verbatim)` character for character. Feel, taste and readability are never an `S`.
   → `spec-gate`: a `Yn` must be a verbatim substring of Vision, and a `Yn` sitting under
   `## Open questions` is a FAIL.
9. **A stub never renders invented product data:** honest empty state plus the one hypothesis
   sentence, a visible `STUB` tag, `@cheq/stubkit` only, and stub screens live under
   `apps/web/src/stubs/**`. → `L-stubkit` (hard) for the path, the `data-stub` root attribute and the
   ban on a literal array of domain objects; whether the empty state is *honest* is a reviewer item
   (recorded as a debt, not pretended to be checked).
10. **A comment states only an invariant THIS package enforces.** A promise another package must
    keep is a tech-debt entry or a `## Cross-package effects` row, never prose in code.
    → **no mechanical check; reviewer only.**
11. **No dependency enters any `package.json` outside a commit whose message carries a line
    BEGINNING `package: <name> — <why>`** (`L-deps` reads exactly that; an indented or quoted copy
    declares nothing), and that same commit must change `pnpm-lock.yaml`. Nothing is ever added to
    `packages/core`'s `dependencies` (rule 1). A pre-1.0, beta or rc version additionally gets a
    tech-debt entry. There is **no escape clause** — waves were not ported, so a dependency has
    exactly one declared route. → `L-deps` (hard).
12. **Prose describing behaviour is updated in the same commit as the behaviour** —
    `docs/knowledge`, the ADRs, the TDs, this file, the per-package guides. → the doc-sync table in
    `process.md` names a checker per row; the row itself is a reviewer item.
13. **A gate change is a declared decision:** commit subject `gate: …`, plus an ADR or TD line, plus
    a probe in `tools/gates/gate-probes.mjs` that **fails on the code as it was before the change**.
    There is no label here; the convention is the declaration. → `gate-probes`; the subject is a
    reviewer item.
14. **Spec approval is the trailer `spec-approved: CHQ-<nnn> <name> <YYYY-MM-DD>`** beginning a line
    of a commit AFTER the spec's last content change — nothing else. An edit after it makes the
    approval stale, loudly. The trailer carries the spec id and the id is matched against the one
    requested. → `spec-gate --require-approved` (hard).
15. **Third-party code lives behind an adapter** in `apps/api/src/adapters/**` or
    `apps/web/src/adapters/**`, never in `@cheq/core` (rule 1 is what holds that), and every runtime
    dependency gets an API digest `docs/vendor/<package>.md` BEFORE its first use, in the same commit
    as the `package:` line (rule 11). Its types and members are cited only from that digest, which
    cites `node_modules/<pkg>/**/*.d.ts:line` at the version pinned by `pnpm-lock.yaml`, or a
    documentation URL; a member nobody can cite is UNVERIFIED — a `Qn`, never a call. → `L-deps`
    checks that the digest exists and that its version matches the lock; whether the digest is
    *truthful* is a reviewer item.
16. **One owner per shared file:** a spec names its homes (`home: module: <path>` /
    `route: <path>` / `screen: <path>`), `L-homes` reports an edit outside the named homes, and a
    system that needs its own space gets its own module, route or screen rather than an edit of
    somebody else's. The shared files are listed in `tools/gates/homes.json`. No escape clause.
    → `L-homes` (**soft** — see Boundaries for why).
17. **A ranking or scheduling system writes a JSONL trace** — one record per decision with every
    option and its score, one per event with its source, magnitude and receivers — so "why did it
    order things that way" is read from data, never guessed. **The rule is stated now and has no
    implementation:** no such system exists; the port will live in `@cheq/core` (pure, with an
    injected sink, judged by `kind: core` tests), the writer in `apps/api`, and nothing is built
    until the first spec with such a system (TD-0007). → **no mechanical check of a record's
    content, and there will not be one.** Once a system exists, the presence of the trace is a spec
    item.

## Feature workflow — spec-first

Three phases, each in a **FRESH session**. The phases work *because* they are separate and a human
signature stands between them in git: a port that merges them "because TypeScript is fast" gets
tests written by the same context as the code — a mirror of the implementation with a fully green
pipeline.

1. **`spec-harden`** — the vision text is pasted verbatim under `## Vision (verbatim)` and becomes
   `docs/specs/CHQ-<nnn>.md`. Each assertion names its `kind` (`core | api | web | e2e`); `verify:`
   is derived, never typed. Unanswered `## Open questions` block the test phase (`pnpm run spec-gate`).
2. **The human answers and signs** with the trailer
   `spec-approved: CHQ-<nnn> <name> <YYYY-MM-DD>` (rule 14).
3. **`tests-from-spec`** — `node tools/gates/spec-gate.mjs --require-approved CHQ-<nnn>` first; failing tests
   placed by `kind`; then `pnpm run red-check`, which proves them red **on the base**: each added file
   on its own, and each new case of a modified file **by name** (the unit for a modified file is the
   CASE, not the file). Red counts only as assertion-red (see the three-reasons table); a
   `TypeError: … is not a function`, a `Cannot find module …`, or a testcase whose name equals the
   file path is pending implementation, not proof.
4. **`implement-to-green`** — code until green with the runner `verify:` names. Spec tests are
   READ-ONLY (rule 7). Each satisfied assertion gets a trailer
   `green: S<n> via <runner> <artifact>`.

Before the human pushes: `pnpm run ready` prints the verification block to paste wherever the record is
kept. The human pushes and reviews. **There is no CI, no PR and no review automation here** — the
same scripts can run in CI later; `ready` prints the block a human carries.

## How to add a package

1. `mkdir -p <dir>/{src,test}` under `packages/` or `apps/`, and write `<dir>/package.json` with
   `"name": "@cheq/<name>"` matching the directory, `"private": true`, `"type": "module"`, and the
   real `dependencies` — nothing undeclared, because `node-linker=isolated` makes an undeclared
   import unresolvable rather than accidentally working (`.npmrc:4`).
2. Write `<dir>/tsconfig.json` extending `../../tsconfig.base.json` with `"noEmit": true` and
   **no** `rootDir`/`outDir` (measured: a `rootDir` together with a `test/**` include is
   `error TS6059` for every test file), and the narrowest `lib`/`types` the package can live with —
   that pair is the boundary, not a lint rule.
3. Add a marker `.ts` with a real export, and at least one guarded fixture under
   `<dir>/test/skeleton/`, so the project has something to compile and something to run: a runner
   that matched zero tests proves nothing, and this one exits non-zero by itself when no test FILE
   matched — which is why no `--passWithNoTests` is ever passed (`tools/gates/run.mjs:641-645`).
4. Add the project to `jest.config.mjs` — its `displayName` **is** the new `kind`, its `rootDir` is
   the new directory and its `testMatch` carries the `<rootDir>/` token — and the `kind` row to the
   table above. A test file claimed by no project's `testMatch` is an `L-orphans` failure; so is one
   claimed by two projects that are not a declared parity band.
5. Copy `docs/templates/AGENTS.package.md` next to the `package.json` and fill it with the real
   dependencies, what may live in the package, and which light checks that.
6. Extend ADR-0001 (package layers) and the edge rule in `tools/gates/lights/graph.mjs` **in the
   same commit** (`gate:` subject, rule 13), with a probe that fails on the previous edge set; add
   the row to the repository map above (rule 12).
7. The dependency that brought the package in needs its `package: <name> — <why>` line (rule 11)
   and, if it is a runtime dependency, its `docs/vendor/<package>.md` digest in the same commit
   (rule 15).
8. `node tools/gates/lights/run.mjs --fast` must pass, and `pnpm run ready` must print the block.
