# React — `react`

- **Version:** 19.3.1 · **Declared in:** `apps/web/package.json:9` (`^19.3.1`) · **Resolved by:** `pnpm-lock.yaml` importer `apps/web` → `dependencies.react.version` · **Added:** 2026-11-01, commit `4ddd4e2` (`chore: scaffold, gates and doctrine`), declared there by the line `package: react — the presentation layer of apps/web` · **Licence:** MIT (`react/package.json` `"license": "MIT"`, full text in `react/LICENSE`)
- **Adapter:** `apps/web/src/main.tsx:1` — the only file in the repository that imports `react`, and nothing else may. Named honestly: rule 15 (`AGENTS.md:436`) puts third-party code in `apps/web/src/adapters/**`, that folder does not exist, and a grep of `tools/gates/` for `adapters` on 2026-11-01 found no reader of the word — so this line is a declaration a reviewer enforces, not a light.
- **Why it is here:** no spec needs it yet. `docs/specs/` holds only `docs/specs/README.md` at this commit, so the honest answer is the scaffold: `apps/web` is a Vite + React presentation layer (`apps/web/package.json:6`) and `apps/web/src/main.tsx` is its entry point. The first `CHQ-<nnn>` that renders anything replaces this line with its own.
- **Typechecks on this toolchain: VERIFIED** 2026-11-01 — `./node_modules/.bin/tsc --noEmit --pretty false -p apps/web/tsconfig.json`, exit 0, zero diagnostics. The exit code was captured into a variable, never read through a pipe, which is the rule rule 1 (`AGENTS.md:13`) and [ADR-0002](../decisions/ADR-0002-verdict-of-record.md) state and which already has a measurement behind it here (`docs/knowledge/loop.md:224` — the same `tsc` invocation reporting `exit=0` through a pipe and `exit=1` on its own).

## Citation paths

`node-linker=isolated` (`.npmrc:4`) makes every package path a store path carrying its version, which
is long and is exactly the point: it goes stale visibly (`docs/vendor/README.md`). The two prefixes are
written out once here and abbreviated below. **A path with no prefix from this table is relative to the
repository root.**

| prefix used below | the real resolved path |
|---|---|
| `react/` | `node_modules/.pnpm/react@19.3.1/node_modules/react/` |
| `@types/react/` | `node_modules/.pnpm/@types+react@19.3.0/node_modules/@types/react/` |

## The version number is read, never written

Two places in this file carry it: the `Version:` header and the prefix table, which holds it because
the resolved paths do. It appears in no sentence (ADR-0003). `L-deps` compares the header against
`pnpm-lock.yaml`'s resolved version and fails a disagreement
(`tools/gates/lights/deps.mjs:503-521`), which is the only thing that makes this file visibly stale.

## This package ships no types, and that decides every citation below

Measured 2026-11-01, `tsc --noEmit --listFiles -p apps/web/tsconfig.json` (exit 0): the compiler reads
`@types/react/global.d.ts`, `@types/react/index.d.ts` and `@types/react/jsx-runtime.d.ts` — and **not
one file under `react/`**.

So a citation of a React *signature* points at `@types/react`, a separate package declared as a
devDependency (`apps/web/package.json:14`) at a version that moves independently of the runtime one.
The runtime package is cited only for what nothing else can answer: its entry points.

Two consequences worth stating rather than discovering:

- the types and the runtime can disagree, and nothing in this repository compares them. A member that
  typechecks is not a member that exists — the shape of that failure is measured in
  [fastify.md](fastify.md), where a declared field is `undefined` at runtime.
- `skipLibCheck: true` (`tsconfig.base.json:26`,
  [TD-0004](../tech-debt/TD-0004-vitest-does-not-typecheck.md)) means errors *inside*
  `@types/react` are not reported at all.

## Entry points (from the runtime package, the only authority on them)

`react/package.json` → `exports`: `"."`, `"./jsx-runtime"`, `"./jsx-dev-runtime"`,
`"./compiler-runtime"`, `"./package.json"`. Nothing else is importable; a subpath not in that list is
not a thing to try.

`apps/web/tsconfig.json:6` sets `"jsx": "react-jsx"`, so `./jsx-runtime` is reached by the compiler and
the bundler and never by a line anyone writes — which is why no file here imports `React` itself.

## The surface this repository calls today

| member | signature | cited from | notes |
|---|---|---|---|
| `StrictMode` | `const StrictMode: ExoticComponent<{ children?: ReactNode \| undefined }>` | `@types/react/index.d.ts:789` | a component, not a flag: it wraps children and takes no props of its own. Its whole observable effect is the development-build double-invocation measured below. Docs: https://react.dev/reference/react/StrictMode (the `@see` at `@types/react/index.d.ts:777`) |
| `ExoticComponent<P>` | `interface ExoticComponent<P = {}> { (props: P): ReactNode; readonly $$typeof: symbol }` | `@types/react/index.d.ts:570` | what `StrictMode`'s type resolves to; cited because an error message will name it |
| `ReactNode` | a union (element, string, number, iterable, portal, boolean, null, undefined, …) | `@types/react/index.d.ts:436` | the type `Root.render` takes — see [react-dom.md](react-dom.md) |

That is all of it. `apps/web/src/App.tsx` is a plain function returning JSX and imports nothing from
`react`; `apps/web/src/main.tsx:1` imports `StrictMode` and nothing else. A digest that listed hooks
nobody calls would be a copy of the upstream docs, which `docs/vendor/README.md` names as the same
failure as no digest.

## Cited, typechecked and observed in a probe — available to the first spec that needs them

Measured in a temporary `apps/web/test/` probe on 2026-11-01 (`tsc -p apps/web/tsconfig.json` exit 0,
`vitest run --project web` 1 passed), deleted in the same command that created it:

| member | signature | cited from |
|---|---|---|
| `act` | `function act(callback: () => VoidOrUndefinedOnly): void` · `function act<T>(callback: () => T \| Promise<T>): Promise<T>` | `@types/react/index.d.ts:1911` · `@types/react/index.d.ts:1912` |
| `useEffect` | `function useEffect(effect: EffectCallback, deps?: DependencyList): void` | `@types/react/index.d.ts:1792`, with `EffectCallback = () => void \| Destructor` at `@types/react/index.d.ts:1672` and `DependencyList = readonly unknown[]` at `@types/react/index.d.ts:1669` |

`act` needs `globalThis.IS_REACT_ACT_ENVIRONMENT = true` when it is used without
`@testing-library/react`, which sets that flag itself — so a `kind: web` test that goes through
`render()` (`apps/web/test/skeleton/stub.test.tsx:3`) never sets it, and one that drives a `Root`
directly must.

`EffectCallback`'s return type is `void | Destructor` where `Destructor = () => void | { … }`
(`@types/react/index.d.ts:63`), so an arrow whose body is an expression returning a value —
`() => log.push(x)`, which returns a number — is `error TS2345`. Measured: that was the first version
of the probe above, and it is the mistake the type is shaped to catch.

## Behaviour facts, measured

All of the following is from one run in the `web` project (jsdom, Vitest's development build of
React), 2026-11-01. Two `Root`s rendered the same component, one inside `StrictMode` and one not, each
logging on render, on effect mount and on effect cleanup:

    StrictMode:  render:a | render:a | effect:a | cleanup:a | effect:a
    plain:       render:plain | effect:plain

- **The component function runs twice and the effect mounts, cleans up and mounts again.** Not an
  artefact of the test: it is what `StrictMode` is for. The consequence for this repository is a rule,
  not a note — `apps/web/src/main.tsx:10` wraps the whole app in it, so **an effect that is not
  idempotent is already broken in the app**, and a `kind: web` test that renders without `StrictMode`
  will not see it. Nothing mechanical enforces that symmetry today.
- **It is development-only.** The doubling comes from the development build; a production build does
  not do it. No production build exists in this repository (`vite build` takes part in no verdict,
  [TD-0010](../tech-debt/TD-0010-no-performance-lane.md)), so "the same code behaves differently in
  the bundle we ship" is UNVERIFIED here rather than denied.
- `StrictMode` adds no DOM node: the host's `innerHTML` after the render was `<p>b</p>`, the
  component's own markup and nothing else.

## UNVERIFIED

- Everything the React docs promise beyond the three members above: hooks, `Suspense`, `use`,
  transitions, the compiler. None has been observed on this machine, so each is a `Qn` in a spec, not
  a call (rule 15).
- The production build's behaviour, including whether anything other than the double-invocation
  differs between it and the development build.
- Whether `@types/react` 19.3.0 and `react` 19.3.1 agree. They are separate packages on separate
  version lines and nothing here compares them.
- React's own `act` outside an environment `@testing-library/react` prepared: observed to work with
  `IS_REACT_ACT_ENVIRONMENT` set by hand, never with it unset.
