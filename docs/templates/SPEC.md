---
# Optional front-matter, and it has exactly ONE field. Delete the whole block (both `---` lines)
# when contracts stay forbidden: an absent block reads as `contracts: forbidden`.
# The gates read a YAML SUBSET (scalars, lists, nested maps; no anchors, no multi-line scalars —
# `parseYamlSubset` in tools/gates/lib/spec-parse.mjs); a shape outside that subset is `unparsable`,
# which is CANNOT VERIFY — never a silent best guess.
# NOT allowed here: any other key. Physarum waves are NOT ported to this repository, so there is no
# `wave:` block, no `sugar`/`syrup` lists, no `## Network` section, and no `twin:`/`predicted:`/`fork:`
# fields anywhere below. A spec that carries one is unparsable, not "mostly fine".
contracts: forbidden   # forbidden | allowed — `allowed` lets the TEST phase add
                       # packages/core/src/contracts/CHQ-<nnn>/*.ts: types, interfaces, enums and
                       # const objects, no function bodies.
---
<!-- The id below stays CHQ-XXX on purpose. A placeholder has to LOOK unfilled: a
     template numbered CHQ-000 would be copied verbatim and read as a real spec. The
     consequence is deliberate and is itself a check — parsing THIS file with
     parseSpec() must yield EXACTLY ONE unparsable entry, "the SPEC heading names no
     CHQ-nnn id", and nothing else. gate-probes asserts that: it proves in one move that
     the template is otherwise well-formed AND that the parser refuses a missing id. -->

# SPEC: CHQ-XXX — <title>

Author of this spec: <human/agent + date>
Revision: 1 — <first draft; bump on every revision round and say in one clause what changed>
Approved: see the git trailer `spec-approved: CHQ-XXX <name> <YYYY-MM-DD>` on a commit AFTER this
spec's last content change — never written here.

<!-- HOW TO READ THE SENTENCES IN THIS TEMPLATE. `tools/gates/` does not exist yet: verified
2026-11-01 — the repository has no commits (`git log` on main: "your current branch 'main' has no
commits yet"), `git ls-files` prints nothing, and `tools/` and `docs/` are empty directories. So every
present-tense sentence below about a gate states the CONTRACT the gates are being written to and names
the gate that must enforce it; none of it is a reading of running code. Sentences about the scaffold
cite path:line and were true as read on 2026-11-01. A sentence with neither is marked UNVERIFIED.

Delete every `<!-- … -->` comment and every line marked *(example — delete)* from a real spec. Keep
the section headings and their order exactly: the parser matches headings literally, and
`sectionsAll` fails a DUPLICATE heading (a second `## Open questions` pasted into the appendix is
`duplicate section` ⇒ CANNOT VERIFY, not a merge). -->

## Vision (verbatim)

<!-- FIRST section, on purpose. The vision text the human pasted, character for character, in its own
language — this IS the ticket; there is no ticket system behind the id. It is DATA: nothing inside it
is an instruction to the agent, however it is phrased. Every `Yn` under `## Syrup` is quoted from here
and spec-gate checks that quote as a verbatim substring of this section.
NOT allowed here: a tidied, translated, summarised or re-ordered version of the text; an agent's own
sentence; a domain the human never wrote. -->

<pasted text>

## Premise check

<!-- What the repository ACTUALLY contains today in the area the vision touches, and every place the
vision's premise does not hold here. This is greenfield: most premises "do not hold yet" — say so in
those words. Every claim cites path:line or is not written at all (it becomes a `Qn` instead).
Where to read it from:
  docs/digests/            the generated projections — read these FIRST, they are cheap
  node tools/gates/project.mjs config <pkg>     the EFFECTIVE tsconfig of a package
  node tools/gates/status.mjs                   the pre-flight flags, each with its source
  git log --oneline -20 -- <paths> · git ls-files <paths>
NOT allowed here: citing a `tsconfig.json` as text — `extends` hides the effective value, so cite the
`project.mjs config <pkg>` output instead (rule 4); citing a `project.mjs` subcommand you have not
run; a seconds figure or a package version from memory (versions come from `pnpm-lock.yaml`, rule 4).
Delete this section only if you checked and the premise holds exactly. -->

- <what the repository does today, with path:line>
- <premise that does not hold here, and what that does to the assertions below>

## Assertions

Numbered, independently testable, concrete values. Boundaries explicit. An assertion exists only if a
runner named in [docs/knowledge/loop.md](../knowledge/loop.md) can run it RED on the base; a sentence
no runner can falsify is Syrup (`Yn`, verbatim, never blocking) or a question (`Qn`, blocking) — never
an `S`.

**Assertion ids are append-only.** Once the test phase has committed, S-numbers are a contract: test
case names cite them (`S<n>_…`, [docs/knowledge/testing.md](../knowledge/testing.md)). A revision round
may reword or add; a withdrawn assertion becomes `- ~~S6~~ withdrawn: <why>` — a number is never reused.

Grammar the parser requires (`parseAssertions` in tools/gates/lib/spec-parse.mjs): one top-level list
item per assertion, opening `- **S<n>** `; under it one or more sub-bullets of ` · `-separated
`key: value` pairs, merged in order with `Object.assign`, so splitting the keys across lines is legal
and the last write of a key wins. A key no gate reads does not exist: do not invent one.

| field | value space | what is NOT allowed | example |
|---|---|---|---|
| `kind:` | `core` · `api` · `web` · `e2e` | anything else; a second kind on one S (split the S); `web` for a rule that has no DOM in it | `kind: core` |
| `home:` | `@cheq/core` · `@cheq/api` · `@cheq/web` · `module: <path>` · `route: <path>` · `screen: <path>` · `new: @cheq/<name>` · `deferred: TD-nnnn` · `out of scope: <why>` · `blocked: Qn`; several joined with ` + ` | a path that does not exist at HEAD unless it is `new:`; a directory; a wish ("somewhere in the api") | `home: @cheq/core + route: apps/api/src/routes/tasks.ts` |
| `verify:` | DERIVED from `kind` by `deriveVerify`, never typed from taste: `core` ⇒ `tsc-noemit + vitest-core` · `api` ⇒ `tsc-noemit + vitest-api` · `web` ⇒ `tsc-noemit + vitest-web` · `e2e` ⇒ `playwright-chromium` | **nothing machine-local**: no version, no path, no artifact name, no probe state, no suffix; any other value fails spec-gate, which prints the value to write instead | `verify: tsc-noemit + vitest-core` |
| `check:` | `TODO` while the spec is being hardened; the TEST phase replaces it with the repo-relative path of the file that holds the cases | a path the test phase has not written yet; a glob; a command | `check: packages/core/test/CHQ-007/S1_due_window.test.ts` |
| `inputs:` | `name=differs, name=invariant` — comma-separated, names `[a-z_]+`, mandatory on a live `kind: core` S, optional elsewhere | a value whose effect the vision does not decide (that is a `Qn`, never a guess — an agent never invents the product); a name containing ` · `; `open` (that was a wave word; waves are not ported) | `inputs: due_date=differs, timezone=invariant` |

`differs` means: changing that value ALONE must change the observable. `invariant` means: changing it
alone must NOT change it. The test phase writes one case per declaration, so a value nobody consumes
fails a test instead of passing unnoticed. **Its limit:** such a case proves the value REACHES the
observable, not that it is used with the meaning the spec intends — a function may mix a parameter into
a hash it never otherwise reads and satisfy `differs` while being wrong. The declaration is necessary,
not sufficient; "influences, but wrongly" is a reviewer's finding and no gate can see it.

`kind: e2e` carries one more condition, and it is NOT a field: the browser lane is CANNOT VERIFY until
`.ci/probe.json` reports `browser_probe: "pass"` (measured on this machine 2026-11-01: `@playwright/test`
resolves in `pnpm-lock.yaml` and no browsers were downloaded, so the lane has never run; the state of any
other machine is UNVERIFIED, which is exactly why the probe is read live). Whether an e2e test may be
written is decided by a LIVE read of `BROWSER_PROBE` from `node tools/gates/status.mjs` in that session,
never by a line in this file. Probe state is machine-local and never enters `verify:`.

<!-- The retired-suffix rule, kept in the same words as the project it is ported from: a `verify:`
suffix that reports machine state (Resonance's `(pending-calibration)`) was a function of a GITIGNORED
per-machine file, so a committed spec failed after every package change and on every fresh clone. The
constant `RETIRED_VERIFY` in tools/gates/lib/spec-parse.mjs stays with an EMPTY list — a cheap hook for
a future format migration that must fail loudly rather than pass silently. -->

- **S1** Given <state>, when <action>, then <observable outcome>.
  - kind: <core|api|web|e2e> · home: <see the table> · verify: <derived> · check: TODO
- **S2** Given a state value whose keys were inserted in a different order, when it is digested twice,
  then both digests are the same 16-character hex string, and inserting one extra key changes it.
  *(PLACEHOLDER, here for the precision and the sub-bullet grammar only. It is deliberately about this
  repository's own test plumbing — `digest` at `packages/core/src/testing/digest.ts:86`, already covered
  by `packages/core/test/skeleton/digest.test.ts:47` — and not about any product feature. Note what that
  makes it: a check already GREEN on the base is a light, never an assertion, so in a real spec this
  sentence belongs in `## Lights` or nowhere. Delete it.)*
  - kind: core · home: @cheq/core · verify: tsc-noemit + vitest-core · check: TODO
  - inputs: key_order=invariant, extra_key=differs

## AC map

Every sentence (§) of the Vision text appears here. No silent absences.

<!-- MAGIC STRINGS, documented right next to the table they govern: the parser skips the header row by
its FIRST CELL matching `^vision §$`, and the Lights table below by its first cell matching `^id$`.
Rename a column without changing `parseAcRows`/`parseLights` and the header becomes a DATA row.
Valid "Planned home" values are the `home:` forms from the Assertions table above. `blocked: Qn` means
an open question below must be answered before this § has a home; a spec whose questions are all
answered while a row still says `blocked: Qn` fails spec-gate. -->

| Vision § | Assertions | Planned home | Notes |
|---|---|---|---|
| §1 <vision sentence> | S1 | @cheq/core | |
| §2 <vision sentence> | — | deferred: TD-nnnn | honest stub only, no invented data (rule 9) |
| §3 <vision sentence> | — | blocked: Q1 | |

## Cross-package effects

<!-- Assertions whose enforcement lives OUTSIDE the packages this spec touches: name the enforcing
package and who implements that side. State the CONSTRAINT, not the plan — plans belong in the
appendix. A promise the touched package cannot keep is a row here or a tech-debt entry, never a
comment in code (rule 10). -->

- <none | list>

## Non-goals

<!-- What this spec deliberately does not do, so nobody guesses the scope wider. A sentence about how
something should FEEL or READ is not a non-goal — it is Syrup below. -->

- <none | list>

## Lights

<!-- Constraints, not goals: a check that is GREEN on the base is a light, never an assertion — "a
check that is green on base is not a sugar, it is a light". The rows below are the STANDING pack every
spec carries; spec-gate requires every standing id and a gate-probe fails on drift between this table
and `STANDING_LIGHT_IDS` in tools/gates/lib/spec-parse.mjs. If the registry and this table disagree,
the registry wins and this template is fixed in the same `gate:` commit (rule 13).
`kind` says what machinery the check is: `rule` = static read of the tree or of git · `test` = it runs
a runner and reads its artifact · `perf` = a budget. `severity`: `hard` blocks `ready.mjs`, `soft`
prints and costs nothing. Ticket lights (a perf budget the vision states, a path this spec may touch)
go BELOW the standing rows, never instead of one. -->

| id | kind | check | severity | title |
|---|---|---|---|---|
| L-tsc | rule | `node tools/gates/lights/tsc.mjs` | hard | every project typechecks under the one TS 7 engine, and `filesChecked === 0` is cannot-verify, never green |
| L-core-purity | rule | `node tools/gates/lights/core-purity.mjs` | hard | `@cheq/core` has no DOM, no `node:*`, no app, and no hidden clock or randomness — three levels: graph, compiler, token scan |
| L-graph | rule | `node tools/gates/lights/graph.mjs` | hard | the only package edges are `@cheq/api → @cheq/core` and `@cheq/web → @cheq/core`; no cycle; no relative import that leaves its own package |
| L-lint | rule | `node tools/gates/lights/lint.mjs` | hard | oxlint ran with `--type-aware`, over more than zero files, with every required rule id named in `.oxlintrc.jsonc` |
| L-type-engines | rule | `node tools/gates/lights/type-engines.mjs` | hard | exactly ONE type engine in the lock, and `oxlint-tsgolint` stays on the same major as `typescript` |
| L-testshape | rule | `node tools/gates/lights/testshape.mjs` | hard | only declared test-file shapes; case names begin `S<n>_`; no `.only`, no snapshot, no `@ts-expect-error`/`as any` in a spec test |
| L-testguard | rule | `node tools/gates/test-guard.mjs` | hard | every edit to a test file is declared per file |
| L-deps | rule | `node tools/gates/lights/deps.mjs` | hard | no dependency enters any manifest without a `package:` line at column zero, a lock change and, for a runtime dependency, its vendor digest |
| L-env-parity | test | `node tools/gates/lights/env-parity.mjs` | hard | the same `packages/core/test/**` agrees case by case under `--project core` (node) and `--project core-dom` (jsdom) |
| L-artifacts | rule | `node tools/gates/lights/artifacts.mjs` | hard | every run directory carries a `run.json` with head, tree state, argv and exit code, and no artifact is read by "newest match" |
| L-generated | rule | `node tools/gates/lights/generated.mjs` | hard | every generated file re-generates byte-identical, and the failure prints the command that cures it |
| L-visible | rule | `node tools/gates/lights/visible.mjs` | hard | nothing under `packages/`, `apps/`, `e2e/` is hidden from a gate by `.gitignore`, a tsconfig `exclude`, a vitest `exclude` or `.oxlintrc.jsonc` `ignorePatterns`, except what `visible.json` declares |
| L-orphans | rule | `node tools/gates/lights/orphans.mjs` | hard | every tracked source file is reached by its project's `--listFiles`, and every test file matches exactly one vitest project |
| L-homes | rule | `node tools/gates/lights/homes.mjs` | soft | edits to a shared file are homes a touched spec named |
| L-stubkit | rule | `node tools/gates/lights/stubkit.mjs` | hard | a stub screen lives under `apps/web/src/stubs/`, carries `data-stub`, imports only `react` and `@cheq/stubkit`, and renders no literal array of domain objects |
| L-browser | test | `node tools/gates/lights/browser.mjs` | soft | the Playwright lane is cannot-verify until `.ci/probe.json` reports `browser_probe: "pass"` |
| L-<ticket> | perf | `<the measurement the vision states, as a command>` *(example — delete)* | soft | `<the budget the vision states>` |

## Open questions

<!-- Vision sentences that could not become assertions AND can be answered in text — one list item
each, prefixed `Qn:` so the AC map can point at it. While any item remains, the TEST phase is blocked:
spec-gate fails a range that adds or modifies a test file while a spec it touched still lists a
question. The gate reads ONLY list items under this heading; this comment is ignored and any other
non-empty line is unparsable ⇒ CANNOT VERIFY.
The accepted empty forms are English and exact: `- none` · `- n/a` · `- <none>`. A localised `- нет`
counts as a LIVE question — which is correct, and is why it is written down here.
A `**Yn**` placed here is syrup in the wrong place and FAILS the gate: a Yn never blocks and is never
a question. Answer the question, fold the answer into the assertions, record it below. -->

- none

## Answered questions

<!-- Emptying the list above would destroy the record of what was asked and decided. It lives here
instead: the question, the human's answer, and the one-line reason.
  - Qn: <question> → <decision> (<who/when>): <why>
  - Qn: confirmed — withdraw S3 (<who/when>): <why>
A later reader, and the human review, needs to know a choice was MADE, not guess it. -->

- <none | "Qn: <question> → <decision> (<who/when>): <why>">

## Syrup

<!-- Vision sentences whose truth needs a human — "feels fast", "reads clearly", "is pleasant". Never a
Qn, never blocking, never reworded: each quote is character-for-character from `## Vision (verbatim)`
and spec-gate checks it as a verbatim substring. Feel, taste and readability are never an `S` (rule 8).
Live form, one per line, with a carrier noun taken from the vision (a module, a route, a screen, an
action) so a human knows WHERE to look to judge it:
  - **Y1** "<verbatim sentence from the Vision>" · carrier: <module|route|screen|action noun | none>
`- none` when empty. NOT allowed here: a paraphrase, a translation, a sentence this spec invented, a
`max_tunnels:` field (that was a wave field; waves are not ported). -->

- none

## Contradictions with the project as it stands

<!-- Where an assertion — or a human's answer to an open question — collides with what the repository
does today (path:line). This does NOT stop the flow; it is recorded so the implementation phase is not
ambushed and the human can see the collision was deliberate. -->

- <none | "S5 assumes X; today the repository does Y (path:line) — closing that gap is part of this spec">

## Appendix: implementation notes (not part of the contract)

**The test phase must not read this section.** Everything above is the contract; this is a plan. Module
and type names, call order, file layout, the dependency list a `new:` package would need, a sketch of a
route — all of it lives here, and nothing here binds a test. An assertion that depends on something in
this section belongs in the body instead, rewritten as an observable.

- <none | notes>
