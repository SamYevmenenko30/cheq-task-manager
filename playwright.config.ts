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
  // No outputFile here, on purpose. A fixed path like `.ci/runs/latest-e2e/` is
  // ONE directory every run of the lane overwrites, so the artifacts in it belong
  // to no run and carry no run.json — which is exactly what L-artifacts refuses,
  // and it refused this file (tools/gates/lights/artifacts.mjs). The per-run
  // directory comes from makeRunDir() and reaches Playwright through the two
  // environment variables the wrapper sets (tools/gates/run.mjs), so the path is
  // named by the run that will be judged, not by this config.
  // junit only. The wrapper redirects exactly one reporter per run
  // (PLAYWRIGHT_JUNIT_OUTPUT_NAME, tools/gates/run.mjs), so a `json` entry here
  // would promise a second channel nobody routes into the run directory — and
  // the jest lanes' cross-check between two channels has no counterpart here.
  // That asymmetry is a limit of the browser lane, not something to paper over
  // with a reporter writing to a path no gate reads.
  reporter: [['junit']],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
