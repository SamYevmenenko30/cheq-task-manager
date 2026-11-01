# React DOM — `react-dom`

- **Version:** 19.3.1 · **Declared in:** `apps/web/package.json:10` (`^19.3.1`) · **Resolved by:** `pnpm-lock.yaml` importer `apps/web` → `dependencies.react-dom.version`, which reads `19.3.1(react@19.3.1)` — the parenthesis is pnpm's peer suffix, and the version this header carries is the part before it (`bareVersion`, `tools/gates/lights/deps.mjs:147`) · **Added:** 2026-11-01, commit `4ddd4e2` (`chore: scaffold, gates and doctrine`), declared there by the line `package: react-dom — the DOM renderer for react` · **Licence:** MIT (`react-dom/package.json` `"license": "MIT"`, full text in `react-dom/LICENSE`)
- **Adapter:** `apps/web/src/main.tsx:2` — the only file in the repository that imports it, and the only one that may. As in [react.md](react.md): rule 15 (`AGENTS.md:436`) names `apps/web/src/adapters/**`, that folder does not exist, and no light reads the word (grep of `tools/gates/`, 2026-11-01), so this line is a reviewer's check.
- **Why it is here:** no spec needs it yet (`docs/specs/` holds only `docs/specs/README.md`). It is here because something has to attach the React tree to the document, and `apps/web/src/main.tsx` is that something.
- **Typechecks on this toolchain: VERIFIED** 2026-11-01 — `./node_modules/.bin/tsc --noEmit --pretty false -p apps/web/tsconfig.json`, exit 0, zero diagnostics, exit code captured into a variable and never read through a pipe (rule 1, `AGENTS.md:13`).

## Citation paths

`node-linker=isolated` (`.npmrc:4`) makes every package path a store path carrying its version, which
goes stale visibly (`docs/vendor/README.md`). The prefixes are written out once here and abbreviated
below. **A path with no prefix from this table is relative to the repository root.**

| prefix used below | the real resolved path |
|---|---|
| `react-dom/` | `node_modules/.pnpm/react-dom@19.3.1_react@19.3.1/node_modules/react-dom/` |
| `@types/react-dom/` | `node_modules/.pnpm/@types+react-dom@19.3.0_@types+react@19.3.0/node_modules/@types/react-dom/` |

## `react-dom/client` is a different module from `react-dom`

The repository imports `createRoot` from `react-dom/client`, not from `react-dom`, and that is not a
style choice:

- the runtime package declares `exports["./client"]` separately from `exports["."]`
  (`react-dom/package.json`), resolving to its own file `react-dom/client.js`;
- the types follow the same split. Measured with `tsc --noEmit --listFiles -p apps/web/tsconfig.json`
  on 2026-11-01: the compiler reads `@types/react-dom/client.d.ts` and **no file under
  `react-dom/`** — this package, like `react`, ships no type declarations, and `@types/react-dom`
  (a devDependency, `apps/web/package.json:15`) is what declares every signature below;
- `createRoot` is declared in `@types/react-dom/client.d.ts` and in no other entry point's types. An
  import of it from `'react-dom'` is not a member this digest can cite.

The other subpaths the package exports — `./server`, `./server.browser`, `./server.edge`,
`./server.node`, `./server.bun`, `./static*`, `./profiling`, `./test-utils` — exist and are not used
here. `@types/react-dom/test-utils/index.d.ts` nevertheless appears in the compiler's file list,
pulled in by `@testing-library/react`, not by our code.

## Peer dependency, and why it is not a second declaration

`peerDependencies: { "react": "^19.3.1" }` in `react-dom/package.json`. `autoInstallPeers: true`
(`pnpm-lock.yaml:4`) means pnpm satisfied it from the `react` this repository already declares, which
is where the `(react@19.3.1)` suffix on the resolved version comes from. Nothing has to be declared
twice; the suffix is the only visible trace, and it is the reason this file's `Version:` header is a
bare version.

## The surface this repository calls today

Every signature below is from `@types/react-dom/client.d.ts`.

| member | signature | cited from | notes |
|---|---|---|---|
| `createRoot` | `function createRoot(container: Container, options?: RootOptions): Root` | `@types/react-dom/client.d.ts:86` | allocates a root and renders **nothing**. Docs: https://react.dev/reference/react-dom/client/createRoot (the `@see` at `@types/react-dom/client.d.ts:84`) |
| `Container` | `Element \| DocumentFragment \| Document \| …` | `@types/react-dom/client.d.ts:73` | wider than the template's guess of `Element \| DocumentFragment`. The last arm is an intentionally unusable experimental interface (`@types/react-dom/client.d.ts:71`) |
| `Root` | `interface Root { render(children: React.ReactNode): void; unmount(): void }` | `@types/react-dom/client.d.ts:61` | two methods, both returning nothing |
| `Root.render` | `(children: React.ReactNode) => void` | `@types/react-dom/client.d.ts:62` | takes `ReactNode` ([react.md](react.md)), not an element type |
| `Root.unmount` | `() => void` | `@types/react-dom/client.d.ts:63` | |
| `RootOptions` | `{ identifierPrefix?: string; onUncaughtError?; onRecoverableError?; onCaughtError? }` | `@types/react-dom/client.d.ts:37` | the error hooks a future spec may want; **not called today**, so cited and not used |
| `ErrorInfo` | `interface ErrorInfo { componentStack?: string }` | `@types/react-dom/client.d.ts:57` | the second argument of the `RootOptions` hooks |

`apps/web/src/main.tsx:9` is the one call site:
`createRoot(host).render(<StrictMode><App /></StrictMode>)`.

## `createRoot` and `render` are two different things

The chained spelling hides it, so it is written out. `createRoot(host)` allocates a root attached to
`host` and draws nothing; `root.render(children)` is a separate call that draws, and it may be called
again on the same root. Measured 2026-11-01 in a temporary `apps/web/test/` probe (jsdom, `tsc` exit 0,
`vitest run --project web` 1 passed, deleted in the same command):

- `root.render(<StrictMode><Probe tag="a"/></StrictMode>)`, then
  `root.render(<StrictMode><Probe tag="b"/></StrictMode>)` on the **same** root: the second call
  re-rendered in place — `host.innerHTML` became `<p>b</p>`, the effect of the first tree was cleaned
  up and the new one mounted (`cleanup:a | effect:b`). It did **not** mount a second tree beside the
  first.
- `root.unmount()`: the effect's cleanup ran and `host.innerHTML` became `""`.
- A second `createRoot(host)` on a host that already has a root was **not** tried, so what React does
  then is UNVERIFIED here. React's development build is documented to warn; that is a promise, not an
  observation.

This is the same mechanism `apps/web/test/setup.ts:7` exists for from the other side: without
`afterEach(cleanup)`, a second `render()` in one test file leaves the first tree mounted and a
single-match query matches twice — the comment at `apps/web/test/setup.ts:1` records that
measurement.

## Behaviour facts, measured

- `createRoot(host)` with no `options` is the shape in use; nothing here passes `RootOptions`, so an
  uncaught render error goes to React's default handling and no code of ours sees it. That is the gap
  `onUncaughtError` would close, and closing it is a spec's decision, not this file's.
- The host element is looked up, not created, by the adapter: `apps/web/src/main.tsx:6` reads
  `document.getElementById('root')` and `apps/web/src/main.tsx:7` throws
  `#root is missing from index.html` when it is absent — so a missing host is an error of ours with a
  sentence in it, not a React type error. `Container` would have accepted `null` nowhere: that
  narrowing is what makes the call typecheck.
- Rendering is synchronous enough to assert on inside `act()` and not otherwise: every observation
  above was taken with the render wrapped in `act` (see [react.md](react.md)).

## UNVERIFIED

- `hydrateRoot` (`@types/react-dom/client.d.ts:101`) and `HydrationOptions`
  (`@types/react-dom/client.d.ts:16`): declared, never called here. No server rendering exists in
  this repository.
- Every `./server*`, `./static*` and `./profiling` entry point.
- The `RootOptions` error hooks: cited from the types, never exercised.
- A second `createRoot` on an already-rooted container, and `render` after `unmount`.
- Whether `@types/react-dom` 19.3.0 describes `react-dom` 19.3.1 correctly. Separate packages,
  separate version lines, nothing compares them, and `skipLibCheck: true` (`tsconfig.base.json:26`,
  [TD-0004](../tech-debt/TD-0004-vitest-does-not-typecheck.md)) would hide an error inside the
  declaration file anyway.
