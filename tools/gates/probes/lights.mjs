/**
 * probes/lights.mjs — the sixteen standing lights, each planted against and
 * each planted FOR. A light is probed AS A MODULE (`light.run({ root, mb,
 * premises })`, the way `lights/run.mjs` calls it), inside a throwaway git
 * repository that carries this repository's own tracked skeleton.
 *
 * Zero dependencies, Node 22 ESM. Everything here goes through
 * `./_harness.mjs`: `scratchRepo`/`writeWorkspace`/`copyGates` build the
 * fixture, `runLight` calls the light and normalises its row with the SAME
 * `normalizeResult` the aggregator judges it with, and `assertLight` asserts
 * the `status` AND a regexp over `detail`.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY EVERY PROBE ASSERTS THE DETAIL AND NOT ONLY THE STATUS
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * A hard light is red when ANYTHING it looks at is wrong, and a fixture is a
 * whole repository: a probe that planted a `Date.now()` and read `status ===
 * 'fail'` would pass just as happily on a fixture that failed because a
 * tsconfig did not parse, a manifest was missing or a premise was absent. Every
 * assertion below therefore names the measured SENTENCE the light prints for
 * the defect that was planted — and `_harness.mjs` enforces it mechanically:
 * reading `status` without reading `detail` fails the probe.
 *
 * The REVERSE probes are the other half and the more valuable one. A light that
 * is stricter than the agreement blocks work that is correct, and nobody
 * notices, because a red row always looks like diligence. So: `new Date(0)`,
 * `x instanceof Date`, `Math.floor`, the string `'node:fs'` in a literal and a
 * comment mentioning `Date.now(` must all PASS; a line-scoped
 * `oxlint-disable-next-line` must pass (it suppresses nothing — measured) while
 * the file-level form must fail; a GATE's `run.json` with no `steps` must PASS
 * while a LANE's must not. That last pair is not hypothetical: L-artifacts was
 * stricter than `RUN_JSON_REQUIRED` and turned a compliant gate record into
 * CANNOT VERIFY, which blocked the whole pack.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE FIXTURE, AND THE THREE THINGS IT COSTS TO MAKE ONE HONEST (ALL MEASURED)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. THE ROOT MUST BE A REALPATH. `mkdtemp(tmpdir())` hands back
 *    `/var/folders/…`, and on this platform `/var` is a symlink to
 *    `/private/var`; `tsc --listFiles` prints REALPATHS. `resolveClosure`
 *    partitions its listing with `abs.startsWith(resolve(root) + '/')`, so a
 *    fixture addressed by the `/var` spelling has EVERY one of its own files
 *    read as `foreign` — measured: L-core-purity reported five "input from
 *    outside the repository" problems on an untouched copy of this tree, and
 *    L-graph seven. The repository itself never shows it (`git rev-parse
 *    --show-toplevel`, which `lights/run.mjs` uses, already answers a
 *    realpath), so this is a property of fixtures only. `realpathSync` once,
 *    here, and every light sees the tree it is standing in.
 *
 * 2. THE PER-PACKAGE `node_modules` MUST BE COPIED for any light that asks the
 *    compiler or the runner about `apps/`. `linkNodeModules` reaches the ROOT
 *    install only, and pnpm's per-package symlink farm is gitignored and
 *    therefore not in `writeWorkspace`'s copy — so `apps/web` cannot resolve
 *    `vite/client` and comes back `error TS2688`, which makes L-tsc red and
 *    L-lint red (`typescript(tsconfig-error) Invalid tsconfig`) on a fixture
 *    nobody touched. `cpSync` copies those directories as the SYMLINKS they
 *    are, and because each link is relative (`../../../node_modules/.pnpm/…`)
 *    it resolves inside the fixture, through its own root link, into this
 *    repository's store. `@cheq/core` then points at the FIXTURE's
 *    `packages/core`, which is what a probe about a workspace edge needs.
 *    It is opt-in (`resolve: true`) because it is the expensive half.
 *
 * 3. `docs/` IS PART OF THE WORLD A LIGHT JUDGES, so it is always copied:
 *    L-tsc tolerates `skipLibCheck: true` only while
 *    `docs/tech-debt/TD-0004-*.md` still names the setting, and L-deps reads
 *    `docs/vendor/<pkg>.md` and `docs/tech-debt/TD-*.md` at HEAD. Only TRACKED
 *    files are copied (`git ls-files`), so a digest a sibling session has
 *    written and not yet committed is absent from the fixture — which is why
 *    `vendorDigests: true` PLANTS one per runtime dependency, with the
 *    `**Version:**` line taken out of the fixture's own lockfile rather than
 *    from memory.
 *
 * Every probe builds its own fixture and removes it: two probes sharing one
 * would judge each other's leftovers. `CHEQ_KEEP_SCRATCH=1` keeps them all.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE LIGHT UNDER TEST IS THE WORKING TREE'S, NOT THE FIXTURE'S COPY
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `copyGates` puts the COMMITTED gates in the fixture (a gate run as a process
 * needs the modules it imports), but every `runLight` below passes
 * `lightsFrom: REPO_ROOT`, so the module being probed is the one on disk right
 * now. A probe that judged the committed copy would go green on the version
 * before the edit it is supposed to be checking.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT IS NOT CLAIMED HERE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * - L-browser's `pass` path is reached with a PLANTED probe record, so it
 *   proves the glob claim and the premise plumbing, NOT that any browser works.
 *   No browser is installed on this machine (TD-0001) and no probe here can
 *   change that.
 * - L-lint's `number_of_files === 0` branch of `../lib/oxlint-json.mjs` is NOT
 *   what fires when the tree is hidden from the linter: measured on oxlint
 *   1.90.0, a config that ignores everything makes it print `No files found to
 *   lint.` as PLAIN TEXT under `--format=json`, so the reader's "not JSON"
 *   branch answers first (still cannot-verify, which is the verdict that
 *   matters). The numeric branch stays unprobed and is named in the report.
 * - The pending-implementation tolerance, the `--thin`/`--fast`/`--all` mode
 *   sets and the `dependsOn` ordering belong to `lights/run.mjs`, the
 *   aggregator, and are the `gates` group's subject, not this one's.
 */

import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { lsFiles } from '../lib/git.mjs';
import { lockKey } from '../lib/probe.mjs';
import { stampOf } from '../lib/run-dir.mjs';
import { SEVERITIES, STANDING_LIGHTS, STANDING_LIGHT_IDS, severityOf } from '../lib/spec-parse.mjs';
import { readPackages, readPremises } from '../lights/_shared.mjs';
import { bareVersion, digestRel, readLockImporters } from '../lights/deps.mjs';
import {
  REPO_ROOT,
  assert,
  assertLight,
  copyGates,
  havePremise,
  linkNodeModules,
  loadLight,
  probe,
  runLight,
  scratchRepo,
  skipped,
  writeWorkspace,
} from './_harness.mjs';

export const title = 'the sixteen standing lights: a planted defect and a reverse error for each';

// --------------------------------------------------------------------- fixture

/** The tracked trees a fixture always carries beside the workspace skeleton.
 * `docs/` is judged by L-tsc (the TD-0004 reference) and L-deps (the vendor
 * digests and the TD entries), so a fixture without it is a different world. */
const EXTRA_TREES = Object.freeze(['docs']);

/** A specifier that names a workspace package rather than a registry one — the
 * same test `../lights/deps.mjs` applies, kept here only to decide which
 * digests to plant. */
const LOCAL_SPEC_RE = /^(workspace|link|file|portal):/;

/** A deterministic run-directory stamp, so a fixture's `.ci/runs` name is not
 * machine state. `stampOf` is the function L-artifacts mirrors. */
const STAMP = stampOf(new Date(0));

/**
 * A throwaway repository holding this repository's skeleton, the gates and
 * `docs/`, committed. → { r, root, premises }
 *
 *   `r`         the `scratchRepo` handle (write / read / rm / git / commit).
 *   `root`      the REALPATH of it — see fact 1 in the header.
 *   `premises`  probed once at that root, as `lights/run.mjs` does.
 *
 * Options: `resolve: true` copies the per-package `node_modules` (fact 2),
 * `vendorDigests: true` plants a digest per runtime dependency (fact 3),
 * `commit` names the scaffold commit.
 */
function workspace(label, { resolve = false, vendorDigests = false, commit = 'chore: scaffold' } = {}) {
  const r = scratchRepo({ label });
  writeWorkspace(r, { lock: true, commit: false });
  copyGates(r);

  const listed = lsFiles([...EXTRA_TREES], { cwd: REPO_ROOT });
  assert(listed.ok, `workspace(${label}): git ls-files ${EXTRA_TREES.join(' ')} failed in ${REPO_ROOT}: ${listed.reason ?? 'no reason given'}`);
  for (const rel of listed.files) r.copyFrom(join(REPO_ROOT, rel), rel);

  if (resolve) {
    for (const pkg of readPackages(REPO_ROOT).packages) {
      const nm = join(REPO_ROOT, pkg.rel, 'node_modules');
      // Copied as symlinks (cpSync does not dereference), so the relative
      // targets resolve inside the fixture — fact 2.
      if (existsSync(nm)) r.copyFrom(nm, `${pkg.rel}/node_modules`);
    }
  }
  if (vendorDigests) plantVendorDigests(r);

  const linked = linkNodeModules(r);
  assert(
    linked.linked || !resolve,
    `workspace(${label}): the fixture must reach the toolchain without an install and could not: ${linked.reason}`,
  );

  r.commit(commit);
  const root = realpathSync(r.dir);
  return { r, root, premises: readPremises(root) };
}

/**
 * One `docs/vendor/<pkg>.md` per RUNTIME dependency of the fixture, with the
 * `**Version:**` line read out of the fixture's own `pnpm-lock.yaml`. The
 * version is never typed here: L-deps compares that line with the lock, so a
 * hand-written number would make the probe about a stale digest instead of
 * about the rule it is planting.
 */
function plantVendorDigests(r) {
  const lock = readLockImporters(r.read('pnpm-lock.yaml'));
  assert(lock.ok, `plantVendorDigests: the fixture's pnpm-lock.yaml could not be read: ${String(lock.reason)}`);
  const planted = [];
  for (const [dir, groups] of Object.entries(lock.importers)) {
    for (const [name, entry] of Object.entries(groups.dependencies ?? {})) {
      if (LOCAL_SPEC_RE.test(String(entry.specifier))) continue;
      r.write(
        digestRel(name),
        [`# ${name}`, '', `**Version:** ${bareVersion(entry.version)}`, '', `Planted by a probe fixture for importer "${dir}".`, ''].join('\n'),
      );
      planted.push(name);
    }
  }
  assert(planted.length > 0, 'plantVendorDigests: the lockfile declares no runtime dependency at all, so nothing was planted and a digest probe would prove nothing');
  return planted;
}

/** Call a light the way the registry does, against the WORKING TREE's module. */
const light = (fx, id, extra = {}) =>
  runLight(id, { root: fx.root, lightsFrom: REPO_ROOT, premises: fx.premises, rangeKind: 'previous-commit', ...extra });

/** `assertLight` plus any number of further regexps over the same detail. */
function alsoMatches(row, what, ...res) {
  for (const re of res) {
    assert(re.test(row.detail), `${what}: the detail does not also match ${String(re)}\n  detail: ${row.detail}`);
  }
}

/** A premise probe with one entry forced absent, for "the lane did not run". */
const without = (premises, name) => ({ ...premises, [name]: { ...premises[name], present: false } });

/** The two reasons a probe here cannot run, by the premise's own name. */
const needTsc = (ctx) => (havePremise(ctx, 'tsc') ? null : skipped(`premise "tsc" absent: ${ctx.premises.tsc.rel} does not exist — ${ctx.premises.tsc.cure}`));
const needOxlint = (ctx) => (havePremise(ctx, 'oxlint') ? null : skipped(`premise "oxlint" absent: ${ctx.premises.oxlint.rel} does not exist — ${ctx.premises.oxlint.cure}`));
const needVitest = (ctx) => (havePremise(ctx, 'vitest') ? null : skipped(`premise "vitest" absent: ${ctx.premises.vitest.rel} does not exist — ${ctx.premises.vitest.cure}`));

// ------------------------------------------------------------------ fragments

/** A spec test that satisfies every L-testshape claim. The `'as any'` inside a
 * string literal is deliberate: the scan runs over MASKED code, and a probe
 * that never carried the forbidden text in a legal position would not know. */
const SPEC_TEST_OK = [
  "import { describe, it, expect } from 'vitest';",
  '',
  "describe('CHQ-001 S1 the title rule', () => {",
  "  it('S1_keeps the literal title', () => {",
  "    expect('as any').toBe('as any');",
  '  });',
  '});',
  '',
].join('\n');

/** A stub screen that satisfies every L-stubkit claim. */
const STUB_SCREEN_OK = [
  "import { StubFrame } from '@cheq/stubkit';",
  '',
  'export function TaskListStub() {',
  '  return (',
  '    <section data-stub="task-list">',
  '      <StubFrame title="no tasks yet" />',
  '    </section>',
  '  );',
  '}',
  '',
].join('\n');

/** `@cheq/stubkit` as a workspace package: without it every file under the stub
 * root is a fail ("a stub that builds its primitives by hand"), so the reverse
 * probe could not exist. */
function plantStubkitPackage(r) {
  r.write(
    'packages/stubkit/package.json',
    `${JSON.stringify({ name: '@cheq/stubkit', version: '0.0.0', private: true, type: 'module', exports: { '.': './src/index.ts' }, dependencies: {} }, null, 2)}\n`,
  );
  r.write('packages/stubkit/src/index.ts', 'export const STUB_KIT = 1;\n');
}

/** A `packages/core/tsconfig.json` with `compilerOptions` patched. The file is
 * rewritten rather than edited so the result is exactly what the probe means. */
function writeCoreTsconfig(r, { options = {}, include = ['src/**/*.ts', 'test/**/*.ts'], files = null } = {}) {
  const cfg = {
    extends: '../../tsconfig.base.json',
    compilerOptions: { lib: ['ES2023'], types: [], noEmit: true, ...options },
    include,
    ...(files === null ? {} : { files }),
  };
  r.write('packages/core/tsconfig.json', `${JSON.stringify(cfg, null, 2)}\n`);
}

/** Add one entry to a dependency group of a manifest in the fixture. */
function addDependency(r, rel, group, name, spec) {
  const manifest = JSON.parse(r.read(rel));
  manifest[group] = { ...manifest[group], [name]: spec };
  r.write(rel, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Replace the `entries` of one of the four manifests, keeping its `_note`. */
function setManifestEntries(r, rel, entries) {
  const data = JSON.parse(r.read(rel));
  data.entries = entries;
  r.write(rel, `${JSON.stringify(data, null, 2)}\n`);
}

/** A `.ci/runs/<name>/run.json`, with the six required fields filled. */
function writeRunRecord(r, name, extra = {}) {
  const record = {
    head: '0'.repeat(40),
    treeClean: true,
    argv: ['test', '--kind', 'core'],
    exitCode: 0,
    startedAt: '1970-01-01T00:00:00.000Z',
    kind: 'core',
    ...extra,
  };
  r.write(`.ci/runs/${name}/run.json`, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** The argv of a vitest step that writes inside its own run directory. */
const vitestArgv = (dirName) => [
  'node_modules/.bin/vitest',
  'run',
  '--project',
  'core',
  '--reporter=junit',
  `--outputFile.junit=.ci/runs/${dirName}/core.junit.xml`,
  '--retry=0',
  '--no-file-parallelism',
  '--passWithNoTests=false',
];

/** A minimal, well-formed JUnit report with one passing case. */
const junitXml = (classname, name) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites name="vitest tests" tests="1" failures="0" errors="0" time="0.01">',
    `  <testsuite name="${classname}" timestamp="1970-01-01T00:00:00.000Z" hostname="probe" tests="1" failures="0" errors="0" skipped="0" time="0.01">`,
    `    <testcase classname="${classname}" name="${name}" time="0.01" />`,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');

/** A probe record in which `browser_probe` is observed, pinned to the fixture's
 * OWN committed lockfile — `readProbe` compares that sha and would otherwise
 * read the record as stale. */
function observeBrowserProbe(fx) {
  const key = lockKey({ root: fx.root });
  assert(key.ok, `observeBrowserProbe: the fixture's committed lockfile could not be hashed: ${String(key.reason)}`);
  fx.r.write(
    '.ci/probe.json',
    `${JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        lockSha256: key.sha256,
        probes: { browser_probe: { class: 'browser', observed: true, detail: 'planted by a probe fixture' } },
      },
      null,
      2,
    )}\n`,
  );
}

/** A spec file that names one module as its home. Written out in full because
 * `parseSpec` is the reader L-homes uses and a fragment would not parse. */
const specNamingHome = (home) =>
  [
    '---',
    'contracts: forbidden',
    '---',
    '',
    '# SPEC: CHQ-001 — a probe fixture',
    '',
    'Revision: 1',
    '',
    '## Vision (verbatim)',
    '',
    'Nothing here is a product sentence; this file exists so a probe can name a home.',
    '',
    '## Assertions',
    '',
    '- **S1** Given a shared file, when a spec names it as a home, then the edit is covered.',
    `  - kind: core · home: module: ${home} · verify: tsc-noemit + vitest-core · check: TODO`,
    '  - inputs: shared_file=differs',
    '',
  ].join('\n');

/** The file the L-homes probes declare shared in `homes.json` and then edit. A
 * real tracked file of the fixture, so the range really holds a change to it. */
const SHARED_FILE = 'packages/core/src/index.ts';

// ----------------------------------------- the L-generated fixture producer

/** What the planted producer renders, and what the committed projection holds
 * when the two agree. Written once so the probe cannot compare a projection
 * with a different expectation of itself. */
const PROJECTION_REL = 'docs/digests/probe-projection.md';
const PROJECTION_BODY = ['# GENERATED — do not edit', '', 'one line of projection', ''].join('\n');

/**
 * A producer of the shape L-generated requires: `--render <dir>` writes the
 * projection UNDER that directory and touches nothing else. The light never
 * lets a producer rewrite the work tree, so a producer without `--render`
 * cannot be judged at all — which is what makes this four-line script the right
 * fixture rather than the real `tools/gates/digest.mjs`: the probe is about the
 * LIGHT's three states, and borrowing another session's generator would make it
 * about that generator instead.
 */
const PRODUCER_SOURCE = [
  '#!/usr/bin/env node',
  "import { mkdirSync, writeFileSync } from 'node:fs';",
  "import { dirname, join } from 'node:path';",
  '',
  `const REL = '${PROJECTION_REL}';`,
  `const BODY = ${JSON.stringify(PROJECTION_BODY)};`,
  '',
  "const at = process.argv.indexOf('--render');",
  'if (at !== -1 && process.argv[at + 1] !== undefined) {',
  '  const out = join(process.argv[at + 1], REL);',
  '  mkdirSync(dirname(out), { recursive: true });',
  "  writeFileSync(out, BODY, 'utf8');",
  '}',
  '',
].join('\n');

/**
 * Declare ONE generated file in the fixture, with its producer and (unless
 * `body` is null) its committed bytes. `producer: false` leaves the script
 * unwritten, which is the cannot-verify state.
 */
function plantProjection(r, { body = PROJECTION_BODY, producer = true } = {}) {
  if (producer) r.write('tools/gates/probe-producer.mjs', PRODUCER_SOURCE);
  setManifestEntries(r, 'tools/gates/generated.json', [
    {
      path: PROJECTION_REL,
      producer: 'node tools/gates/probe-producer.mjs --fix',
      producerScript: 'tools/gates/probe-producer.mjs',
      check: 'node tools/gates/probe-producer.mjs --check',
      sourceRoots: ['packages/core/src'],
    },
  ]);
  if (body !== null) r.write(PROJECTION_REL, body);
}

// ---------------------------------------------------------------- the probes

export const probes = [
  // ------------------------------------------------- the severity table itself
  probe('the severity table: STANDING_LIGHTS declares one for every id, from the declared set', () => {
    const undeclared = STANDING_LIGHTS.filter((l) => l.severity === null).map((l) => l.id);
    assert(
      undeclared.length === 0,
      `tools/gates/lib/spec-parse.mjs STANDING_LIGHTS leaves ${undeclared.length} row(s) with severity: null — ${undeclared.join(', ')}. ` +
        'The pack then reads each of them as `hard` and prints a line naming them, so the row nobody classified is also the row nobody can read a verdict off. ' +
        "Fill it from the module's own `export const severity`.",
    );
    const wrong = STANDING_LIGHTS.filter((l) => !SEVERITIES.includes(l.severity)).map((l) => `${l.id}=${JSON.stringify(l.severity)}`);
    assert(wrong.length === 0, `STANDING_LIGHTS carries a severity outside ${SEVERITIES.join(' | ')}: ${wrong.join(', ')}`);
    assert(
      STANDING_LIGHT_IDS.length === 16,
      `STANDING_LIGHT_IDS holds ${STANDING_LIGHT_IDS.length} id(s) and the doctrine (AGENTS.md, the port plan §6.4) names SIXTEEN — ${STANDING_LIGHT_IDS.join(', ')}. ` +
        'Adding or removing a light is a declared change to that table, this probe and the docs in one gate: commit.',
    );
  }),

  probe("the severity table: every row agrees with its light module's own `export const severity`", async () => {
    const mods = await Promise.all(STANDING_LIGHT_IDS.map((id) => loadLight(id)));
    const problems = [];
    STANDING_LIGHT_IDS.forEach((id, i) => {
      const mod = mods[i];
      const table = severityOf(id);
      const rel = `tools/gates/lights/${id.replace(/^L-/, '')}.mjs`;
      if (!SEVERITIES.includes(mod.severity)) {
        problems.push(`${rel}: exports severity ${JSON.stringify(mod.severity ?? null)}, which is not one of ${SEVERITIES.join(' | ')}`);
        return;
      }
      if (mod.id !== id) problems.push(`${rel}: exports id ${JSON.stringify(mod.id)} while the filename says ${id} — run.mjs derives the id from the filename, so the row would describe another check`);
      if (!table.declared) problems.push(`${rel} declares ${mod.severity} and STANDING_LIGHTS declares nothing for ${id}`);
      else if (table.severity !== mod.severity)
        problems.push(`${rel} declares ${mod.severity} and STANDING_LIGHTS says ${table.severity} for ${id} — normalizeResult lets the TABLE win, so the module's own statement would be silently overruled`);
    });
    assert(
      problems.length === 0,
      `${problems.length} disagreement(s) between tools/gates/lib/spec-parse.mjs STANDING_LIGHTS and the light modules:\n  ${problems.join('\n  ')}\n` +
        'The two are the same fact written twice; this probe exists so the copy cannot drift again.',
    );
  }),

  // --------------------------------------------------------------------- L-tsc
  probe('L-tsc: a type error in packages/core/src ⇒ fail, naming the diagnostic and the log it was read from', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('tsc-type-error', { resolve: true });
    fx.r.write('packages/core/src/__probe.ts', 'export const wrong: number = "not a number";\n');
    const row = await light(fx, 'L-tsc');
    assertLight(row, 'fail', /TS2322/, 'L-tsc with a string assigned to a number in packages/core/src');
    alsoMatches(row, 'L-tsc with a planted type error', /\.ci\/lights\/tsc\.core\.log/, /packages\/core\/src\/__probe\.ts/, /core=red\(1\)/);
    fx.r.cleanup();
    return null;
  }),

  probe('L-tsc: `document.title` in packages/core ⇒ fail with TS2584 — the boundary bites at the compiler, not at a rule', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('tsc-dom', { resolve: true });
    fx.r.write('packages/core/src/__probe.ts', 'export const t = document.title;\n');
    const row = await light(fx, 'L-tsc');
    assertLight(row, 'fail', /TS2584/, 'L-tsc with document.title in a lib: ["ES2023"] / types: [] project');
    alsoMatches(row, 'L-tsc with document.title', /Cannot find name 'document'/);
    fx.r.cleanup();
    return null;
  }),

  probe("L-tsc: `import 'node:fs'` in packages/core ⇒ fail with TS2591 — no ambient types, so there is no type to disable a rule about", async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('tsc-node', { resolve: true });
    fx.r.write('packages/core/src/__probe.ts', "import { readFileSync } from 'node:fs';\nexport const f = readFileSync;\n");
    const row = await light(fx, 'L-tsc');
    assertLight(row, 'fail', /TS2591/, "L-tsc with import 'node:fs' in packages/core");
    alsoMatches(row, "L-tsc with import 'node:fs'", /Cannot find name 'node:fs'/);
    fx.r.cleanup();
    return null;
  }),

  probe('L-tsc: a tsconfig that reads NOTHING is never a pass — `filesChecked=0` is named (measured: the row is fail, not cannot-verify)', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('tsc-zero', { resolve: true });
    // MEASURED: an `include` that matches nothing is `error TS18003` (exit 2), a
    // GLOBAL diagnostic — so the "never ran" shape that reaches the
    // filesChecked===0 branch is `files: [] + include: []`, which exits 0 and
    // prints nothing at all.
    writeCoreTsconfig(fx.r, { include: [], files: [] });
    const row = await light(fx, 'L-tsc');
    assertLight(row, 'fail', /filesChecked=0/, 'L-tsc on a core project whose include and files are both empty');
    alsoMatches(
      row,
      'L-tsc on a project that read no input',
      /core=cannot-verify/,
      /never ran is not green/,
      // The other two kinds still have to be judged: a narrowed project is not
      // a licence to say nothing about the rest.
      /api=green/,
    );
    fx.r.cleanup();
    return null;
  }),

  probe('L-tsc: `rootDir` in a noEmit project ⇒ fail at the pin, with the measured TS6059 behind it', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('tsc-rootdir', { resolve: true });
    writeCoreTsconfig(fx.r, { options: { rootDir: 'src' } });
    const row = await light(fx, 'L-tsc');
    assertLight(row, 'fail', /"rootDir" is set to "\.\/src" and must be absent from a noEmit typecheck config/, 'L-tsc with rootDir set on packages/core');
    alsoMatches(row, 'L-tsc with rootDir set', /TS6059/, /packages\/core\/tsconfig\.json:\d+/);
    fx.r.cleanup();
    return null;
  }),

  probe('L-tsc: the untouched skeleton ⇒ pass, with every typed kind green and the skipLibCheck debt named', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('tsc-clean', { resolve: true });
    const row = await light(fx, 'L-tsc');
    assertLight(row, 'pass', /core=green\(\d+ input\(s\)\)/, 'L-tsc on an untouched copy of this repository');
    alsoMatches(row, 'L-tsc on a clean tree', /api=green/, /web=green/, /skipLibCheck: true at tsconfig\.base\.json:\d+ is the declared debt TD-0004/);
    fx.r.cleanup();
    return null;
  }),

  // ------------------------------------------------------------- L-core-purity
  probe('L-core-purity level 3: `Date.now()` in packages/core ⇒ fail, with the cure that time arrives as an argument', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('purity-clock');
    fx.r.write('packages/core/src/__probe.ts', 'export const now = () => Date.now();\n');
    const row = await light(fx, 'L-core-purity');
    assertLight(row, 'fail', /packages\/core\/src\/__probe\.ts:1 Date\.now\(/, 'L-core-purity with Date.now() in the pure package');
    alsoMatches(row, 'L-core-purity with a hidden clock', /time enters packages\/core through a parameter/);
    fx.r.cleanup();
    return null;
  }),

  probe('L-core-purity level 3: `new Date()` with an empty argument list ⇒ fail', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('purity-new-date');
    fx.r.write('packages/core/src/__probe.ts', 'export const now = () => new Date();\n');
    const row = await light(fx, 'L-core-purity');
    assertLight(row, 'fail', /new Date\(\) with an empty argument list/, 'L-core-purity with new Date() in the pure package');
    fx.r.cleanup();
    return null;
  }),

  probe('L-core-purity level 3 REVERSE: new Date(0), `instanceof Date`, Math.floor, a "node:fs" literal and a comment ⇒ pass', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('purity-legal');
    // Every line here is a form the blanket `no-restricted-globals` rule
    // refused and which this project allows on purpose (port-plan-delta Д11): a
    // type, a fixed value, arithmetic, and the forbidden text in positions the
    // mask removes. A light stricter than that agreement blocks correct work.
    fx.r.write(
      'packages/core/src/__legal.ts',
      [
        '// A comment that names Date.now( and node:fs on purpose: a comment is masked.',
        "export const SPEC = 'node:fs';",
        'export const EPOCH = new Date(0);',
        'export const isDate = (x: unknown): boolean => x instanceof Date;',
        'export const half = (n: number): number => Math.floor(n / 2);',
        'export const at = (d: Date): number => d.getTime();',
        '',
      ].join('\n'),
    );
    fx.r.git(['add', '-A']);
    const row = await light(fx, 'L-core-purity');
    assertLight(row, 'pass', /three levels pass/, 'L-core-purity on the five legal forms');
    alsoMatches(row, 'L-core-purity on the legal forms', /level 3 scanned 6\/6 source\(s\)/, /level 2 numeric: 6 input\(s\) == 6 tracked/);
    fx.r.cleanup();
    return null;
  }),

  probe('L-core-purity level 2: a relative path out of packages/core ⇒ fail — tsc exits 0 and says nothing about it', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('purity-escape');
    fx.r.write('packages/core/src/__esc.ts', "import { API_PACKAGE } from '../../../apps/api/src/index.ts';\nexport const leak = API_PACKAGE;\n");
    fx.r.git(['add', '-A']);
    const row = await light(fx, 'L-core-purity');
    assertLight(row, 'fail', /apps\/api\/src\/index\.ts is an IN-REPO input of packages\/core\/tsconfig\.json from outside packages\/core/, 'L-core-purity with a relative escape out of the pure package');
    alsoMatches(row, 'L-core-purity with a relative escape', /owned by @cheq\/api/, /1 in-repo elsewhere/);
    fx.r.cleanup();
    return null;
  }),

  probe('L-core-purity level 2: a NARROWED include ⇒ fail on the numeric comparison, not a quiet speed-up', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('purity-narrow');
    writeCoreTsconfig(fx.r, { include: ['src/index.ts'] });
    const row = await light(fx, 'L-core-purity');
    assertLight(row, 'fail', /tracked source\(s\) under packages\/core that the compiler NEVER READ/, 'L-core-purity with the core include narrowed to one file');
    alsoMatches(row, 'L-core-purity with a narrowed include', /packages\/core\/test\/skeleton\/marker\.test\.ts/, /closure: 1 inside/);
    fx.r.cleanup();
    return null;
  }),

  probe('L-core-purity level 1: a dependency in packages/core/package.json ⇒ fail (the empty object is the carrier of the rule)', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('purity-dep');
    addDependency(fx.r, 'packages/core/package.json', 'dependencies', '@cheq/api', 'workspace:*');
    const row = await light(fx, 'L-core-purity');
    assertLight(row, 'fail', /"dependencies" declares @cheq\/api — packages\/core depends on nothing \(rule 1\)/, 'L-core-purity with a dependency declared by the pure package');
    fx.r.cleanup();
    return null;
  }),

  probe('L-core-purity: a NESTED tsconfig under packages/core ⇒ REFUSED — level 1 would keep passing while reading the wrong file', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('purity-nested');
    fx.r.write('packages/core/src/tsconfig.json', '{ "compilerOptions": {} }\n');
    const row = await light(fx, 'L-core-purity');
    assertLight(row, 'fail', /REFUSED — a nested tsconfig\.json under packages\/core/, 'L-core-purity with a nested tsconfig under the pure package');
    fx.r.cleanup();
    return null;
  }),

  // ------------------------------------------------------------------- L-graph
  probe('L-graph: packages/core importing @cheq/api ⇒ fail — an edge nobody declared', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('graph-core-to-api', { resolve: true });
    fx.r.write('packages/core/src/__probe.ts', "import { API_PACKAGE } from '@cheq/api';\nexport const x = API_PACKAGE;\n");
    const row = await light(fx, 'L-graph');
    assertLight(row, 'fail', /packages\/core\/package\.json: the code imports @cheq\/api and the manifest declares no edge to it/, 'L-graph with core importing the api package');
    fx.r.cleanup();
    return null;
  }),

  probe('L-graph: a relative import through the package root ⇒ fail — the ONE witness is this scan plus tsc --listFiles', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('graph-escape', { resolve: true });
    fx.r.write('packages/core/src/__esc.ts', "import { API_PACKAGE } from '../../../apps/api/src/index.ts';\nexport const leak = API_PACKAGE;\n");
    const row = await light(fx, 'L-graph');
    assertLight(
      row,
      'fail',
      /the relative specifier "\.\.\/\.\.\/\.\.\/apps\/api\/src\/index\.ts" resolves to apps\/api\/src\/index\.ts, OUTSIDE packages\/core/,
      'L-graph with a relative escape out of packages/core',
    );
    alsoMatches(row, 'L-graph with a relative escape', /is an in-repo input of packages\/core\/tsconfig\.json owned by @cheq\/api/);
    fx.r.cleanup();
    return null;
  }),

  probe('L-graph: a cycle between two packages ⇒ fail, printing the cycle', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('graph-cycle', { resolve: true });
    addDependency(fx.r, 'apps/api/package.json', 'dependencies', '@cheq/web', 'workspace:*');
    addDependency(fx.r, 'apps/web/package.json', 'dependencies', '@cheq/api', 'workspace:*');
    const row = await light(fx, 'L-graph');
    assertLight(row, 'fail', /a dependency CYCLE among workspace packages: @cheq\/api → @cheq\/web → @cheq\/api/, 'L-graph with api and web declaring each other');
    alsoMatches(row, 'L-graph with a cycle', /is not an edge ADR-0001 names/);
    fx.r.cleanup();
    return null;
  }),

  probe('L-graph REVERSE: the declared edges (api→core, web→core) ⇒ pass, and an unused declaration is NAMED, not failed', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('graph-clean', { resolve: true });
    const row = await light(fx, 'L-graph');
    assertLight(row, 'pass', /2 allowed edge\(s\), no cycle, no escaping relative import, no alias/, 'L-graph on an untouched copy of this repository');
    alsoMatches(row, 'L-graph on a clean tree', /@cheq\/web declares @cheq\/core and no source imports it yet/, /alias scan: 0 tsconfig "paths" entr\(ies\)/);
    fx.r.cleanup();
    return null;
  }),

  // -------------------------------------------------------------------- L-lint
  probe('L-lint: a FILE-LEVEL `oxlint-disable` of a required rule ⇒ fail (measured: that form really does suppress a type-aware rule)', async (ctx) => {
    const skip = needOxlint(ctx);
    if (skip !== null) return skip;
    const fx = workspace('lint-disable', { resolve: true });
    fx.r.write('packages/core/src/__probe.ts', '// oxlint-disable typescript/no-floating-promises\nexport const x = 1;\n');
    const row = await light(fx, 'L-lint');
    assertLight(row, 'fail', /a file-level `oxlint-disable typescript\/no-floating-promises`/, 'L-lint with a file-level suppression of a boundary rule');
    alsoMatches(row, 'L-lint with a file-level suppression', /packages\/core\/src\/__probe\.ts:1/, /9\/9 required rule\(s\) configured as errors/);
    fx.r.cleanup();
    return null;
  }),

  probe('L-lint REVERSE: a LINE-SCOPED `oxlint-disable-next-line` ⇒ pass, and is NAMED as suppressing nothing', async (ctx) => {
    const skip = needOxlint(ctx);
    if (skip !== null) return skip;
    const fx = workspace('lint-nextline', { resolve: true });
    fx.r.write('packages/core/src/__probe.ts', '// oxlint-disable-next-line typescript/no-floating-promises\nexport const x = 1;\n');
    const row = await light(fx, 'L-lint');
    assertLight(row, 'pass', /the lint lane is green and the rule set is intact/, 'L-lint with a line-scoped directive that suppresses nothing');
    alsoMatches(row, 'L-lint with a line-scoped directive', /1 directive\(s\) that suppress nothing here/, /MEASURED not to suppress a type-aware rule/);
    fx.r.cleanup();
    return null;
  }),

  probe('L-lint: a required rule id missing from .oxlintrc.jsonc ⇒ fail, and the COUNT is asserted', async (ctx) => {
    const skip = needOxlint(ctx);
    if (skip !== null) return skip;
    const fx = workspace('lint-rule-gone', { resolve: true });
    const before = fx.r.read('.oxlintrc.jsonc');
    const after = before.replace('    "typescript/no-explicit-any": "error",\n', '');
    assert(after !== before, '.oxlintrc.jsonc no longer carries the line this probe removes — the any-leak family is in NO default category, so the probe must plant its absence through the "rules" object');
    fx.r.write('.oxlintrc.jsonc', after);
    const row = await light(fx, 'L-lint');
    assertLight(row, 'fail', /the required rule "typescript\/no-explicit-any" is not named under "rules"/, 'L-lint with a required rule taken out of the config');
    alsoMatches(row, 'L-lint with a shortened rule list', /8 of 9 required rule\(s\) are configured as errors/, /in no default category/);
    fx.r.cleanup();
    return null;
  }),

  probe('L-lint: a config that hides the whole tree ⇒ cannot-verify, never pass (measured: oxlint answers in plain text, not with number_of_files=0)', async (ctx) => {
    const skip = needOxlint(ctx);
    if (skip !== null) return skip;
    const fx = workspace('lint-zero-files', { resolve: true });
    const before = fx.r.read('.oxlintrc.jsonc');
    const after = before.replace('"ignorePatterns": [', '"ignorePatterns": [\n    "**/*",');
    assert(after !== before, '.oxlintrc.jsonc has no "ignorePatterns" array to widen — this probe plants the fourth door of L-visible and the zero-file state of L-lint through it');
    fx.r.write('.oxlintrc.jsonc', after);
    const row = await light(fx, 'L-lint');
    assertLight(row, 'cannot-verify', /No files found to lint|number_of_files=0/, 'L-lint on a tree its own config hides entirely');
    alsoMatches(row, 'L-lint with nothing to lint', /a lane that did not run is not a lane that passed/, /--type-aware/);
    fx.r.cleanup();
    return null;
  }),

  // ------------------------------------------------------------ L-type-engines
  probe('L-type-engines: `typescript-eslint` declared in any manifest ⇒ fail', async () => {
    const fx = workspace('engines-tsel');
    addDependency(fx.r, 'package.json', 'devDependencies', 'typescript-eslint', '^8.72.1');
    fx.r.commit('chore: a second type engine');
    const row = await light(fx, 'L-type-engines', { mb: 'HEAD^' });
    assertLight(row, 'fail', /HEAD:package\.json declares typescript-eslint in "devDependencies"/, 'L-type-engines with typescript-eslint declared at the root');
    alsoMatches(row, 'L-type-engines with typescript-eslint', /peers on `typescript >=4\.8\.4 <6\.1\.0`/);
    fx.r.cleanup();
  }),

  probe('L-type-engines: `eslint` declared in a package manifest ⇒ fail', async () => {
    const fx = workspace('engines-eslint');
    addDependency(fx.r, 'apps/web/package.json', 'devDependencies', 'eslint', '^9.0.0');
    fx.r.commit('chore: eslint is back');
    const row = await light(fx, 'L-type-engines', { mb: 'HEAD^' });
    assertLight(row, 'fail', /HEAD:apps\/web\/package\.json declares eslint in "devDependencies"/, 'L-type-engines with eslint declared in apps/web');
    fx.r.cleanup();
  }),

  probe('L-type-engines: a SECOND typescript version in the lock ⇒ fail, with both versions in the row', async () => {
    const fx = workspace('engines-two-ts');
    const before = fx.r.read('pnpm-lock.yaml');
    const after = before.replace('\npackages:\n', '\npackages:\n\n  typescript@6.0.3:\n    resolution: {integrity: sha512-plantedByAProbe}\n');
    assert(after !== before, "the fixture's pnpm-lock.yaml has no top-level `packages:` section — L-type-engines reads exactly that section, so there is nothing to plant a second engine in");
    fx.r.write('pnpm-lock.yaml', after);
    fx.r.commit('chore: a second typescript in the lock');
    const row = await light(fx, 'L-type-engines', { mb: 'HEAD^' });
    assertLight(row, 'fail', /resolves 2 versions of "typescript": 6\.0\.3, 7\.0\.2/, 'L-type-engines with two typescript versions resolved in HEAD');
    alsoMatches(row, 'L-type-engines with two engines', /a SECOND type engine is back/);
    fx.r.cleanup();
  }),

  probe('L-type-engines: oxlint-tsgolint on another major than typescript ⇒ fail', async () => {
    const fx = workspace('engines-major');
    const before = fx.r.read('pnpm-lock.yaml');
    const after = before.replace(/\n {2}oxlint-tsgolint@7\.[^\n:]*:/, '\n  oxlint-tsgolint@6.0.1:');
    assert(after !== before, "the fixture's lock resolves no `oxlint-tsgolint@7.x` — the two majors this light compares are the lint engine's and the compiler's, so the probe cannot plant a divergence");
    fx.r.write('pnpm-lock.yaml', after);
    fx.r.commit('chore: tsgolint on major 6');
    const row = await light(fx, 'L-type-engines', { mb: 'HEAD^' });
    assertLight(row, 'fail', /typescript is on major 7 \(7\.0\.2\) and oxlint-tsgolint on major 6 \(6\.0\.1\)/, 'L-type-engines with the lint engine on another major');
    alsoMatches(row, 'L-type-engines with two engine lines', /reasoning on two different engine lines/);
    fx.r.cleanup();
  }),

  probe('L-type-engines REVERSE: one engine, one specifier, one line ⇒ pass, with the MAJOR-ONLY limit named', async () => {
    const fx = workspace('engines-clean');
    fx.r.commit('chore: a second commit so HEAD^ exists');
    const row = await light(fx, 'L-type-engines', { mb: 'HEAD^' });
    assertLight(row, 'pass', /exactly one type engine in HEAD/, 'L-type-engines on an untouched copy of this repository');
    alsoMatches(row, 'L-type-engines on a clean tree', /plus 20 platform package\(s\), which are the same release and not a second engine/, /MAJOR ONLY, which is a declared limit/);
    fx.r.cleanup();
  }),

  // -------------------------------------------------------------------- L-deps
  probe('L-deps: a dependency added with no `package:` line ⇒ fail, naming the line to write', async () => {
    const fx = workspace('deps-undeclared', { vendorDigests: true });
    addDependency(fx.r, 'packages/core/package.json', 'devDependencies', 'left-pad', '^1.3.0');
    fx.r.commit('chore: a dependency nobody declared');
    const row = await light(fx, 'L-deps', { mb: 'HEAD^' });
    assertLight(row, 'fail', /left-pad entered devDependencies and nothing declares it/, 'L-deps with an undeclared addition');
    alsoMatches(row, 'L-deps with an undeclared addition', /add a line BEGINNING at column zero/, /packages\/core\/package\.json:\d+/);
    fx.r.cleanup();
  }),

  probe('L-deps: an INDENTED `package:` copy declares nothing ⇒ still fail, and the near-miss is named', async () => {
    const fx = workspace('deps-indented', { vendorDigests: true });
    addDependency(fx.r, 'packages/core/package.json', 'devDependencies', 'left-pad', '^1.3.0');
    fx.r.commit('chore: an indented declaration\n\n  package: left-pad — an indented trailer declares nothing');
    const row = await light(fx, 'L-deps', { mb: 'HEAD^' });
    assertLight(row, 'fail', /left-pad entered devDependencies and nothing declares it/, 'L-deps with an indented package: copy');
    alsoMatches(row, 'L-deps with an indented package: copy', /Near-miss/, /indented — a trailer is anchored to column zero/);
    fx.r.cleanup();
  }),

  probe('L-deps REVERSE: a column-zero `package:` line plus the matching lock importer ⇒ pass', async () => {
    const fx = workspace('deps-declared', { vendorDigests: true });
    addDependency(fx.r, 'packages/core/package.json', 'devDependencies', 'left-pad', '^1.3.0');
    const before = fx.r.read('pnpm-lock.yaml');
    const after = before.replace(
      '  packages/core: {}',
      ['  packages/core:', '    devDependencies:', '      left-pad:', '        specifier: ^1.3.0', '        version: 1.3.0'].join('\n'),
    );
    assert(after !== before, "the fixture's lock has no `packages/core: {}` importer in flow form — that empty-mapping shape is what this probe fills, and without it the pair cannot be made to agree");
    fx.r.write('pnpm-lock.yaml', after);
    fx.r.commit('chore: a declared dependency\n\npackage: left-pad — the fixture needs one declared addition');
    const row = await light(fx, 'L-deps', { mb: 'HEAD^' });
    assertLight(row, 'pass', /1 `package:` declaration\(s\)/, 'L-deps with a declared addition and a lock that agrees');
    alsoMatches(row, 'L-deps with a declared addition', /1 addition\(s\)/, /pnpm-lock\.yaml changed/);
    fx.r.cleanup();
  }),

  probe('L-deps: a RUNTIME dependency with no docs/vendor/<pkg>.md ⇒ fail', async () => {
    const fx = workspace('deps-no-digest', { vendorDigests: true });
    fx.r.rm('docs/vendor/fastify.md');
    fx.r.commit('chore: the digest is gone');
    const row = await light(fx, 'L-deps', { mb: 'HEAD^' });
    assertLight(row, 'fail', /fastify is a RUNTIME dependency and docs\/vendor\/fastify\.md does not exist at HEAD/, 'L-deps with a runtime dependency whose digest was deleted');
    alsoMatches(row, 'L-deps with a missing vendor digest', /a wrong member name is a bug no probe finds for us/, /3 runtime dependenc\(y\/ies\) checked for a digest/);
    fx.r.cleanup();
  }),

  probe('L-deps: a manifest that lost what the lock still lists ⇒ named on its own (the measured TD-0007 defect)', async () => {
    const fx = workspace('deps-lock-drift', { vendorDigests: true });
    const manifest = JSON.parse(fx.r.read('package.json'));
    const victim = Object.keys(manifest.devDependencies ?? {})[0] ?? null;
    assert(victim !== null, 'the fixture root package.json declares no devDependencies, so the measured defect (a manifest that lost what the lock lists) cannot be planted');
    delete manifest.devDependencies[victim];
    fx.r.write('package.json', `${JSON.stringify(manifest, null, 2)}\n`);
    fx.r.commit(`chore: the manifest and the lock disagree\n\npackage: ${victim} — removed from the manifest on purpose`);
    const row = await light(fx, 'L-deps', { mb: 'HEAD^' });
    assertLight(row, 'fail', /THIS IS THE MEASURED DEFECT \(TD-0007\)/, 'L-deps with a root manifest that lost a devDependency the lock still lists');
    alsoMatches(row, 'L-deps with a manifest/lock disagreement', new RegExp(`lists devDependencies\\.${victim} and package\\.json declares no such entry`), /never from memory/);
    fx.r.cleanup();
  }),

  // --------------------------------------------------------------- L-testshape
  probe('L-testshape: a spec case title that does not begin `S<n>_` ⇒ fail', async () => {
    const fx = workspace('shape-title');
    fx.r.write('packages/core/test/CHQ-001/S1_title-rule.test.ts', SPEC_TEST_OK.replace('S1_keeps the literal title', 'keeps the literal title'));
    const row = await light(fx, 'L-testshape');
    assertLight(row, 'fail', /case title "keeps the literal title" does not begin "S<n>_"/, 'L-testshape with a spec case title that carries no S<n>_');
    alsoMatches(row, 'L-testshape with an untitled case', /packages\/core\/test\/CHQ-001\/S1_title-rule\.test\.ts:\d+/, /1 spec/);
    fx.r.cleanup();
  }),

  probe('L-testshape: `@ts-expect-error` in a spec test ⇒ fail (scanned in the RAW text, because a directive IS a comment)', async () => {
    const fx = workspace('shape-directive');
    fx.r.write('packages/core/test/CHQ-001/S1_title-rule.test.ts', `// @ts-expect-error nope\n${SPEC_TEST_OK}`);
    const row = await light(fx, 'L-testshape');
    assertLight(row, 'fail', /`@ts-expect-error` in a spec test/, 'L-testshape with a silenced type error in a spec test');
    fx.r.cleanup();
  }),

  probe("L-testshape REVERSE: a well-formed spec test, `'as any'` inside a string, and a directive in a SKELETON ⇒ pass", async () => {
    const fx = workspace('shape-ok');
    fx.r.write('packages/core/test/CHQ-001/S1_title-rule.test.ts', SPEC_TEST_OK);
    // The same directive one directory over: level 3 is about SPEC tests, and a
    // light that judged a skeleton fixture by those rules would block the
    // repository's own plumbing tests.
    fx.r.write('packages/core/test/skeleton/marker.test.ts', `// @ts-expect-error a skeleton is not a spec test\n${fx.r.read('packages/core/test/skeleton/marker.test.ts')}`);
    const row = await light(fx, 'L-testshape');
    assertLight(row, 'pass', /5 test file\(s\) \(1 spec\)/, 'L-testshape on a well-formed spec test beside a skeleton that carries a directive');
    alsoMatches(row, 'L-testshape on a well-formed spec test', /level 4: 0 file\(s\) compared against an artifact/);
    fx.r.cleanup();
  }),

  // --------------------------------------------------------------- L-testguard
  probe('L-testguard: an undeclared edit of a guarded test ⇒ fail, naming the trailer to write', async () => {
    const fx = workspace('guard-undeclared');
    fx.r.write('packages/core/test/skeleton/marker.test.ts', `${fx.r.read('packages/core/test/skeleton/marker.test.ts')}\n// edited by a probe\n`);
    fx.r.commit('chore: an undeclared edit of a guarded test');
    const row = await light(fx, 'L-testguard', { mb: 'HEAD^' });
    assertLight(row, 'fail', /packages\/core\/test\/skeleton\/marker\.test\.ts: modified established skeleton/, 'L-testguard with an undeclared edit of a skeleton fixture');
    alsoMatches(row, 'L-testguard with an undeclared edit', /spec-conflict: <file>/, /spec-change: <file>/);
    fx.r.cleanup();
  }),

  probe('L-testguard REVERSE: the same edit with a column-zero `spec-change:` trailer ⇒ pass', async () => {
    const fx = workspace('guard-declared');
    fx.r.write('packages/core/test/skeleton/marker.test.ts', `${fx.r.read('packages/core/test/skeleton/marker.test.ts')}\n// edited by a probe\n`);
    fx.r.commit('chore: a declared edit of a guarded test\n\nspec-change: packages/core/test/skeleton/marker.test.ts — the fixture declares its own edit');
    const row = await light(fx, 'L-testguard', { mb: 'HEAD^' });
    assertLight(row, 'pass', /1 guarded change\(s\): 1 declared, 0 undeclared/, 'L-testguard with the edit declared per file at column zero');
    fx.r.cleanup();
  }),

  probe('L-testguard: the gate itself absent ⇒ cannot-verify — this light has no rules of its own to fall back on', async () => {
    const fx = workspace('guard-no-gate');
    fx.r.rm('tools/gates/test-guard.mjs');
    const row = await light(fx, 'L-testguard', { mb: 'HEAD^' });
    assertLight(row, 'cannot-verify', /tools\/gates\/test-guard\.mjs does not exist/, 'L-testguard with the gate it is a row for deleted');
    fx.r.cleanup();
  }),

  // ----------------------------------------------------------------- L-orphans
  probe('L-orphans: a tracked module nothing imports ⇒ fail, naming the entry points it is not reachable from', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('orphans-module', { resolve: true });
    fx.r.write('packages/core/src/orphan.ts', 'export const ORPHAN = 1;\n');
    fx.r.commit('chore: an orphan module');
    const row = await light(fx, 'L-orphans');
    assertLight(row, 'fail', /packages\/core\/src\/orphan\.ts:1: nothing imports this module/, 'L-orphans with a module no entry point and no test reaches');
    alsoMatches(row, 'L-orphans with an unreachable module', /no entry point of packages\/core/);
    fx.r.cleanup();
    return null;
  }),

  probe('L-orphans: a test file no Vitest project collects ⇒ fail (a test nobody runs reads exactly like a test that passes)', async (ctx) => {
    const skip = needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('orphans-test', { resolve: true });
    fx.r.write('packages/core/stray.test.ts', "import { it, expect } from 'vitest';\nit('stray', () => { expect(1).toBe(1); });\n");
    fx.r.commit('chore: a test outside every band');
    const row = await light(fx, 'L-orphans');
    assertLight(row, 'fail', /packages\/core\/stray\.test\.ts:1: no Vitest project collects this file/, 'L-orphans with a test file outside every collection band');
    alsoMatches(row, 'L-orphans with an uncollected test', /bands: packages\/core\/test\/\*\*\/\*\.test\.ts/);
    fx.r.cleanup();
    return null;
  }),

  probe("L-orphans REVERSE: the untouched skeleton ⇒ pass, corroborated by the runner's own collection", async (ctx) => {
    const skip = needVitest(ctx) ?? needTsc(ctx);
    if (skip !== null) return skip;
    const fx = workspace('orphans-clean', { resolve: true });
    const row = await light(fx, 'L-orphans');
    assertLight(row, 'pass', /core\+core-dom: \d+ file\(s\), and `vitest list --json` collects exactly those/, 'L-orphans on an untouched copy of this repository');
    alsoMatches(row, 'L-orphans on a clean tree', /4 test file\(s\) across 3 collection band\(s\)/, /"\.\/testing" → packages\/core\/src\/testing\/digest\.ts/);
    fx.r.cleanup();
    return null;
  }),

  // ----------------------------------------------------------------- L-visible
  probe('L-visible: a path under packages/ that git ignores and visible.json does not declare ⇒ fail, naming the door', async () => {
    const fx = workspace('visible-undeclared');
    fx.r.write('.gitignore', `${fx.r.read('.gitignore')}\npackages/core/src/hidden.ts\n`);
    fx.r.write('packages/core/src/hidden.ts', 'export const HIDDEN = 1;\n');
    fx.r.commit('chore: a hidden source');
    const row = await light(fx, 'L-visible');
    assertLight(row, 'fail', /packages\/core\/src\/hidden\.ts is hidden from every walk by the door "gitignore" and tools\/gates\/visible\.json declares nothing for it/, 'L-visible with an undeclared gitignore blind spot');
    alsoMatches(row, 'L-visible with an undeclared blind spot', /an undeclared blind spot is how a subtree stops being checked/);
    fx.r.cleanup();
  }),

  probe('L-visible REVERSE: the same path DECLARED with its door ⇒ pass', async () => {
    const fx = workspace('visible-declared');
    fx.r.write('.gitignore', `${fx.r.read('.gitignore')}\npackages/core/src/hidden.ts\n`);
    fx.r.write('packages/core/src/hidden.ts', 'export const HIDDEN = 1;\n');
    setManifestEntries(fx.r, 'tools/gates/visible.json', [
      { path: 'packages/core/src/hidden.ts', doors: ['gitignore'], why: 'planted by a probe fixture to prove that a declaration cures the row' },
    ]);
    fx.r.commit('chore: a declared blind spot');
    const row = await light(fx, 'L-visible');
    assertLight(row, 'pass', /four doors checked over packages \+ apps \+ e2e/, 'L-visible with the blind spot declared in visible.json');
    alsoMatches(row, 'L-visible with a declared blind spot', /door gitignore: 1 ignored path\(s\) file-by-file/);
    fx.r.cleanup();
  }),

  probe('L-visible REVERSE: a `.`-prefixed directory is SELF-HIDDEN and is not counted against the manifest ⇒ pass', async () => {
    const fx = workspace('visible-self-hidden');
    fx.r.write('.gitignore', `${fx.r.read('.gitignore')}\npackages/core/.cache/\n`);
    fx.r.write('packages/core/.cache/x.ts', 'export const X = 1;\n');
    fx.r.commit('chore: a dot directory');
    const row = await light(fx, 'L-visible');
    assertLight(row, 'pass', /1 self-hidden/, 'L-visible with an ignored dot directory nobody declared');
    alsoMatches(row, 'L-visible with a self-hidden path', /visible\.json declares NOTHING hidden/);
    fx.r.cleanup();
  }),

  // --------------------------------------------------------------- L-generated
  probe('L-generated: a committed projection a hand edited ⇒ fail, with the first differing line and the CURE', async () => {
    const fx = workspace('generated-edited');
    plantProjection(fx.r, { body: PROJECTION_BODY.replace('one line of projection', 'a line somebody typed') });
    fx.r.commit('chore: a hand-edited projection');
    const row = await light(fx, 'L-generated');
    assertLight(row, 'fail', /docs\/digests\/probe-projection\.md:3: the committed file is NOT what tools\/gates\/probe-producer\.mjs renders/, 'L-generated with a hand-edited projection');
    alsoMatches(row, 'L-generated with a hand-edited projection', /HEAD has "a line somebody typed", a fresh render has "one line of projection"/, /CURE: node tools\/gates\/probe-producer\.mjs --fix/);
    fx.r.cleanup();
  }),

  probe('L-generated REVERSE: a projection that re-renders byte-identical ⇒ pass', async () => {
    const fx = workspace('generated-identical');
    plantProjection(fx.r);
    fx.r.commit('chore: a projection');
    const row = await light(fx, 'L-generated');
    assertLight(row, 'pass', /1 byte-identical, 0 fail, 0 cannot-verify/, 'L-generated with a projection that matches a fresh render');
    fx.r.cleanup();
  }),

  probe('L-generated: a file in the generated directory that no entry declares ⇒ fail (the shape a hand-written "digest" takes)', async () => {
    const fx = workspace('generated-orphan');
    plantProjection(fx.r);
    fx.r.write('docs/digests/hand-written.md', '# not generated by anything\n');
    fx.r.commit('chore: an orphan in the generated directory');
    const row = await light(fx, 'L-generated');
    assertLight(row, 'fail', /docs\/digests\/hand-written\.md: at HEAD inside a generated directory and declared by no entry/, 'L-generated with an undeclared file beside a projection');
    fx.r.cleanup();
  }),

  probe('L-generated: a declared producer that does not exist ⇒ cannot-verify, never pass', async () => {
    const fx = workspace('generated-no-producer');
    plantProjection(fx.r, { producer: false });
    fx.r.commit('chore: a declaration with no producer');
    const row = await light(fx, 'L-generated');
    assertLight(row, 'cannot-verify', /producer not written: tools\/gates\/probe-producer\.mjs/, 'L-generated with the producer script absent');
    alsoMatches(row, 'L-generated with no producer', /nothing can be said about this file until it exists/);
    fx.r.cleanup();
  }),

  probe('L-generated: a declared projection absent from HEAD ⇒ fail — a declaration with no file', async () => {
    const fx = workspace('generated-absent');
    plantProjection(fx.r, { body: null });
    fx.r.commit('chore: a declaration with no file');
    const row = await light(fx, 'L-generated');
    assertLight(row, 'fail', /docs\/digests\/probe-projection\.md: declared generated in tools\/gates\/generated\.json and absent from HEAD/, 'L-generated with a declared file nobody committed');
    fx.r.cleanup();
  }),

  // ----------------------------------------------------------------- L-stubkit
  probe('L-stubkit: a stub screen whose root element carries no data-stub ⇒ fail', async () => {
    const fx = workspace('stub-no-marker');
    plantStubkitPackage(fx.r);
    fx.r.write('apps/web/src/stubs/TaskList.tsx', STUB_SCREEN_OK.replace(' data-stub="task-list"', ''));
    const row = await light(fx, 'L-stubkit');
    assertLight(row, 'fail', /the root element <section> does not carry data-stub/, 'L-stubkit with a screen whose root carries no marker');
    alsoMatches(row, 'L-stubkit with an unmarked screen', /1 of them a screen \(a JSX root\)/);
    fx.r.cleanup();
  }),

  probe('L-stubkit: a literal array of objects in a stub ⇒ fail — a stub renders an honest empty state', async () => {
    const fx = workspace('stub-invented-data');
    plantStubkitPackage(fx.r);
    fx.r.write(
      'apps/web/src/stubs/TaskList.tsx',
      STUB_SCREEN_OK.replace('  return (', '  const rows = [{ id: 1, title: "invented" }];\n  void rows;\n  return ('),
    );
    const row = await light(fx, 'L-stubkit');
    assertLight(row, 'fail', /a literal array of objects/, 'L-stubkit with fabricated rows in a stub screen');
    alsoMatches(row, 'L-stubkit with invented data', /never fabricated rows \(rule 9\)/);
    fx.r.cleanup();
  }),

  probe('L-stubkit: a domain import inside the stub root ⇒ fail (react and @cheq/stubkit are the only bare specifiers)', async () => {
    const fx = workspace('stub-domain-import');
    plantStubkitPackage(fx.r);
    fx.r.write(
      'apps/web/src/stubs/TaskList.tsx',
      STUB_SCREEN_OK.replace("import { StubFrame } from '@cheq/stubkit';", "import { StubFrame } from '@cheq/stubkit';\nimport { CORE_PACKAGE } from '@cheq/core';\nvoid CORE_PACKAGE;"),
    );
    const row = await light(fx, 'L-stubkit');
    assertLight(row, 'fail', /import "@cheq\/core" — inside apps\/web\/src\/stubs\/ the only non-relative specifiers are/, 'L-stubkit with a domain import in a stub screen');
    fx.r.cleanup();
  }),

  probe('L-stubkit: an unresolvable relative import in a stub ⇒ fail (the header promises it; the original let it through)', async () => {
    const fx = workspace('stub-unresolvable');
    plantStubkitPackage(fx.r);
    fx.r.write(
      'apps/web/src/stubs/TaskList.tsx',
      STUB_SCREEN_OK.replace("import { StubFrame } from '@cheq/stubkit';", "import { StubFrame } from '@cheq/stubkit';\nimport { nothing } from './nobody-wrote-this.ts';\nvoid nothing;"),
    );
    const row = await light(fx, 'L-stubkit');
    assertLight(row, 'fail', /import "\.\/nobody-wrote-this\.ts" resolves to no file/, 'L-stubkit with an import that resolves to nothing');
    fx.r.cleanup();
  }),

  probe('L-stubkit: a stub marker OUTSIDE the stub root ⇒ fail, naming the one directory a stub may live in', async () => {
    const fx = workspace('stub-misplaced');
    plantStubkitPackage(fx.r);
    fx.r.write('apps/web/src/Misplaced.tsx', STUB_SCREEN_OK.replace("import { StubFrame } from '@cheq/stubkit';\n\n", '').replace('      <StubFrame title="no tasks yet" />\n', ''));
    const row = await light(fx, 'L-stubkit');
    assertLight(row, 'fail', /apps\/web\/src\/Misplaced\.tsx: carries data-stub on <section>/, 'L-stubkit with a stub marker outside the stub root');
    alsoMatches(row, 'L-stubkit with a misplaced stub', /a stub screen lives under apps\/web\/src\/stubs\/ and nowhere else/);
    fx.r.cleanup();
  }),

  probe('L-stubkit REVERSE: a marked screen built from the stubkit, beside a helper with no JSX ⇒ pass', async () => {
    const fx = workspace('stub-ok');
    plantStubkitPackage(fx.r);
    fx.r.write('apps/web/src/stubs/TaskList.tsx', STUB_SCREEN_OK);
    // A helper under the stub root is legitimate and is simply not a screen —
    // the claim about a root element has nothing to stand on for it.
    fx.r.write('apps/web/src/stubs/labels.ts', "export const EMPTY_LABEL = 'no tasks yet';\n");
    const row = await light(fx, 'L-stubkit');
    assertLight(row, 'pass', /2 file\(s\), 1 of them a screen \(a JSX root\)/, 'L-stubkit with one correct screen and one helper');
    alsoMatches(row, 'L-stubkit on a correct stub', /@cheq\/stubkit is packages\/stubkit/);
    fx.r.cleanup();
  }),

  // -------------------------------------------------------------- L-env-parity
  probe('L-env-parity: one case whose verdict depends on the environment ⇒ fail, with both verdicts and the reason', async (ctx) => {
    const skip = needVitest(ctx);
    if (skip !== null) return skip;
    const fx = workspace('parity-disagree', { resolve: true });
    fx.r.write(
      'packages/core/test/skeleton/env.test.ts',
      [
        "import { describe, it, expect } from 'vitest';",
        '',
        "describe('the environment', () => {",
        "  it('has no document', () => {",
        "    expect(typeof globalThis.document).toBe('undefined');",
        '  });',
        '});',
        '',
      ].join('\n'),
    );
    const row = await light(fx, 'L-env-parity');
    assertLight(row, 'fail', /core \(node\)=green vs core-dom \(jsdom\)=red/, 'L-env-parity with a case that only passes under node');
    alsoMatches(row, 'L-env-parity with a disagreement', /packages\/core\/test\/skeleton\/env\.test\.ts > the environment > has no document/, /under jsdom: AssertionError/);
    fx.r.cleanup();
    return null;
  }),

  probe('L-env-parity REVERSE: the untouched core set ⇒ pass, every case compared BY NAME', async (ctx) => {
    const skip = needVitest(ctx);
    if (skip !== null) return skip;
    const fx = workspace('parity-clean', { resolve: true });
    const row = await light(fx, 'L-env-parity');
    assertLight(row, 'pass', /case\(s\) compared by name under core \(node\) vs core-dom \(jsdom\) and every verdict agrees/, 'L-env-parity on an untouched copy of the core test set');
    alsoMatches(row, 'L-env-parity on a clean tree', /content key over \d+ tracked and 0 uncommitted path\(s\) under packages\/core/);
    fx.r.cleanup();
    return null;
  }),

  probe('L-env-parity: the runner premise absent ⇒ cannot-verify naming it, never a pass', async () => {
    const fx = workspace('parity-no-runner');
    const row = await light(fx, 'L-env-parity', { premises: without(fx.premises, 'vitest') });
    assertLight(row, 'cannot-verify', /premise "vitest" absent: node_modules\/\.bin\/vitest does not exist/, 'L-env-parity with the runner premise forced absent');
    alsoMatches(row, 'L-env-parity with no runner', /pnpm install/);
    fx.r.cleanup();
  }),

  // --------------------------------------------------------------- L-artifacts
  probe("L-artifacts REVERSE: a GATE's run.json with no `steps` ⇒ pass — the light must not be stricter than RUN_JSON_REQUIRED", async () => {
    const fx = workspace('artifacts-gate-record');
    writeRunRecord(fx.r, `${STAMP}-spec-gate`, { kind: 'gate', gate: 'spec-gate' });
    const row = await light(fx, 'L-artifacts');
    assertLight(row, 'pass', /the record of gate "spec-gate", not a run of record/, "L-artifacts on a gate's own record, which spawns no judged tool");
    alsoMatches(row, 'L-artifacts on a gate record', /it spawned no judged tool, so it carries no "steps" and none is required/);
    fx.r.cleanup();
  }),

  probe("L-artifacts: a LANE's run.json with no `steps` ⇒ cannot-verify — the argvs that make its artifact mean anything are unreadable", async () => {
    const fx = workspace('artifacts-lane-record');
    writeRunRecord(fx.r, `${STAMP}-test-core`);
    const row = await light(fx, 'L-artifacts');
    assertLight(row, 'cannot-verify', /no "steps" array/, 'L-artifacts on a lane record that names no judged tool');
    alsoMatches(row, 'L-artifacts on a lane record with no steps', /--passWithNoTests=false, --retry=0 and --type-aware cannot be read back/);
    fx.r.cleanup();
  }),

  probe('L-artifacts: a FIXED run-directory name ⇒ fail — a reused directory by construction', async () => {
    const fx = workspace('artifacts-fixed-dir');
    writeRunRecord(fx.r, 'latest', { steps: [{ half: 'vitest', exitCode: 0, argv: vitestArgv('latest') }] });
    const row = await light(fx, 'L-artifacts');
    assertLight(row, 'fail', /\.ci\/runs\/latest: the directory name is not <stamp>-<label>/, 'L-artifacts on a run directory with a fixed name');
    alsoMatches(row, 'L-artifacts on a fixed directory', /a fixed name is a REUSED run directory by construction/);
    fx.r.cleanup();
  }),

  probe('L-artifacts: a vitest step with no `--passWithNoTests=false` ⇒ fail, with the reason the flag exists', async () => {
    const fx = workspace('artifacts-missing-flag');
    const name = `${STAMP}-test-core`;
    writeRunRecord(fx.r, name, { steps: [{ half: 'vitest', exitCode: 0, argv: vitestArgv(name).filter((a) => a !== '--passWithNoTests=false') }] });
    const row = await light(fx, 'L-artifacts');
    assertLight(row, 'fail', /the vitest argv does not carry --passWithNoTests=false/, 'L-artifacts on a recorded vitest argv that could pass with no tests');
    alsoMatches(row, 'L-artifacts on a missing flag', /an empty lane reads as a green one/);
    fx.r.cleanup();
  }),

  probe('L-artifacts: a step writing OUTSIDE its own run directory ⇒ fail', async () => {
    const fx = workspace('artifacts-stray-output');
    const name = `${STAMP}-test-core`;
    writeRunRecord(fx.r, name, {
      steps: [
        {
          half: 'vitest',
          exitCode: 0,
          argv: ['node_modules/.bin/vitest', 'run', '--project', 'core', '--reporter=junit', '--outputFile.junit=.ci/tests/core.junit.xml', '--retry=0', '--passWithNoTests=false'],
        },
      ],
    });
    const row = await light(fx, 'L-artifacts');
    assertLight(row, 'fail', /sends --outputFile\.junit=\.ci\/tests\/core\.junit\.xml to \.ci\/tests\/core\.junit\.xml, which is not inside/, 'L-artifacts on a run that writes into a shared path');
    alsoMatches(row, 'L-artifacts on a stray output path', /two runs' artifacts share a path and neither has an owner/);
    fx.r.cleanup();
  }),

  probe('L-artifacts REVERSE: a well-formed lane record ⇒ pass', async () => {
    const fx = workspace('artifacts-ok');
    const name = `${STAMP}-test-core`;
    writeRunRecord(fx.r, name, { steps: [{ half: 'vitest', exitCode: 0, argv: vitestArgv(name) }] });
    const row = await light(fx, 'L-artifacts');
    assertLight(row, 'pass', new RegExp(`\\.ci/runs/${STAMP}-test-core: vitest: \\d+ argv token\\(s\\), exit 0`), 'L-artifacts on a run of record that names its tool and writes into its own directory');
    fx.r.cleanup();
  }),

  // ------------------------------------------------------------------- L-homes
  probe('L-homes: an edit of a declared shared file that no spec homes ⇒ fail (soft: reported, never blocking)', async () => {
    const fx = workspace('homes-unowned');
    setManifestEntries(fx.r, 'tools/gates/homes.json', [{ path: SHARED_FILE, why: 'planted by a probe fixture: the barrel every package reads' }]);
    fx.r.commit('chore: declare a shared file');
    fx.r.write(SHARED_FILE, `${fx.r.read(SHARED_FILE)}\nexport const PROBE_EDIT = 1;\n`);
    fx.r.commit('chore: edit the shared file with no spec');
    const row = await light(fx, 'L-homes', { mb: 'HEAD^' });
    assertLight(row, 'fail', /packages\/core\/src\/index\.ts: declared shared in tools\/gates\/homes\.json/, 'L-homes with a shared file edited by no spec');
    alsoMatches(row, 'L-homes with an unowned edit', /no spec file was touched in this range, so no home was named at all/);
    assert(row.severity === 'soft', `L-homes must stay SOFT (it reports and never blocks until homes.json holds more than one entry); the row came back severity=${String(row.severity)}`);
    fx.r.cleanup();
  }),

  probe('L-homes REVERSE: the same edit with a spec naming that module as its `home:` ⇒ pass', async () => {
    const fx = workspace('homes-owned');
    setManifestEntries(fx.r, 'tools/gates/homes.json', [{ path: SHARED_FILE, why: 'planted by a probe fixture: the barrel every package reads' }]);
    fx.r.commit('chore: declare a shared file');
    fx.r.write(SHARED_FILE, `${fx.r.read(SHARED_FILE)}\nexport const PROBE_EDIT = 1;\n`);
    fx.r.write('docs/specs/CHQ-001.md', specNamingHome(SHARED_FILE));
    fx.r.commit('spec: CHQ-001 names the shared file as its home');
    const row = await light(fx, 'L-homes', { mb: 'HEAD^' });
    assertLight(row, 'pass', /1 spec file\(s\) in the range \(CHQ-001\) name 1 file home\(s\)/, 'L-homes with a spec naming the shared file as its home');
    fx.r.cleanup();
  }),

  probe('L-homes REVERSE: a change that touches no declared shared file ⇒ pass, saying so', async () => {
    const fx = workspace('homes-unrelated');
    setManifestEntries(fx.r, 'tools/gates/homes.json', [{ path: SHARED_FILE, why: 'planted by a probe fixture: the barrel every package reads' }]);
    fx.r.commit('chore: declare a shared file');
    fx.r.write('apps/api/src/index.ts', `${fx.r.read('apps/api/src/index.ts')}\nexport const PROBE_EDIT = 1;\n`);
    fx.r.commit('chore: edit a file nobody declared shared');
    const row = await light(fx, 'L-homes', { mb: 'HEAD^' });
    assertLight(row, 'pass', /none of the 1 shared file\(s\) tools\/gates\/homes\.json declares among them/, 'L-homes on a change outside every declared home');
    fx.r.cleanup();
  }),

  // ----------------------------------------------------------------- L-browser
  probe('L-browser: no probe record ⇒ cannot-verify with the cure, and nothing read is evidence', async () => {
    const fx = workspace('browser-no-probe');
    const row = await light(fx, 'L-browser');
    assertLight(row, 'cannot-verify', /playwright browsers not installed — npx playwright install chromium \(TD-0001\)/, 'L-browser with no probe record in the worktree');
    alsoMatches(row, 'L-browser with no probe record', /premise "browser_probe": no probe record at/);
    assert(row.severity === 'soft', `L-browser must stay SOFT so an unobserved probe is readable and never blocking; the row came back severity=${String(row.severity)}`);
    fx.r.cleanup();
  }),

  probe('L-browser: an OBSERVED probe and still no artifact ⇒ cannot-verify — the glob claim has nothing to stand on', async () => {
    const fx = workspace('browser-no-artifact');
    observeBrowserProbe(fx);
    const row = await light(fx, 'L-browser');
    assertLight(row, 'cannot-verify', /the probe lifts the lane and there is still no artifact to read/, 'L-browser with the premise observed and no e2e artifact');
    fx.r.cleanup();
  }),

  probe('L-browser: an artifact naming a file the e2e glob does not cover ⇒ fail', async () => {
    const fx = workspace('browser-foreign-file');
    observeBrowserProbe(fx);
    fx.r.write(`.ci/runs/${STAMP}-e2e/e2e.junit.xml`, junitXml('apps/web/test/skeleton/marker.test.ts', 'marker'));
    const row = await light(fx, 'L-browser');
    assertLight(row, 'fail', /a <testcase classname> names a file the glob does not cover/, 'L-browser with an e2e report naming a web unit test');
    alsoMatches(row, 'L-browser with a foreign file', /the declared shape is e2e\/CHQ-<nnn>\/S<n>_<slug>\.spec\.ts/);
    fx.r.cleanup();
  }),

  probe('L-browser REVERSE: an observed probe and an artifact whose classname IS an e2e case ⇒ pass', async () => {
    const fx = workspace('browser-covered-file');
    observeBrowserProbe(fx);
    fx.r.write(`.ci/runs/${STAMP}-e2e/e2e.junit.xml`, junitXml('e2e/CHQ-001/S1_task-list.spec.ts', 'S1_shows the list'));
    const row = await light(fx, 'L-browser');
    assertLight(row, 'pass', /premise "browser_probe" observed/, 'L-browser with an artifact naming a declared e2e case');
    alsoMatches(row, 'L-browser on a covered artifact', new RegExp(`read \\.ci/runs/${STAMP}-e2e/e2e\\.junit\\.xml \\(junit\\)`));
    fx.r.cleanup();
  }),
];
