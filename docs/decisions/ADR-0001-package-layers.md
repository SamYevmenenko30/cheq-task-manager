# ADR-0001: Three workspace packages, one direction, and the boundary is the dependency graph

**Status:** Accepted · **Date:** 2026-11-01

## Context

A pnpm workspace does not compile jointly. Each package is its own `tsconfig` project and its own
manifest, and nothing in TypeScript stops a file in one package from importing a file in another by
relative path. So a layer boundary stated only in prose is a boundary that nothing reports.

What exists in the repository today:

- three workspace packages — `@cheq/core` (`packages/core/package.json:2`), `@cheq/api`
  (`apps/api/package.json:2`), `@cheq/web` (`apps/web/package.json:2`) — matched by the globs
  `packages/*`, `apps/*`, `tools/*` (`pnpm-workspace.yaml:1-4`). `tools/*` matches no package today
  and is deliberate: `tools/gates` carries **no** `package.json`, because one would give the gates
  dependencies and they would stop running exactly when they are needed, in a fresh worktree before
  an install finishes (`package.json:5`);
- `@cheq/core` declares `"dependencies": {}` (`packages/core/package.json:7`) and that emptiness is
  the carrier of the rule, not a comment about it;
- `node-linker=isolated` (`.npmrc:4`), so `packages/core` has no `node_modules` of its own and an
  undeclared PACKAGE import does not resolve there at all (`error TS2307`);
- `@cheq/core` exposes exactly two entry points, both pointing at source, because there is no build
  step: `"."` → `./src/index.ts` and `"./testing"` → `./src/testing/digest.ts`
  (`packages/core/package.json:8-11`).

Two measurements decided the shape of this ADR.

**The isolated linker blocks what the ROOT does not declare, not everything `@cheq/core` did not
declare.** Observed 2026-11-01, when the test runner was the previous one:
`packages/core/test/skeleton/marker.test.ts:4` imported that runner by bare specifier;
`pnpm exec tsc --noEmit -p packages/core/tsconfig.json` exited 0 with no diagnostics, and
`--listFiles` on that same project listed `vitest/dist/index.d.ts`, `@vitest/mocker`, `expect-type`,
`assertion-error`, `@types/chai`, `tinybench` and `vite/dist/node/module-runner.d.ts` — all resolved
upward, out of the workspace root. That observation keeps its date and its names: it is the
measurement this rule was written from, not a claim about today's tree. What holds today is the same
shape under different names — the same line now imports `@jest/globals`
(`packages/core/test/skeleton/marker.test.ts:4`), equally a root devDependency and equally invisible
to `@cheq/core`'s own empty `dependencies`. Which declarations the closure contains since the runner
changed is UNVERIFIED (nothing has re-listed it); the hole the measurement found is not.
`react-dom/client` fails from core only because
the root does not declare `react-dom`; the day it does, core can import it and the manifest check
will not notice. The graph is a real carrier, and it is not a complete one.

**A relative path out of a package is invisible to all of the compiler, the manifest and the
linter.** Recorded 2026-11-01 during this repository's setup: a file
`packages/core/src/__esc.ts` containing `import { API_PACKAGE } from '../../../apps/api/src/index.ts'`
produced `exit=0` and no diagnostics from `tsc --noEmit -p packages/core/tsconfig.json`. **Not
re-observed by this ADR** — the probe file no longer exists, so it is UNVERIFIED as of today and is
re-proved by the probe named in ADR-0005. It is the reason level 2 of ADR-0005 exists.

## Decision

Three packages, three edges, one direction. `@cheq/core ← @cheq/api` and `@cheq/core ← @cheq/web`
read "the app references the core"; the core references nothing.

| package | folder | may depend on | must not depend on |
|---|---|---|---|
| `@cheq/core` | `packages/core/` | **nothing** (`dependencies: {}`) | `@cheq/api`, `@cheq/web`, `react`, `react-dom`, `fastify`, `node:*`, the DOM, anything the root happens to declare |
| `@cheq/api` | `apps/api/` | `@cheq/core`, `fastify` (`apps/api/package.json:7-10`) | `@cheq/web`, the DOM |
| `@cheq/web` | `apps/web/` | `@cheq/core`, `react`, `react-dom` (`apps/web/package.json:7-11`) | `@cheq/api` — the web package talks to the api over HTTP, never by import |

No cycle. `@cheq/core` holds the rules, the task model, scheduling, the persistence shape and
determinism; `@cheq/api` maps HTTP to core calls (`apps/api/package.json:6`); `@cheq/web` renders
core state and turns input into core intents (`apps/web/package.json:6`). Neither app holds a rule
of its own: a rule that only the api or only the web package knows is a rule no `kind: core` test
can falsify.

The boundary is carried by three independent things, and the ADR is about all three, not about the
table:

1. **the manifests** — `dependencies` is the declaration, and `L-deps` judges it against a
   `package:` trailer;
2. **the resolver** — `node-linker=isolated` makes an undeclared package import fail to resolve,
   which is why changing `.npmrc:4` is a `gate:` commit with an ADR line (`.npmrc:1-3`);
3. **`L-graph`** — the declared edges must equal the ACTUAL closure the compiler reports
   (`tsc --noEmit --listFiles` per project), the package `name` must equal its folder name, and no
   relative specifier may leave its own package root. Nothing else catches the escape measured above.

Rejected alternatives, each for a stated reason:

- **One package with folders and a lint rule on import paths.** The declaration would then live only
  in the linter, whose suppression is documented and works (ADR-0005), and a fresh worktree with no
  install could check nothing.
- **`paths` aliases in `tsconfig.base.json` for cross-package imports.** An alias is a second,
  silent edge the manifests do not mention; `L-graph` would then have two sources to reconcile.
- **A built `dist` per package as the thing apps import.** `exports` points at `./src/*.ts` and every
  project is `noEmit` (`packages/core/tsconfig.json:9`, `tsconfig.base.json:13-17`). This is recorded
  so nobody "fixes" the boundary by adding a build: the honest second channel in this repository is
  types (`tsc`) against behaviour (the test runner), not `src` against `dist` — and which runner
  produces the behaviour half is deliberately not what this ADR turns on.

## Consequences

- Gains: the core is testable with no DOM, no server and no network, and its purity is a property of
  the dependency graph rather than of anyone's discipline. An app can be replaced without touching a
  rule. The three names and three edges are fixed by this table.
- Costs: anything the core cannot express — I/O, time, randomness, HTTP — is an argument passed in or
  a port implemented in an app, so a type that needs both worlds is split in two. `@cheq/web` cannot
  reuse an api helper; the shared half moves into the core or is duplicated deliberately.
- **Open hole, named:** the root's own dev dependency set is importable from `packages/core` by upward
  resolution (measured above). `L-graph`'s closure check is what sees it; the manifest check alone
  does not. Until that light exists, the hole is open and nothing reports it.
- Adding or removing a package is a change to this table, to `tools/gates/lights/graph.mjs` and to the
  repository map in `AGENTS.md`, in one `gate:` commit.
- `tools/*` stays in `pnpm-workspace.yaml:4` with nothing matching it. If a package ever appears
  there it joins this table in the same commit; a workspace package whose edges no table names is
  exactly what this ADR exists to prevent.
