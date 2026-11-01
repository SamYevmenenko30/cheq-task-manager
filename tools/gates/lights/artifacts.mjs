#!/usr/bin/env node
/**
 * L-artifacts (hard) — a run of record is citable. Four claims about
 * `.ci/runs/**`, each mechanical, and the last one is the one nobody expects:
 *
 *   1. EVERY run directory carries a `run.json`, and that file names the commit
 *      (`head`), whether the tracked tree was clean (`treeClean`), the argv and
 *      the tool's own exit code — `RUN_JSON_REQUIRED` from `../lib/run-dir.mjs`
 *      is the list, imported and never retyped.
 *   2. NO artifact is reached by a "newest" glob. A run directory is named
 *      `<stamp>-<label>`; a FIXED name (`latest-e2e`) is a reused directory by
 *      construction, and a declaration of one in a committed config is the same
 *      defect one step earlier.
 *   3. A run writes ONLY into its own directory: every output path in a step's
 *      argv resolves inside that run directory.
 *   4. THE FLAGS THAT MAKE A RUN MEAN ANYTHING ARE READ BACK OUT OF THE ARGV.
 *      A test step must carry `--passWithNoTests=false` and `--retry=0`; a lint
 *      step must carry `--type-aware`. Each of the three is a measured
 *      silent-pass: without `--passWithNoTests=false` a run that matched nothing
 *      exits 0 and writes a tidy report; a retried failure is a green run that
 *      failed; and without `--type-aware` oxlint's type rules DO NOT RUN and
 *      NOTHING says so (port-plan-delta Д7). A lane can therefore be green and
 *      empty, and the only place that is visible after the fact is the argv the
 *      run recorded.
 *
 *     node tools/gates/lights/artifacts.mjs
 *
 * Zero dependencies, Node 22 ESM. The module contract lives in `./_shared.mjs`.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE ARGV OF RECORD IS `steps[].argv`, NOT `run.json.argv` — MEASURED
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * This is the trap this light was nearly written into. `run.json.argv` is
 * `process.argv.slice(2)` of the WRAPPER (tools/gates/run.mjs:883) — it reads
 * `["test","--kind","core","--label","x"]`. Asserting `--retry=0` against that
 * field would fail on every correct run, and "fixing" it by loosening the
 * assertion would have left the real flag unchecked forever.
 *
 * The judged tool's own argv is `steps[].argv` (`[bin, ...args]`, written by
 * `runTool` at tools/gates/run.mjs:302), one entry per half, with `half` naming
 * which tool it was: `tsc` | `oxlint` | `vitest` | `playwright`. So this light
 * reads `steps[]` and uses `half` as the classification — the writer's own word
 * — while still deriving a classification from the argv's program name and
 * reporting a DISAGREEMENT between the two. A step whose `half` says `vitest`
 * over an argv that spawned something else is a record describing a run that did
 * not happen.
 *
 * A step may legitimately carry NO argv: `{ half, kind, skipped }` for a step the
 * wrapper refused to launch, and `{ half, kind, launched: false, … }` for a
 * project with no cases. Those are declared absences and are counted, not
 * failed. A step with neither an argv nor one of those two declarations is
 * cannot-verify: the record says a half ran and does not say how.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT "NO NEWEST GLOB" CAN AND CANNOT BE CHECKED AS
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * "No reader selects the newest artifact" is a property of READER CODE, and the
 * place it is enforced is `../lib/run-dir.mjs`, which hands out no latest and no
 * pattern. What this light can check is the OBSERVABLE consequence, in two
 * directions:
 *
 *   - a directory under `.ci/runs` whose name is not `<stamp>-<label>`. The
 *     stamp form is `stampOf`'s own output (`toISOString` with `:` and `.`
 *     replaced), so `STAMP_RE` below mirrors that function and is checked
 *     against it at module load — a drift in either makes this light refuse
 *     instead of judging by a stale pattern;
 *   - a committed file that NAMES a fixed `.ci/runs/<name>` path. That is the
 *     defect before it becomes a directory, and this repository has one:
 *     `playwright.config.ts:12-15` points both reporters at
 *     `.ci/runs/latest-e2e/`, which is a single directory every e2e run would
 *     overwrite, with no `run.json` and no commit beside it. It is reported with
 *     its `path:line`.
 *
 * The scan for that literal runs over `scanSource`-masked source, so a path in a
 * comment or inside a `${…}` substitution is not a declaration. It covers the
 * committed files that WRITE artifacts — the two runner configs and
 * `tools/gates/**` — and not the whole tree: a `.ci/runs/<x>` string in prose is
 * documentation, and a light that failed on documentation would be turned off.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT THIS LIGHT DOES NOT CLAIM
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `STANDING_LIGHTS` (`../lib/spec-parse.mjs`) titles this light "a run of record
 * writes only into its own run directory; ONE BROWSER RUN AT A TIME". The second
 * half is NOT implemented here and is not silently dropped: the lock that would
 * answer it is `.ci/lock`, written and released inside `tools/gates/run.mjs`
 * (`CI_LOCK`, line 123) and deleted when the run ends, so after the fact there is
 * nothing left to read — a held lock means a run is in flight NOW, which is a
 * question about this moment and not about the artifacts a run left behind.
 * `../lib/run-dir.mjs` exports no reader for it. Reporting that gap belongs in
 * the report that accompanies this file, and the claim is absent from the row
 * rather than faked.
 *
 * Nothing here reads HEAD, and that is deliberate: `.ci/` is gitignored machine
 * state (.gitignore:9-10), so there is no committed side to diff a run directory
 * against. The one git fact a run records — `head` — is checked for PRESENCE and
 * shape, not for being reachable: a run made on a commit that was since rebased
 * away is still a truthful record of that run.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RUNS_ROOT, RUN_JSON_REQUIRED, readRunJson, runJsonPath, stampOf } from '../lib/run-dir.mjs';
import { SHA_RE, repoRoot } from '../lib/git.mjs';
import { normalizeResult, normRel, readPremises, relPosix, scanSource, under } from './_shared.mjs';

export const id = 'L-artifacts';
export const severity = 'hard';

/**
 * A run directory is `<stamp>-<label>`. The stamp half mirrors `stampOf` in
 * `../lib/run-dir.mjs` (an ISO instant with `:` and `.` replaced by `-`) and the
 * label half mirrors its `LABEL_RE`. Both are checked against the real function
 * at module load — see `MIRROR_PROBLEM`.
 */
export const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
export const RUN_DIR_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-([a-z0-9][a-z0-9-]*)$/;

/**
 * Non-null when `STAMP_RE` no longer describes what `stampOf` produces. A
 * pattern that has drifted from the function it mirrors would fail every
 * correct directory, so this light reports the drift and judges nothing.
 */
export const MIRROR_PROBLEM = STAMP_RE.test(stampOf(new Date(0)))
  ? null
  : `STAMP_RE no longer matches stampOf() — stampOf(new Date(0)) is ${JSON.stringify(stampOf(new Date(0)))}; fix STAMP_RE in tools/gates/lights/artifacts.mjs to mirror ../lib/run-dir.mjs`;

/** The flags each kind of step must carry, with WHY — the why is printed, because
 * "add --retry=0" without the reason reads as ceremony. Each one is a measured
 * silent pass; see the header. */
export const REQUIRED_FLAGS = Object.freeze({
  vitest: [
    { re: /^--passWithNoTests=false$/, flag: '--passWithNoTests=false', why: 'without it a run whose filter matched nothing exits 0 and writes a well-formed report, so an empty lane reads as a green one' },
    { re: /^--retry=0$/, flag: '--retry=0', why: 'a failure that passes on a retry is not a green run, and the report keeps only the last attempt' },
  ],
  oxlint: [
    { re: /^--type-aware$/, flag: '--type-aware', why: 'without it oxlint\'s type-aware rules DO NOT RUN and nothing says so — the output looks like a successful lint (port-plan-delta Д7)' },
  ],
  tsc: [],
  playwright: [],
});

/** `half` → the program basename its argv must start with, so the record's own
 * word can be checked against what it actually spawned. */
export const PROGRAM_OF_HALF = Object.freeze({ vitest: 'vitest', oxlint: 'oxlint', tsc: 'tsc', playwright: 'playwright' });

/** The committed files that WRITE artifacts, scanned for a fixed `.ci/runs/<x>`
 * literal. Not the whole tree — see the header. */
export const WRITER_ROOTS = Object.freeze(['tools/gates']);
export const WRITER_FILES = Object.freeze(['playwright.config.ts', 'vitest.config.ts']);
const WRITER_EXTS = Object.freeze(['.mjs', '.ts']);

const SHOWN = 8;
const list = (xs, shown = SHOWN) => {
  const a = [...xs];
  return a.length <= shown ? a.join(', ') : `${a.slice(0, shown).join(', ')} and ${String(a.length - shown)} more`;
};

/** The 1-based line of an OFFSET. `jsonLine` in `./_shared.mjs` searches for a
 * JSON key in double quotes and would miss a single-quoted TypeScript literal;
 * `scanSource` keys its literals BY offset, so the line is computed from that
 * offset instead of searched for — exact, and never the wrong occurrence. */
const lineOf = (text, offset) => {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
};

/**
 * Directories directly under `.ci/runs`, plus anything there that is not a
 * directory. → { exists, dirs, strays, problems }
 *
 * `walk` from `./_shared.mjs` is not usable: it skips every `.`-prefixed segment
 * (`SELF_HIDDEN`), and `.ci` is one — correct for a walk over judged source,
 * useless for reading machine state. This never recurses: a run's artifacts are
 * flat beside its `run.json`.
 */
export function listRuns(root) {
  const abs = join(root, RUNS_ROOT);
  if (!existsSync(abs)) return { exists: false, dirs: [], strays: [], problems: [] };
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch (e) {
    return { exists: true, dirs: [], strays: [], problems: [`${RUNS_ROOT}: unreadable directory: ${String(e.message)} — a run nobody can list is never clean`] };
  }
  const dirs = [];
  const strays = [];
  for (const d of entries.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (d.isDirectory()) dirs.push(d.name);
    else strays.push(d.name);
  }
  return { exists: true, dirs, strays, problems: [] };
}

/**
 * The output paths one argv asks for. → [{ token, path }]
 *
 * Three forms, all of them in use in this repository: `--outputFile=<p>`,
 * `--outputFile.<reporter>=<p>` (the DOTTED form vitest requires — the mixed
 * form crashes it before any test runs and writes nothing, measured) and
 * `-o <p>`. A relative path is resolved against the repository root, which is
 * the cwd every step is spawned with (tools/gates/run.mjs:961).
 */
export function outputPaths(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] ?? '');
    const eq = /^(--outputFile(?:\.[A-Za-z0-9_-]+)?|--output|--reporter-options)=(.+)$/.exec(a);
    if (eq) {
      out.push({ token: a, path: eq[2] });
      continue;
    }
    if (a === '-o' || a === '--output' || a === '--outputFile') {
      const next = argv[i + 1];
      if (typeof next === 'string' && !next.startsWith('-')) out.push({ token: `${a} ${next}`, path: next });
    }
  }
  return out;
}

/**
 * Judge ONE step of one run. → { problems, unknowns, note }
 * `dirRel` is the run directory, repo-relative, and is what every output path
 * must lie inside.
 */
export function judgeStep(root, dirRel, step, where) {
  const problems = [];
  const unknowns = [];
  const half = typeof step?.half === 'string' ? step.half : null;
  const argv = Array.isArray(step?.argv) ? step.argv.map((x) => String(x)) : null;

  if (half === null) {
    unknowns.push(`${where}: a step with no "half" — the record does not say which tool it describes, so its argv cannot be judged against anything`);
    return { problems, unknowns, note: 'half missing' };
  }

  if (argv === null) {
    // Two DECLARED absences, and nothing else.
    if (typeof step.skipped === 'string' && step.skipped.trim() !== '') return { problems, unknowns, note: `${half}: not launched (skipped: ${step.skipped})` };
    if (step.launched === false) return { problems, unknowns, note: `${half}: not launched (${String(step.reason ?? 'no reason recorded')})` };
    unknowns.push(
      `${where}: the ${half} step records no argv and declares neither "skipped" nor "launched": false — the record says a tool ran and does not say how, so the flags that make its artifact mean anything cannot be read back`,
    );
    return { problems, unknowns, note: `${half}: argv missing` };
  }

  // The record's own word, checked against what it spawned.
  const program = PROGRAM_OF_HALF[half] ?? null;
  const bin = (argv[0] ?? '').split('/').pop() ?? '';
  if (program === null) unknowns.push(`${where}: half ${JSON.stringify(half)} is not one of ${Object.keys(PROGRAM_OF_HALF).join(', ')} — no flag requirement is declared for it, so its argv is unjudged`);
  else if (!bin.startsWith(program))
    problems.push(
      `${where}: the step says half="${half}" and its argv[0] is ${JSON.stringify(argv[0])} (program ${JSON.stringify(bin)}, expected ${JSON.stringify(program)}) — a record that names one tool over another tool's argv describes a run that did not happen`,
    );

  for (const req of REQUIRED_FLAGS[half] ?? []) {
    if (!argv.some((a) => req.re.test(a)))
      problems.push(`${where}: the ${half} argv does not carry ${req.flag} — ${req.why}. Cure: the wrapper that writes this argv is tools/gates/run.mjs; the flag belongs there, not at a call site`);
  }

  // The mixed --outputFile form: measured to crash vitest 5.0.5 before any test
  // runs, writing NOTHING. A run recorded with it produced no artifact at all.
  if (half === 'vitest') {
    const bare = argv.filter((a) => a.startsWith('--outputFile='));
    const dotted = argv.filter((a) => /^--outputFile\.[A-Za-z0-9_-]+=/.test(a));
    if (bare.length > 0 && dotted.length > 0)
      problems.push(
        `${where}: the vitest argv mixes ${list(bare)} with ${list(dotted)} — BOTH --outputFile keys must be dotted; the mixed form crashes vitest before any test runs and writes no artifact at all (measured), so a run recorded this way has nothing to be read from`,
      );
  }

  for (const o of outputPaths(argv)) {
    const rel = isAbsolute(o.path) ? relPosix(root, o.path) : normRel(o.path);
    if (rel === null || rel === '' || rel.startsWith('..')) {
      problems.push(`${where}: the ${half} argv sends ${o.token} outside this repository — a run of record writes only into its own run directory (${dirRel}/)`);
      continue;
    }
    if (!under(rel, dirRel))
      problems.push(
        `${where}: the ${half} argv sends ${o.token} to ${rel}, which is not inside ${dirRel}/ — a run of record writes only into its own run directory, or two runs' artifacts share a path and neither has an owner`,
      );
  }

  return { problems, unknowns, note: `${half}: ${String(argv.length)} argv token(s), exit ${String(step.exitCode ?? 'not recorded')}` };
}

/** Judge ONE run directory. → { problems, unknowns, notes } */
export function judgeRun(root, name) {
  const dirRel = `${RUNS_ROOT}/${name}`;
  const abs = join(root, dirRel);
  const problems = [];
  const unknowns = [];
  const notes = [];

  const shape = RUN_DIR_RE.exec(name);
  if (shape === null)
    problems.push(
      `${dirRel}: the directory name is not <stamp>-<label> (${STAMP_RE.source} then [a-z0-9][a-z0-9-]*) — a fixed name is a REUSED run directory by construction: the next run of the same lane overwrites these artifacts and the reader cannot tell which run it is reading. Cure: let makeRunDir() in tools/gates/lib/run-dir.mjs name it, and delete this directory`,
    );

  const read = readRunJson(abs);
  if (!read.ok) {
    problems.push(
      `${dirRel}: no readable run.json (${String(read.reason)}) — a directory of artifacts with no record of which commit, which argv and which exit code produced them cannot be cited as evidence. Cure: delete it, or re-run the lane through tools/gates/run.mjs, which writes it`,
    );
    return { problems, unknowns, notes };
  }

  const data = read.data ?? {};
  const missing = RUN_JSON_REQUIRED.filter((k) => !Object.hasOwn(data, k));
  if (missing.length)
    problems.push(
      `${runJsonPath(dirRel)}: missing required field(s) ${missing.join(', ')} — RUN_JSON_REQUIRED in tools/gates/lib/run-dir.mjs is the list, and a run with no ${missing[0]} cannot be cited`,
    );

  // `head` is checked for SHAPE, never for reachability: a run made on a commit
  // that was later rebased away is still a truthful record of that run. `null`
  // is the legitimate value for "the repository had no commit".
  if (Object.hasOwn(data, 'head') && data.head !== null && !SHA_RE.test(String(data.head)))
    problems.push(`${runJsonPath(dirRel)}: head=${JSON.stringify(data.head)} is neither null nor a 40-character sha — the commit a run cites has to be nameable`);
  if (Object.hasOwn(data, 'treeClean') && typeof data.treeClean !== 'boolean')
    problems.push(`${runJsonPath(dirRel)}: treeClean=${JSON.stringify(data.treeClean)} is not a boolean — "was the tracked tree clean" has two answers and neither of them is a string`);
  if (Object.hasOwn(data, 'exitCode') && data.exitCode !== null && !Number.isInteger(data.exitCode))
    problems.push(`${runJsonPath(dirRel)}: exitCode=${JSON.stringify(data.exitCode)} is neither null (the tool never spawned) nor an integer`);
  if (Object.hasOwn(data, 'argv') && !Array.isArray(data.argv))
    problems.push(`${runJsonPath(dirRel)}: argv=${JSON.stringify(data.argv)} is not an array — it is the wrapper's own process.argv.slice(2), and the judged tools' argvs are in steps[]`);

  const steps = Array.isArray(data.steps) ? data.steps : null;

  // A GATE's own record is not a run of record. spec-gate and test-guard write
  // `run.json` to say which commit and range they judged; they spawn no runner,
  // so there is no argv of a judged tool to read back and `steps` is rightly
  // absent. The shared contract agrees: RUN_JSON_REQUIRED in ../lib/run-dir.mjs
  // is head/treeClean/argv/exitCode/startedAt/kind and does NOT include
  // `steps`. Demanding it of a gate directory made this light stricter than the
  // contract it enforces, which is the one way a light can be wrong while
  // looking rigorous — it turned a compliant record into CANNOT VERIFY and
  // blocked the pack. A gate record identifies itself with `gate`.
  const isGateRecord = typeof data.gate === 'string' && data.gate.length > 0;
  if (isGateRecord && steps === null) {
    notes.push(
      `${runJsonPath(dirRel)}: the record of gate "${data.gate}", not a run of record — it spawned no judged tool, so it carries no "steps" and none is required (RUN_JSON_REQUIRED, ../lib/run-dir.mjs)`,
    );
  } else if (steps === null) {
    unknowns.push(
      `${runJsonPath(dirRel)}: no "steps" array — the judged tools' argvs live there (tools/gates/run.mjs:893), and without them --passWithNoTests=false, --retry=0 and --type-aware cannot be read back out of this run`,
    );
  } else if (steps.length === 0) {
    unknowns.push(`${runJsonPath(dirRel)}: "steps" is empty — this run recorded no tool at all, so there is no argv to judge`);
  } else {
    steps.forEach((step, i) => {
      const r = judgeStep(root, dirRel, step, `${runJsonPath(dirRel)} steps[${String(i)}]`);
      problems.push(...r.problems);
      unknowns.push(...r.unknowns);
      notes.push(r.note);
    });
  }

  return { problems, unknowns, notes };
}

/**
 * A committed writer that NAMES a fixed `.ci/runs/<name>` path. → [{ where, path }]
 *
 * The literal is read from `scanSource`'s literals map, so a path in a comment
 * or inside a `${…}` substitution is not a declaration. A path whose segment
 * after `runs/` matches the stamp form is a run directory and is fine; anything
 * else is a fixed directory, which is the reuse defect one step before it
 * becomes a directory on disk.
 */
export function fixedRunPaths(root) {
  const found = [];
  const problems = [];

  const files = [...WRITER_FILES];
  const collect = (rel) => {
    const abs = join(root, rel);
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch (e) {
      problems.push(`${rel}: unreadable directory: ${String(e.message)}`);
      return;
    }
    for (const d of entries.toSorted((a, b) => (a.name < b.name ? -1 : 1))) {
      const child = `${rel}/${d.name}`;
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) {
        collect(child);
        continue;
      }
      if (WRITER_EXTS.some((e) => child.endsWith(e))) files.push(child);
    }
  };
  for (const r of WRITER_ROOTS) if (existsSync(join(root, r))) collect(r);

  for (const rel of files) {
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch (e) {
      problems.push(`${rel}: unreadable (${String(e.message)}) — a writer a gate cannot read is never clean`);
      continue;
    }
    let scan;
    try {
      scan = scanSource(text);
    } catch (e) {
      problems.push(`${rel}: could not be masked (${String(e.message)}) — no path:line below it would be trustworthy`);
      continue;
    }
    problems.push(...scan.problems.map((p) => `${rel}: ${p}`));
    for (const [start, lit] of scan.literals.entries()) {
      if (lit.isLiteral !== true) continue;
      const v = normRel(lit.value);
      if (v === null || !under(v, RUNS_ROOT) || v === RUNS_ROOT) continue;
      const segment = v.slice(RUNS_ROOT.length + 1).split('/')[0];
      if (RUN_DIR_RE.test(segment)) continue;
      found.push({ where: `${rel}:${String(lineOf(text, start))}`, path: v, segment });
    }
  }
  return { found, problems };
}

export function run(ctx = {}) {
  const root = ctx.root ?? process.cwd();

  if (MIRROR_PROBLEM !== null) return { id, severity, status: 'cannot-verify', detail: MIRROR_PROBLEM };

  const runs = listRuns(root);
  const fixed = fixedRunPaths(root);

  const problems = [];
  const unknowns = [...runs.problems, ...fixed.problems];
  const notes = [];

  for (const f of fixed.found)
    problems.push(
      `${f.where}: declares the FIXED run path ${f.path} — ${RUNS_ROOT}/${f.segment} is one directory every run of that lane overwrites, so the artifacts in it belong to no run and carry no run.json. Cure: take the directory from makeRunDir() in tools/gates/lib/run-dir.mjs, or redirect the reporter per run (the e2e lane does it with PLAYWRIGHT_JUNIT_OUTPUT_NAME, tools/gates/run.mjs:1124)`,
    );

  for (const s of runs.strays)
    problems.push(`${RUNS_ROOT}/${s}: not a directory — ${RUNS_ROOT} holds one directory per run and nothing else; an artifact loose beside them belongs to no run`);

  for (const name of runs.dirs) {
    const r = judgeRun(root, name);
    problems.push(...r.problems);
    unknowns.push(...r.unknowns);
    notes.push(`${RUNS_ROOT}/${name}: ${r.notes.join('; ') || 'no step judged'}`);
  }

  // An absent or empty `.ci/runs` is a PASS, and the detail says what it means:
  // nothing has been run of record here, so there is no record to be
  // uncitable. That is different from a run directory that exists and carries no
  // run.json, which is a fail above.
  if (!runs.exists || (runs.dirs.length === 0 && runs.strays.length === 0)) {
    const head = `no run directory yet (${runs.exists ? `${RUNS_ROOT} exists and is empty` : `${RUNS_ROOT} does not exist`}) — nothing has been run of record in this worktree, so there is no record that could fail to be citable; this light starts judging with the first run`;
    const status = problems.length > 0 ? 'fail' : unknowns.length > 0 ? 'cannot-verify' : 'pass';
    return { id, severity, status, detail: [head, ...problems, ...unknowns].join(' · ') };
  }

  const head =
    `${String(runs.dirs.length)} run directory(ies) under ${RUNS_ROOT}: ${list(runs.dirs)}` +
    `; required run.json field(s) ${RUN_JSON_REQUIRED.join('/')}` +
    `; argv flags asserted: ${Object.entries(REQUIRED_FLAGS)
      .filter(([, v]) => v.length > 0)
      .map(([h, v]) => `${h} ${v.map((x) => x.flag).join(' ')}`)
      .join(', ')}`;

  const status = problems.length > 0 ? 'fail' : unknowns.length > 0 ? 'cannot-verify' : 'pass';
  return { id, severity, status, detail: [head, ...problems, ...unknowns, ...notes].join(' · ') };
}

// ------------------------------------------------------------------------- cli

/**
 * `node tools/gates/lights/artifacts.mjs` — the command a spec's `## Lights` row
 * cites (docs/templates/SPEC.md). It prints the same row the pack prints and
 * applies the pack's own rule: a HARD light that is not `pass` exits 1. A
 * refusal is a sentence naming the cure, never a stack trace.
 *
 * There is no "no commits yet" refusal here: `.ci/` is gitignored machine state
 * and nothing in this light reads HEAD, so a repository with no commit is judged
 * exactly as one with a thousand.
 */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rr = repoRoot();
  if (!rr.ok) {
    console.error(`[${id}] REFUSED: not a git work tree (${rr.reason}) — ${RUNS_ROOT} and the committed writers are both addressed from the repository root.`);
    process.exit(1);
  }
  let returned;
  try {
    returned = run({ root: rr.root, mb: null, rangeKind: null, allow: [], mode: 'all', thin: false, premises: readPremises(rr.root), base: 'main', tolerate: false });
  } catch (e) {
    returned = { status: 'cannot-verify', detail: `threw: ${String(e?.message ?? e).split('\n')[0]}` };
  }
  const row = normalizeResult({ id, severity }, returned);
  console.log('| id | severity | status | detail |');
  console.log(`| ${row.id} | ${row.severity} | ${row.status === 'cannot-verify' ? 'CANNOT VERIFY' : row.status} | ${row.detail.replaceAll('|', '¦')} |`);
  process.exit(row.severity === 'hard' && row.status !== 'pass' ? 1 : 0);
}
