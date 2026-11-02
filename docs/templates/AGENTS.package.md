# Package <@cheq/name>

<!-- One copy of this file sits at the root of each workspace package, next to its package.json, filled
with the REAL dependencies read from that package.json — never a wish list. A new package gets one in
the same commit as its package.json (AGENTS.md → "How to add a package"). A comment in this package's
code may state only an invariant listed under "What this package enforces" below (rule 10).
The lights and the `tools/gates/project.mjs` inspector named below exist and are committed (verified
2026-11-02), so fill each field below from their real output rather than from this template's
wording. -->

**Name:** `@cheq/<name>` · **Path:** `<packages|apps>/<dir>/` · **Jest project(s):** `<core | core-dom | api | web | none>` (the name `--selectProjects` takes) · **Spec `kind`:** `<core|api|web|e2e|none>`

**Purpose:** (two sentences — what lives here, and what deliberately does not)

**Depends on** (its `dependencies` + `devDependencies`, verbatim from `<dir>/package.json`, with the
versions the lock resolved): `@cheq/core workspace:*` · … — for `@cheq/core` this list is exactly `{}`,
and that emptiness IS the boundary (`packages/core/package.json:7`): with `node-linker=isolated`
(`.npmrc:4`) the package has no `node_modules` of its own, so an undeclared import does not resolve.
`@cheq/core` is the one package with TWO Jest projects — `core` (node) and `core-dom` (jsdom), the same
files in both environments, `jest.config.mjs:87` and `jest.config.mjs:94`.

**Must not depend on, and the light that refuses it:** (e.g. "any app, any `node:*`, any DOM —
`L-core-purity` and `L-graph`"; "`@cheq/web`: nothing but `@cheq/core`, `react` and `react-dom` —
`L-graph`"; "a runtime dependency with no `docs/vendor/<pkg>.md` — `L-deps`")

**Effective compiler settings** (from `node tools/gates/project.mjs config <pkg>`, never quoted from the
`tsconfig.json` text — `extends` hides the effective value, rule 4): `lib: […]` · `types: […]` ·
`noEmit: true` · (what this package's tsconfig adds on top of `tsconfig.base.json`)

**What this package enforces** (the ONLY invariants a comment in it may state):
- (e.g. "every exported function is a pure function of its arguments: time, randomness and I/O enter as
  parameters")
- (e.g. "an HTTP handler maps a request to exactly one core call and holds no rule of its own")

**Cross-package promises it depends on** (enforced elsewhere, or written down as a tech-debt entry —
never as prose in code): (e.g. "`@cheq/web` turns every input event into exactly one core intent —
`@cheq/web`, S<n> of CHQ-<nnn>")

**Tests that cover it:** `<dir>/test/CHQ-<nnn>/S<n>_<slug>.test.ts(x)` under Jest project `<name>` ·
spec-less skeleton fixtures: `<dir>/test/skeleton/*.test.ts` (guarded, never red-checked, never a spec's
`check:`)

**Runner of record for its kind** (the verdict, read from the artifact and never from an exit code):
`core` ⇒ `tsc-noemit + jest-core` · `api` ⇒ `tsc-noemit + jest-api` · `web` ⇒ `tsc-noemit +
jest-web` · `e2e` ⇒ `playwright-chromium`, CANNOT VERIFY until `.ci/probe.json` reports
`browser_probe: "pass"`. Both halves run every time, because the test runner strips types instead of
checking them ([TD-0004](../tech-debt/TD-0004-runner-does-not-typecheck.md)); the JUnit artifact is
steered by `JEST_JUNIT_OUTPUT_FILE` in the environment, never by a flag
([testing.md](../knowledge/testing.md))

**Known debts:** TD-XXXX (<one clause>) | none

**Not mine:** (what looks like it belongs here and belongs to a neighbour, with the neighbour named)
