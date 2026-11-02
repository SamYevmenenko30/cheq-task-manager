# TD-0016: `app.inject()` cannot load under Jest on the pinned Node, so the runner config carries a one-package transform exception

**Status:** Open · the exception is in force and MEASURED to be the whole difference between 25 red api cases and 29 green ones, at the price of the api lane exercising a transformed copy of `cookie` where production loads it as ESM; what is undecided is whether it stays, or is replaced by moving the pinned Node to 24.9+, which closes that divergence and is a decision with CHQ-004 and CHQ-005 downstream of it
**Area:** `jest.config.mjs` (`shared.transformIgnorePatterns`, header fact 6) · `.nvmrc:1` · `docs/vendor/fastify.md`
**Raised:** 2026-11-02, during CHQ-002's implementation phase

## What is wrong

`kind: api`'s verdict of record is `app.inject()` and nothing else — no live port, by rule
(`AGENTS.md:153`, `.claude/agents/api.md:36`, `docs/vendor/fastify.md`). That method is Fastify's
re-export of `light-my-request`, and the chain it loads is:

```
fastify/fastify.js:479   -> light-my-request/index.js:5
                         -> light-my-request/lib/request.js:10
                         -> light-my-request/lib/cookies.js:3   require('cookie')
```

`light-my-request@6.8.0` is CommonJS. `cookie@2.0.1` is ESM-only — `"type": "module"`,
`"exports": "./dist/index.js"`, and `dist/` holds no CJS build
(`node_modules/.pnpm/cookie@2.0.1/node_modules/cookie/package.json`). Node 22 performs that
`require` of an ES module natively; **Jest does not**: its own CJS loader intercepts the call and
throws `ERR_REQUIRE_ESM`, naming three cures — a transform, `transformIgnorePatterns`, or
"Node v24.9+ where Jest supports require(esm) natively"
(`node_modules/.pnpm/jest-runtime@30.5.2/node_modules/jest-runtime/build/index.js:452`).

MEASURED 2026-11-02 against CHQ-002's eleven committed spec tests, implementation in place, with the
runner's default `transformIgnorePatterns: ['/node_modules/']`: **25 of 29 api cases failed**, every
one of them inside `app.inject` with `Must use import to load ES Module: …/cookie/dist/index.js`,
before reaching any expectation. The four that passed are the three cases of S7 — the only assertion
that judges the store adapter away from a route — and the skeleton marker. With the exception in
force, 29 of 29 pass, and the other three projects are unaffected (123 of 123 across all four).

So the defect is not in the product and no implementation of `apps/api` can route around it: with the
pinned toolchain as it was, **ten of CHQ-002's eleven assertions were unjudgeable by the mechanism
the method says judges them.**

## Why it is tolerable right now

- The exception names ONE package. `/node_modules/(?!(\.pnpm/)?cookie[@/])` lifts `cookie` out of
  the default and leaves every other package in it, in both spellings a `node-linker=isolated` store
  path produces (`.npmrc:4`). A pattern that merely dropped the default would have put the whole of
  `node_modules` through `@swc/jest`.
- It is not a gate going blind. `transformIgnorePatterns` is not one of the three keys `L-visible`
  reads out of this file (`tools/gates/lights/visible.mjs:212` — `testMatch`,
  `testPathIgnorePatterns`, `modulePathIgnorePatterns`), it is not a `tsconfig` `include`, and the
  direction of the change is to make MORE code loadable rather than less code visible. No file is
  hidden from any light by it and no assertion changed.
- It is a separate commit from the behaviour it unblocks, so replacing it with the Node route is one
  revert plus one decision, not an archaeology exercise.

What does NOT stand in for it: nothing re-derives the claim. If `light-my-request` or `cookie` moves
under a Fastify bump — and both are transitive, which `L-deps` does not watch
(`tools/gates/lights/deps.mjs:81`, and `docs/vendor/fastify.md`'s UNVERIFIED list says so) — this
pattern can start naming a package that is no longer in the chain, and the only symptom would be the
same 25 red cases returning.

**And the cure buys a test-versus-production divergence, which is the honest cost of taking the
narrow one.** Under the runner `cookie` is now put through `@swc/jest` and executes as CommonJS; in
production nothing transforms it and Node loads it as the ES module it is. So every api assertion
exercises a *transformed copy* of that dependency rather than the artefact a deployed process would
load. The gap is small — `cookie` is a parser and a serialiser with no top-level side effects, and
the only member in the chain is `stringifySetCookie`, reached by light-my-request's cookie handling,
which no assertion here touches — but it is a difference in kind and not in degree, and nothing in
this repository would report it widening. Pinning Node 24.9+ (option 2 below) closes it outright,
because then the test loads exactly what production loads.

## What closing it involves

A decision, not a measurement. Two candidates, and the second is the one with reach:

1. **Keep the exception.** Then it is owed a probe in `tools/gates/gate-probes.mjs` that fails when
   the key is absent — i.e. plants the default back and checks that the api lane reports
   `cannot-verify` rather than green — which is what rule 13 asks of any change to the checking
   machinery, and what nobody has written. Closing on this path means that probe exists and this
   entry is struck through.
2. **Move the pinned Node to 24.9+ and delete the key.** `v24.18.0` is installed on this machine
   (`ls ~/.nvm/versions/node`, 2026-11-02) and Jest 30.5.2 delegates `require(esm)` to Node from
   24.9. But `.nvmrc:1` is read by `status.mjs` as the declared version and reported as
   `NODE=… declared=… matches=`, so the pin is machine-state doctrine (ADR-0003), and the same
   number is the runtime of the container in CHQ-004 and of whatever CHQ-005 deploys to. That makes
   it a project decision with consequences two tickets out, which is why this ticket took the
   narrower cure and recorded the wider one here instead of choosing it.

Either way the observation that would make this entry **stay open with a different reason** is a
Fastify bump that moves `light-my-request` off `cookie`: the key then protects nothing, and the
entry becomes "a transform exception nobody needs is still in the config".
