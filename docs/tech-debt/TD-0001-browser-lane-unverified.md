# TD-0001: The browser lane is CANNOT VERIFY — the pinned browser build is not installed and there is no `e2e/`

**Status:** Open · no `kind: e2e` test is written or proven red; `L-browser` is soft and reads CANNOT VERIFY
**Area:** `playwright.config.ts` · `tools/gates/run.mjs e2e` · `tools/gates/lights/browser.mjs` · `.ci/probe.json`
**Raised:** 2026-11-01

## What is unproven

Whether a Playwright run can produce a verdict on this machine at all. Two things are missing, and the
second is the interesting one.

`playwright.config.ts:10` points `testDir` at `./e2e`, and that directory **does not exist** (observed
2026-11-01, `ls -d e2e` → `No such file or directory`). So no e2e artifact has ever been written and no
`kind: e2e` assertion has ever been falsified.

And the browser build this Playwright version pins is absent — but a naive check would say the
opposite. Observed 2026-11-01:

```
$ pnpm exec playwright install --dry-run
Chrome for Testing 156.0.8078.4 (playwright chromium v1248)
  Install location:  ~/Library/Caches/ms-playwright/chromium-1248
$ ls ~/Library/Caches/ms-playwright
chromium-1015  chromium-1169  chromium-1228  chromium_headless_shell-1169
chromium_headless_shell-1228  ffmpeg-1007  ffmpeg-1011  firefox-1335
webkit-1683  webkit_mac11_special-1816
```

The cache is far from empty — it holds three other projects' chromium builds — and `chromium-1248`,
the one this version requires, is not among them. **A light that tests "does the Playwright cache
exist and is it non-empty" would report the lane installed.** The honest question is whether the build
this installed version pins is present, which is what `playwright install --dry-run` answers.

## Why it is safe right now

- `verify: playwright-chromium` names the RUNNER only and never the state of this machine
  (ADR-0002 item 1), so a committed spec does not go stale when a browser is installed or removed.
- `tools/gates/run.mjs e2e` refuses to run while `.ci/probe.json` does not carry
  `browser_probe: "pass"`, and prints CANNOT VERIFY with exit 2, never 0 — the config's own header
  states this contract (`playwright.config.ts:3-5`).
- `L-browser` is **soft** and reads the probe, so the absence of a browser never blocks a commit; and a
  soft light that says CANNOT VERIFY is still printed as a row, not omitted.
- `retries: 0` and `forbidOnly: true` (`playwright.config.ts:11-12`) mean that when the lane does run,
  a trimmed or flaky-retried run cannot look successful.
- No assertion anywhere depends on it: `tests-from-spec` writes no `kind: e2e` test while
  `browser_probe` is not `pass`, and `spec-gate` prints one WARNING line naming `browser_probe` for a
  spec that carries an e2e assertion.

## What closing it involves

1. `npx playwright install chromium` — which downloads `chromium-1248` and
   `chromium_headless_shell-1248` into the shared cache above. This is a network download the owner
   runs; no gate installs anything.
2. `node tools/gates/gate-probes.mjs --real`: a planted FAILING e2e spec must be observed failing with
   a `<failure>` in `e2e.junit.xml`, and a planted passing one observed passing. Both halves, or the
   probe has shown only that the runner starts. On success it writes `browser_probe: "pass"` into
   `.ci/probe.json` and this entry closes.
3. The probe must check the pinned build, not the cache directory — the measurement above is the
   reason. `status.mjs` prints the expected build and whether it is present.
4. If the download is unavailable or the run cannot pass, the entry **stays open with a different
   reason**: `kind: e2e` is then a kind no runner can falsify on this machine, and an e2e sentence in a
   spec belongs in `## Syrup` or as a question, not as an assertion.
