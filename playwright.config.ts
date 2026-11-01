import { defineConfig, devices } from '@playwright/test';

// The config is committed; the BROWSERS are not installed. tools/gates/run.mjs e2e refuses to
// run while .ci/probe.json does not carry browser_probe: "pass", and prints
// CANNOT VERIFY (playwright browsers not installed — TD-0001) with exit 2, never 0.
//
// forbidOnly and retries: 0 exist so that a trimmed or flaky-retried run cannot look
// successful. A green e2e lane has to be earned once, by a probe, before it may be cited.
export default defineConfig({
  testDir: './e2e',
  retries: 0,
  forbidOnly: true,
  reporter: [
    ['junit', { outputFile: '.ci/runs/latest-e2e/e2e.junit.xml' }],
    ['json', { outputFile: '.ci/runs/latest-e2e/e2e.json' }],
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
