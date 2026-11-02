#!/usr/bin/env node
/**
 * gate-probes.mjs — the gates, gated.
 *
 *   node tools/gates/gate-probes.mjs [--only <substring>] [--list]
 *   node tools/gates/gate-probes.mjs --real [--browser]
 *
 * Zero dependencies, Node 22 ESM. Two jobs, and they are not the same job:
 *
 *   WITHOUT `--real` it runs the probe GROUPS — fixtures built in a temporary
 *   git repository, the real readers against captured artifacts, each gate and
 *   each light asked to fail on a planted defect and to pass on a clean tree.
 *   Nothing outside `$TMPDIR` is touched.
 *
 *   WITH `--real` it plants deliberate defects in THIS repository, OBSERVES the
 *   toolchain failing on them, removes them, and only then writes
 *   `.ci/probe.json` — the record every lane reads through
 *   `tools/gates/lib/probe.mjs` before it claims to mean anything. It writes
 *   nothing when any required observation is missing, and it refuses to leave
 *   the tree dirty.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A JEST TEST
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Deliberately outside the test glob. A `*.test.ts` here would fall under
 * red-check's jurisdiction, and red-check cannot honestly prove a brand-new
 * suite red on the base — the suite does not exist there. It would also be a
 * test run by the runner it is meant to judge, and the first thing these probes
 * check is that the runner's own report cannot be trusted blindly
 * (`tests="0"` and exit 0 on a run that matched nothing — measured).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * A GROUP NOBODY WROTE IS NOT A GROUP THAT PASSED
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * The four groups are declared below. A group whose module is missing prints one
 * row — `not run (module missing: …)` — and the OTHER groups still report: a run
 * that collapses on the first absent file tells you about one group and hides
 * the rest. It still makes the run non-zero, because fail-closed is the rule
 * everywhere else in this repository and a probe suite with holes in it is
 * exactly the state that lets a gate quietly stop checking. The same goes for a
 * SKIPPED probe: the summary prints the count with the words "a skipped probe is
 * not a pass", and the exit code agrees with the words.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT `--real` OBSERVES, AND WHY EACH ONE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * | class       | planted                                  | observed in                                   |
 * |-------------|------------------------------------------|-----------------------------------------------|
 * | `type`      | `const n: number = 'not a number'` in core | tsc exit ≠ 0 AND `error TS2322` in the log    |
 * | `test`      | a failing `expect` in a core test        | a `<failure>` whose body opens `Error: expect(received).toBe(expected)` in the XML AND `numFailedTests > 0` in the JSON |
 * | `lint`      | a floating promise in core               | oxlint exit 1 AND `typescript(no-floating-promises)` naming the file |
 * | `lint-flag` | the SAME floating promise                | oxlint WITHOUT `--type-aware` exits 0 and reports nothing |
 * | `boundary`  | `import 'react-dom/client'` in core      | tsc TS2307, which `classifyTs2307` calls `not-installed` for `react-dom` |
 * | `browser`   | TWO e2e specs that drive a page, one failing and one passing (only with `--browser`) | UNVERIFIED on this machine — see below |
 *
 * `lint-flag` is not a formality. Without `--type-aware` the type-aware rules do
 * not run and NOTHING says so: the output looks like a clean lint (measured —
 * `number_of_rules` quietly drops from 243 to 211). A probe that only watched
 * the flagged run pass could not tell a working lane from a lane whose flag was
 * dropped, so the pair is the evidence: red with the flag, green without it.
 *
 * `boundary` is observed through the COMPILER, not the linter, and that is a
 * deviation from the plan with a measured reason: `.oxlintrc.jsonc` configures
 * no `no-restricted-imports` (oxlint has no `no-restricted-syntax` at all, and
 * the blanket `no-restricted-globals` was removed because it refused
 * `x instanceof Date` and `Math.floor` — delta Д11). The boundary is enforced by
 * the dependency graph and therefore by `tsc`: `packages/core` declares no
 * dependencies, so a package import there is unresolvable. That is stronger than
 * a lint rule, because it is not a rule that a comment can switch off.
 *
 * `browser` is NOT installed here and nothing in this file installs it: a gate
 * never downloads anything (TD-0001). With `--browser` it first asks
 * `playwright install --dry-run` whether the pinned build is present and refuses
 * by name when it is not. The plant-and-run half has NEVER been executed in this
 * repository — it is written, it is unverified, and the record it would write is
 * the only thing that lifts the e2e lane out of CANNOT VERIFY.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * NO SECONDS, AND NOTHING LEFT BEHIND
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * The record carries `observed: true | false` and nothing about duration: a
 * probe says whether a failure was seen, never how long the tool took, because a
 * figure in a record becomes a promise the next reader keeps (ADR-0003, TD-0002).
 * Every plant is removed in a `finally`, and after the observations this file
 * asks git whether the tracked tree is clean. A dirty tree is a refusal to write
 * the record: a record produced by a run that changed the repository describes a
 * tree nobody has.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { PROBE_PATH, lockKey } from './lib/probe.mjs';
import { readJUnit, fileVerdict } from './lib/junit-xml.mjs';
import { readJestJson } from './lib/jest-json.mjs';
import { classifyTs2307, readTsc } from './lib/tsc-log.mjs';
import { readOxlint } from './lib/oxlint-json.mjs';
import { repoRoot, statusPorcelain } from './lib/git.mjs';
import { liveWatchers, typesArgv, jestArgv, jestEnv, lintArgv } from './run.mjs';
import { byCodepoint, readPackages, readPremises } from './lights/_shared.mjs';
import {
  MARKS,
  REPO_ROOT,
  SKIPPED_NOTE,
  cleanupScratch,
  probeArtifactDir,
  runBin,
  runGroup,
} from './probes/_harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------- the groups

/**
 * The declared groups, in the order they print. `harness` is the one built-in:
 * if the fixtures, the read ledger or the scratch repo are broken, every other
 * group reports about nothing, so it goes first.
 */
export const GROUPS = Object.freeze([
  { name: 'harness', module: 'probes/_harness.mjs', exported: 'selfProbes' },
  { name: 'readers', module: 'probes/readers.mjs', exported: 'probes' },
  { name: 'gates', module: 'probes/gates.mjs', exported: 'probes' },
  { name: 'lights', module: 'probes/lights.mjs', exported: 'probes' },
]);

export const GROUP_NAMES = GROUPS.map((g) => g.name);

// ---------------------------------------------------------------- the real run

/** The classes a complete record must carry. `ready` passes this to `readProbe`. */
export const REQUIRED_CLASSES = Object.freeze(['type', 'test', 'lint', 'lint-flag', 'boundary']);

/** The optional one: it is absent here and absence is a state, not a failure. */
export const OPTIONAL_CLASSES = Object.freeze(['browser']);

/**
 * Every plant `--real` makes, by the name of its observation. The paths are
 * UNTRACKED additions under a `__probe_` prefix, so a plant can never collide
 * with a real file and `git status` names it instantly if one survives.
 */
export const PLANTS = Object.freeze({
  type: {
    rel: 'packages/core/src/__probe_type.ts',
    text: '// planted by tools/gates/gate-probes.mjs --real; removed in a finally\nexport const planted: number = \'not a number\';\n',
  },
  boundary: {
    rel: 'packages/core/src/__probe_boundary.ts',
    text: "// planted by tools/gates/gate-probes.mjs --real; removed in a finally\nimport { createRoot } from 'react-dom/client';\n\nexport const planted = createRoot;\n",
  },
  lint: {
    rel: 'packages/core/src/__probe_lint.ts',
    text: [
      '// planted by tools/gates/gate-probes.mjs --real; removed in a finally',
      'async function later(): Promise<number> {',
      '  return 1;',
      '}',
      '',
      'export function planted(): void {',
      '  later();',
      '}',
      '',
    ].join('\n'),
  },
  test: {
    rel: 'packages/core/test/__probe/planted.test.ts',
    text: [
      "// planted by tools/gates/gate-probes.mjs --real; removed in a finally",
      "import { describe, expect, it } from '@jest/globals';",
      '',
      "describe('a planted failure', () => {",
      "  it('fails on purpose so the lane is known to be able to fail', () => {",
      '    expect(1).toBe(2);',
      '  });',
      '});',
      '',
    ].join('\n'),
  },
  // BOTH halves, and both DRIVE A PAGE. A spec that only asserts `1 === 2`
  // fails without ever launching a browser — measured: it produced a perfectly
  // shaped `<failure type="expect.toBe">` on a machine where the pinned build is
  // absent, and an earlier version of this file recorded that as a browser
  // observation. The lane TD-0001 is about is the BROWSER, so the plant goes
  // through `page`. `setContent` needs no web server.
  browser_red: {
    rel: 'e2e/__probe/planted-red.spec.ts',
    text: [
      '// planted by tools/gates/gate-probes.mjs --real --browser; removed in a finally',
      "import { expect, test } from '@playwright/test';",
      '',
      "test('a planted failure that needs a page', async ({ page }) => {",
      "  await page.setContent('<h1>hello</h1>');",
      "  await expect(page.locator('h1')).toHaveText('goodbye');",
      '});',
      '',
    ].join('\n'),
  },
  browser_green: {
    rel: 'e2e/__probe/planted-green.spec.ts',
    text: [
      '// planted by tools/gates/gate-probes.mjs --real --browser; removed in a finally',
      "import { expect, test } from '@playwright/test';",
      '',
      "test('a planted pass that needs a page', async ({ page }) => {",
      "  await page.setContent('<h1>hello</h1>');",
      "  await expect(page.locator('h1')).toHaveText('hello');",
      '});',
      '',
    ].join('\n'),
  },
});

function plant(root, which) {
  const p = PLANTS[which];
  const abs = join(root, p.rel);
  if (existsSync(abs)) throw new Error(`${p.rel} already exists — gate-probes will not overwrite a file it did not plant`);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, p.text);
  return { rel: p.rel, abs };
}

function unplant(root, which) {
  const p = PLANTS[which];
  const abs = join(root, p.rel);
  rmSync(abs, { force: true });
  // The directories too, when the plant made them and nothing else lives there.
  // `e2e/` is the case that matters: it does not exist in this repository, and a
  // leftover empty one would turn every light that reports "e2e does not exist"
  // into one that reports an empty lane.
  const dir = dirname(abs);
  if (dir.endsWith('__probe')) rmSync(dir, { recursive: true, force: true });
  const parent = dirname(dir);
  if (existsSync(parent) && readdirSync(parent).length === 0) rmSync(parent, { recursive: true, force: true });
  return existsSync(abs) ? { removed: false, rel: p.rel } : { removed: true, rel: p.rel };
}

const observed = (detail) => ({ observed: true, detail });
const notObserved = (detail) => ({ observed: false, detail });

/**
 * The type lane: a planted TS2322 must make tsc exit non-zero AND say so in the
 * log. The exit code alone would not do — a tsc that cannot find its project
 * exits non-zero too (measured: TS18003, exit 2, zero inputs).
 */
function observeType(root, dir) {
  plant(root, 'type');
  try {
    const log = join(dir, 'tsc.core.log');
    const res = runBin('tsc', typesArgv('core'), { cwd: root });
    writeFileSync(log, res.combined);
    const read = readTsc(log);
    const ts2322 = read.diagnostics.filter((d) => d.code === 'TS2322');
    if (res.status === 0) return notObserved(`tsc exited 0 with ${PLANTS.type.rel} planted — the type lane did not notice an unassignable string. Log: ${log}`);
    if (!/error TS2322/.test(res.combined)) return notObserved(`tsc exited ${String(res.status)} but printed no "error TS2322": ${res.combined.split('\n').slice(0, 3).join(' | ')}`);
    if (read.verdict !== 'red') return notObserved(`the log has a TS2322 but readTsc read ${read.verdict} (${read.reason}) — the reader and the tool disagree`);
    if (!ts2322.some((d) => d.path.endsWith('__probe_type.ts')))
      return notObserved(`a TS2322 was reported, but not in the planted file: ${JSON.stringify(read.diagnostics.map((d) => `${d.path}:${String(d.line)} ${d.code}`))}`);
    const first = ts2322[0];
    return observed(
      `tsc exited ${String(res.status)}; ${first.path}(${String(first.line)},${String(first.col)}): ${first.code}; readTsc read ${read.verdict} over ${String(read.filesChecked)} input(s)`,
    );
  } finally {
    unplant(root, 'type');
  }
}

/**
 * The boundary: a package import inside `packages/core` is unresolvable because
 * that package declares no dependencies. Observed through the compiler — see the
 * header for why the linter cannot answer this today.
 */
function observeBoundary(root, dir) {
  plant(root, 'boundary');
  try {
    const log = join(dir, 'tsc.core.boundary.log');
    const res = runBin('tsc', typesArgv('core'), { cwd: root });
    writeFileSync(log, res.combined);
    const read = readTsc(log);
    const pkgs = readPackages(root);
    const names = (pkgs.packages ?? []).map((p) => p.name).filter(Boolean);
    const hits = read.diagnostics
      .filter((d) => d.path.endsWith('__probe_boundary.ts'))
      .map((d) => ({ d, c: classifyTs2307(d, { workspacePackages: names }) }));
    if (res.status === 0) return notObserved(`tsc exited 0 with ${PLANTS.boundary.rel} planted — packages/core reached react-dom and nothing objected. Log: ${log}`);
    if (!hits.length)
      return notObserved(`tsc exited ${String(res.status)} but reported nothing in the planted file: ${JSON.stringify(read.diagnostics.map((d) => `${d.path} ${d.code}`))}`);
    const ts2307 = hits.filter((h) => h.d.code === 'TS2307');
    if (!ts2307.length) return notObserved(`the planted import failed with ${JSON.stringify(hits.map((h) => h.d.code))} rather than TS2307 — the signature this lane reads is not the one it got`);
    const c = ts2307[0].c;
    if (c.bare !== 'react-dom')
      return notObserved(`TS2307 named ${JSON.stringify(c.specifier)} (bare ${JSON.stringify(c.bare)}), not react-dom — the message is not about the planted import`);
    return observed(
      `tsc exited ${String(res.status)}; ${ts2307[0].d.path}(${String(ts2307[0].d.line)}): TS2307 on ${JSON.stringify(c.specifier)}; classifyTs2307 reads it as ${c.reason} against the ${names.length} workspace package name(s) — nothing inside the repository can make that import resolve`,
    );
  } finally {
    unplant(root, 'boundary');
  }
}

/**
 * The test lane, and both channels of it: the XML must carry the measured
 * assertion signature and the JSON must count the failure. One channel is not
 * a cross-check of itself.
 *
 * WHERE THE SIGNATURE LIVES, measured 2026-11-02 on jest-junit 17.0.0 and the
 * reason this is not `type="AssertionError"` any more: jest-junit writes
 * `<failure>` with NO `message` and NO `type` ATTRIBUTE and puts
 * `<Type>: <message>` on the FIRST LINE of the element body — for a failed
 * `expect` that line is `Error: expect(received).toBe(expected)`. So the body
 * is what carries the evidence, and `fixtures/jest/all-failed.junit.xml` is the
 * committed artefact of the same shape.
 *
 * The trailing positional is Jest's own `testPathPatterns`; it keeps the
 * observation to the planted file instead of running the whole core project,
 * whose other files are not what is being observed.
 */
function observeTest(root, dir) {
  plant(root, 'test');
  try {
    const junit = join(dir, 'core.junit.xml');
    const json = join(dir, 'core.json');
    const args = [...jestArgv('core', { json, filter: null }), 'test/__probe/planted'];
    const res = runBin('jest', args, { cwd: root, env: jestEnv({ junit }) });
    const xml = readJUnit(junit);
    const js = readJestJson(json);
    if (res.status === 0) return notObserved(`jest exited 0 with a failing expect planted — the test lane cannot fail. Output: ${res.combined.split('\n').slice(0, 4).join(' | ')}`);
    if (!xml.ok) return notObserved(`the JUnit artefact is unusable: ${String(xml.reason)} (${junit})`);
    const ASSERTION_BODY = /Error: expect\(received\)\./;
    const signature = xml.cases.filter((c) => ASSERTION_BODY.test(String(c.failure?.body ?? '')) || c.failure?.type === 'AssertionError');
    if (!signature.length)
      return notObserved(
        `no failed case in ${junit} carries the measured assertion signature (type="AssertionError", or a <failure> body opening "Error: expect(received)."): ` +
          JSON.stringify(xml.cases.map((c) => `${c.name}: type=${JSON.stringify(c.failure?.type)} body=${JSON.stringify(String(c.failure?.body ?? '').split('\n')[0])}`)),
      );
    if (!js.ok) return notObserved(`the JSON channel is unusable: ${String(js.reason)} (${json})`);
    if (!(js.counts.failed > 0)) return notObserved(`the JSON channel counted numFailedTests=${String(js.counts.failed)} for a run that failed`);
    const v = fileVerdict(xml, { file: 'packages/core/test/__probe/planted.test.ts' });
    if (v.verdict !== 'red') return notObserved(`fileVerdict read ${v.verdict} for the planted file: ${v.why}`);
    return observed(
      `jest exited ${String(res.status)}; XML tests=${String(xml.totals.tests)} failures=${String(xml.totals.failures)}, the failure body opening ${JSON.stringify(String(signature[0].failure?.body ?? '').split('\n')[0])}; ` +
        `JSON numFailedTests=${String(js.counts.failed)}; fileVerdict read red`,
    );
  } finally {
    unplant(root, 'test');
  }
}

/**
 * The lint lane AND the flag that gives it meaning, as one plant and two runs.
 * → { lint, flag } — two records, because the pair is the evidence and either
 * half alone proves the wrong thing.
 */
function observeLint(root, dir) {
  const RULE = 'typescript(no-floating-promises)';
  plant(root, 'lint');
  try {
    const withFlag = join(dir, 'oxlint.type-aware.json');
    const withoutFlag = join(dir, 'oxlint.no-flag.json');
    const a = runBin('oxlint', [...lintArgv(), 'packages/core'], { cwd: root });
    writeFileSync(withFlag, a.stdout);
    const b = runBin('oxlint', ['--format=json', 'packages/core'], { cwd: root });
    writeFileSync(withoutFlag, b.stdout);

    const ra = readOxlint(withFlag);
    const rb = readOxlint(withoutFlag);
    const hits = (ra.diagnostics ?? []).filter((d) => d.code === RULE && d.filename.endsWith('__probe_lint.ts'));

    const lint =
      a.status === 0
        ? notObserved(`oxlint --type-aware exited 0 with a floating promise planted in ${PLANTS.lint.rel}: ${withFlag}`)
        : !hits.length
          ? notObserved(`oxlint --type-aware exited ${String(a.status)} but no ${RULE} in the planted file: ${JSON.stringify((ra.diagnostics ?? []).map((d) => `${d.filename} ${d.code}`))}`)
          : ra.verdict !== 'red'
            ? notObserved(`the artefact carries ${RULE} but readOxlint read ${ra.verdict} (${ra.reason})`)
            : observed(
                `oxlint --type-aware exited ${String(a.status)}; ${RULE} at ${hits[0].filename}:${String(hits[0].line)}:${String(hits[0].column)}; readOxlint read red over ${String(ra.filesLinted)} file(s) with ${String(ra.rulesConfigured)} rule(s) configured`,
              );

    const flag =
      !lint.observed
        ? notObserved('the flagged run did not catch the plant, so the pair proves nothing about the flag')
        : b.status !== 0
          ? notObserved(`oxlint WITHOUT --type-aware exited ${String(b.status)} — if the type-aware rules fire anyway, the flag is not what makes this lane work: ${withoutFlag}`)
          : (rb.diagnostics ?? []).some((d) => d.code === RULE)
            ? notObserved(`${RULE} was reported WITHOUT --type-aware, so the flag carries no meaning: ${withoutFlag}`)
            : observed(
                `the SAME plant: with --type-aware oxlint exited ${String(a.status)} and reported ${RULE}; without the flag it exited ${String(b.status)} and reported ${String((rb.diagnostics ?? []).length)} diagnostic(s) over ${String(rb.filesLinted)} file(s) — and ${String(ra.rulesConfigured)} rules ran with the flag against ${String(rb.rulesConfigured)} without it. A lane run without the flag is silently narrower, and nothing in its output says so.`,
              );

    return { lint, flag };
  } finally {
    unplant(root, 'lint');
  }
}

/**
 * The pinned chromium build, from playwright's own mouth.
 *
 * MEASURED, and the reason this is not `existsSync` on the cache directory:
 * `playwright install --dry-run` exits 0 and prints an `Install location:` for
 * every browser WHETHER OR NOT it is there. On this machine it names
 * `chromium-1248` while the cache holds 1015, 1169 and 1228 — three older
 * builds, none of them the pinned one. So the answer is: ask the dry-run which
 * path is pinned, then ask the filesystem whether THAT path exists. A check on
 * the cache directory alone would report the lane installed (TD-0001 says so in
 * prose; this is the same statement as code).
 *
 * → { ok, reason, location }
 */
export function pinnedChromium({ root = REPO_ROOT } = {}) {
  const dry = runBin('playwright', ['install', '--dry-run'], { cwd: root });
  if (dry.status === null) return { ok: false, reason: `playwright could not be started (${String(dry.spawnError)}) — the lane has no runner here`, location: null };
  if (dry.status !== 0) return { ok: false, reason: `playwright install --dry-run exited ${String(dry.status)}: ${dry.combined.split('\n').slice(0, 3).join(' | ')}`, location: null };
  const blocks = dry.stdout.split(/\n\s*\n/);
  const chromium = blocks.find((b) => /\(playwright chromium v\d+\)/.test(b));
  if (chromium === undefined)
    return { ok: false, reason: `playwright install --dry-run named no chromium build: ${dry.stdout.split('\n').slice(0, 4).join(' | ')}`, location: null };
  const m = chromium.match(/Install location:\s*(\S.*?)\s*$/m);
  if (m === null) return { ok: false, reason: `the chromium block carries no "Install location:": ${chromium.replace(/\s+/g, ' ').slice(0, 160)}`, location: null };
  const location = m[1];
  if (!existsSync(location))
    return {
      ok: false,
      reason: `the PINNED build is not installed: ${location} does not exist — npx playwright install chromium (TD-0001). An older build in the same cache is not this one.`,
      location,
    };
  return { ok: true, reason: `the pinned build is present: ${location}`, location };
}

/** The measured signature of a playwright run with no browser downloaded.
 * The same regex lives at tools/gates/run.mjs:163, which does not export it. */
const BROWSER_ABSENT_RE = /Executable doesn't exist at|Please run the following command to download new browsers/;

/**
 * The browser lane. UNVERIFIED: the plant-and-run half has never completed in
 * this repository, because the pinned build is not installed and nothing here
 * installs it (TD-0001). Both halves are required — a planted FAILING spec
 * observed failing AND a planted PASSING spec observed passing — because a
 * failure on its own can be the environment rather than the assertion.
 */
function observeBrowser(root, dir) {
  const pinned = pinnedChromium({ root });
  if (!pinned.ok) return notObserved(pinned.reason);
  plant(root, 'browser_red');
  plant(root, 'browser_green');
  try {
    const junit = join(dir, 'e2e.junit.xml');
    const res = runBin('playwright', ['test', '--reporter=junit', 'e2e/__probe'], {
      cwd: root,
      env: { PLAYWRIGHT_JUNIT_OUTPUT_NAME: junit },
    });
    if (BROWSER_ABSENT_RE.test(res.combined))
      return notObserved(`playwright reports the browser missing, which is an environment that was never built, not a test that failed: ${res.combined.split('\n').slice(0, 3).join(' | ')}`);
    const xml = readJUnit(junit);
    if (!xml.ok) return notObserved(`the e2e JUnit artefact is unusable: ${String(xml.reason)} (${junit})`);
    const red = xml.cases.filter((c) => c.status === 'failed' || c.status === 'errored');
    const green = xml.cases.filter((c) => c.status === 'passed');
    if (!red.length || !green.length)
      return notObserved(
        `both halves are required and this run has ${red.length} failing and ${green.length} passing case(s): ${JSON.stringify(xml.cases.map((c) => `${c.name}:${c.status}`))}`,
      );
    if (red.some((c) => BROWSER_ABSENT_RE.test(`${c.failure?.message ?? ''} ${c.failure?.body ?? ''}`)))
      return notObserved(`the failing case failed because the browser is absent, not because the assertion is: ${String(red[0].failure?.message)}`);
    return observed(
      `playwright exited ${String(res.status)} against ${pinned.location}; ${junit} carries ${String(red.length)} failing and ${String(green.length)} passing case(s), both driving a page; the failing one is ${JSON.stringify(red[0].failure?.type)}: ${JSON.stringify(red[0].failure?.message)}`,
    );
  } finally {
    unplant(root, 'browser_red');
    unplant(root, 'browser_green');
    // Playwright's own output directory, created by the run and gitignored.
    rmSync(join(root, 'test-results'), { recursive: true, force: true });
  }
}

/**
 * Run every real observation. → { records, problems }
 * `records` maps a probe NAME to `{ observed, class, detail }`; the name is what
 * `premise(probe, name)` looks up, so it is stable vocabulary.
 */
export function observeAll({ root = REPO_ROOT, browser = false } = {}) {
  const dir = probeArtifactDir('real');
  const records = {};
  const problems = [];

  const put = (name, cls, r) => {
    records[name] = { observed: r.observed === true, class: cls, detail: r.detail };
    if (r.observed !== true) problems.push(`${name} (${cls}): ${r.detail}`);
  };

  put('type_probe', 'type', observeType(root, dir));
  put('boundary_probe', 'boundary', observeBoundary(root, dir));
  put('test_probe', 'test', observeTest(root, dir));
  const lint = observeLint(root, dir);
  put('lint_probe', 'lint', lint.lint);
  put('lint_type_aware_probe', 'lint-flag', lint.flag);
  if (browser) put('browser_probe', 'browser', observeBrowser(root, dir));

  return { records, problems, artifacts: dir };
}

/**
 * Write the record — and only when every required class was observed. The file
 * carries no duration: `observed: true | false` is the whole vocabulary.
 */
export function writeProbeRecord({ root = REPO_ROOT, records }) {
  const classes = new Set(
    Object.values(records)
      .filter((r) => r.observed === true)
      .map((r) => r.class),
  );
  const missing = REQUIRED_CLASSES.filter((c) => !classes.has(c));
  if (missing.length) return { written: false, reason: `${missing.length} required class(es) were not observed: ${missing.join(', ')}`, missing, path: null };

  const lock = lockKey({ root });
  if (!lock.ok) return { written: false, reason: `the record must be pinned to the COMMITTED lockfile and it could not be read: ${lock.reason}`, missing: [], path: null };

  const path = resolve(root, PROBE_PATH);
  mkdirSync(dirname(path), { recursive: true });
  const record = {
    _note:
      'Written ONLY by node tools/gates/gate-probes.mjs --real, read ONLY through tools/gates/lib/probe.mjs. A record of deliberate failures that were OBSERVED — not a cache, not a budget, and it carries no duration (ADR-0003, TD-0002).',
    observedAt: new Date().toISOString(),
    lockSha256: lock.sha256,
    probes: records,
  };
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return { written: true, reason: null, missing: [], path };
}

/** Tracked modifications plus any plant that survived. A dirty tree refuses the record. */
export function treeState({ root = REPO_ROOT } = {}) {
  const s = statusPorcelain(['packages', 'apps', 'e2e', 'tools', 'docs'], { cwd: root });
  const survivors = Object.values(PLANTS)
    .map((p) => p.rel)
    .filter((rel) => existsSync(join(root, rel)));
  return { ok: s.ok, entries: s.ok ? s.entries : null, reason: s.reason ?? null, survivors };
}

// ------------------------------------------------------------------------- argv

export function parseArgs(argv) {
  const out = { only: '', real: false, browser: false, list: false, help: false, errors: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--real') out.real = true;
    else if (a === '--browser') out.browser = true;
    else if (a === '--list') out.list = true;
    else if (a === '--only') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--') || v === '') out.errors.push('--only needs a substring: --only L-tsc');
      else {
        out.only = v;
        i += 1;
      }
    } else if (a.startsWith('--only=')) out.only = a.slice('--only='.length);
    else out.errors.push(`unknown argument ${JSON.stringify(a)} — try --help`);
  }
  if (out.browser && !out.real) out.errors.push('--browser only means anything with --real: it plants a spec and runs a browser');
  return out;
}

export const USAGE = [
  'node tools/gates/gate-probes.mjs [--only <substring>] [--list]',
  'node tools/gates/gate-probes.mjs --real [--browser]',
  '',
  `  groups: ${GROUP_NAMES.join(', ')} (each is tools/gates/probes/<name>.mjs; harness is built in)`,
  '  --only <s>   run only the probes whose group or name contains <s>',
  '  --list       print every probe name and run nothing',
  '  --real       plant deliberate defects in THIS repository, observe the failures,',
  `               remove them, then write ${PROBE_PATH} — never written when an observation is missing`,
  '  --browser    with --real: also probe the Playwright lane, which has NEVER run here (TD-0001)',
  '',
  '  CHEQ_KEEP_SCRATCH=1 keeps the fixture directories for inspection.',
  '  Exit 0 only when every probe passed, every group ran and nothing was skipped.',
].join('\n');

// ------------------------------------------------------------------------- main

async function loadGroup(g) {
  const abs = join(HERE, g.module);
  if (!existsSync(abs)) return { ...g, state: 'missing', reason: `module missing: tools/gates/${g.module} — the group that owns these probes is not written yet`, probes: [] };
  try {
    const mod = await import(pathToFileURL(abs).href);
    const list = mod[g.exported];
    if (!Array.isArray(list))
      return { ...g, state: 'broken', reason: `tools/gates/${g.module} exports no \`${g.exported}\` array — a group is an ARRAY of probe(name, fn) descriptors (see probes/_harness.mjs)`, probes: [] };
    const bad = list.filter((p) => typeof p?.name !== 'string' || typeof p?.fn !== 'function');
    if (bad.length) return { ...g, state: 'broken', reason: `${bad.length} entr(y/ies) in \`${g.exported}\` are not probe(name, fn) descriptors`, probes: [] };
    return { ...g, state: 'ready', reason: null, title: typeof mod.title === 'string' ? mod.title : null, probes: list };
  } catch (e) {
    return { ...g, state: 'broken', reason: `import threw: ${String(e?.message ?? e).split('\n')[0]}`, probes: [] };
  }
}

export async function main(argvIn = process.argv.slice(2)) {
  const args = parseArgs(argvIn);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.errors.length) {
    console.error(`[gate-probes] REFUSED:\n  ${args.errors.join('\n  ')}\n\n${USAGE}`);
    return 2;
  }

  const rr = repoRoot();
  if (!rr.ok) {
    console.error(`[gate-probes] REFUSED: not a git work tree (${rr.reason}) — every fixture is a git repository and the real run reads this one.`);
    return 2;
  }
  const root = rr.root;

  if (args.real) return realRun(root, args);

  const premises = readPremises(root);
  // Loading is order-independent and happens in ONE batch (the same shape
  // lights/run.mjs uses). RUNNING is the opposite — strictly sequential, which
  // is why it goes through the harness's async generator below: the read ledger
  // belongs to one probe at a time.
  const loaded = await Promise.all(GROUPS.map(loadGroup));

  const counts = { pass: 0, fail: 0, skipped: 0 };
  const notRun = [];
  const failures = [];

  if (args.list) {
    for (const g of loaded) {
      if (g.state !== 'ready') {
        console.log(`[${g.name}] not run (${g.reason})`);
        continue;
      }
      console.log(`[${g.name}] ${g.probes.length} probe(s)${g.title ? ` — ${g.title}` : ''}`);
      for (const p of g.probes) console.log(`  ${p.name}`);
    }
    return 0;
  }

  /**
   * One group after another, recursively. The sequencing is `runGroup`'s job
   * inside a group; across groups it is this function's, and it is recursion
   * for the same measured reason (`eslint(no-await-in-loop)`, which oxlint
   * applies to `for await` as well — see `probes/_harness.mjs`).
   */
  const runRest = async (queue) => {
    const [g, ...rest] = queue;
    if (g === undefined) return;
    if (g.state === 'ready') {
      const selected = g.probes.filter((p) => args.only === '' || g.name.includes(args.only) || p.name.includes(args.only));
      console.log(`[${g.name}] ${selected.length}/${g.probes.length} probe(s)${g.title ? ` — ${g.title}` : ''}`);
      await runGroup(selected, { premises, real: false, only: args.only }, (r) => {
        counts[r.state] += 1;
        if (r.state === 'pass') console.log(`  ${MARKS.pass} ${r.name}`);
        else if (r.state === 'skipped') console.log(`  ${MARKS.skipped} SKIPPED ${r.name}\n      ${r.message}`);
        else {
          console.log(`  ${MARKS.fail} ${r.name}${r.kind === 'threw' ? '  (the probe itself threw)' : ''}`);
          for (const line of String(r.message).split('\n')) console.log(`      ${line}`);
          failures.push({ group: g.name, name: r.name, kind: r.kind });
        }
      });
    } else {
      notRun.push(g);
      console.log(`[${g.name}] not run (${g.reason})`);
    }
    await runRest(rest);
  };

  try {
    await runRest(loaded);
  } finally {
    const c = cleanupScratch();
    if (c.kept.length) console.log(`[gate-probes] CHEQ_KEEP_SCRATCH=1: ${c.kept.length} fixture(s) left behind:\n  ${c.kept.join('\n  ')}`);
  }

  const total = counts.pass + counts.fail + counts.skipped;
  // A filter that matched nothing is not a clean run — the same rule the readers
  // group asserts about `tests="0"`, applied to this gate's own argv. Without
  // this, `--only <typo>` prints "0 passed, 0 failed" and exits 0.
  if (total === 0 && args.only !== '') {
    console.error(
      `[gate-probes] REFUSED: --only ${JSON.stringify(args.only)} matched no group and no probe name, so nothing ran — and a run that matched nothing is not a pass. ` +
        `Groups: ${loaded.map((g) => `${g.name}${g.state === 'ready' ? '' : ' (not run)'}`).join(', ')}. Use --list to see every name.`,
    );
    return 2;
  }
  console.log(
    `[gate-probes] ${String(counts.pass)} passed, ${String(counts.fail)} failed, ${String(counts.skipped)} skipped of ${String(total)} probe(s)` +
      `${counts.skipped > 0 ? ` — ${SKIPPED_NOTE}` : ''}${args.only === '' ? '' : ` (--only ${args.only})`}`,
  );
  if (failures.length) {
    const threw = failures.filter((f) => f.kind === 'threw');
    console.error(
      `[gate-probes] FAIL: ${String(failures.length)} probe(s) did not hold: ${failures.map((f) => `${f.group}/${f.name}`).join(', ')}` +
        (threw.length > 0 ? ` — ${String(threw.length)} of them THREW, which says the probe is broken, not the thing it judges` : ''),
    );
  }
  if (notRun.length)
    console.error(
      `[gate-probes] INCOMPLETE: ${String(notRun.length)} group(s) did not run (${notRun.map((g) => g.name).join(', ')}) — a group nobody wrote has not verified anything, so this run is not a pass.`,
    );
  if (counts.skipped > 0 && !failures.length && !notRun.length)
    console.error(`[gate-probes] INCOMPLETE: ${String(counts.skipped)} probe(s) were skipped — ${SKIPPED_NOTE}; each one names the premise that would lift it.`);

  if (failures.length || notRun.length || counts.skipped > 0) return 1;
  console.log('[gate-probes] every probe held ✓');
  return 0;
}

/** `--real`: observe, clean up, and only then write the record. */
function realRun(root, args) {
  const watchers = liveWatchers();
  if (!watchers.ok) {
    console.error(`[gate-probes] REFUSED: cannot tell whether a watcher is running (${watchers.reason}) — a watcher would recompile the plants under the observation.`);
    return 2;
  }
  if (watchers.found.length) {
    console.error(
      `[gate-probes] REFUSED: ${String(watchers.found.length)} watcher(s) are live and would react to a planted defect:\n  ${watchers.found.map((p) => `${String(p.pid)} ${p.cmd}`).join('\n  ')}`,
    );
    return 2;
  }

  const before = treeState({ root });
  if (!before.ok) {
    console.error(`[gate-probes] REFUSED: git status failed (${String(before.reason)}) — a real run must know the tree it changes.`);
    return 2;
  }
  if (before.survivors.length) {
    console.error(`[gate-probes] REFUSED: a plant from an earlier run is still on disk: ${before.survivors.join(', ')} — remove it, then run again.`);
    return 2;
  }

  console.log(`[gate-probes] --real: planting, observing and removing. Nothing is installed and nothing is downloaded (TD-0001).`);
  let out;
  try {
    out = observeAll({ root, browser: args.browser });
  } finally {
    for (const which of Object.keys(PLANTS)) unplant(root, which);
  }

  for (const [name, r] of Object.entries(out.records)) {
    console.log(`  ${r.observed ? MARKS.pass : MARKS.fail} ${name} [${r.class}] ${r.detail}`);
  }
  console.log(`[gate-probes] artefacts of the real run: ${out.artifacts}`);

  const after = treeState({ root });
  // `statusPorcelain` already passes `--untracked-files=no`, so every entry it
  // returns IS a tracked modification. An untracked file another agent left in
  // the tree is not this run's dirt and must not refuse the record.
  const dirty = after.entries ?? [];
  if (after.survivors.length) {
    console.error(`[gate-probes] REFUSED to write ${PROBE_PATH}: a plant survived the run: ${after.survivors.join(', ')}`);
    return 2;
  }
  if (!after.ok) {
    console.error(`[gate-probes] REFUSED to write ${PROBE_PATH}: git status failed after the run (${String(after.reason)})`);
    return 2;
  }
  if (dirty.length) {
    console.error(
      `[gate-probes] REFUSED to write ${PROBE_PATH}: ${String(dirty.length)} tracked path(s) are modified after the run — a record made by a run that changed the repository describes a tree nobody has:\n  ${dirty
        .map((e) => `${e.xy} ${e.path}`)
        .join('\n  ')}`,
    );
    return 2;
  }

  const w = writeProbeRecord({ root, records: out.records });
  if (!w.written) {
    console.error(`[gate-probes] ${PROBE_PATH} NOT written: ${w.reason}`);
    console.error(`  Every lane whose premise is missing reads CANNOT VERIFY, which is the correct state until the observation is made.`);
    return 1;
  }
  console.log(`[gate-probes] wrote ${w.path} — ${String(Object.values(out.records).filter((r) => r.observed).length)} observation(s), class(es) ${[...new Set(Object.values(out.records).filter((r) => r.observed).map((r) => r.class))].toSorted(byCodepoint).join(', ')}`);
  if (out.problems.length) {
    console.log('[gate-probes] not observed (each one keeps its lane at CANNOT VERIFY):');
    for (const p of out.problems) console.log(`  - ${p}`);
    console.log(
      `[gate-probes] the record WAS written — every required class (${REQUIRED_CLASSES.join(', ')}) was observed — and this run still exits non-zero, because ${String(out.problems.length)} observation(s) asked for were not made.`,
    );
  }
  if (!args.browser) console.log(`[gate-probes] the browser lane was not probed: pass --browser once the pinned build is installed (TD-0001).`);
  return out.problems.length ? 1 : 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`[gate-probes] CRASHED: ${String(e?.stack ?? e)}`);
      process.exit(2);
    },
  );
}
