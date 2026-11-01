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
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.tsx?$': '$1' },
  clearMocks: true,
  restoreMocks: true,
};

export default {
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
  collectCoverageFrom: [
    'packages/core/src/**/*.ts',
    'apps/api/src/**/*.ts',
    '!**/*.d.ts',
  ],
  coverageThreshold: { global: { statements: 80, branches: 80, functions: 80, lines: 80 } },
};
