import { defineConfig } from 'vitest/config';

// Two measured facts are encoded here by ABSENCE:
//
// 1. `outputFile` inside a `projects` entry is IGNORED by Vitest — the reports still land in
//    Vitest's own `.vitest/`. A per-kind artifact must therefore be asked for on the command
//    line, which is what tools/gates/run.mjs does. The gate names the artifact it will read.
//
// 2. `passWithNoTests` is never set here. Its absence is part of the verdict: the wrapper
//    passes `--passWithNoTests=false` explicitly, so a run that matched nothing fails loudly
//    instead of reporting success over an empty suite.
//
// A project's `name` is the spec `kind` — one chain from file path to kind to project to
// artifact, with no registry in the middle to drift.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          root: './packages/core',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        test: {
          // The same files as `core`, in the other environment @cheq/core actually reaches
          // (it ships to the browser through apps/web). This is the one honest parity lane
          // this repository has, and L-env-parity diffs the two artifacts case by case.
          name: 'core-dom',
          root: './packages/core',
          environment: 'jsdom',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'api',
          root: './apps/api',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'web',
          root: './apps/web',
          environment: 'jsdom',
          setupFiles: ['./test/setup.ts'],
          include: ['test/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
