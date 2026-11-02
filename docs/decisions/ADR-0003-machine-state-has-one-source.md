# ADR-0003: Machine state has one source and one reader, read at the moment of use — never copied into prose

**Status:** Accepted · **Date:** 2026-11-01

## Context

A version, a timing, a cache state and a bundle size are all machine state. Written into a document,
each becomes a copy that can disagree with the thing it describes — and this repository exists to stop
exactly that kind of disagreement (ADR-0002: a verdict is read from an artifact, never from a claim).
Two shapes of the defect are already visible here.

**Two tracked files disagreed about the toolchain, which is how this rule got written.** Observed
2026-11-01: `/Users/semenyevmenenko/work/cheq-task-manager/package.json` had **no**
`devDependencies` key at all (31 lines, scripts only), while `pnpm-lock.yaml:9-46` recorded twelve
devDependencies for importer `.` — `typescript`, `vitest`, `oxlint`, `oxlint-tsgolint`, `jsdom`,
`@playwright/test`, `tsx`, `@types/node`, `@vitest/coverage-v8` and the three `@testing-library/*`.
Every lane in this repository ran on packages the root manifest did not declare, and nothing in the
repository said so. That observation keeps its date and its names, including the test runner of that
day: it is the cleanest illustration of the rule this ADR states, which is exactly why it is not
re-dated now that the pair has been reconciled (TD-0007, fixed the same day — the declared set today
is read from `package.json` and `git show HEAD:pnpm-lock.yaml`, never from this file). What the fix
did NOT buy is a fresh-worktree `pnpm install --frozen-lockfile`; nothing has run one, and
`LOCKFILE_CLEAN` is the flag that will answer it.

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
| what a run of record did | `.ci/runs/<ts>-<label>/run.json` — argv, exit code and, since 2026-11-02, `envExtra` | `tools/gates/lib/run-dir.mjs` |
| whether the install matches the lock | `pnpm install --frozen-lockfile` | `status.mjs` → `LOCKFILE_CLEAN` |

**The lock of record is HEAD's**, because a base run checks out a commit: a worktree pinned to a named
commit plus `pnpm install --frozen-lockfile`. An uncommitted dependency edit therefore changes no
verdict and enters no record; committing one does, which is correct.

**A run's ENVIRONMENT is machine state too, and it is now in the record.** Added 2026-11-02, when the
test runner changed: the JUnit reporter takes its output path from an environment variable rather than
from a flag, so an `argv` alone no longer says where a run wrote its artifact. The wrapper therefore
records what it added to the child's environment as `envExtra` beside the argv
(`tools/gates/run.mjs:326`), and a light reads that field instead of a human remembering what was
exported (ADR-0002 item 2). The rule is unchanged — one source, one reader, read at the moment of use
— and the source for "how was this run invoked" is one file, not two.

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
  repository. Nothing has run it. The divergence measured above would have made it fail outright and
  was fixed the same day, so such an install can now at least begin — which is a statement about two
  text files and not about `node_modules` (TD-0007). `status.mjs`'s `LOCKFILE_CLEAN` flag is the
  thing that will answer it, and it is named for what it reads: the pair, not the tree.
