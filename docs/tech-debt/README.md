# Tech debt ledger

Known shortcuts, deferred work, "looks real but isn't" traps and — mostly, in this repository —
claims that are still UNVERIFIED on this machine. One file per entry.

## The genre

An entry is not a complaint and not a to-do. It answers three questions, in this order, and a file
missing any of them is not an entry:

1. **What is unproven or wrong** — stated so that a reader can check it, with `path:line` or the
   command and date that observed it. A sentence nobody can check is written UNVERIFIED and says so.
2. **Why it is safe right now** — what stands in for the missing proof: a lane that answers CANNOT
   VERIFY instead of green, a rule that forbids the shape, a human who reviews it. "It probably
   works" is not an answer; if nothing stands in, the entry says that, and that is the loudest thing
   a ledger can say.
3. **What closing it involves** — the concrete run, probe or decision. Named precisely enough that
   someone else can do it, including what observation would make the entry close and what observation
   would make it *stay open with a different reason*.

Rules of the ledger:

- **The Status column carries the current reasoning, not one word.** A reader must be able to see why
  an open debt is tolerable today without opening the file.
- **A resolved entry is struck through, never deleted** — row and `**Status:**` line both — so the
  history stays legible. Git holds the diff; the ledger holds the reasoning.
- **No number that a command can print is copied into an entry**
  ([ADR-0003](../decisions/ADR-0003-machine-state-has-one-source.md)). An entry names the key
  and the command; where a measurement describes a configuration nobody will reproduce, it is kept and
  labelled as history.
- A new entry takes the next free number as `TD-XXXX-slug.md` and is listed below in the same commit.
- Prose describing behaviour is updated in the same commit as the behaviour, this ledger included.

| ID | Title | Status | Opened |
| --- | --- | --- | --- |
| [TD-0001](TD-0001-browser-lane-unverified.md) | The browser lane (`kind: e2e`, Playwright) is CANNOT VERIFY — the pinned browser build is not installed and `e2e/` does not exist | Open · no `kind: e2e` test is written or proven red; `verify: playwright-chromium` names only the runner; `L-browser` is soft and reads CANNOT VERIFY; the config itself says so (`playwright.config.ts:3-5`) | 2026-11-01 |
| [TD-0002](TD-0002-no-calibration-lane.md) | There is no calibration lane: no seconds figure, bundle size or hook-duration target is measured, so none may be promised | Open · `status.mjs` prints `BUDGETS=unavailable (no calibration lane)`; the deliberate-failure half survives as `.ci/probe.json`, written only by `gate-probes --real` | 2026-11-01 |
| [TD-0003](TD-0003-lint-rule-set-is-hand-written.md) | The enabled lint rule set is a hand-written list; `require-await` EXISTS in oxlint and is simply not enabled, and nothing asserts the list numerically | Open · measured 2026-11-01, so it is a config gap not a capability gap; the type verdict is `tsc`'s and never the linter's (ADR-0004); one line plus a probe closes the named rule | 2026-11-01 |
| [TD-0004](TD-0004-vitest-does-not-typecheck.md) | Vitest strips types, so a missing symbol surfaces as a runtime error indistinguishable from an assertion without a second artifact; and `skipLibCheck: true` hides whatever is wrong in a `.d.ts` | Open · redness is classified from TWO artifacts with measured signatures (ADR-0002 item 5); suppression directives are forbidden in spec tests | 2026-11-01 |
| [TD-0005](TD-0005-dual-channel-cross-check-never-gated.md) | Both channels of a run are measured and reconciled — and no gate has ever read them | Open · the JSON reporter's collection-failure shape and the three reconciling identities ARE measured (`tools/gates/lib/vitest-json.mjs:24-59`, `:165-170`), and `crossCheck` answers `agree` / `cannot-verify`, never green; what is unproven is the cross-check AS A GATE — no gate exists to call it — plus the unescaping step `vitest list --json` needs before it can be compared with the XML | 2026-11-01 |
| [TD-0006](TD-0006-core-dom-parity-never-disagreed.md) | The `core` / `core-dom` parity lane has never been observed disagreeing, so it is unknown whether it discriminates a runtime difference from two artifacts of different ages | Open · the lane exists in config (`vitest.config.ts:26-36`); the light re-runs on a content-hash mismatch instead of comparing, and answers CANNOT VERIFY with no artifact | 2026-11-01 |
| [TD-0007](TD-0007-manifest-and-lock-can-disagree.md) | "The install succeeded" does not mean "the tree matches the lock" — ~~and right now the root manifest and the lock disagree about twelve packages~~ | Open · the general claim stands: nothing here has observed an install leaving the tree matching the lock, and `LOCKFILE_CLEAN` is unwritten. ~~The live defect — no `devDependencies` in `package.json` against twelve in `pnpm-lock.yaml:9-46` — is FIXED 2026-11-01 (`package.json:10-23`): `--frozen-lockfile --lockfile-only` exits 0 and leaves the lock byte-identical, where it previously refused the pair outright~~ | 2026-11-01 |
| [TD-0008](TD-0008-tsgolint-tsc-parity-unverified.md) | `oxlint-tsgolint` and `tsc` are the same engine LINE, not the same binary, and no probe compares their type verdicts | Open · the linter is never a verdict about types (ADR-0004); `L-type-engines` pins the major version and nothing finer | 2026-11-01 |
| [TD-0009](TD-0009-vendor-digests-owed.md) | Three runtime dependencies have no API digest, and two of them are already imported — the vendor rule is in debt from the moment it lands | Open · `react` and `react-dom/client` are used at `apps/web/src/main.tsx:1-2` with no digest; `fastify` is declared and not yet imported, so its digest is owed before first use, not overdue | 2026-11-01 |
| [TD-0010](TD-0010-no-performance-lane.md) | There is no performance lane: `perf` is not a kind, no threshold file exists, bundle size is unmeasured and `vite build` has never run as a verdict | Open · a performance requirement cannot become an assertion — `verify:` is derived from `kind` and has no `perf` route, so such a sentence goes into a spec's `## Lights` or `## Syrup`; every project is `noEmit` (`tsconfig.base.json:13`) and `apps/web` has no build script (`apps/web/package.json:12`), so `pnpm types` going green is not evidence that the app builds | 2026-11-01 |
| [TD-0011](TD-0011-inputs-rule-proves-reach-not-meaning.md) | An `inputs:` case proves a value REACHES the observable, never that it is used with the meaning the spec intends | Open · deliberately: the limit is declared where the rule is read (`docs/templates/SPEC.md:95-98`, `docs/knowledge/testing.md:103-105`), the rule still catches the most common weak test — a value nobody consumes — and a value whose effect the spec does not decide becomes a `Qn`, never a guess | 2026-11-01 |
| [TD-0012](TD-0012-no-mutation-testing.md) | Nothing measures whether a test would NOTICE a behaviour change — there is no mutation lane and no coverage verdict | Open · `red-check` proves each added test was red on the base, which is stronger than coverage and weaker than mutation; breadth is reported and not checked (the `S coverage` line in `ready`, a grep over `S<n>_` tokens), and `@vitest/coverage-v8` is installed with no lane reading it | 2026-11-01 |
