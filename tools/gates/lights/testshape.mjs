/**
 * L-testshape — the SHAPE of a test file, judged from the sources, plus one
 * cross-check against the run artifact when a run has left one.
 *
 * Zero dependencies, Node 22 ESM. Nothing here parses TypeScript: every
 * source-level answer is either `classify()` from `../lib/test-file-patterns.mjs`
 * (the one classifier of a path) or a token scan over masked text from
 * `../lib/test-cases.mjs` (the one enumerator of cases). This module owns no
 * second opinion about either.
 *
 * WHY A SHAPE LIGHT AT ALL. `../lib/test-cases.mjs` enumerates cases by scanning
 * tokens, and its header names the one hole it cannot close: a plain alias
 * (`const t = it;`) makes every case called through it invisible, which is an
 * UNDERCOUNT — the single direction a gate must never fail in. That hole is
 * closed here, by requiring the declared call heads in a test file rather than
 * by making the enumerator cleverer. The same reasoning covers `.only` (a run
 * that silently executed a subset still reports `passed`) and a case name that
 * is not a literal (a spec case whose title is computed cannot carry `S<n>_`,
 * and the artifact cannot be matched by name).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE FOUR LEVELS, AND WHICH FILES EACH ONE JUDGES
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. FORM — every file under a test directory matches a DECLARED form.
 *    `classify()` decides; `unclassified-test` and `invalid` are a fail with
 *    that module's own `reason`, which already names the cure. One exception,
 *    and it is not an invention: `__snapshots__/*.snap` is the form
 *    `tools/gates/test-guard.mjs:143` declares and guards, and `classify()`
 *    deliberately answers `unclassified-test` for it (test-guard.mjs:141). A
 *    snapshot is therefore not a form violation here — but a snapshot belonging
 *    to a SPEC test is a level-3 violation, because a spec test may not assert
 *    through a snapshot at all.
 *
 * 2. EVERY TEST FILE (spec, e2e, skeleton) — `.only` anywhere, an aliased or
 *    `.extend`-renamed test head, and a scanner that could not read the file.
 *    These three are hazards regardless of whose test it is: each one makes the
 *    artifact describe fewer cases than the source declares while still saying
 *    `passed`.
 *
 * 3. SPEC TESTS ONLY — the title contract (`S<n>_`, matching the file's own
 *    assertion number), exactly one top-level `describe`, at most
 *    MAX_CASES_PER_SPEC_FILE cases, no snapshot matcher, and none of
 *    `@ts-expect-error` / `@ts-nocheck` / `as any`.
 *
 *    A skeleton fixture is NOT judged by these: it is spec-less by design
 *    (test-file-patterns.mjs:14), and `packages/core/test/skeleton/digest.test.ts`
 *    legitimately carries four top-level `describe`s and sixteen cases against
 *    the published SHA-256 vectors. A light that failed on it would be telling
 *    the repository to delete its only honest fixture.
 *
 * 4. THE ARTIFACT CROSS-CHECK — for a file the run artifact is about, the number
 *    of `<testcase>` elements must not be FEWER than the source's static count.
 *    See the honest limit below for when this level is reached.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * TWO MEASURED TRAPS THIS MODULE IS BUILT AROUND
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. `codeOnly` MASKS COMMENTS, SO IT CANNOT SEE A `@ts-` DIRECTIVE. The whole
 *    point of `@ts-expect-error` and `@ts-nocheck` is that they ARE comments:
 *    scanning the masked text for them matches nothing, every time, and the rule
 *    would read as permanently satisfied. They are therefore scanned in the RAW
 *    text. `as any` is the opposite case and is scanned in the MASKED text, so
 *    the string `'as any'` in a message is not a violation. Two scans, two
 *    texts, for two different reasons — not an inconsistency.
 *
 * 2. `typescript/ban-ts-comment` DOES NOT COVER THIS. The rule exists in oxlint
 *    and the config parses with it, but it did NOT fire on
 *    `// @ts-expect-error nope` (measured 2026-11-01: the directive's trailing
 *    description appears to satisfy its default options, which were not tuned).
 *    So the token scan here is the only thing enforcing that clause, and it must
 *    not be removed in favour of a lint rule until a probe has seen that rule
 *    fire.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * HONEST LIMIT: WHEN LEVEL 4 IS NOT REACHED
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Level 4 reads `ARTIFACT_OF_PROJECT` — an EXPLICIT path per project, never a
 * glob and never "the newest run" (`../lib/run-dir.mjs` says why). When no such
 * artifact exists, this light does not launch a runner and does not pretend to
 * have compared anything: the detail says `level 4: not reached (<path>)` and
 * names every file that went uncompared. The row's status is then decided by
 * levels 1-3 alone.
 *
 * That is a DEVIATION from fail-closed, and it is deliberate rather than
 * overlooked. L-testshape is a `--fast` light (`../lib/spec-parse.mjs`
 * STANDING_LIGHTS), i.e. the pre-commit path, which runs no test and has no
 * artifact of its own; a shape light that blocked every commit until somebody
 * had run the test suite would be switched off within a day, and switching it off costs
 * levels 1-3 as well. The question level 4 asks — did this run execute every
 * case the source declares — has an owner that is NOT optional:
 * `artifactVerdict` in `../lib/test-project.mjs` and `fileVerdict` in
 * `../lib/junit-xml.mjs`, both on the run-of-record path, where a missing
 * artifact already IS cannot-verify. Here it is a corroboration, and it is
 * labelled as one.
 *
 * A file whose `<testcase>` is a COLLECTION FAILURE is not an undercount: the
 * file never loaded, which is the pending-implementation state between the test
 * phase and the implementation phase. `isCollectionFailure` from
 * `../lib/junit-xml.mjs` answers that — and it is CALLED, never reimplemented:
 * the equality a reasonable reader would write (`name === classname`) is FALSE
 * on a real collection failure, because `classname` is relative to the
 * repository root while `name` is relative to the project root (measured
 * 2026-11-01, junit-xml.mjs:228).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listCases } from '../lib/test-cases.mjs';
import { isCollectionFailure, readJUnit } from '../lib/junit-xml.mjs';
import { KINDS, TEST_DIR, classify } from '../lib/test-file-patterns.mjs';
import { PROJECTS, PROJECT_NAMES } from '../lib/test-project.mjs';
import { codeOnly, readVisible, walk } from './_shared.mjs';

export const id = 'L-testshape';
export const severity = 'hard';

/**
 * The cap on cases in ONE spec test file. A spec assertion that needs more than
 * this is two assertions wearing one `S<n>`, and the spec is where that gets
 * split — not here.
 */
export const MAX_CASES_PER_SPEC_FILE = 7;

/**
 * Where level 4 looks, per Jest project. EXPLICIT paths: no glob, no mtime
 * sort, no `latest` symlink (`../lib/run-dir.mjs` header, refusal 2). These are
 * the paths the measured lane writes (`jest --selectProjects <p>
 * --reporter=junit --outputFile.junit=.ci/tests/<p>.junit.xml`), and `.ci/` is
 * gitignored machine state, so reading one is never reading the repository.
 */
export const ARTIFACT_OF_PROJECT = Object.freeze(
  Object.fromEntries(PROJECT_NAMES.filter((p) => PROJECTS[p].runner === 'jest').map((p) => [p, `.ci/tests/${p}.junit.xml`])),
);

/** A snapshot file: a test by content, a companion file by shape. The same
 * pattern `test-guard.mjs:143` guards, so the two gates agree on what one is. */
const SNAPSHOT_RE = /(^|\/)__snapshots__\/[^/]+\.snap$/;

/** A spec case title: `S<n>_` with no leading zero, then anything. */
const CASE_TITLE_RE = /^S([1-9]\d*)_/;

/** The declared call heads. An identifier bound to one of them makes every case
 * called through it invisible to the enumerator — the undercount
 * `../lib/test-cases.mjs` names as this light's job (test-cases.mjs:66). */
const ALIAS_RE =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(xdescribe|fdescribe|describe|suite|xtest|test|xit|fit|it|bench)\s*(?:[;,)\]}]|$)/gm;

/** Snapshot matchers: the assertion lives in a file nobody reviewed, and
 * `jest -u` rewrites it in bulk. Forbidden in a spec test. */
const SNAPSHOT_MATCHER_RE = /\.(toMatchSnapshot|toMatchInlineSnapshot)\s*\(/g;

/**
 * `.failing` INVERTS the verdict, and that is incompatible with a spec test.
 *
 * MEASURED 2026-11-02, jest 30: `it.failing('x', () => { expect(1).toBe(2); })` is reported with
 * status `"passed"` — the runner is asserting that the body throws. A spec test written this way
 * is therefore GREEN while its assertion fails, so red-check would see a passing case on the base
 * and conclude the test does not prove anything. It is the one modifier that makes red and green
 * swap places, so it is refused in a spec test rather than merely noted.
 */
const FAILING_MODIFIER_RE = /\b(?:x|f)?(?:it|test)\s*\.\s*(?:concurrent\s*\.\s*)?(failing)\b/g;

/** Scanned in the RAW text, because these ARE comments — see trap 1. */
const TS_DIRECTIVE_RE = /@ts-(expect-error|nocheck|ignore)\b/g;

/** Scanned in the MASKED text, so `'as any'` inside a string is not a hit. */
const AS_ANY_RE = /\bas\s+any\b/g;

/** The 1-based line of an offset, for a `path:line` citation (rule 8). */
const lineOf = (text, offset) => text.slice(0, Math.max(0, offset)).split('\n').length;

function matchLines(text, re) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ line: lineOf(text, m.index), text: m[0], groups: m.slice(1) });
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

export function run({ root = process.cwd() } = {}) {
  const problems = [];
  const notes = [];

  // ---------------------------------------------------------------- the walk
  //
  // ONE walk, through the shared one, so the blind spot of this light is the
  // declared blind spot and nothing else. A `visible.json` that does not parse
  // is L-visible's row to report; `isExcluded` fails closed there (it excludes
  // nothing), so this light still sees the whole tree.
  const visible = readVisible(root);
  if (!visible.ok) notes.push(`visible.json: ${visible.problems[0]} (L-visible owns this; the walk hid nothing)`);

  const roots = KINDS.map((k) => TEST_DIR[k]);
  const found = walk(root, { roots, visible });
  for (const p of found.problems) problems.push(`walk: ${p}`);
  for (const miss of found.missing) notes.push(`${miss}/ does not exist — no test of that kind has been placed yet`);

  // ------------------------------------------------------- level 1: the form
  const testFiles = [];
  let snapshots = 0;
  for (const rel of found.files) {
    if (SNAPSHOT_RE.test(rel)) {
      snapshots += 1;
      // A snapshot beside a spec test is a level-3 violation (the matcher that
      // writes it is forbidden there), named here because this is where the
      // file itself is seen.
      const owner = classify(rel.replace(/\/__snapshots__\/[^/]+\.snap$/, ''));
      if (/\/CHQ-\d{3}\//.test(rel))
        problems.push(
          `${rel}: a snapshot under a CHQ-<nnn> spec directory — a spec test may not assert through a snapshot ` +
            `(\`jest -u\` rewrites the assertion in bulk); delete it and assert the value in the test${owner.specId ? ` (${owner.specId})` : ''}`,
        );
      continue;
    }
    const info = classify(rel);
    if (info.form === 'unclassified-test' || info.form === 'invalid') {
      problems.push(`${rel}: ${info.reason ?? 'matches no declared test form'}`);
      continue;
    }
    if (info.form === 'spec-test' || info.form === 'e2e-test' || info.form === 'skeleton') testFiles.push(info);
  }
  if (snapshots > 0) notes.push(`${snapshots} snapshot file(s) present (guarded by test-guard, not a form violation)`);

  // ------------------------------------- levels 2 and 3: every test file read
  const listed = new Map();
  let specCount = 0;

  for (const info of testFiles) {
    let text;
    try {
      text = readFileSync(join(root, info.path), 'utf8');
    } catch (e) {
      problems.push(`${info.path}: unreadable (${String(e.message)}) — a test file a gate cannot read is not a test file it judged`);
      continue;
    }
    const cases = listCases(text, { file: info.path });
    listed.set(info.path, { info, cases, text });
    const masked = codeOnly(text);

    // --- level 2, every test file ------------------------------------------

    // The scanner itself may have been wrong (an apostrophe in JSX text opens a
    // string state and the mask goes with it), so an unparsable file is never
    // read as "no cases found".
    for (const u of cases.unparsable) problems.push(`${info.path}: the case scanner could not read this file (${u}) — nothing below is derived from it`);

    for (const c of cases.cases)
      if (c.only)
        problems.push(
          `${info.path}:${c.line}: \`.only\` on "${c.test}" — the run then executes a SUBSET and the artifact still reports it as passed; ` +
            'remove the modifier',
        );

    for (const a of matchLines(masked, ALIAS_RE))
      problems.push(
        `${info.path}:${a.line}: \`${a.groups[0]}\` is bound to the test head \`${a.groups[1]}\` — cases called through an alias are invisible to ` +
          'the case enumerator (tools/gates/lib/test-cases.mjs:66), which is an UNDERCOUNT; call `describe`/`it`/`test` by name',
      );

    for (const u of cases.unresolved)
      if (info.form === 'spec-test' || info.form === 'e2e-test')
        problems.push(
          `${info.path}:${u.line}: \`${u.head}\` declares no literal case name (${u.reason}) — a spec case title must be a string literal ` +
            `beginning S<n>_, and the artifact is matched by that name`,
        );
      else notes.push(`${info.path}:${u.line}: ${u.head} is not enumerable (${u.reason}) — a skeleton fixture, so counted nowhere`);

    for (const d of cases.duplicates) problems.push(`${info.path}: two cases named "${d}" — name → case is no longer 1:1, so the artifact cannot be matched by name`);

    // --- level 3, spec tests only ------------------------------------------
    if (info.form !== 'spec-test' && info.form !== 'e2e-test') continue;
    specCount += 1;

    if (cases.topLevelSuites !== 1)
      problems.push(
        `${info.path}: ${cases.topLevelSuites} top-level describe block(s) — a spec test file carries exactly one, ` +
          `so the artifact's "<describe> > <test>" names belong to one assertion`,
      );

    if (cases.cases.length > MAX_CASES_PER_SPEC_FILE)
      problems.push(
        `${info.path}: ${cases.cases.length} cases, over the ${MAX_CASES_PER_SPEC_FILE} a single spec assertion may carry — ` +
          `${info.assertionId ?? 'this assertion'} is doing the work of several; split it in docs/specs/${info.specId ?? 'CHQ-<nnn>'}.md`,
      );

    for (const c of cases.cases) {
      const m = CASE_TITLE_RE.exec(c.test);
      if (m === null) {
        problems.push(
          `${info.path}:${c.line}: case title ${JSON.stringify(c.test)} does not begin "S<n>_" — the title is how an assertion is found in ` +
            `the artifact and how a case is selected from it by exact name`,
        );
        continue;
      }
      if (info.assertionNumber !== null && Number(m[1]) !== info.assertionNumber)
        problems.push(
          `${info.path}:${c.line}: case title ${JSON.stringify(c.test)} claims S${m[1]} while the file is ${info.assertionId} — ` +
            'a case proves the assertion its file is named for, or it belongs in that assertion\'s own file',
        );
    }

    for (const s of matchLines(masked, SNAPSHOT_MATCHER_RE))
      problems.push(
        `${info.path}:${s.line}: \`${s.groups[0]}\` in a spec test — the assertion would live in a file nobody reviewed and \`jest -u\` ` +
          'rewrites it in bulk; assert the value here',
      );

    for (const f of matchLines(masked, FAILING_MODIFIER_RE))
      problems.push(
        `${info.path}:${f.line}: \`.failing\` in a spec test — the runner reports a case whose body THROWS as "passed" ` +
          '(measured on jest 30), so this case is green exactly when its assertion fails and red-check cannot prove it red; ' +
          'assert the failure with expect(...).toThrow() instead',
      );

    // RAW text on purpose: a `@ts-` directive is a comment, and `codeOnly`
    // masks comments — see trap 1 in the header.
    for (const d of matchLines(text, TS_DIRECTIVE_RE))
      problems.push(
        `${info.path}:${d.line}: \`@ts-${d.groups[0]}\` in a spec test — a spec test is judged by tsc as well as by the runner, and a silenced ` +
          'type error is an assertion about nothing; fix the type or raise a spec-conflict',
      );

    for (const a of matchLines(masked, AS_ANY_RE))
      problems.push(
        `${info.path}:${a.line}: \`as any\` in a spec test — it defeats the type verdict for the one file whose types the spec depends on; ` +
          'name the type, or assert through the public surface',
      );
  }

  // ------------------------------------------ level 4: the artifact, if any
  const compared = [];
  const notCompared = [];
  const unreachedArtifacts = [];

  for (const [project, artifactRel] of Object.entries(ARTIFACT_OF_PROJECT)) {
    const cfg = PROJECTS[project];
    const mine = [...listed.values()].filter((e) => e.info.path.startsWith(`${cfg.dir}/`) && cfg.extensions.some((x) => e.info.path.endsWith(x)));
    if (mine.length === 0) continue;

    const abs = join(root, artifactRel);
    if (!existsSync(abs)) {
      unreachedArtifacts.push(`${artifactRel} (${mine.length} file(s) of project ${project})`);
      continue;
    }
    const read = readJUnit(abs);
    if (!read.ok) {
      // The artifact exists and cannot be read. That IS a fail-closed case: a
      // present-but-unreadable artifact is not an absent one.
      problems.push(`${artifactRel}: ${read.reason}`);
      continue;
    }
    for (const entry of mine) {
      const file = entry.info.path;
      const forFile = read.cases.filter((c) => c.classname === file);
      if (forFile.length === 0) {
        notCompared.push(`${file} (no <testcase classname="${file}"> in ${artifactRel})`);
        continue;
      }
      const collection = forFile.filter(isCollectionFailure);
      if (collection.length > 0) {
        notCompared.push(`${file} (never loaded in ${artifactRel}: ${collection[0].failure?.type ?? 'collection failure'} — pending implementation, not an undercount)`);
        continue;
      }
      if (entry.cases.expected === null) {
        notCompared.push(`${file} (the source's case count is not derivable: ${entry.cases.note ?? 'see above'})`);
        continue;
      }
      if (forFile.length < entry.cases.expected) {
        problems.push(
          `${file}: ${artifactRel} carries ${forFile.length} <testcase> element(s) and the source declares ${entry.cases.expected} — ` +
            'the run executed fewer cases than the file holds (a narrowed include, a filter, or a case the enumerator can see and the runner did not)',
        );
        continue;
      }
      compared.push(`${file} ${forFile.length}/${entry.cases.expected}`);
    }
  }

  // --------------------------------------------------------------- the row
  const summary = [
    `${found.files.length} file(s) under ${roots.join(', ')}`,
    `${testFiles.length} test file(s) (${specCount} spec)`,
    `level 4: ${compared.length} file(s) compared against an artifact`,
  ];
  if (notCompared.length > 0) summary.push(`${notCompared.length} not compared: ${notCompared.join('; ')}`);
  if (unreachedArtifacts.length > 0)
    summary.push(`level 4 not reached for ${unreachedArtifacts.join(', ')} — this light runs no test and reads no glob; the run of record writes that path`);
  summary.push(...notes);

  if (problems.length > 0)
    return {
      id,
      severity,
      status: 'fail',
      detail: `${problems.length} shape violation(s): ${problems.join(' · ')} [${summary.join(' · ')}]`,
    };

  return { id, severity, status: 'pass', detail: summary.join(' · ') };
}
