# TD-0018: the probe fixture is proven self-contained for ONE link and ONE compile

**Status:** Open · the defect is fixed and every probe re-run green against the right tree; what is checked is one symlink and one `tsc` invocation, not the property in general
**Area:** `tools/gates/probes/_harness.mjs` (`copyPackageNodeModules`, and the probe beside it)
**Raised:** 2026-11-02

## The defect this entry is the residue of

`workspace({ resolve: true })` copies each workspace package's own `node_modules` — pnpm's
per-package symlink farm — so that a module specifier resolves inside the fixture the way it does
here. The copy used `cpSync(abs, target, { recursive: true })`, and the comment above it claimed
"copied as symlinks (cpSync does not dereference), so the relative targets resolve inside the
fixture".

That claim was false, and measured false in isolation on 2026-11-02:

    src/nm/link -> ../target
    cpSync default                   : /private/var/folders/…/tmp.XXXX/src/target
    cpSync verbatimSymlinks: true    : ../target

`cpSync` defaults to `verbatimSymlinks: false`, which REWRITES a relative symlink's target to an
absolute path. So `apps/api/node_modules/@cheq/core -> ../../../../packages/core` became, inside the
fixture, an absolute link to this checkout, and `tsc -p apps/api/tsconfig.json` run in the fixture
compiled THIS repository's core. From `--traceResolution`, same day:

    ======== Module name '@cheq/core' was successfully resolved to
    '/Users/…/cheq-task-manager/packages/core/src/index.ts' ========

**Every `resolve: true` probe was therefore judging a tree it had not planted its defect in.** The
planting still happened in the fixture; the compiler read the real sources. A probe that passed under
that arrangement proved less than it said, and the one that caught it — `L-graph REVERSE` — caught it
only because `L-graph` happens to report inputs from outside the repository under judgement. No other
light would have said anything, and the probes had been green since they were written.

The fix is `verbatimSymlinks: true`. Copied verbatim, the same link resolves to the FIXTURE's
`packages/core`, while the relative hops into `node_modules/.pnpm/…` still land in the real install
through the root symlink `linkNodeModules` makes — which is what keeps the fixture install-free.

## What is unproven now

The property is "a fixture resolves its own sources, never this repository's". What is checked is
narrower, by construction:

- **One link**: `apps/api/node_modules/@cheq/core`, asserted to be relative by reading the link.
- **One compile**: `tsc -p apps/api/tsconfig.json` in the fixture, asserted to list no input under
  this repository's `packages/` or `apps/`.

`apps/api` is the only package here that resolves a workspace sibling through `node_modules`, so
today those two cover every case that exists. They stop covering it the moment a third package
imports a second one, or a package reaches a sibling by some other route — a tsconfig `paths` entry,
a Jest `moduleNameMapper`, a bundler alias. Nothing fails when that happens; the new probe simply
keeps asserting the link it knows about.

## Why the general check is not written

The honest general form is to ask the compiler, for every package, that no input lie under
`REPO_ROOT/packages` or `REPO_ROOT/apps` — a loop over `readPackages` running one `tsc --listFiles`
each, inside the fixture. That is the same shape as the probe that exists, repeated, and it is not
free: each invocation is a full typecheck of a package, in a group that already runs 149 probes.

It is also not where the risk is. The rewrite happened in ONE call, and that call now has one
option set on it. What a wider probe would buy is protection against a NEW copy route being added
without this option — and the cheaper guard for that is the one this entry names: the mechanism lives
in exactly one exported function, `copyPackageNodeModules`, beside `linkNodeModules`, rather than
inline in the probe group that uses it.

## The deliberate limit underneath, which is not debt

The fixture's ROOT `node_modules` is a symlink to this repository's install, so a probe that planted
a defect in a third-party package would judge the real one. That is intended — the alternative is an
install per fixture — and it is stated where the symlink is made. It bounds what these probes can be
about: the repository's own sources, never its dependencies' behaviour.
