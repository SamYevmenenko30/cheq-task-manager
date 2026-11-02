/**
 * L-env-parity — the SAME test files under node and under jsdom must say the
 * same thing, case by case.
 *
 * Zero dependencies, Node 22 ESM. `@cheq/core` is engine-free by rule and ships
 * to the browser through `apps/web`, so "it passes" is a claim about two
 * environments. The pair of Jest projects that runs one include in two
 * environments is the one honest parity lane this repository has
 * (jest.config.mjs:94, `../lib/test-project.mjs` PROJECTS), and this light is
 * the only thing that reads both artifacts and compares them.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE BAND IS DERIVED, NOT NAMED
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Nothing below says `core` or `core-dom`. The band is computed from the
 * project table: the projects that share a `dir` and an `extensions` list, in
 * DIFFERENT environments. So a third environment added to the same files joins
 * the comparison by itself, and a rename does not leave this light comparing a
 * project with itself. Two guards come with that:
 *
 *   - fewer than two projects on the include ⇒ cannot-verify, naming the one
 *     project that runs it. There is no parity to check and a pass would be a
 *     claim about a comparison that never happened;
 *   - two projects whose `environment` is the SAME string ⇒ cannot-verify. That
 *     is the quiet way this lane dies: the pair keeps running, every case keeps
 *     agreeing, and the row goes green while testing one environment twice.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * A STALE ARTIFACT IS RE-RUN, NEVER COMPARED (AND THE KEY IS CONTENT, NOT mtime)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `node=green dom=absent` is not a disagreement about code — it is one run
 * older than the other. An artifact older than any source under the package is
 * therefore not read: both projects are RE-RUN, which is also why this light
 * declares the `jest` premise rather than hoping somebody else ran the lane.
 *
 * The freshness key is CONTENT in two halves, and never mtime. The reason for
 * "never mtime" is mechanical: `git checkout` and a restored build cache both
 * rewrite mtime to "now", so an mtime key calls a tree that changed fresh and a
 * tree that did not changed.
 *
 *   half 1  `git ls-files -s <package>` — mode, blob sha, stage, path per
 *           tracked file (`../lib/git.mjs` lsFilesStaged). A blob sha changes
 *           when the content does and at no other time.
 *   half 2  for every path under the package that git reports as modified,
 *           added or UNTRACKED, the sha256 of its bytes on disk.
 *
 * Half 2 is an addition to the key the port plan names, and it closes a hole
 * that half alone would leave wide open: `git ls-files -s` reports the INDEX, so
 * an edit nobody staged does not move it — and the runner runs the WORK TREE. With
 * half 1 alone, editing a source and re-running the lights would compare the
 * artifacts of the tree BEFORE the edit while reporting them as fresh, which is
 * precisely the "an artifact older than its sources" failure this light exists
 * to refuse. A dirty work tree is the normal state of a development session, so
 * that is not an edge case. Both halves are content; neither is a timestamp.
 *
 * It also answers the degenerate state this repository is in right now. Before
 * the first `git add` half 1 is EMPTY, and the sha256 of an empty listing is a
 * constant that would call every tree fresh forever; half 2 still hashes every
 * file under the package, because untracked is exactly what they all are. If
 * BOTH halves come back empty there is nothing under the package at all, and
 * `projectState` has already answered `n/a` before the key is reached.
 *
 * When either half cannot be read, no key is stored, the band is re-run
 * unconditionally and the row is cannot-verify even on agreement: "I compared
 * something" is not "I can tell whether what I compared was current".
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY IT WRITES ITS OWN ARTIFACTS INSTEAD OF READING `.ci/tests/`
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * The measured lane leaves reports in `.ci/tests/<project>.junit.xml`, and this
 * light does not read them. A file somebody else wrote carries no statement of
 * WHICH tree it was produced from, and this light's whole subject is whether two
 * runs describe the same tree. Its own artifacts are deleted before the run and
 * the key is written AFTER both runs complete, so a key that exists can only
 * mean "both runs of this tree finished" — the same closure `./testguard.mjs`
 * gets by deleting a summary before spawning the gate that writes it.
 *
 * Neither path is a run of record: `.ci/runs/<ts>-<label>/` is that, it is never
 * reused, and `L-artifacts` owns it.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE MEASURED COMMAND FORM, AND THE ONE FLAG SHAPE THAT SILENTLY WRITES NOTHING
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *     jest --selectProjects <p> --ci --runInBand --json --outputFile=<json>
 *       --outputFile.junit=<xml> --outputFile.json=<json>
 *       --retry=0 --no-file-parallelism --passWithNoTests=false
 *
 * MEASURED 2026-11-01: `outputFile` inside a `projects` entry is IGNORED (the
 * reporter writes `junit.xml` into the cwd), so each run's artifact path is given to the
 * command line; and the two `--outputFile` flags must BOTH be the dotted form —
 * mixing the plain `--outputFile=` with `--outputFile.json=` makes the run fail
 * and write nothing at all. `--retry=0` because a flaky pass is not parity, and
 * `--passWithNoTests=false` because an empty run must be loud.
 *
 * Both channels are read (`../lib/junit-xml.mjs` and `../lib/jest-json.mjs`)
 * and reconciled with `crossCheck` before anything is compared: two channels
 * about one run that do not agree mean neither may be quoted. The exit code is
 * captured separately by `sh()` and stays advisory — there is no pipe in this
 * file, which is how two runs in the session that designed these gates reported
 * `exit=0` over a crashed linter and over four TS6059.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THIS LIGHT HAS NEVER SEEN A DISAGREEMENT (TD-0006), AND STAYS HARD
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Measured: both projects run the same 17 cases and not one has ever differed.
 * So the light currently has no OBSERVED signal, which is recorded as debt and
 * is not an argument for making it soft — a boundary light with no signal is a
 * boundary that has not been crossed yet, and the day it is crossed is the day
 * the light is worth having. What the absence does require is a planted
 * disagreement in `gate-probes`: a case that passes under node and fails under
 * jsdom, which must turn this row red.
 *
 * On a pass the detail says how many cases were compared, so a run that compared
 * nothing cannot read like a run that compared everything.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { git, lsFilesStaged } from '../lib/git.mjs';
import { isCollectionFailure, readJUnit, redReason, toTri } from '../lib/junit-xml.mjs';
import { sha256 } from '../lib/probe.mjs';
import { KIND_ROOT } from '../lib/test-file-patterns.mjs';
import { PROJECTS, PROJECT_NAMES, projectState } from '../lib/test-project.mjs';
import { crossCheck, readJestJson } from '../lib/jest-json.mjs';
import { requirePremise, sh } from './_shared.mjs';

export const id = 'L-env-parity';
export const severity = 'hard';

/** Without the runner this light cannot re-run a stale pair, and a stale pair is
 * the one thing it must never compare — so the premise is DECLARED and `run.mjs`
 * refuses the row by that premise's own name. */
export const premises = ['jest'];

/**
 * Declared so the pack ORDERS this light after the compile verdict: a parity
 * diff over a tree that does not typecheck describes two broken runs. It is also
 * the channel the one pending-implementation tolerance travels along
 * (`./run.mjs`), which on today's modes never fires here — `--all` ignores the
 * flag — and `run.mjs` says so under the table rather than leaving it implied.
 */
export const dependsOn = ['L-tsc'];

/** Where this light writes the two runs it then reads. Fixed, emptied first,
 * and never evidence of a run of record (see the header). */
export const ARTIFACT_DIR = '.ci/lights';

export const artifactRel = (project, ext) => `${ARTIFACT_DIR}/env-parity.${project}.${ext}`;

/** The stored freshness key. Written only after every run of the band finished. */
export const KEY_REL = `${ARTIFACT_DIR}/env-parity.key.json`;

const sortStr = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

/** A case's identity across the two runs: the file AND the name. Comparing the
 * name alone would merge two files' identically titled cases into one row and
 * then report a disagreement between two different tests. */
const keyOf = (c) => `${c.classname} > ${c.name}`;

/**
 * The parity band: the projects that run ONE include in more than one
 * environment. → { ok, reason, band } with `band = { dir, extensions, projects }`.
 */
export function parityBand() {
  const groups = new Map();
  for (const name of PROJECT_NAMES) {
    const cfg = PROJECTS[name];
    if (cfg.runner !== 'jest') continue;
    const key = `${cfg.dir}|${[...cfg.extensions].toSorted(sortStr).join(',')}`;
    if (!groups.has(key)) groups.set(key, { dir: cfg.dir, extensions: cfg.extensions, projects: [] });
    groups.get(key).projects.push(name);
  }
  const bands = [...groups.values()].filter((b) => b.projects.length > 1);
  if (bands.length === 0) {
    const single = [...groups.values()].map((b) => `${b.projects[0]} alone runs ${b.dir}`).join('; ');
    return {
      ok: false,
      reason: `no project in tools/gates/lib/test-project.mjs shares an include with another (${single}) — there is no parity band, and a row that compared nothing is not a pass`,
      band: null,
    };
  }
  if (bands.length > 1)
    return {
      ok: false,
      reason: `${bands.length} parity bands exist (${bands.map((b) => `${b.projects.join('+')} on ${b.dir}`).join('; ')}) — this light compares ONE, so say which in the project table before it judges either`,
      band: null,
    };
  const band = bands[0];
  const envs = band.projects.map((p) => PROJECTS[p].environment);
  if (new Set(envs).size !== band.projects.length)
    return {
      ok: false,
      reason:
        `the band ${band.projects.join('+')} runs ${band.dir} in environments ${envs.join(', ')} — two projects in the SAME environment agree about nothing, ` +
        'and this row would go green while testing one environment twice',
      band: null,
    };
  return { ok: true, reason: null, band };
}

/**
 * The two-halved content key for one directory. → { ok, reason, key, tracked, dirty }
 *
 * `git status --porcelain --untracked-files=all` is asked through the raw `git`
 * runner of `../lib/git.mjs` rather than through its `statusPorcelain`, which
 * pins `--untracked-files=no` — and an untracked file is the half of the dirty
 * set that matters most here, because a test file nobody staged yet is still a
 * test file the runner runs.
 *
 * A path git reports is hashed from DISK. A deleted one hashes to the word
 * `absent`, so a deletion moves the key as surely as an edit does.
 */
export function contentKey(root, dirRel) {
  const listing = lsFilesStaged([dirRel], { cwd: root });
  if (!listing.ok) return { ok: false, reason: `git ls-files -s ${dirRel} failed (${listing.reason})`, key: null, tracked: 0, dirty: 0 };

  const st = git(['status', '--porcelain', '--untracked-files=all', '--', dirRel], { cwd: root });
  if (st.code !== 0)
    return {
      ok: false,
      reason: `git status --porcelain --untracked-files=all -- ${dirRel} exited ${st.code} (${st.stderr.split('\n')[0] || 'no message'}), so an unstaged edit could not be seen`,
      key: null,
      tracked: listing.entries.length,
      dirty: 0,
    };

  const dirty = [];
  for (const line of st.stdout.split('\n')) {
    if (line.trim() === '') continue;
    // `XY <path>`, and `XY <old> -> <new>` for a rename; the destination is the
    // path that exists on disk, which is the one with content to hash.
    const path = line.slice(3).split(' -> ').at(-1).replace(/^"(.*)"$/, '$1');
    const abs = join(root, path);
    let digest = 'absent';
    if (existsSync(abs)) {
      try {
        digest = sha256(readFileSync(abs, 'utf8'));
      } catch (e) {
        return { ok: false, reason: `${path} is reported as changed and cannot be read (${String(e.message)}), so the key would describe a tree this light did not see`, key: null, tracked: listing.entries.length, dirty: 0 };
      }
    }
    dirty.push(`${path} ${digest}`);
  }

  if (listing.entries.length === 0 && dirty.length === 0)
    return { ok: false, reason: `neither git nor the filesystem reports any file under ${dirRel}, so there is no content to key on`, key: null, tracked: 0, dirty: 0 };

  return { ok: true, reason: null, key: sha256(`${listing.raw}\n--\n${dirty.toSorted(sortStr).join('\n')}`), tracked: listing.entries.length, dirty: dirty.length };
}

// The `premises` property is the probe `run.mjs` hands every light; the binding
// is renamed so it does not shadow this module's own `premises` declaration.
export function run({ root = process.cwd(), premises: premiseProbe = null } = {}) {
  const prem = requirePremise(premiseProbe, 'jest');
  if (!prem.ok) return { id, severity, status: 'cannot-verify', detail: prem.reason };

  const found = parityBand();
  if (!found.ok) return { id, severity, status: 'cannot-verify', detail: found.reason };
  const { band } = found;
  const envOf = Object.fromEntries(band.projects.map((p) => [p, PROJECTS[p].environment]));
  const label = band.projects.map((p) => `${p} (${envOf[p]})`).join(' vs ');

  // --------------------------------------------- is there anything to compare
  const states = Object.fromEntries(band.projects.map((p) => [p, projectState({ root, project: p })]));
  for (const p of band.projects) {
    const st = states[p];
    if (st.state === 'n/a')
      return {
        id,
        severity,
        status: 'cannot-verify',
        detail: `${p}: no it( or test( call site under ${st.dir} — not launched and not green (rule 3), so the ${label} comparison has no subject`,
      };
    if (st.unclassified.length > 0)
      return {
        id,
        severity,
        status: 'cannot-verify',
        detail: `${st.unclassified.length} file(s) under ${st.dir} match no declared form (${st.unclassified[0].path}: ${st.unclassified[0].reason}) — the band's file set is not known`,
      };
  }

  // ------------------------------------------------------- the freshness key
  const pkgRel = KIND_ROOT[PROJECTS[band.projects[0]].kind] ?? band.dir;
  const keyNotes = [];
  const key = contentKey(root, pkgRel);
  const currentKey = key.ok ? key.key : null;
  if (!key.ok) keyNotes.push(`${key.reason} — the band is re-run unconditionally, no key is stored, and nothing may be called fresh`);
  else keyNotes.push(`content key over ${key.tracked} tracked and ${key.dirty} uncommitted path(s) under ${pkgRel}`);

  // ---------------------------------------------------------- fresh or re-run
  const keyAbs = join(root, KEY_REL);
  const artifacts = Object.fromEntries(band.projects.map((p) => [p, { xml: join(root, artifactRel(p, 'junit.xml')), json: join(root, artifactRel(p, 'json')) }]));

  let stored = null;
  if (currentKey !== null && existsSync(keyAbs)) {
    try {
      stored = JSON.parse(readFileSync(keyAbs, 'utf8'));
    } catch (e) {
      keyNotes.push(`${KEY_REL} is unreadable or not JSON (${String(e.message)}) — treated as absent, so the band is re-run`);
      stored = null;
    }
  }
  const everyArtifact = band.projects.every((p) => existsSync(artifacts[p].xml) && existsSync(artifacts[p].json));
  const sameProjects = Array.isArray(stored?.projects) && stored.projects.join(',') === band.projects.join(',');
  const fresh = currentKey !== null && stored?.key === currentKey && sameProjects && everyArtifact;

  const runNotes = [];
  if (fresh) {
    runNotes.push(`${KEY_REL} matches the content of ${pkgRel}, so the stored pair describes this tree and was not re-run`);
  } else {
    let why = 'an artifact is missing';
    if (currentKey === null) why = 'no usable content key';
    else if (stored === null) why = `no ${KEY_REL}`;
    else if (stored.key !== currentKey) why = `the content of ${pkgRel} changed since the stored key`;
    else if (!sameProjects) why = `the band changed (stored: ${Array.isArray(stored.projects) ? stored.projects.join('+') : 'unreadable'})`;
    runNotes.push(`re-run (${why}) — an artifact older than its sources is re-run, never compared`);
    try {
      mkdirSync(join(root, ARTIFACT_DIR), { recursive: true });
      rmSync(keyAbs, { force: true });
      for (const p of band.projects) {
        rmSync(artifacts[p].xml, { force: true });
        rmSync(artifacts[p].json, { force: true });
      }
    } catch (e) {
      return { id, severity, status: 'cannot-verify', detail: `cannot clear ${ARTIFACT_DIR}/env-parity.* (${String(e.message)}) — a pair left from an earlier tree would be read as this one's` };
    }

    const ran = {};
    for (const p of band.projects) {
      // The same two channels as the run of record, built the same way — except
      // that with Jest the JUnit path is NOT a flag: jest-junit takes it from
      // JEST_JUNIT_OUTPUT_FILE, so half of the artefact contract travels in the
      // environment. NODE_OPTIONS is required for ESM; without it every test file
      // dies with "Cannot use import statement outside a module", which would read
      // here as a runtime difference between node and jsdom and is nothing of the
      // kind. --ci replaces --retry=0 (Jest does not retry unasked) and
      // --runInBand replaces --no-file-parallelism; --passWithNoTests is NOT
      // passed because Jest already exits non-zero when nothing matched.
      const r = sh(
        prem.premise.path,
        ['--selectProjects', p, '--ci', '--runInBand', '--json', `--outputFile=${artifacts[p].json}`],
        {
          cwd: root,
          env: { JEST_JUNIT_OUTPUT_FILE: artifacts[p].xml, NODE_OPTIONS: '--experimental-vm-modules' },
        },
      );
      if (r.code === null) return { id, severity, status: 'cannot-verify', detail: `could not run ${prem.premise.rel} for project ${p}: ${r.spawnError ?? 'spawn failed'} (${r.argv.join(' ')})` };
      const absent = [
        ['junit.xml', artifacts[p].xml],
        ['json', artifacts[p].json],
      ]
        .filter(([, abs]) => !existsSync(abs))
        .map(([ext]) => artifactRel(p, ext));
      if (absent.length > 0)
        return {
          id,
          severity,
          status: 'cannot-verify',
          detail:
            `project ${p} exited ${r.code} and wrote no ${absent.join(' and no ')}: ` +
            `${(r.stderr || r.stdout).split('\n').find((l) => l.trim() !== '') ?? 'it printed nothing'} — ` +
            'both --outputFile flags must be the dotted form; the mixed form makes the run write nothing at all, and no artifact is never green',
        };
      ran[p] = { argv: r.argv, exitCode: r.code };
      runNotes.push(`${p} exited ${r.code} (advisory — the verdict is the artifact)`);
    }
    if (currentKey !== null) {
      // Written LAST, so a key that exists means every run of this tree finished.
      try {
        writeFileSync(keyAbs, `${JSON.stringify({ key: currentKey, package: pkgRel, projects: band.projects, runs: ran }, null, 2)}\n`, 'utf8');
      } catch (e) {
        keyNotes.push(`${KEY_REL} could not be written (${String(e.message)}) — the next run re-runs the band, which costs nothing but the run`);
      }
    }
  }

  // ------------------------------------------------------- read both channels
  const reads = {};
  for (const p of band.projects) {
    const junit = readJUnit(artifacts[p].xml);
    if (!junit.ok) return { id, severity, status: 'cannot-verify', detail: `${p} (${envOf[p]}): ${junit.reason} · ${runNotes.join(' · ')}` };
    const json = readJestJson(artifacts[p].json);
    const cross = crossCheck(junit, json);
    if (!cross.ok)
      return {
        id,
        severity,
        status: 'cannot-verify',
        detail:
          `${p} (${envOf[p]}): the two channels of one run do not reconcile — ${cross.reasons.join('; ')} ` +
          `(${artifactRel(p, 'junit.xml')}, ${artifactRel(p, 'json')}) — neither may be quoted, so nothing was compared`,
      };
    reads[p] = junit;
  }

  // ------------------------------------------------------------- the diff
  const problems = [];
  const notes = [...keyNotes, ...runNotes];

  // A file that never LOADED in one environment and did in the other is the
  // sharpest form this light exists to catch, and the tri-state diff alone would
  // report it as "a case is missing on one side" — true, and unactionable.
  //
  // A file that failed to collect in EVERY environment is the opposite: that is
  // the state between the test phase and the implementation phase (the import is
  // of a module nobody has written), both runs agree about it, and there is
  // nothing to compare. It is cannot-verify for that file and never a
  // disagreement — a parity light that failed on it would be reporting the
  // absence of an implementation as an environment difference.
  const failedToCollect = new Map();
  for (const p of band.projects)
    for (const c of reads[p].collectionFailures) {
      if (!failedToCollect.has(c.classname)) failedToCollect.set(c.classname, new Map());
      failedToCollect.get(c.classname).set(p, c);
    }
  const neverLoaded = [];
  for (const [file, byProject] of failedToCollect) {
    const where = [...byProject.keys()];
    const reason = redReason(byProject.get(where[0]).failure);
    if (where.length === band.projects.length) {
      neverLoaded.push(`${file} never loaded in EITHER environment (${reason.type}: ${reason.message} [${reason.reason}]) — both runs agree it did not run, so it is compared nowhere`);
      continue;
    }
    const ran = band.projects.filter((q) => !byProject.has(q));
    problems.push(
      `${file}: never loaded under ${where.map((p) => `${p} (${envOf[p]})`).join(', ')}: ${reason.type}: ${reason.message} [${reason.reason}] — while ` +
        `${ran.map((q) => `${q} (${envOf[q]}) ran ${reads[q].cases.filter((x) => x.classname === file && !isCollectionFailure(x)).length} case(s) of it`).join(', ')}. ` +
        'A module that collects in one environment and not the other is the parity defect itself',
    );
  }

  const tris = Object.fromEntries(
    band.projects.map((p) => [p, new Map(reads[p].cases.filter((c) => !isCollectionFailure(c)).map((c) => [keyOf(c), { tri: toTri(c), case: c }]))]),
  );
  const allKeys = [...new Set(band.projects.flatMap((p) => [...tris[p].keys()]))].toSorted(sortStr);

  let compared = 0;
  let inert = 0;
  for (const k of allKeys) {
    const seen = band.projects.filter((p) => tris[p].has(k));
    if (seen.length !== band.projects.length) {
      const missing = band.projects.filter((p) => !tris[p].has(k));
      problems.push(
        `${k}: present under ${seen.map((p) => `${p} (${envOf[p]})`).join(', ')} and ABSENT under ${missing.map((p) => `${p} (${envOf[p]})`).join(', ')} — ` +
          'the band runs one include, so a case that exists in one run and not the other is a case the environment decided to skip or never collected',
      );
      continue;
    }
    const verdicts = band.projects.map((p) => ({ p, tri: tris[p].get(k).tri }));
    if (new Set(verdicts.map((v) => v.tri)).size > 1) {
      problems.push(
        `${k}: ${verdicts.map((v) => `${v.p} (${envOf[v.p]})=${v.tri}`).join(' vs ')} — ` +
          `${verdicts
            .filter((v) => v.tri === 'red')
            .map((v) => {
              const r = redReason(tris[v.p].get(k).case.failure);
              return `under ${envOf[v.p]}: ${r.type}: ${r.message}`;
            })
            .join('; ')}`,
      );
      continue;
    }
    compared += 1;
    if (verdicts[0].tri !== 'green' && verdicts[0].tri !== 'red') inert += 1;
  }

  if (compared > 0 && inert === compared)
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail:
        `all ${compared} case(s) of ${label} are ${[...new Set(band.projects.flatMap((p) => [...tris[p].values()].map((v) => v.tri)))].join('/')} in BOTH environments — ` +
        `agreeing about nothing is not parity (a .skip or .todo executes in neither) · ${notes.join(' · ')}`,
    };

  const counts = band.projects.map((p) => `${p} (${envOf[p]}) ${reads[p].totals.tests} case(s)`).join(', ');

  if (problems.length > 0)
    return {
      id,
      severity,
      status: 'fail',
      detail: `${problems.length} disagreement(s) between ${label}: ${problems.join(' · ')} [${counts} · ${compared} case(s) agreed · ${[...neverLoaded, ...notes].join(' · ')}]`,
    };

  if (neverLoaded.length > 0)
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail:
        `${neverLoaded.join(' · ')} — ${compared} other case(s) of ${label} agree, and a file compared in neither environment is not a file this row covers ` +
        `(${counts} · ${notes.join(' · ')})`,
    };

  if (currentKey === null)
    return {
      id,
      severity,
      status: 'cannot-verify',
      detail: `${compared} case(s) of ${label} agree case by case (${counts})${inert > 0 ? `, ${inert} of them executing in neither environment` : ''}, but ${keyNotes.join('; ')}`,
    };

  return {
    id,
    severity,
    status: 'pass',
    detail:
      `${compared} case(s) compared by name under ${label} and every verdict agrees (${counts})` +
      `${inert > 0 ? `; ${inert} case(s) executed in neither environment and prove nothing` : ''} · ${notes.join(' · ')}`,
  };
}
