/**
 * probes/readers.mjs — group 7: every reader in `tools/gates/lib/` against a
 * CAPTURED artifact of the format it claims to read.
 *
 * Zero dependencies. The contract this group is written against lives in
 * `./_harness.mjs`; read its header first.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY THESE PROBES READ FILES FROM THE REPOSITORY AND NOT STRINGS IN THIS FILE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * A reader is only evidence if it has met the format its producer really emits.
 * The fixtures under `tools/gates/fixtures/` were produced by jest 30.5.2 with
 * jest-junit 17.0.0, tsc 7.0.2 and oxlint 1.90.0 and committed verbatim
 * (provenance: `fixtures/manifest.json`, prose: `fixtures/README.md`). Three of
 * them are marked `real: false` because no run produces their shape, and each
 * names the edit — a derived fixture that did not say so would be a format
 * nobody emits being probed as if somebody did.
 *
 * THE JEST SET REPLACED THE VITEST SET, and that is the whole reason this file
 * changed. `jest.config.mjs` reproduces the file-path `classname` on purpose
 * (`classNameTemplate: '{filepath}'`, `titleTemplate: '{classname} > {title}'`),
 * so a GREEN run is shaped as before and the readers parse it unchanged. Keeping
 * the old artifacts would have left eighteen probes asserting a format this
 * repository's runner no longer produces — exactly the "probe of an imagined
 * format" `_harness.mjs` warns about — so every situation was re-captured by a
 * real run and four differences fell out of the capture.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE FOUR TRAPS THESE PROBES EXIST TO HOLD SHUT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. THE EMPTY RUN EXITS 0. `--passWithNoTests` plus a filter matching nothing
 *    writes a well-formed `tests="0"` report, `"success": true`, exit 0. Every
 *    other signal says "fine"; only the count says "nothing happened".
 * 2. A COLLECTION FAILURE IS INVISIBLE IN THE XML. Measured on jest-junit
 *    17.0.0: a suite that failed to RUN emits no `<testsuite>` and no
 *    `<testcase>`, so the artifact is `<testsuites tests="0" failures="0">` —
 *    byte-shaped like an empty run, while the run exits 1. The file that never
 *    loaded is nameable from the JSON channel and from nowhere else.
 * 3. `filesChecked === 0` IS NOT A CLEAN PROJECT. A tsc log with no diagnostics
 *    and no `--listFiles` lines is zero bytes and exit 0. "Never ran" is the
 *    one state an exit code cannot distinguish from "clean".
 * 4. A CASE THAT NEVER RAN MUST NOT READ GREEN. Measured: `it.skip` becomes
 *    `<testcase><skipped/></testcase>` and `it.todo` becomes a `<testcase>` with
 *    an EMPTY body, which has no mark of any kind on it — while the XML counters
 *    exclude it and the JSON counters include it.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GROUP DOES NOT CLAIM
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * The readers are pure functions over text, so nothing here spawns a gate and
 * nothing here needs an install — except the probe that cross-checks a stored
 * artifact against the RUNNER's own collection. That one needs `node_modules`
 * and SKIPs by name without it, because a probe that quietly stops checking is
 * worse than one that says it did not run.
 *
 * It also no longer claims a case-level cross-check against the runner.
 * `jest --listTests --json` prints test FILES, not cases (measured), so the
 * runner corroborates WHICH FILES a project collects and says nothing about
 * case names; the case names have one second enumerator left, the committed XML.
 */

import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

import {
  caseStatus,
  decodeXml,
  fileVerdict,
  filesIn,
  isCollectionFailure,
  nameMatches,
  parseJUnit,
  readJUnit,
  redReason,
  toTri,
} from '../lib/junit-xml.mjs';
import { crossCheck, jsonCaseStatus, readJestJson } from '../lib/jest-json.mjs';
import { readTsc } from '../lib/tsc-log.mjs';
import { parseCode, readOxlint } from '../lib/oxlint-json.mjs';
import { parseTrailers } from '../lib/trailers.mjs';
import { listCases } from '../lib/test-cases.mjs';
import { byCodepoint } from '../lights/_shared.mjs';
import { assert, fixtureJson, fixturePath, havePremise, probe, readFixture, runBin, scratchRepo, skipped } from './_harness.mjs';

export const title = 'the artefact readers against captured output of the real toolchain';

/** The directory the test-run fixtures live in, named after their PRODUCER. */
const JEST = 'jest';

/** The file the capture fixtures are about, as `classname` spells it. */
const CAP = 'packages/core/test/__cap';
const SKELETON = 'packages/core/test/skeleton/digest.test.ts';

const sha256File = (abs) => createHash('sha256').update(readFileSync(abs)).digest('hex');

/** A one-line summary of a reader's answer, for an assertion message. */
const said = (r) => `verdict=${String(r?.verdict)} ok=${String(r?.ok)} reason=${JSON.stringify(r?.reason ?? null)}`;

/** The cure a reader defect found by these probes is fixed with, in one place so
 * three messages cannot name three different files. `lib/` is not this group's
 * to edit; a probe that fires here says where the fix goes. */
const CURE_JUNIT = 'tools/gates/lib/junit-xml.mjs';
const CURE_JSON = 'tools/gates/lib/jest-json.mjs';

export const probes = [
  // ───────────────────────────────────────────────── JUnit XML, six fixtures

  probe('junit: an EMPTY run is CANNOT VERIFY, and that run exited 0', () => {
    const xml = readFixture(JEST, 'empty-run.junit.xml');
    const parsed = parseJUnit(xml);
    assert(parsed.totals.tests === 0, `the empty-run fixture should carry tests="0", it carries ${String(parsed.totals.tests)}`);
    assert(
      parsed.suites.length === 0 && parsed.cases.length === 0,
      `the measured empty run carries no suite and no case at all; this fixture has ${parsed.suites.length} suite(s) and ${parsed.cases.length} case(s)`,
    );

    const r = readJUnit(fixturePath(JEST, 'empty-run.junit.xml'));
    assert(!r.ok && r.verdict === 'cannot-verify', `an empty run must be CANNOT VERIFY, the reader said ${said(r)}`);
    assert(/tests="0"/.test(r.reason), `the reason must name the count that refused it, it said ${JSON.stringify(r.reason)}`);

    // The trap, from the other channel: everything except the count says fine.
    const json = fixtureJson(JEST, 'empty-run.json');
    assert(json.success === true, `the measured empty run reports "success": true — the fixture says ${JSON.stringify(json.success)}`);
    const j = readJestJson(fixturePath(JEST, 'empty-run.json'));
    assert(!j.ok && /numTotalTests=0/.test(j.reason), `the JSON channel must refuse the same run; it said ${said(j)}`);
  }),

  probe('junit: every case failed — the artefact is read as red, and the counters say three of three', () => {
    const r = readJUnit(fixturePath(JEST, 'all-failed.junit.xml'));
    assert(r.ok, `the all-failed fixture must parse: ${said(r)}`);
    assert(
      r.totals.tests === 3 && r.totals.failures === 3 && r.totals.errors === 0,
      `the measured counters are tests=3 failures=3 errors=0; this fixture has ${JSON.stringify(r.totals)}`,
    );
    const file = `${CAP}/failed.test.ts`;
    const v = fileVerdict(r, { file, expected: 3 });
    assert(v.verdict === 'red', `three failing cases must read red, the reader said ${v.verdict}: ${v.why}`);
    assert(
      v.cases.length === 3 && v.cases.every((c) => c.tri === 'red'),
      `each of the three must be red on its own; the tri-states are ${JSON.stringify(v.cases.map((c) => `${c.name}:${c.tri}`))}`,
    );

    // And the JSON channel of THE SAME run agrees about it being red.
    const j = readJestJson(fixturePath(JEST, 'all-failed.json'));
    assert(j.ok && j.counts.failed === 3 && j.counts.total === 3, `the JSON channel must count three of three failed; it said ${said(j)} counts=${JSON.stringify(j.counts)}`);
    const x = crossCheck(r, j);
    assert(x.agree, `the two channels of one red run must agree about it: ${JSON.stringify(x.reasons)}`);
  }),

  probe('junit: WHERE a failure\'s type and message live — measured on jest-junit, and redReason must still name the three signatures', () => {
    const xml = readFixture(JEST, 'all-failed.junit.xml');

    // The MEASURED shape, asserted first so a re-capture that changes it fails
    // here with the bytes rather than inside a reader three calls away:
    // jest-junit writes `<failure>` with NO message= and NO type= attribute, and
    // puts `<Type>: <message>` on the FIRST LINE of the element body.
    assert(
      /<failure>\s*\n?\s*Error: expect\(received\)\.toBe\(expected\)/.test(xml),
      `the measured form is a bare <failure> whose body opens with the type and message; the fixture's first failure reads ${JSON.stringify(xml.slice(xml.indexOf('<failure'), xml.indexOf('<failure') + 160))}`,
    );
    assert(
      !/<failure[^>]*\smessage="/.test(xml) && !/<failure[^>]*\stype="/.test(xml),
      'jest-junit 17.0.0 was measured to write NO message= and NO type= attribute on <failure>; this fixture carries one, so re-capture it and this probe together',
    );
    for (const line of ['TypeError: core.completeTask is not a function', 'ReferenceError: absentFn is not defined']) {
      assert(xml.includes(line), `the fixture must carry the measured first line ${JSON.stringify(line)}; it does not`);
    }

    const r = readJUnit(fixturePath(JEST, 'all-failed.junit.xml'));
    const file = `${CAP}/failed.test.ts`;
    const mine = r.cases.filter((c) => c.classname === file);
    assert(mine.length === 3, `the three cases must be found by classname=${file}; found ${mine.length}`);
    assert(
      mine.every((c) => (c.failure?.body ?? '').length > 0),
      `parseJUnit must keep the failure BODY, which is the only place the type and message are; it kept ${JSON.stringify(mine.map((c) => (c.failure?.body ?? '').slice(0, 40)))}`,
    );

    // The claim that matters, and the one this fixture set is here to settle:
    // the three measured signatures must be NAMEABLE. `unknown` is CANNOT
    // VERIFY by its own documentation (junit-xml.mjs:40), which turns every
    // honest red run into "red for a reason nobody can name" — run.mjs's
    // unmeasuredFailures then refuses the lane, and red-check can never accept
    // "red on base".
    const reasons = mine.map((c) => ({ name: c.name, r: redReason(c.failure) }));
    const named = reasons.filter((x) => x.r.reason !== 'unknown');
    assert(
      named.length === 3,
      `all three measured signatures must be named by redReason; ${reasons.length - named.length} of ${reasons.length} answered "unknown": ` +
        `${JSON.stringify(reasons.map((x) => `${x.name} -> ${x.r.reason} type=${JSON.stringify(x.r.type)} message=${JSON.stringify(x.r.message)}`))}\n` +
        `  CURE in ${CURE_JUNIT}: parseJUnit reads the type and message from the <failure> ATTRIBUTES (:134-135) and falls back to '' when they are absent, ` +
        "and redReason's `failure?.message ?? failure?.body` (:300) never reaches the body because '' is not nullish. Take both from the body's first line " +
        `(\`<Type>: <message>\`) when the attributes are missing. This group may not edit ${CURE_JUNIT}.`,
    );
    const byReason = new Map(reasons.map((x) => [x.r.reason, x.r]));
    assert(
      byReason.has('assertion'),
      `one case is an honest failed expect and must read as an assertion; the reasons were ${JSON.stringify(reasons.map((x) => x.r.reason))}`,
    );
    const sym = reasons.filter((x) => x.r.reason === 'missing-symbol').map((x) => x.r);
    assert(
      sym.length === 2,
      `a TypeError "… is not a function" and a ReferenceError "… is not defined" are both missing-symbol, so two cases must carry that reason — got ${sym.length}: ${JSON.stringify(reasons.map((x) => `${x.r.type}:${x.r.reason}`))}`,
    );
    const specifiers = sym.map((x) => x.specifier).toSorted(byCodepoint);
    assert(
      specifiers.join(',') === 'absentFn,core.completeTask',
      `the specifier is the name the expression was called as; expected absentFn,core.completeTask, got ${JSON.stringify(specifiers)}`,
    );
  }),

  probe('junit: one passed is green, and a count that disagrees with the source is CANNOT VERIFY', () => {
    const r = readJUnit(fixturePath(JEST, 'one-passed.junit.xml'));
    assert(r.ok, `the one-passed fixture must parse: ${said(r)}`);
    const file = `${CAP}/one.test.ts`;

    const green = fileVerdict(r, { file, expected: 1, expectedNames: ['names the package'] });
    assert(green.verdict === 'green', `one passing case must read green, the reader said ${green.verdict}: ${green.why}`);

    // "A filter is not the proof": the artefact carries fewer cases than the
    // source declares, which is a run that missed, not a suite that passed.
    const short = fileVerdict(r, { file, expected: 2 });
    assert(
      short.verdict === 'cannot-verify' && /filter is not the proof/.test(short.why),
      `1 case against 2 declared must be CANNOT VERIFY naming the filter; the reader said ${short.verdict}: ${short.why}`,
    );

    // And a name nobody ran is not a pass either.
    const wrongName = fileVerdict(r, { file, expectedNames: ['a case this file does not declare'] });
    assert(
      wrongName.verdict === 'cannot-verify' && /none of the/.test(wrongName.why),
      `a declared name absent from the run must be CANNOT VERIFY; the reader said ${wrongName.verdict}: ${wrongName.why}`,
    );
  }),

  probe('junit: `it.todo` has no mark of any kind in the XML, and must still never read green', () => {
    const xml = readFixture(JEST, 'skipped-only.junit.xml');

    // The MEASURED shape: ONE of the two cases carries <skipped/>, the other
    // carries nothing at all — which is byte-identical to how a PASSING case is
    // written. That is the whole trap, and it is asserted on the bytes first.
    const bodies = [...xml.matchAll(/<testcase\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/testcase>/g)].map((m) => ({ name: decodeXml(m[1]), body: m[2] }));
    assert(bodies.length === 2, `the fixture must carry two <testcase> elements (.skip and .todo); it carries ${bodies.length}`);
    const withMark = bodies.filter((b) => /<skipped\b/.test(b.body));
    const withoutMark = bodies.filter((b) => !/<skipped\b/.test(b.body));
    assert(
      withMark.length === 1 && /is switched off/.test(withMark[0].name),
      `exactly the .skip case carries <skipped/>; the marked case(s) are ${JSON.stringify(withMark.map((b) => b.name))}`,
    );
    assert(
      withoutMark.length === 1 && /is not written yet/.test(withoutMark[0].name) && withoutMark[0].body.trim() === '',
      `the .todo case was measured as a <testcase> with an EMPTY body — the same bytes a PASSING case gets; this fixture has ${JSON.stringify(withoutMark.map((b) => `${b.name}:${b.body.trim().slice(0, 40)}`))}`,
    );

    const r = readJUnit(fixturePath(JEST, 'skipped-only.junit.xml'));
    assert(r.ok, `the skipped-only fixture must parse: ${said(r)}`);
    const file = `${CAP}/skipped.test.ts`;
    const mine = r.cases.filter((c) => c.classname === file);
    assert(mine.length === 2, `both cases must be found by classname=${file}; found ${mine.length}`);

    // The claim: a case that did not execute is never red and never green.
    // `.todo` is the one shape where the XML offers no evidence at all, so the
    // reader has to get it from the counters or from the JSON channel.
    const tris = mine.map((c) => ({ name: c.name, tri: toTri(c), bucket: caseStatus(c) }));
    const greened = tris.filter((t) => t.tri === 'green');
    assert(
      greened.length === 0,
      `no case in a file whose every case is .skip or .todo may read green; ${greened.length} did: ${JSON.stringify(tris)}\n` +
        `  CURE in ${CURE_JUNIT}: parseJUnit decides 'passed' from the ABSENCE of <failure> and <skipped/> (:128-141), and jest-junit writes a .todo exactly that way. ` +
        "The evidence is in the counters: the suite's `skipped` attribute and `<testsuites tests>` both EXCLUDE the .todo, so a case beyond the suite's own `tests` count did not execute. " +
        `This group may not edit ${CURE_JUNIT}.`,
    );
    const v = fileVerdict(r, { file, expected: 2 });
    assert(
      v.verdict === 'cannot-verify',
      `a file holding one .skip and one .todo proves nothing either way and must be CANNOT VERIFY; the reader said ${v.verdict}: ${v.why}`,
    );

    // The XML cannot tell .skip from .todo; the JSON counters can, and they are
    // also the only channel that counts the .todo at all.
    const j = readJestJson(fixturePath(JEST, 'skipped-only.json'));
    // PARSED and refused: no case in this run executed, so it is no verdict — and the
    // counters below are exactly what the reader still hands over, because whether the
    // two channels describe the same run stays answerable on a non-verdict.
    assert(j.parsed && !j.ok, `the JSON channel of the skipped run must parse and be refused as a non-verdict: ${said(j)}`);
    assert(
      j.counts.pending === 1 && j.counts.todo === 1 && j.counts.total === 2,
      `measured: JSON numPendingTests=1 (.skip) + numTodoTests=1 (.todo), numTotalTests=2; it said ${JSON.stringify(j.counts)}`,
    );
    assert(
      r.totals.tests === 1 && r.totals.skipped === 1,
      `measured on the other side: the XML counts the .skip and NOT the .todo — tests="1" skipped="1"; this fixture has tests=${String(r.totals.tests)} skipped=${String(r.totals.skipped)}`,
    );
  }),

  probe('junit: the two channels of the SAME skipped run must reconcile, .todo included', () => {
    const xml = readJUnit(fixturePath(JEST, 'skipped-only.junit.xml'));
    const json = readJestJson(fixturePath(JEST, 'skipped-only.json'));

    // This run is NO VERDICT, and that is the point of the fixture: every case is
    // a .skip or a .todo, so the JSON reader refuses it (`passed + failed === 0`).
    // `parsed` is what says the shape was read, and reconciling the channels is
    // arithmetic that stays answerable on a run nobody may read a verdict from.
    assert(xml.ok, `the XML half must parse on its own first: ${said(xml)}`);
    assert(
      json.parsed && !json.ok,
      `the JSON half must be PARSED and refused as a non-verdict, which is what makes this comparison meaningful: ${said(json)}`,
    );

    const x = crossCheck(xml, json);
    assert(
      x.agree,
      `one honest run, two channels, and they must not be reported as describing different runs: ${JSON.stringify(x.reasons)}\n` +
        `  CURE in ${CURE_JSON}: crossCheck's identities were measured on the PREVIOUS runner, where both channels counted a .todo. ` +
        'Measured here: XML tests=1 skipped=1 against JSON total=2 pending=1 todo=1, because jest-junit excludes a .todo from both counters while emitting a <testcase> for it. ' +
        `The arithmetic has to account for numTodoTests the way it already accounts for collection failures. This group may not edit ${CURE_JSON}.`,
    );
    assert(
      x.detail?.jsonIsVerdict === false,
      `agreeing channels must not be mistaken for a verdict: crossCheck has to say the JSON half is none, it said ${JSON.stringify(x.detail?.jsonIsVerdict)}`,
    );
    assert(
      x.detail?.xml?.uncountedCases === 1 && x.detail?.json?.todo === 1,
      `the one case that never ran must be counted by the XML (as a <testcase> beyond its suite's tests=) and NAMED by the JSON (numTodoTests): ${JSON.stringify({ xml: x.detail?.xml, json: x.detail?.json })}`,
    );
  }),

  probe('junit: an artefact about ANOTHER project is CANNOT VERIFY, not somebody else\'s green', () => {
    const r = readJUnit(fixturePath(JEST, 'foreign-file.junit.xml'));
    assert(r.ok, `the foreign-file fixture must parse: ${said(r)}`);
    const files = filesIn(r);
    assert(
      files.length > 0 && files.every((f) => f.startsWith('apps/api/')),
      `this fixture is a real api run; its classnames must all be under apps/api, they are ${JSON.stringify(files)}`,
    );
    const v = fileVerdict(r, { file: SKELETON });
    assert(
      v.verdict === 'cannot-verify' && /about other files/.test(v.why),
      `asked about a core file, an api artefact must be CANNOT VERIFY; the reader said ${v.verdict}: ${v.why}`,
    );
    assert(
      r.cases.every((c) => c.status === 'passed'),
      `the point of this fixture is that it is GREEN about other files — ${r.cases.filter((c) => c.status !== 'passed').length} case(s) are not passed`,
    );
  }),

  probe('junit: a collection failure is INVISIBLE in the XML and nameable only in the JSON — and the pair is CANNOT VERIFY', () => {
    // The MEASURED signature, and it is an absence. jest-junit emits nothing at
    // all for a suite that failed to RUN: no <testsuite>, no <testcase>, no
    // synthetic case whose classname/name pair could be compared. The artifact
    // of a file that never loaded is shaped exactly like an empty run, while
    // the run exits 1 — so the exit code is the only thing that differs, and an
    // exit code is advisory.
    const xmlText = readFixture(JEST, 'collection-failure.junit.xml');
    assert(
      /<testsuites\b[^>]*\btests="0"/.test(xmlText) && !/<testsuite\b/.test(xmlText.replace(/<testsuites/g, '')) && !/<testcase\b/.test(xmlText),
      `the measured collection-failure artefact is a bare <testsuites tests="0"> with no suite and no case; this fixture is ${JSON.stringify(xmlText.slice(0, 200))}`,
    );
    const empty = readFixture(JEST, 'empty-run.junit.xml');
    assert(
      xmlText.replace(/time="[^"]*"/g, 'time="T"') === empty.replace(/time="[^"]*"/g, 'time="T"'),
      'a collection failure and an empty run were measured as the SAME artefact apart from the time attribute — that is the trap this fixture is for. ' +
        `They now differ:\n  collection-failure: ${JSON.stringify(xmlText)}\n  empty-run:          ${JSON.stringify(empty)}`,
    );

    const r = readJUnit(fixturePath(JEST, 'collection-failure.junit.xml'));
    assert(
      !r.ok && r.verdict === 'cannot-verify' && /tests="0"/.test(r.reason),
      `the XML channel must refuse the run on its count — fail-closed is the correct answer to an artefact that says nothing; it said ${said(r)}`,
    );
    assert(
      r.cases.length === 0 && (r.collectionFailures ?? []).length === 0,
      `there is nothing in this artefact for isCollectionFailure to recognise; the reader found ${r.cases.length} case(s) and ${(r.collectionFailures ?? []).length} collection failure(s)`,
    );
    // The suffix form it looks for still has to work, because it is what makes a
    // synthetic file-shaped case not-red wherever one does appear. Probed on the
    // pair directly, since no artefact of this toolchain carries one.
    assert(
      isCollectionFailure({ classname: `${CAP}/collect.test.ts`, name: 'test/__cap/collect.test.ts' }),
      'isCollectionFailure must still read the suffix form (classname repo-relative, name project-relative) as a collection failure — it is dead code against a jest artefact and live code against any producer that emits one',
    );

    // The JSON channel is where the file that never loaded can be named.
    const j = readJestJson(fixturePath(JEST, 'collection-failure.json'));
    assert(!j.ok && /numTotalTests=0/.test(j.reason), `the JSON channel must refuse the run on its own count rule; it said ${said(j)}`);
    assert(
      j.collectionFailures.length === 1 && j.collectionFailures[0].name.endsWith(`${CAP}/collect.test.ts`),
      `the JSON channel must SEE the file (no assertionResults + a message); it saw ${JSON.stringify(j.collectionFailures.map((f) => f.name))}`,
    );
    assert(
      /Could not locate module \.\.\/\.\.\/src\/scheduling\/schedule\.ts/.test(j.collectionFailures[0].message),
      `and its message must name the module that could not be resolved; it said ${JSON.stringify(j.collectionFailures[0].message.split('\n').slice(0, 4).join(' | '))}`,
    );
    const raw = fixtureJson(JEST, 'collection-failure.json');
    assert(
      raw.numRuntimeErrorTestSuites === 1 && raw.numFailedTestSuites === 1 && raw.success === false,
      `measured: the JSON counts it as a RUNTIME ERROR suite — numRuntimeErrorTestSuites 1, numFailedTestSuites 1, success false; the fixture says ${JSON.stringify({ rte: raw.numRuntimeErrorTestSuites, failed: raw.numFailedTestSuites, success: raw.success })}`,
    );

    const x = crossCheck(r, j);
    assert(
      !x.agree && x.verdict === 'cannot-verify' && x.reasons.some((s) => /channel unusable/.test(s)),
      `crossCheck must refuse when a channel is unusable, it said ${JSON.stringify(x)}`,
    );
    const per = jsonCaseStatus(j, `${CAP}/collect.test.ts`, 'never loads');
    assert(per.verdict === 'cannot-verify', `the JSON channel knows nothing about a case in a file that never collected; it said ${per.verdict}: ${per.why}`);
  }),

  probe('junit: two channels that describe different runs are CANNOT VERIFY, and an agreeing pair is not', () => {
    const xml = readJUnit(fixturePath(JEST, 'counter-mismatch.junit.xml'));
    const json = readJestJson(fixturePath(JEST, 'counter-mismatch.json'));
    assert(xml.ok && json.ok, `both halves of the mismatch pair must parse on their own: xml ${said(xml)} json ${said(json)}`);
    const bad = crossCheck(xml, json);
    assert(
      !bad.agree && bad.reasons.some((s) => /test counts do not reconcile/.test(s)),
      `XML tests=1 against JSON numTotalTests=2 must not reconcile; crossCheck said ${JSON.stringify(bad)}`,
    );

    const goodXml = readJUnit(fixturePath(JEST, 'one-passed.junit.xml'));
    const goodJson = readJestJson(fixturePath(JEST, 'one-passed.json'));
    const good = crossCheck(goodXml, goodJson);
    assert(good.agree && good.verdict === 'agree', `the real pair this fixture was derived from must agree; crossCheck said ${JSON.stringify(good)}`);

    // `agree` is not a verdict about tests: the all-failed pair AGREES about a
    // red run, which is the correct answer and the reason the field was renamed.
    const redPair = crossCheck(readJUnit(fixturePath(JEST, 'all-failed.junit.xml')), readJestJson(fixturePath(JEST, 'all-failed.json')));
    assert(redPair.agree, `the two channels of the red run must agree about it being red: ${JSON.stringify(redPair.reasons)}`);
  }),

  probe('junit: entity decoding is not politeness — a case whose title holds a quote is unfindable without it', () => {
    const xml = readFixture(JEST, 'core-skeleton.junit.xml');
    assert(
      /name="sha256 against the published vectors &gt; hashes &quot;abc&quot;"/.test(xml),
      'the captured core run should carry the &quot;-escaped case name AND the &gt;-escaped separator the titleTemplate produces; re-capture the fixture',
    );
    const parsed = parseJUnit(xml);
    const names = parsed.cases.filter((c) => c.classname === SKELETON).map((c) => c.name);
    assert(
      names.includes('sha256 against the published vectors > hashes "abc"'),
      `the decoded names must carry the plain quote; they are ${JSON.stringify(names.filter((n) => n.includes('abc')))}`,
    );
    assert(decodeXml('&amp;lt;') === '&lt;', `&amp; must be decoded LAST or &amp;lt; becomes "<"; decodeXml said ${JSON.stringify(decodeXml('&amp;lt;'))}`);
    assert(
      nameMatches('sha256 against the published vectors > hashes "abc"', 'hashes "abc"'),
      'nameMatches must match a declared title against the full suite path — it did not',
    );
  }),

  // ────────────────────────────────────────────────────────────── tsc log

  probe('tsc: positioned diagnostics are red with their codes, and --listFiles is the evidence it ran', () => {
    const r = readTsc(fixturePath('tsc', 'red-ts2322.listfiles.log'));
    assert(r.verdict === 'red', `two TS2322 lines must read red: ${said(r)}`);
    assert(r.diagnostics.length === 2, `both diagnostics must survive the dedup, got ${r.diagnostics.length}: ${JSON.stringify(r.diagnostics.map((d) => d.raw))}`);
    assert(
      r.diagnostics.every((d) => d.code === 'TS2322'),
      `the codes must be TS2322, got ${JSON.stringify(r.diagnostics.map((d) => d.code))}`,
    );
    assert(
      r.diagnostics[0].path === 'tsproj/src/bad.ts' && r.diagnostics[0].line === 1 && r.diagnostics[0].col === 14,
      `the RELATIVE path, line and column must be parsed, got ${JSON.stringify(r.diagnostics[0])}`,
    );
    assert(r.filesChecked > 0, `--listFiles lines must be counted, filesChecked=${String(r.filesChecked)}`);

    const clean = readTsc(fixturePath('tsc', 'core-clean.listfiles.log'));
    assert(clean.verdict === 'green' && clean.filesChecked > 0, `the clean core log must be green over its inputs: ${said(clean)}`);
  }),

  probe('tsc: zero diagnostics with filesChecked=0 is CANNOT VERIFY — never ran is not green', () => {
    const p = fixturePath('tsc', 'clean-without-listfiles.log');
    assert(readFileSync(p, 'utf8') === '', `this fixture is the EMPTY log a clean run without --listFiles writes; it is ${JSON.stringify(readFileSync(p, 'utf8').slice(0, 80))}`);
    const r = readTsc(p);
    assert(r.verdict === 'cannot-verify' && !r.ok, `an empty log must be CANNOT VERIFY: ${said(r)}`);
    assert(/filesChecked=0/.test(r.reason) && /listFiles/.test(r.reason), `the reason must name the count and the missing flag, it said ${JSON.stringify(r.reason)}`);

    const missing = readTsc(fixturePath('tsc', 'a-log-nobody-wrote.log'));
    assert(missing.verdict === 'cannot-verify' && /no such file/.test(missing.reason), `a missing artefact is CANNOT VERIFY, never green: ${said(missing)}`);
  }),

  probe('tsc: a configuration that did not load is RED, not a clean project', () => {
    const r = readTsc(fixturePath('tsc', 'no-inputs-ts18003.log'));
    assert(r.verdict === 'red', `a global diagnostic must read red whatever the count: ${said(r)}`);
    assert(r.global.length === 1 && r.global[0].code === 'TS18003', `the global diagnostic must be parsed, got ${JSON.stringify(r.global)}`);
    assert(r.diagnostics.length === 0 && r.filesChecked === 0, `that run positioned nothing and read nothing: diagnostics=${r.diagnostics.length} filesChecked=${String(r.filesChecked)}`);
    assert(/no file position/.test(r.reason), `the reason must say the diagnostic has no file position, it said ${JSON.stringify(r.reason)}`);
  }),

  // ─────────────────────────────────────────────────────────── oxlint JSON

  probe('oxlint: findings carry plugin(rule) and a position from labels[].span', () => {
    const r = readOxlint(fixturePath('oxlint', 'findings.json'));
    assert(r.verdict === 'red', `two diagnostics must read red: ${said(r)}`);
    assert(r.errors === 2 && r.warnings === 0, `the counts are computed from the diagnostics (the report carries no totals): errors=${String(r.errors)} warnings=${String(r.warnings)}`);
    const noDebugger = r.diagnostics.find((d) => d.code === 'eslint(no-debugger)');
    assert(noDebugger !== undefined, `the measured code form is plugin(rule); the codes are ${JSON.stringify(r.diagnostics.map((d) => d.code))}`);
    assert(
      noDebugger.plugin === 'eslint' && noDebugger.rule === 'no-debugger',
      `parseCode must split plugin(rule), it gave ${JSON.stringify({ plugin: noDebugger.plugin, rule: noDebugger.rule })}`,
    );
    assert(noDebugger.line === 2 && noDebugger.column === 3, `the position lives in labels[].span, got line=${String(noDebugger.line)} column=${String(noDebugger.column)}`);
    assert(parseCode('typescript/no-floating-promises').rule === null, 'the slash form is NOT the measured one and must not parse — parseCode accepted it');
  }),

  probe('oxlint: a run that linted nothing is CANNOT VERIFY, in both measured shapes', () => {
    // The shape the lane really produces: oxlint prints a PROSE line before the
    // JSON on stdout, and stdout IS the artefact, so the file is not JSON.
    const raw = readFixture('oxlint', 'zero-files.raw.json');
    assert(raw.startsWith('No files found to lint.'), `the measured zero-file stdout starts with the prose line; this fixture starts ${JSON.stringify(raw.slice(0, 40))}`);
    const r = readOxlint(fixturePath('oxlint', 'zero-files.raw.json'));
    assert(r.verdict === 'cannot-verify' && !r.ok, `a non-JSON artefact must be CANNOT VERIFY: ${said(r)}`);
    assert(
      /No files found to lint/.test(r.reason),
      `the reason must hand back the tool's OWN words so a reader can act on them; it said ${JSON.stringify(r.reason)}`,
    );

    // And the branch that was written for `number_of_files === 0`, reachable
    // only once something strips that line. Derived fixture, named as such.
    const d = readOxlint(fixturePath('oxlint', 'zero-files.derived.json'));
    assert(d.verdict === 'cannot-verify' && /number_of_files=0/.test(d.reason), `number_of_files=0 must be CANNOT VERIFY naming the count: ${said(d)}`);
    assert(d.diagnostics.length === 0, `that run reported no findings because it reached no file, not because the tree is clean: ${d.diagnostics.length} diagnostic(s)`);

    const clean = readOxlint(fixturePath('oxlint', 'clean.json'));
    assert(clean.verdict === 'green' && clean.filesLinted > 0, `the real clean run must be green over its files: ${said(clean)}`);
  }),

  // ───────────────────────────────────────────────────── trailers, column zero

  probe('trailers: column zero declares, anything else is a named near-miss', () => {
    const declared = parseTrailers('feat: a thing\n\npackage: fastify — the api needs a server\n');
    assert(declared.byName.package.length === 1, `a column-zero trailer must declare; parseTrailers found ${JSON.stringify(declared.byName.package)}`);
    assert(
      declared.trailers[0].parsed.pkg === 'fastify' && /needs a server/.test(declared.trailers[0].parsed.why),
      `the value must split on the em dash, it parsed ${JSON.stringify(declared.trailers[0].parsed)}`,
    );

    for (const [text, why] of [
      ['feat: a thing\n\n  package: fastify — indented\n', 'indented'],
      ['feat: a thing\n\n> package: fastify — quoted\n', 'prefixed'],
      ['feat: a thing\n\nPackage: fastify — capitalised\n', 'lowercase'],
      ['feat: a thing\n\npackage:fastify — no space\n', 'space'],
      ['feat: a thing\n\npackage: \n', 'empty value'],
    ]) {
      const p = parseTrailers(text);
      assert(p.byName.package.length === 0, `${JSON.stringify(text)} must declare NOTHING (${why}); it declared ${JSON.stringify(p.byName.package)}`);
      assert(p.rejected.length === 1, `${JSON.stringify(text)} must be reported as a near-miss so the gate can say what it found; rejected=${JSON.stringify(p.rejected)}`);
      assert(
        p.rejected[0].reasons.length > 0,
        `a near-miss must carry its reason; for ${JSON.stringify(text)} it carried ${JSON.stringify(p.rejected[0])}`,
      );
    }

    // Mentioning it in a sentence declares nothing AND is not even a near-miss.
    const prose = parseTrailers('docs: why we took fastify\n\nWe will add a package: fastify, later.\n');
    assert(prose.byName.package.length === 0, `a mid-sentence mention must declare nothing, it declared ${JSON.stringify(prose.byName.package)}`);
  }),

  probe('trailers: a CR-terminated trailer is still a declaration, and git strips the CR without --cleanup=verbatim', () => {
    const direct = parseTrailers('test: crlf\r\n\r\npackage: fastify — the api needs a server\r\n');
    assert(direct.byName.package.length === 1, `parseTrailers must strip the trailing CR before matching; it found ${JSON.stringify(direct.byName.package)}`);
    assert(direct.byName.package[0] === 'fastify — the api needs a server', `the value must not keep the CR, it is ${JSON.stringify(direct.byName.package[0])}`);

    // And the reason the fixture needs `--cleanup=verbatim` at all: git's own
    // default rewrites the message, so this form cannot be produced any other way.
    const r = scratchRepo({ label: 'readers-crlf' });
    r.write('a.txt', 'x\n');
    r.commit('test: verbatim\r\n\r\npackage: fastify — the api needs a server\r\n', { verbatim: true });
    const kept = r.git(['log', '-1', '--format=%B']).stdout;
    assert(kept.includes('server\r'), `--cleanup=verbatim must keep the CR, the commit body is ${JSON.stringify(kept)}`);
    assert(parseTrailers(kept).byName.package.length === 1, `and the reader must still see the declaration in ${JSON.stringify(kept)}`);
    r.write('b.txt', 'y\n');
    r.commit('test: default cleanup\r\n\r\npackage: fastify — the api needs a server\r\n');
    const stripped = r.git(['log', '-1', '--format=%B']).stdout;
    assert(!stripped.includes('server\r'), `git's default cleanup must strip the CR — that asymmetry is what the verbatim fixture exists for; the body is ${JSON.stringify(stripped)}`);
    r.cleanup();
  }),

  // ──────────────────────────────── test-cases, against the runner's own list

  probe('test-cases: the text scan names the same CASES as the captured artefact, and the runner\'s list names the same FILES', (ctx) => {
    const manifest = fixtureJson('manifest.json');
    const recorded = manifest.sources?.[SKELETON];
    const abs = join(ctx.root, SKELETON);
    assert(existsSync(abs), `${SKELETON} is not on disk — this probe compares the stored artefact with the live source`);
    const live = sha256File(abs);
    if (live !== recorded) {
      return skipped(
        `${SKELETON} is ${live.slice(0, 12)}… and fixtures/manifest.json recorded ${String(recorded).slice(0, 12)}… — the captured artefacts describe another revision of this file. Re-capture them (fixtures/README.md); a stale fixture must not read as a defect in the reader.`,
      );
    }

    const scanned = listCases(readFileSync(abs, 'utf8'), { file: SKELETON });
    assert(!scanned.cannotVerify, `the skeleton file must be fully enumerable; the scanner said ${JSON.stringify(scanned.note)}`);

    const parsed = parseJUnit(readFixture(JEST, 'core-skeleton.junit.xml'));
    const fromXml = parsed.cases.filter((c) => c.classname === SKELETON).map((c) => c.name).toSorted(byCodepoint);
    const fromScan = [...scanned.names].toSorted(byCodepoint);
    assert(
      fromScan.length === fromXml.length && fromScan.every((n, i) => n === fromXml[i]),
      `the scan and the artefact must name the same cases.\n  scan (${fromScan.length}): ${JSON.stringify(fromScan)}\n  xml  (${fromXml.length}): ${JSON.stringify(fromXml)}`,
    );

    // The runner's own collection — and the MEASURED change of what it answers.
    // The previous runner listed one record per CASE (and double-escaped a quote
    // in the name, which had to be undone before comparing). `jest --listTests
    // --json` prints an array of test FILES, so it corroborates WHICH FILES a
    // project collects and nothing about case names.
    const list = fixtureJson(JEST, 'list-core.json');
    assert(
      Array.isArray(list) && list.length > 0 && list.every((e) => typeof e === 'string'),
      `the measured shape is an array of path STRINGS, not of records; the fixture holds ${JSON.stringify(list).slice(0, 200)}`,
    );
    assert(
      list.includes(SKELETON),
      `the file the case names were compared over must be in the runner's own collection; it holds ${JSON.stringify(list)}`,
    );
    const suiteFiles = [...new Set(parsed.cases.map((c) => c.classname))].toSorted(byCodepoint);
    const listed = [...list].toSorted(byCodepoint);
    assert(
      listed.length === suiteFiles.length && listed.every((f, i) => f === suiteFiles[i]),
      `the files the runner collects and the files the artefact is about must be the same set — the two enumerators of the FILE question.\n  list (${listed.length}): ${JSON.stringify(listed)}\n  xml  (${suiteFiles.length}): ${JSON.stringify(suiteFiles)}`,
    );
    // An explicit pass: only SKIP / skipped() mean "did not run" (see _harness.mjs).
    return null;
  }),

  probe('test-cases: a case the source does not name is honestly unknown, never counted as zero', () => {
    const each = [
      "import { describe, it, expect } from '@jest/globals';",
      "describe('generated', () => {",
      "  it.each([[1, 2], [3, 4]])('adds %i and %i', (a, b) => { expect(a).toBeLessThan(b); });",
      '});',
      '',
    ].join('\n');
    const r = listCases(each, { file: 'x.test.ts' });
    assert(r.expected === null, `an .each site cannot be enumerated from the source, so expected must be null, it is ${String(r.expected)}`);
    assert(r.cannotVerify, `and the file must read CANNOT VERIFY, it read ${String(r.cannotVerify)}`);
    assert(r.cases.length === 0 && r.unresolved.length === 1, `nothing may be counted: cases=${r.cases.length} unresolved=${r.unresolved.length}`);
    assert(/\.each/.test(r.unresolved[0].reason), `the reason must name the modifier, it said ${JSON.stringify(r.unresolved[0].reason)}`);
  }),

  probe('test-cases: the LIVE runner collection agrees with the text scan about FILES (needs node_modules)', (ctx) => {
    if (!havePremise(ctx, 'jest')) return skipped(`premise "jest" absent: ${ctx.premises.jest.rel} does not exist — ${ctx.premises.jest.cure}`);
    const res = runBin('jest', ['--selectProjects', 'core', '--listTests', '--json'], { cwd: ctx.root });
    if (res.status === null) return skipped(`jest could not be started (${String(res.spawnError)}) — ${res.out.slice(0, 200)}`);
    assert(res.status === 0, `jest --listTests must exit 0, it exited ${String(res.status)}: ${res.out.slice(0, 400)}`);

    // MEASURED: the prose line `Running one project: core` goes to STDERR, so
    // stdout is pure JSON. Reading `out` (both streams) would not parse.
    let listed = null;
    let parseError = null;
    try {
      listed = JSON.parse(res.stdout);
    } catch (e) {
      parseError = String(e.message);
    }
    assert(
      parseError === null,
      `jest --listTests --json must print JSON on STDOUT alone (${String(parseError)}); its stdout begins ${JSON.stringify(res.stdout.slice(0, 300))} and its stderr begins ${JSON.stringify(res.stderr.slice(0, 120))}`,
    );
    assert(Array.isArray(listed) && listed.length > 0, `the listing must be a non-empty array, it is ${JSON.stringify(listed).slice(0, 200)}`);
    assert(
      listed.every((e) => typeof e === 'string' && e.startsWith('/')),
      `every entry is an ABSOLUTE FILE path (measured — not a record per case); got ${JSON.stringify(listed.slice(0, 2))}`,
    );

    const root = `${ctx.root}/`;
    const fromRunner = [...new Set(listed.map((f) => (f.startsWith(root) ? f.slice(root.length) : f)))].toSorted(byCodepoint);
    for (const rel of fromRunner) {
      const abs = join(ctx.root, rel);
      assert(existsSync(abs), `the listing names ${rel}, which is not on disk under ${ctx.root}`);
      const scanned = listCases(readFileSync(abs, 'utf8'), { file: rel });
      assert(
        !scanned.cannotVerify,
        `${rel}: the runner collects this file and the scanner could not enumerate it (${JSON.stringify(scanned.note)}), so the cross-check is CANNOT VERIFY rather than a disagreement`,
      );
    }

    // The other direction, which is the one that catches a file nobody runs:
    // every `.test.ts` under the core project's test directory must be in the
    // runner's own collection. The runner is asked about the live tree, so a
    // file planted by anything in this session appears on BOTH sides.
    const fromTree = [...new Set(testFilesUnder(ctx.root, 'packages/core/test'))].toSorted(byCodepoint);
    assert(
      fromTree.length === fromRunner.length && fromTree.every((f, i) => f === fromRunner[i]),
      `every .test.ts under packages/core/test must be collected by the core project, and the runner must collect nothing else — ` +
        `a file on one side only is a test nobody runs or a run nobody declared.\n  tree   (${fromTree.length}): ${JSON.stringify(fromTree)}\n  runner (${fromRunner.length}): ${JSON.stringify(fromRunner)}`,
    );
    return null;
  }),
];

/**
 * Every `*.test.ts` under one repo-relative directory, as repo-relative posix
 * paths. An iterative walk, so the ONE sequential driver rule in `_harness.mjs`
 * (no `await` in a loop) is not even in play; `node_modules` and `.`-prefixed
 * directories are skipped for the same reason every other walk in this
 * repository skips them.
 */
function testFilesUnder(root, dirRel) {
  const out = [];
  const stack = [dirRel];
  while (stack.length > 0) {
    const cur = stack.pop();
    const abs = join(root, cur);
    if (!existsSync(abs)) continue;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && !e.name.startsWith('.')) stack.push(`${cur}/${e.name}`);
      } else if (e.isFile() && e.name.endsWith('.test.ts')) out.push(`${cur}/${e.name}`);
    }
  }
  return out;
}
