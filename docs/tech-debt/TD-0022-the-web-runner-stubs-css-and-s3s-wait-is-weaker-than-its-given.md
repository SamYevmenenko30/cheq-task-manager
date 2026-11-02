# TD-0022 — The `web` runner stubs CSS, and S3's wait is weaker than its own Given

Opened 2026-11-02, during CHQ-003's `implement-to-green`. Two findings about the same gap between
what the browser does and what the `web` test project can see. Both are measured, both are
load-bearing today, and neither is hidden behind a passing lane.

## 1. The runner has no CSS pipeline, so `*.css` is stubbed

CHQ-003 decided CSS Modules, because of the three styling options the vision offers it is the only
one Vite supports with no dependency and `L-deps` forbids this phase from adding one
(`docs/specs/CHQ-003.md`, Contradictions). Vite compiles a CSS module; Jest does not.

**MEASURED 2026-11-02**, with the `web` project's config as it stood: one component importing
`./App.module.css` made **all eleven** suites under `apps/web/test` fail to COLLECT with
`SyntaxError: Unexpected token '.'` at `apps/web/src/App.module.css:4`, and the run reported
`Tests: 0 total`. That is the shape a reader must not mistake for eleven broken components: it is
one verdict about the runner.

The cure is the one Jest's own message recommends for a non-JS asset — `moduleNameMapper` — and it
is now `jest.config.mjs`'s `web` project only, mapping `\.css$` to
`apps/web/test/support/css-module.ts`. What that costs, stated rather than discovered later:

- **No case can observe a real class name.** The stub exports an empty map, deliberately rather
  than as an identity proxy: an identity proxy would let a test assert on a class name that Vite
  never produces. Every CHQ-003 case addresses the tree by role, label or text, so nothing passes
  because of a style — but nothing checks the styling either, and the layout assertion that would
  (S11) is `kind: e2e` and CANNOT VERIFY ([TD-0001](TD-0001-browser-lane-unverified.md)).
- **The key is not one of `L-visible`'s doors.** Its three ways into `jest.config.mjs` are
  `testMatch`, `testPathIgnorePatterns` and `modulePathIgnorePatterns`
  (`tools/gates/lights/visible.mjs`). `moduleNameMapper` hides nothing: every file stays visible to
  `tsc`, to `oxlint` and to the runner. It is the same shape as the `transformIgnorePatterns`
  exception of [TD-0016](TD-0016-inject-needs-a-transform-exception-or-a-newer-node.md) — one
  declared entry that makes something loadable — and it is owed the same thing: a probe that fails
  when the entry is absent, so the measurement above stops depending on anyone's memory.
- **`tsc` does not read the stub.** It types the import from `vite/client`'s `CSSModuleClasses`,
  which is `{ readonly [key: string]: string }`, so with `noUncheckedIndexedAccess` on, every read
  of a class is already `string | undefined` in the source. That is why
  `apps/web/src/components/class-names.ts` exists, and why an absent class renders no attribute
  instead of the word `undefined`.

## 2. CHQ-003 S3 establishes its Given with a wait that is vacuously true

S3 is "Given `GET /tasks` resolves with `[]`, when the list renders, then the empty state is
shown". `apps/web/test/CHQ-003/S3_shows-the-empty-state.test.tsx:19` establishes that Given with
`await waitForRows(0)` — and `waitForRows(0)` asserts that **zero** rows are present, which is
already true WHILE the request is in flight. Testing Library's `waitFor` resolves on its first
synchronous check when the condition already holds, so the case observes the tree one macrotask
after mount rather than after the response landed.

**MEASURED 2026-11-02.** With an ordinary React implementation the case sees the LOADING state: one
render, `status=loading`, probed with the promise chain at 1, 2, 3, 4, 5 and 6 microtask ticks —
the tick count makes no difference, because the limiting factor is not the chain. React schedules
an update from a promise callback on the default lane, and Testing Library's react `asyncWrapper`
sets the act environment to **false** while it waits, so the update is still unflushed when the
assertion runs.

What the test therefore asserts is not S3's sentence but "the empty state is in the DOM within one
macrotask of mount". `apps/web/src/hooks/use-tasks.ts` satisfies it with `flushSync`, which commits
the move out of the loading state in the task that learned the answer. **That call is there for
this reason and it is written down at the call site.** It has a defensible product reading — no
frame shows "Loading tasks…" after the data has arrived — but it is not a line anyone would have
written from the spec alone, and React's own documentation asks that `flushSync` stay uncommon.

The defect is in the test's wait, not in the code, and the test is read-only to the phase that
found it (`implement-to-green`, the one hard rule). It is recorded here instead of being resolved,
because the fix belongs to a `tests-from-spec` round: `waitForRows` is the wrong tool for an
assertion whose Given is "the response arrived", and the cure is a wait on the empty state itself
— `waitFor(() => { expect(screen.queryByText(/no tasks? yet/i)).not.toBeNull(); })` — which fails
until the state is real and therefore retries. When that lands, the `flushSync` can go, and
whether it should is then an ordinary product question rather than a constraint.

Related: [TD-0004](TD-0004-runner-does-not-typecheck.md) (the runner strips types, so a collection
failure and an assertion failure are told apart from two artifacts — finding 1 above is a
collection failure, which is why it reported `Tests: 0 total` and not a count of red cases),
[TD-0012](TD-0012-no-mutation-testing.md) (nothing measures whether a test would NOTICE a
behaviour change — a wait that is vacuously true is that defect in its smallest form).
