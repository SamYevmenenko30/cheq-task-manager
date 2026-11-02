# TD-0007: "The install succeeded" does not mean "the tree matches the lock" — ~~and the root manifest and the lock disagree right now~~

**Status:** Open · the general claim stands: nothing has observed an install leaving the tree matching the lock. The live manifest defect is struck below — reconciled 2026-11-01, and `--frozen-lockfile --lockfile-only` has exited 0 on the pair since. What the root declares TODAY is read from `package.json` and `git show HEAD:pnpm-lock.yaml`, never from this entry: the set is no longer the one struck below, because the test runner in it changed on 2026-11-02
**Area:** `package.json` · `pnpm-lock.yaml` · `tools/gates/status.mjs` (`LOCKFILE_CLEAN`) · `tools/gates/red-check.mjs`
**Raised:** 2026-11-01 · manifest half closed 2026-11-01

This entry carried two different subjects. One was a defect in this repository and is now fixed; the
other is a fact about pnpm that no gate here has ever checked. They are separated so that closing the
first does not quietly close the second.

## ~~What was wrong — FIXED 2026-11-01~~

~~**Observed 2026-11-01:** the root `package.json` had **no `devDependencies` key at all** (scripts
only), while `pnpm-lock.yaml:9-46` recorded twelve devDependencies for importer `.` — `typescript`,
`vitest`, `oxlint`, `oxlint-tsgolint`, `jsdom`, `@playwright/test`, `tsx`, `@types/node`,
`@vitest/coverage-v8`, `@testing-library/dom`, `@testing-library/react`,
`@testing-library/user-event`. Every lane in this repository — the type verdict, all four test
projects, the lint lane, the browser lane — ran on packages the root manifest did not declare.~~

~~It was not a theoretical divergence. `pnpm install --frozen-lockfile --lockfile-only` refused the
pair outright:~~

~~`ERR_PNPM_OUTDATED_LOCKFILE … specifiers in the lockfile … don't match specs in package.json ({})`~~

~~and `--frozen-lockfile` is the DEFAULT in CI, so an install there died before any gate could run —
the failure was not "a gate does not report it", it was "nothing installs".~~

~~**Fixed 2026-11-01:** the twelve entries are declared at `package.json:10-23`, each specifier taken
from the `importers: '.'` block of `pnpm-lock.yaml` rather than chosen, and
`pnpm install --frozen-lockfile --lockfile-only` now exits 0 leaving the lock byte-identical. The
`L-deps` rule about undeclared dependencies therefore has something true to check for the first
time.~~

## What is unproven

That an install leaves the tree matching the lock. Recorded 2026-11-01 during this repository's setup
(not re-observed here): `pnpm install` reported `Lockfile is up to date, resolution step is skipped`
and KEPT a stale copy of a plugin; the tree only matched the lock after
`rm -rf node_modules pnpm-lock.yaml` and a full install. So "install finished without an error" is
not evidence about what is on disk, which is the same lesson as ADR-0002 in a different lane: the
exit code is not the verdict.

The manifest fix narrows this but does not touch it. What was proven on 2026-11-01 is that the
manifest and the lock now agree **about specifiers** — that is a statement about two text files.
Whether `node_modules` holds what either of them describes is still unobserved, and
`--lockfile-only` is precisely the mode that cannot answer it: it resolves and writes nothing to
disk.

## Why it is safe right now — and where it is not

- Partly it is not. A base run in a fresh worktree has still never been demonstrated end to end, so
  **every claim about what a base run would do is UNVERIFIED** until a worktree install is observed.
  What changed on 2026-11-01 is that such an install can now begin; before the fix it could not, and
  the distinction is worth keeping because a reader who sees only "install verified" would assume
  more than was measured.
- What does stand: the lock of record is HEAD's (`git show HEAD:pnpm-lock.yaml`, ADR-0003), so a run
  pinned to a commit and a reader asking about that commit name the same file.
- `red-check` compares `sha256` of the lock it installed from against
  `git show <mergeBase>:pnpm-lock.yaml` and answers CANNOT VERIFY on a mismatch, instead of running
  quietly against whatever happens to be installed. Written now (`tools/gates/red-check.mjs`), and
  still not OBSERVED doing it on a real divergence — which is the same shape of gap as step 3 below,
  and the reason this entry is not closed by the existence of the code.

## What closing it involves

1. ~~Whoever owns the root `package.json` reconciles it with the lock.~~ Done 2026-11-01, see above.
2. ~~`tools/gates/status.mjs` prints `LOCKFILE_CLEAN` from a real check.~~ It does, and it does it
   **offline**: the flag compares each tracked manifest's specifiers AT HEAD against the lock's
   `importers` block AT HEAD and never spawns an install in any form
   (`lockfileClean`, `tools/gates/status.mjs:444`). That choice is deliberate and it is also the
   limit — a pre-flight that can rewrite the lockfile it is reporting on is not a pre-flight. Note
   the shape of the alternatives, in case anyone reaches for one: the pnpm of record
   (`package.json:9`, read through ADR-0003, never copied into prose) has **no** `--dry-run` for
   `install` — observed 2026-11-01, `ERROR Unknown option: 'dry-run'` — so the only other options
   are a real install in a throwaway location or `pnpm install --frozen-lockfile --lockfile-only`,
   the latter known to exit 0 on an agreeing pair and to fail with `ERR_PNPM_OUTDATED_LOCKFILE` on a
   disagreeing one. Every one of them, the implemented flag included, says nothing about
   `node_modules`, which is why the flag is named for what it reads: the two files, not the tree.
3. A `gate-probes` fixture plants a lock/manifest divergence and observes CANNOT VERIFY from
   `red-check`, rather than a quiet run. The divergence that was live in this repository is the
   cheapest possible fixture, and its exact error text is recorded above so the probe can assert on
   it. That probe is what finally makes this entry closable.
4. The tree-level half needs its own observation: an install into an empty worktree, then evidence
   that what landed matches the lock. If that observation shows a divergence pnpm does not report,
   this entry stays open with a third subject rather than closing.
