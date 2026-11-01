# ADR-0003: Machine state has one source and one reader, read at the moment of use — never copied into prose

**Status:** Accepted · **Date:** 2026-11-01

## Context

A version, a timing, a cache state and a bundle size are all machine state. Written into a document,
each becomes a copy that can disagree with the thing it describes — and this repository exists to stop
exactly that kind of disagreement (ADR-0002: a verdict is read from an artifact, never from a claim).
Two shapes of the defect are already visible here.

**Two tracked files disagree about the toolchain right now.** Observed 2026-11-01:
`/Users/semenyevmenenko/work/cheq-task-manager/package.json` has **no** `devDependencies` key at all
(31 lines, scripts only), while `pnpm-lock.yaml:9-46` records twelve devDependencies for importer `.`
— `typescript`, `vitest`, `oxlint`, `oxlint-tsgolint`, `jsdom`, `@playwright/test`, `tsx`,
`@types/node`, `@vitest/coverage-v8` and the three `@testing-library/*`. Every lane in this repository
runs on packages the root manifest does not declare. Nothing in the repository says so, and a
`pnpm install --frozen-lockfile` in a fresh worktree has not been run against this pair. This is a live
defect, not accepted debt; it is recorded here because it is the cleanest available illustration of the
rule, and the gate that would have named it is TD-0007.

**A figure in prose outlives the run that produced it.** The port this repository comes from grew a
seven-column budget table, two of whose columns recorded calibration records that no longer existed on
disk, plus four struck-through passages about what a flag used to mean
(`/Users/semenyevmenenko/Resonance/docs/decisions/ADR-0005-machine-state-has-one-source.md:9-18`). Every
session pays for that in context, and the copy can be wrong in either direction.

What the state of this machine actually lives in: `.nvmrc:1` (node major), `package.json:9`
(`packageManager`, the pnpm version), `pnpm-lock.yaml` (every resolved dependency version),
`.ci/probe.json` (what a probe OBSERVED), and `.ci/runs/<ts>-<label>/run.json` (what a run did). All of
`.ci/` is gitignored and machine-local (`.gitignore:9-10`, which already names this ADR).

## Decision

**One source per fact, one reader per source, read when used.**

| fact | the one source | the one reader |
|---|---|---|
| node version | `.nvmrc` | `tools/gates/status.mjs` |
| pnpm version | `package.json` → `packageManager` | `tools/gates/status.mjs` |
| every dependency version | `pnpm-lock.yaml` — **of record: `git show HEAD:pnpm-lock.yaml`** | `tools/gates/lib/git.mjs` + `status.mjs` |
| what a probe observed | `.ci/probe.json` | `tools/gates/lib/probe.mjs` — the ONLY reader |
| what a run of record did | `.ci/runs/<ts>-<label>/run.json` | `tools/gates/lib/run-dir.mjs` |
| whether the install matches the lock | `pnpm install --frozen-lockfile` | `status.mjs` → `LOCKFILE_CLEAN` |

**The lock of record is HEAD's**, because a base run checks out a commit: a worktree pinned to a named
commit plus `pnpm install --frozen-lockfile`. An uncommitted dependency edit therefore changes no
verdict and enters no record; committing one does, which is correct.

**No version, no seconds figure, no byte size and no cache state is written into any document** —
`AGENTS.md`, an ADR, a TD, a skill or a spec. A document names the KEY and the COMMAND that prints it;
`node tools/gates/status.mjs` is that command, and it prints flat flags in one call. Where no lane
measures a thing, `status` prints `unavailable (<reason>)` and documents repeat the reason, never a
number: today that is `BUDGETS=unavailable (no calibration lane)` (TD-0002). A stale record offers no
figure at all — half a figure is worse than none, because it reads like state.

**Two deliberate exceptions, both labelled where they appear.** A measurement that describes a
configuration nobody will reproduce is not current state and stays written down:

- the two-engine comparison in [ADR-0004](ADR-0004-one-type-engine.md) — the arrangement it measures
  was built, verified and then removed from the repository, so the figure can never be re-read from
  this machine;
- a figure a fix round measured for itself stays in the header of the script that measured it,
  labelled as a fix-round measurement, not promoted to a document.

Anything else that looks like state in prose is a defect, and the fix is to name the key instead.

## Consequences

- Gains: a probe or an install costs zero documentation commits. A figure quoted in a session was read
  from this machine, so it cannot belong to another configuration. A reviewer has one question to ask
  of any number in a diff — "which command prints this?" — and a number with no answer is removed.
- Costs: the repository alone no longer tells a reader what version of anything is installed; they see
  key names and must run `status`. That is the honest state — `.ci/` was always gitignored
  (`.gitignore:9-10`) and the lock is the only committed version record.
- A document can drift back into copying state and nothing mechanical stops it. A hook that refuses a
  document containing a value `status` can print was considered and dropped: it would also refuse a
  spec's premise check, which is REQUIRED to cite tool output with its date. The rule is this ADR plus
  a reviewer.
- What stays UNVERIFIED: that `pnpm install --frozen-lockfile` succeeds in a fresh worktree of this
  repository. Nothing has run it, and the manifest/lock divergence measured above suggests it would
  fail (TD-0007). `status.mjs`'s `LOCKFILE_CLEAN` flag is the thing that will answer it.
