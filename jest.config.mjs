// The test runner of record. The assignment names Jest and an 80% backend
// coverage floor, so Jest is what produces every test verdict here.
//
// MEASURED, and each line below exists because of one of these:
//
// 1. `ts-jest` is NOT used. Its peer range is `typescript: ">=4.3 <7"`, so it
//    excludes the TypeScript this repository runs — the same conflict
//    typescript-eslint has (ADR-0004). `@swc/jest` strips types in Rust and
//    declares no dependency on the `typescript` package at all, so the
//    repository keeps exactly ONE type engine: tsc 7 checks, swc only strips.
//    L-type-engines is what keeps that true.
// 2. The sources import with an explicit `.ts`/`.tsx` extension, because every
//    project is `noEmit` and `allowImportingTsExtensions` is on
//    (tsconfig.base.json). Jest resolves modules itself, so `moduleNameMapper`
//    strips the extension back off.
// 3. ESM needs `NODE_OPTIONS=--experimental-vm-modules` in the child's
//    environment. tools/gates/run.mjs sets it; a hand-run without it fails with
//    "Cannot use import statement outside a module", which looks like a source
//    error and is not one.
// 4. The jest-junit templates are NOT cosmetic. Jest's default `classname` is
//    the describe block; Vitest's is the FILE PATH, and every artefact reader in
//    tools/gates/lib plus the eighteen probes that cover them are written against
//    the file-path shape — including how a COLLECTION failure is recognised.
//    `classNameTemplate: '{filepath}'` + `titleTemplate: '{classname} > {title}'`
//    reproduces that shape exactly: measured, and the existing reader parsed a
//    jest-junit file with no change.
// 5. `core` and `core-dom` run the SAME files in different environments. That is
//    the parity lane L-env-parity diffs case by case; it is not a double
//    collection, and L-orphans knows the pair.
// 6. `transformIgnorePatterns` is widened by exactly ONE package, and the one is
//    forced. `app.inject()` — the whole verdict mechanism of `kind: api`
//    (ADR-0002, docs/vendor/fastify.md) — loads light-my-request@6.8.0, which is
//    CommonJS and does `require('cookie')` at module scope
//    (light-my-request/lib/cookies.js:3 <- lib/request.js:10 <- index.js:5),
//    while cookie@2.0.1 is ESM-only: `"type": "module"`,
//    `"exports": "./dist/index.js"` and no CJS build in the package at all.
//    Node 22 would do that require natively; Jest's own CJS loader intercepts it
//    and refuses, and the three cures it names are a transform, this key, or
//    Node v24.9+ (jest-runtime 30.5.2 build/index.js:452). MEASURED 2026-11-02
//    on CHQ-002: with the default `['/node_modules/']`, every inject-based
//    assertion dies with ERR_REQUIRE_ESM before reaching an expectation — 25 of
//    29 api cases, a failure about the loader and not about the product — and
//    with the pattern below, 29 of 29 pass. The exception names one package, in
//    BOTH spellings a pnpm store path has (`node_modules/.pnpm/cookie@x/` and
//    the `node_modules/cookie/` inside it, because `node-linker=isolated` —
//    .npmrc:4 — produces both), so nothing else in node_modules starts being
//    transformed by accident. The key is NOT one of L-visible's three doors into
//    this file (testMatch, testPathIgnorePatterns, modulePathIgnorePatterns —
//    tools/gates/lights/visible.mjs:212) and it hides nothing: it makes one
//    third-party module loadable. TD-0016 records the alternative — moving the
//    pinned Node to 24.9+ — and why that choice is not this ticket's to make.

const transform = {
  '^.+\\.(t|j)sx?$': [
    '@swc/jest',
    {
      jsc: {
        parser: { syntax: 'typescript', tsx: true },
        target: 'es2022',
        // MEASURED: the transform must agree with tsconfig's `jsx` setting, and
        // the disagreement surfaces ONLY at runtime. tsconfig.base.json sets
        // `"jsx": "react-jsx"` (the automatic runtime — which is also why
        // `react/react-in-jsx-scope` is off in .oxlintrc.jsonc), while swc's
        // default is the CLASSIC runtime: it emitted `React.createElement` and
        // both web tests died with `ReferenceError: React is not defined`,
        // reading like a broken component rather than a mis-configured transform.
        transform: { react: { runtime: 'automatic' } },
      },
    },
  ],
};

const shared = {
  transform,
  // Header fact 6: the default is `['/node_modules/']`, and cookie@2.0.1 is the
  // one package lifted out of it. TD-0016.
  transformIgnorePatterns: ['/node_modules/(?!(\\.pnpm/)?cookie[@/])'],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.tsx?$': '$1' },
  clearMocks: true,
  restoreMocks: true,
};

export default {
  // The JUnit reporter is declared HERE and its output path is NOT. jest-junit
  // takes the path from JEST_JUNIT_OUTPUT_FILE, which is how every caller steers
  // one run's artefact into that run's own directory (tools/gates/run.mjs and
  // tools/gates/lights/env-parity.mjs both set it). A path written here would be
  // one file every run overwrites — the defect L-artifacts refuses.
  //
  // The templates are load-bearing, not cosmetic: see header fact 4. Without
  // them Jest's `classname` is the describe block, and every artefact reader in
  // tools/gates/lib — plus the probes over them, plus how a COLLECTION failure is
  // recognised — is written against the file-path shape.
  reporters: [
    'default',
    [
      'jest-junit',
      {
        classNameTemplate: '{filepath}',
        titleTemplate: '{classname} > {title}',
        ancestorSeparator: ' > ',
        suiteNameTemplate: '{filepath}',
        addFileAttribute: 'true',
      },
    ],
  ],

  projects: [
    {
      ...shared,
      displayName: 'core',
      testEnvironment: 'node',
      rootDir: './packages/core',
      testMatch: ['<rootDir>/test/**/*.test.ts'],
    },
    {
      ...shared,
      displayName: 'core-dom',
      testEnvironment: 'jsdom',
      rootDir: './packages/core',
      testMatch: ['<rootDir>/test/**/*.test.ts'],
    },
    {
      ...shared,
      displayName: 'api',
      testEnvironment: 'node',
      rootDir: './apps/api',
      testMatch: ['<rootDir>/test/**/*.test.ts'],
    },
    {
      ...shared,
      displayName: 'web',
      testEnvironment: 'jsdom',
      rootDir: './apps/web',
      testMatch: ['<rootDir>/test/**/*.test.{ts,tsx}'],
      setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
    },
  ],

  // The backend floor the assignment names. It is asserted on the `core` + `api`
  // projects only: the business logic lives in packages/core (engine-free, I/O
  // injected) and apps/api is its HTTP adapter, so "the backend" is both.
  // Frontend coverage is explicitly not required.
  //
  // DECLARED HERE AND READ BY NOTHING — TD-0013. No lane in tools/gates/run.mjs
  // passes `--coverage`, no npm script mentions it and no light reads a coverage
  // artifact (measured 2026-11-02), so this threshold bites only a human who asks
  // for coverage by hand. Measured when asked: statements 94.44%, lines 95.53%,
  // functions 100%, branches 72.54% — the floor FAILS on branches, and the only
  // substantial code under these globs is packages/core/src/testing/, which is
  // pipeline support rather than the product the floor is about. The number stays
  // as written because it is the right number; the lane that asserts it lands with
  // the first product endpoint, and the TD says what that takes.
  collectCoverageFrom: [
    'packages/core/src/**/*.ts',
    'apps/api/src/**/*.ts',
    '!**/*.d.ts',
  ],
  coverageThreshold: { global: { statements: 80, branches: 80, functions: 80, lines: 80 } },
};
