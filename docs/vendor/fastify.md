# Fastify — `fastify`

- **Version:** 5.12.7 · **Declared in:** `apps/api/package.json:9` (`^5.12.7`) · **Resolved by:** `pnpm-lock.yaml` importer `apps/api` → `dependencies.fastify.version` · **Added:** 2026-11-01, commit `4ddd4e2` (`chore: scaffold, gates and doctrine`), declared there by the line `package: fastify — the HTTP adapter of apps/api; tests reach it through app.inject(), never a live port` · **Licence:** MIT (`fastify/package.json` `"license": "MIT"`, full text in `fastify/LICENSE`)
- **Adapter:** none yet. **Not one line of this repository imports `fastify`** — `apps/api/src/` holds a single file, `apps/api/src/index.ts`, and it is a marker exporting a string constant (`apps/api/src/index.ts:7`). When the first route arrives it belongs in `apps/api/src/`, built by a factory a test can import (`.claude/agents/api.md:39`); rule 15's `apps/api/src/adapters/**` (`AGENTS.md:436`) is a declaration no light reads today (grep of `tools/gates/` for `adapters`, 2026-11-01).
- **Why it is here:** because the rule says BEFORE first use, and there is no use. `docs/vendor/README.md` calls `fastify` the normal case the rule was written for: declared and not yet imported. `.claude/skills/tests-from-spec/SKILL.md:52` records the gap this file closes in so many words — "the injection method's exact signature is cited from Fastify's own docs at first use, UNVERIFIED here until then". It is no longer UNVERIFIED: the signature is below, cited and measured.
- **Typechecks on this toolchain: VERIFIED** 2026-11-01 — a temporary `apps/api/src/` probe importing the factory and the three types below, then calling `app.get`, `app.inject`, `res.json()` and `app.close()`: `./node_modules/.bin/tsc --noEmit --pretty false -p apps/api/tsconfig.json` exit 0, zero diagnostics, and `./node_modules/.bin/tsx` on the same file exit 0. Both exit codes were captured into variables, never read through a pipe (rule 1, `AGENTS.md:13`). The probe was deleted in the command that created it, and `git status --porcelain` was empty afterwards.

## Citation paths

`node-linker=isolated` (`.npmrc:4`) makes every package path a store path carrying its version, which
goes stale visibly (`docs/vendor/README.md`). The prefixes are written out once here and abbreviated
below. **A path with no prefix from this table is relative to the repository root** — which matters
more here than in the other digests, because Fastify ships its own `docs/` folder and a bare
`docs/Guides/…` would read as this repository's.

| prefix used below | the real resolved path |
|---|---|
| `fastify/` | `node_modules/.pnpm/fastify@5.12.7/node_modules/fastify/` |
| `light-my-request/` | `node_modules/.pnpm/light-my-request@6.8.0/node_modules/light-my-request/` |

## The one thing this repository needs from Fastify: `inject`

`kind: api` is judged through in-process injection and never through a listening port
(`docs/knowledge/testing.md:24`, `.claude/agents/api.md:36`, `.claude/skills/ts-loop/SKILL.md:88`).
`pnpm dev:api` is a real server and is advisory only: a reply seen in a browser is not evidence, and a
test that binds a port can pass because something else was listening. So `inject` is not a convenience
here — it is the mechanism the verdict rests on, and the rest of this file is organised around it.

| member | signature | cited from | notes |
|---|---|---|---|
| `inject` | `inject(opts: InjectOptions \| string): Promise<LightMyRequestResponse>` | `fastify/types/instance.d.ts:170` | **the form this repository uses.** `await app.inject({ method, url })` |
| `inject` (callback) | `inject(opts: InjectOptions \| string, cb: LightMyRequestCallback): void` | `fastify/types/instance.d.ts:169` | returns `void`; not used here |
| `inject` (chain) | `inject(): LightMyRequestChain` | `fastify/types/instance.d.ts:171` | the fluent form, `app.inject().get('/').end(…)`; documented at `fastify/docs/Guides/Testing.md:154`, **not used and not measured here** |

Fastify's built-in injection is [`light-my-request`](https://github.com/fastify/light-my-request)
(`fastify/docs/Guides/Testing.md:66`), resolved to `light-my-request@6.8.0` in this tree. That package
is a **transitive** dependency: no manifest in this repository declares it, and under
`node-linker=isolated` an import of `'light-my-request'` from `apps/api` would not resolve. It does not
have to: Fastify re-exports the four names from its own entry point (`fastify/fastify.d.ts:222`), so a
test writes

    import type { InjectOptions, LightMyRequestResponse } from 'fastify';

and cites this file. Measured: that import typechecks at exit 0 under `apps/api/tsconfig.json`.
Importing those types from `'light-my-request'` instead would be a dependency nothing declares.

### `InjectOptions` — what a request is made of

From `light-my-request/types/index.d.ts:30` onwards:

| field | type | line |
|---|---|---|
| `method` | `HTTPMethods` | `light-my-request/types/index.d.ts:55` |
| `url` | `string` or `{ pathname, protocol?, hostname?, port?, query? }` | `light-my-request/types/index.d.ts:31` |
| `path` | the same shape as `url` | `light-my-request/types/index.d.ts:38` |
| `headers` | `http.IncomingHttpHeaders \| http.OutgoingHttpHeaders` | `light-my-request/types/index.d.ts:45` |
| `query` | `string \| { [k: string]: string \| string[] }` | `light-my-request/types/index.d.ts:46` |
| `payload` · `body` | `InjectPayload` (two spellings of the same thing) | `light-my-request/types/index.d.ts:57` · `light-my-request/types/index.d.ts:58` |
| `cookies` | `{ [k: string]: string \| Omit<Cookie,'name'> } \| Cookie[]` | `light-my-request/types/index.d.ts:61` |

The upstream guide's summary of the same set is `fastify/docs/Guides/Testing.md:140`.

### `LightMyRequestResponse` — what comes back

From `light-my-request/types/index.d.ts:83` onwards:

| member | type | line | notes |
|---|---|---|---|
| `statusCode` | `number` | `light-my-request/types/index.d.ts:90` | what a `kind: api` assertion is usually about |
| `json` | `<T = any>() => T` | `light-my-request/types/index.d.ts:95` | a **method**, not a property — `res.json()`. Its default type parameter is `any`, so pass one: `res.json<{ ok: boolean }>()` |
| `payload` | `string` | `light-my-request/types/index.d.ts:93` | the raw body |
| `body` | `string` | `light-my-request/types/index.d.ts:94` | the same string under a second name |
| `headers` | `http.OutgoingHttpHeaders` | `light-my-request/types/index.d.ts:89` | |
| `statusMessage` | `string` | `light-my-request/types/index.d.ts:91` | |
| `rawPayload` | `Buffer` | `light-my-request/types/index.d.ts:88` | |
| `raw` | `{ res: http.ServerResponse, req: http.IncomingMessage }` | `light-my-request/types/index.d.ts:84` | the node objects underneath |
| `cookies` | `Array<Cookie>` | `light-my-request/types/index.d.ts:97` | |
| `trailers` | `{ [key: string]: string }` | `light-my-request/types/index.d.ts:92` | |
| `stream` | `() => Readable` | `light-my-request/types/index.d.ts:96` | |
| `isLightMyRequest` | `true` | `light-my-request/types/index.d.ts:98` | **declared and absent at runtime — see the defect below** |

## The factory

`fastify/fastify.d.ts:307` is `export = fastify`, a CommonJS-style declaration with four overloads
(`fastify/fastify.d.ts:269` onwards) selected by the options object: http2-secure, http2, https and —
the one this repository takes — plain http at `fastify/fastify.d.ts:296`:

    declare function fastify<Server, Request, Reply, Logger, TypeProvider>(
      opts?: fastify.FastifyHttpOptions<Server, Logger>
    ): FastifyInstance<…> & SafePromiseLike<FastifyInstance<…>>

`export =` would normally make `import Fastify from 'fastify'` an error. It is legal here because
`esModuleInterop: true` (`tsconfig.base.json:10`), and it was **measured** rather than assumed:
`import Fastify from 'fastify'` plus `import type { FastifyInstance, InjectOptions,
LightMyRequestResponse } from 'fastify'` typechecked at exit 0 under this repository's
`verbatimModuleSyntax: true` / `moduleResolution: "bundler"` / `module: "ESNext"` settings
(`tsconfig.base.json:6`, `tsconfig.base.json:7`, `tsconfig.base.json:8`).

The instance type is `FastifyInstance` (`fastify/types/instance.d.ts`, re-exported at
`fastify/fastify.d.ts:226`); `app.get` is `RouteShorthandMethod`
(`fastify/types/instance.d.ts:194`), `app.post` at `fastify/types/instance.d.ts:197`, `app.route` at
`fastify/types/instance.d.ts:186`, `app.register` at `fastify/types/instance.d.ts:181`, `app.close`
at `fastify/types/instance.d.ts:145`, `app.ready` at `fastify/types/instance.d.ts:177`, `app.listen`
at `fastify/types/instance.d.ts:173`.

## Behaviour facts, measured

One probe run, 2026-11-01, `tsx` exit 0, on an instance built as `Fastify({ logger: false })` with a
single `app.get('/health', async () => ({ ok: true }))`:

- **`inject` boots the app itself.** The probe never called `listen()` and never called `ready()`, and
  the route answered `statusCode=200`, `payload={"ok":true}`, `json().ok === true`,
  `content-type: application/json; charset=utf-8`. The mechanism is in the source: `inject` calls
  `this.ready(…)` when the instance has not started (`fastify/fastify.js:496` onwards, under the
  comment at `fastify/fastify.js:472` — "If the server is not ready yet, this utility will
  automatically force it"), which is the same promise the guide makes at
  `fastify/docs/Guides/Testing.md:95`. So a test needs no `await app.ready()` and no port.
- **An object reply is serialised to JSON without being asked.** Measured above: the handler returned
  a plain object and the payload came back as JSON with a charset. A test may therefore assert on
  `res.json()` without configuring a serialiser.
- **An unknown route is a failure nobody configured.** `GET /nope` on the same instance:
  `statusCode=404` with the body
  `{"message":"Route GET:/nope not found","error":"Not Found","statusCode":404}`. That is Fastify's
  default not-found handler, so a spec that wants a different shape has to say so.
- **The instance is single-use across `close`.** Two injections in a row on the same instance both
  answered 200. After `await app.close()`, a third injection **rejected** with
  `Fastify has already been closed and cannot be reopened` — the branch at `fastify/fastify.js:483`
  raising `FST_ERR_REOPENED_CLOSE_SERVER` (`fastify/lib/errors.js:473`). A test that closes the app in
  a hook and then injects again is asserting on that message, not on a route.

## The measured defect: a field the types promise and the runtime does not have

`isLightMyRequest: true` is declared on the **resolved** response
(`light-my-request/types/index.d.ts:98`). Measured on the object `await app.inject(…)` actually
resolves to:

    Object.hasOwn(res, 'isLightMyRequest')                             → false
    (res.raw.res as { isLightMyRequest?: boolean }).isLightMyRequest   → true

The flag is set on the node response object, not on the serialised result
(`light-my-request/lib/response.js:12`, and the same line for the request at
`light-my-request/lib/request.js:142`). So `expect(res.isLightMyRequest).toBe(true)` **typechecks**
and is `undefined` at runtime.

This is worth a paragraph rather than a footnote because it is exactly the failure shape
[TD-0004](../tech-debt/TD-0004-vitest-does-not-typecheck.md) names from two directions at once:
Vitest erases types (esbuild), so the type channel never runs on the test, and `skipLibCheck: true`
(`tsconfig.base.json:26`) means nothing checks the declaration file either. Nothing in this
repository would have reported it; a probe against the real artefact did. Treat every member in the
tables above the same way — cited is not measured, and the measured ones are marked.

## UNVERIFIED

- The chain form `app.inject().get('/')…` (`fastify/types/instance.d.ts:171`).
- The callback form `inject(opts, cb)` (`fastify/types/instance.d.ts:169`).
- Plugins and encapsulation: `register` (`fastify/types/instance.d.ts:181`), hooks, decorators, the
  schema compiler, the type providers. None is imported, called or observed here; each is a `Qn` in
  the spec that first needs it, never a call (rule 15).
- Every `InjectOptions` field except `method` and `url`: `headers`, `query`, `payload`/`body`,
  `cookies`, `path`, `simulate`, `remoteAddress`, `authority`, `payloadAsStream`.
- Every `LightMyRequestResponse` member except `statusCode`, `payload`, `json()`, `headers` and
  `raw.res` — and `isLightMyRequest`, which is verified ABSENT.
- `listen()`, and the whole live-server route. It is advisory by rule (`.claude/agents/api.md:36`) and
  no verdict may rest on it, so it is deliberately not measured.
- The three non-http factory overloads (`fastify/fastify.d.ts:269`, `fastify/fastify.d.ts:278`,
  `fastify/fastify.d.ts:287`).
- Whether the version of `light-my-request` this digest cites stays the one Fastify resolves. It is
  transitive: a Fastify bump can move it with nothing in any manifest changing, and `L-deps` watches
  the lockfile's importer specifiers, not its transitive closure
  (`tools/gates/lights/deps.mjs:81` — the reader reads `importers:` and nothing else).
