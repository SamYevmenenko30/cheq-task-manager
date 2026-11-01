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
 * The fixtures under `tools/gates/fixtures/` were produced by vitest 5.0.5,
 * tsc 7.0.2 and oxlint 1.90.0 and committed verbatim (provenance:
 * `fixtures/manifest.json`, prose: `fixtures/README.md`). Three of them are
 * marked `real: false` because no run produces their shape, and each names the
 * edit — a derived fixture that did not say so would be a format nobody emits
 * being probed as if somebody did.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE FOUR MEASURED TRAPS THESE PROBES EXIST TO HOLD SHUT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. THE EMPTY RUN EXITS 0. `--passWithNoTests=true` plus a filter matching
 *    nothing writes a well-formed `tests="0"` report, `"success": true`, exit 0.
 *    Every other signal says "fine"; only the count says "nothing happened".
 * 2. THE COLLECTION FAILURE IS NOT AN EQUALITY. `classname` is repo-relative,
 *    `name` is project-relative, so `name === classname` is FALSE on a real one
 *    and so is `name === basename(classname)` — which is what the ported
 *    `isCollectionFailure` compared, so it answered false on every real
 *    collection failure and a file that never parsed read as an ordinary red
 *    case. The probe asserts the suffix form AND asserts that both equalities
 *    are false on the real pair, so a regression to either fails here.
 * 3. `filesChecked === 0` IS NOT A CLEAN PROJECT. A tsc log with no diagnostics
 *    and no `--listFiles` lines is zero bytes and exit 0. "Never ran" is the
 *    one state an exit code cannot distinguish from "clean".
 * 4. `vitest list --json` DOUBLE-ESCAPES A QUOTE. The list gives
 *    `hashes \"abc\"` (a backslash and a quote, code points 92 34, after
 *    JSON.parse); the XML gives `hashes &quot;abc&quot;`, which decodes to
 *    `hashes "abc"`. The XML is the artifact of record, so the LIST is the side
 *    to unescape — and the probe asserts the comparison FAILS without that step,
 *    which is what makes the step load-bearing rather than decorative.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GROUP DOES NOT CLAIM
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * The readers are pure functions over text, so nothing here spawns a gate and
 * nothing here needs an install — except the two probes that cross-check a
 * stored artifact against the RUNNER's own collection. Those need
 * `node_modules` and SKIP by name without it, because a probe that quietly
 * stops checking is worse than one that says it did not run.
 */

import { basename, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
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
import { crossCheck, jsonCaseStatus, readVitestJson } from '../lib/vitest-json.mjs';
import { readTsc } from '../lib/tsc-log.mjs';
import { parseCode, readOxlint } from '../lib/oxlint-json.mjs';
import { parseTrailers } from '../lib/trailers.mjs';
import { listCases } from '../lib/test-cases.mjs';
import { byCodepoint } from '../lights/_shared.mjs';
import { assert, fixtureJson, fixturePath, havePremise, probe, readFixture, runBin, scratchRepo, skipped } from './_harness.mjs';

export const title = 'the artefact readers against captured output of the real toolchain';

/** The file the vitest fixtures are about, as `classname` spells it. */
const CAP = 'packages/core/test/__cap';
const SKELETON = 'packages/core/test/skeleton/digest.test.ts';

const sha256File = (abs) => createHash('sha256').update(readFileSync(abs)).digest('hex');

/**
 * The ONE measured step that makes `vitest list --json` comparable with the
 * artifact of record: the list double-escapes a quote inside a case name
 * (`hashes \"abc\"` after JSON.parse — code points 92, 34), while the XML
 * carries `&quot;` and decodes to a plain quote. The XML is the artifact of
 * record, so the LIST is the side that is unescaped.
 */
const unescapeListName = (s) => s.replaceAll('\\"', '"').replaceAll('\\\\', '\\');

/** A one-line summary of a reader's answer, for an assertion message. */
const said = (r) => `verdict=${String(r?.verdict)} ok=${String(r?.ok)} reason=${JSON.stringify(r?.reason ?? null)}`;

export const probes = [
  // ───────────────────────────────────────────────── JUnit XML, six fixtures

  probe('junit: an EMPTY run is CANNOT VERIFY, and that run exited 0', () => {
    const xml = readFixture('vitest', 'empty-run.junit.xml');
    const parsed = parseJUnit(xml);
    assert(parsed.totals.tests === 0, `the empty-run fixture should carry tests="0", it carries ${String(parsed.totals.tests)}`);

    const r = readJUnit(fixturePath('vitest', 'empty-run.junit.xml'));
    assert(!r.ok && r.verdict === 'cannot-verify', `an empty run must be CANNOT VERIFY, the reader said ${said(r)}`);
    assert(/tests="0"/.test(r.reason), `the reason must name the count that refused it, it said ${JSON.stringify(r.reason)}`);

    // The trap, from the other channel: everything except the count says fine.
    const json = fixtureJson('vitest', 'empty-run.json');
    assert(json.success === true, `the measured empty run reports "success": true — the fixture says ${JSON.stringify(json.success)}`);
    const j = readVitestJson(fixturePath('vitest', 'empty-run.json'));
    assert(!j.ok && /numTotalTests=0/.test(j.reason), `the JSON channel must refuse the same run; it said ${said(j)}`);
  }),

  probe('junit: every case failed — the three measured red signatures, each named', () => {
    const r = readJUnit(fixturePath('vitest', 'all-failed.junit.xml'));
    assert(r.ok, `the all-failed fixture must parse: ${said(r)}`);
    const file = `${CAP}/failed.test.ts`;
    const v = fileVerdict(r, { file, expected: 3 });
    assert(v.verdict === 'red', `three failing cases must read red, the reader said ${v.verdict}: ${v.why}`);

    const byReason = new Map(v.reasons.map((x) => [x.reason, x]));
    assert(byReason.has('assertion'), `no case was read as an honest assertion; the reasons were ${JSON.stringify(v.reasons.map((x) => `${x.type}:${x.reason}`))}`);
    const sym = v.reasons.filter((x) => x.reason === 'missing-symbol');
    assert(
      sym.length === 2,
      `both a TypeError and a ReferenceError are missing-symbol (measured), so two cases must carry that reason — got ${sym.length}: ${JSON.stringify(v.reasons.map((x) => `${x.type}:${x.reason}:${String(x.specifier)}`))}`,
    );
    const types = new Set(sym.map((x) => x.type));
    assert(types.has('TypeError') && types.has('ReferenceError'), `the two missing-symbol cases must come from the two measured types, got ${JSON.stringify([...types])}`);
    const specifiers = sym.map((x) => x.specifier).toSorted(byCodepoint);
    assert(
      specifiers.join(',') === 'absentFn,completeTask',
      `the specifier is the name the expression was called as; expected absentFn,completeTask, got ${JSON.stringify(specifiers)}`,
    );
    assert(byReason.get('assertion').type === 'AssertionError', `the assertion case must be type="AssertionError", it is ${JSON.stringify(byReason.get('assertion').type)}`);
  }),

  probe('junit: one passed is green, and a count that disagrees with the source is CANNOT VERIFY', () => {
    const r = readJUnit(fixturePath('vitest', 'one-passed.junit.xml'));
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

  probe('junit: only skipped cases are never red and never green, and .skip vs .todo survives in the JSON', () => {
    const path = fixturePath('vitest', 'skipped-only.junit.xml');
    const r = readJUnit(path);
    assert(r.ok, `the skipped-only fixture must parse: ${said(r)}`);
    const file = `${CAP}/skipped.test.ts`;

    const v = fileVerdict(r, { file, expected: 2 });
    assert(v.verdict === 'cannot-verify' && /skipped/.test(v.why), `two skipped cases must be CANNOT VERIFY; the reader said ${v.verdict}: ${v.why}`);

    const tris = r.cases.filter((c) => c.classname === file).map(toTri);
    assert(tris.length === 2 && tris.every((t) => t === 'cannot-verify'), `each skipped case is cannot-verify, got ${JSON.stringify(tris)}`);
    const statuses = r.cases.filter((c) => c.classname === file).map(caseStatus);
    assert(statuses.every((s) => s === 'skipped'), `the raw bucket of each case must be "skipped", got ${JSON.stringify(statuses)}`);

    // The XML cannot tell .skip from .todo; the counters can, and crossCheck's
    // third identity is the only place that distinction is used.
    const j = readVitestJson(fixturePath('vitest', 'skipped-only.json'));
    assert(j.ok, `the JSON channel of the skipped run must parse: ${said(j)}`);
    assert(
      j.counts.pending === 1 && j.counts.todo === 1 && r.totals.skipped === 2,
      `XML skipped=${String(r.totals.skipped)} must equal JSON pending=${String(j.counts.pending)} + todo=${String(j.counts.todo)} (measured)`,
    );
    const x = crossCheck(r, j);
    assert(x.agree, `the two channels of one real run must agree: ${JSON.stringify(x.reasons)}`);
  }),

  probe('junit: an artefact about ANOTHER project is CANNOT VERIFY, not somebody else\'s green', () => {
    const r = readJUnit(fixturePath('vitest', 'foreign-file.junit.xml'));
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

  probe('junit: a collection failure is the SUFFIX form, and neither equality fires on the real pair', () => {
    const r = readJUnit(fixturePath('vitest', 'collection-failure.junit.xml'));
    assert(r.ok, `the collection-failure fixture must parse: ${said(r)}`);
    assert(r.cases.length === 1, `the fixture carries one testcase, it carries ${r.cases.length}`);
    const c = r.cases[0];

    // The measured pair, and the two equalities a reader was first written with.
    assert(
      c.classname === `${CAP}/collect.test.ts` && c.name === 'test/__cap/collect.test.ts',
      `the measured pair is classname repo-relative and name project-relative; this fixture has classname=${JSON.stringify(c.classname)} name=${JSON.stringify(c.name)}`,
    );
    assert(c.name !== c.classname, `name === classname must be FALSE on a real collection failure, and here name=${JSON.stringify(c.name)} classname=${JSON.stringify(c.classname)}`);
    assert(
      c.name !== basename(c.classname),
      `name === basename(classname) must be FALSE too — that is the comparison the ported reader used, and it answered false on every real collection failure. name=${JSON.stringify(c.name)} basename=${JSON.stringify(basename(c.classname))}`,
    );
    assert(c.classname.endsWith(`/${c.name}`), `the suffix form is what fires: classname=${JSON.stringify(c.classname)} must end with "/" + name=${JSON.stringify(c.name)}`);
    // A LIMIT of this probe, stated rather than implied: `isCollectionFailure`
    // has three branches and on every artifact this toolchain emits they
    // OVERLAP — a collection failure's `name` always looks like a file path, so
    // the "no ' > ' and a test extension" last resort fires wherever the suffix
    // form does. Verified by mutation: removing the suffix form alone keeps this
    // probe green, removing it AND the last resort (the ported equality-only
    // reader) turns it red with the pair printed. So this asserts the BEHAVIOUR
    // and the measured pair, not which branch answered.
    assert(isCollectionFailure(c), `isCollectionFailure must read this real pair as a collection failure; it read ${String(isCollectionFailure(c))} for classname=${JSON.stringify(c.classname)} name=${JSON.stringify(c.name)}`);
    assert(r.collectionFailures.length === 1, `readJUnit must collect it, it collected ${r.collectionFailures.length}`);

    // Never red: the declared case did not run.
    assert(toTri(c) === 'cannot-verify', `a collection failure is cannot-verify, not red; toTri said ${toTri(c)}`);
    const reason = redReason(c.failure);
    assert(
      reason.reason === 'missing-module' && reason.specifier === '../../src/scheduling/schedule.ts',
      `the reason must be missing-module with the specifier from the message, got ${reason.reason} / ${JSON.stringify(reason.specifier)} from ${JSON.stringify(reason.message)}`,
    );
    const v = fileVerdict(r, { file: c.classname, expected: 1 });
    assert(v.verdict === 'cannot-verify' && /never loaded/.test(v.why), `the file verdict must say the file never loaded; it said ${v.verdict}: ${v.why}`);

    // And the JSON channel of THAT run, measured for the first time here: the
    // file is present with no assertionResults, and numTotalTests is 0 — so this
    // channel refuses the run on its own count rule before any identity is
    // reached. TD-0005/TD-0012 recorded this as unmeasured.
    const j = readVitestJson(fixturePath('vitest', 'collection-failure.json'));
    assert(!j.ok && /numTotalTests=0/.test(j.reason), `the JSON channel of a pure collection failure must refuse on its count; it said ${said(j)}`);
    assert(j.collectionFailures.length === 1, `the JSON channel must still SEE the file (no assertionResults + a message); it saw ${j.collectionFailures.length}`);
    const x = crossCheck(r, j);
    assert(
      !x.agree && x.verdict === 'cannot-verify' && x.reasons.some((s) => /JSON channel unusable/.test(s)),
      `crossCheck must refuse when one channel is unusable, it said ${JSON.stringify(x)}`,
    );
    const per = jsonCaseStatus(j, `${CAP}/collect.test.ts`, 'cannot run at all');
    assert(per.verdict === 'cannot-verify', `the JSON channel knows nothing about a case in a file that never collected; it said ${per.verdict}: ${per.why}`);
  }),

  probe('junit: two channels that describe different runs are CANNOT VERIFY, and an agreeing pair is not', () => {
    const xml = readJUnit(fixturePath('vitest', 'counter-mismatch.junit.xml'));
    const json = readVitestJson(fixturePath('vitest', 'counter-mismatch.json'));
    assert(xml.ok && json.ok, `both halves of the mismatch pair must parse on their own: xml ${said(xml)} json ${said(json)}`);
    const bad = crossCheck(xml, json);
    assert(
      !bad.agree && bad.reasons.some((s) => /test counts do not reconcile/.test(s)),
      `XML tests=1 against JSON numTotalTests=2 must not reconcile; crossCheck said ${JSON.stringify(bad)}`,
    );

    const goodXml = readJUnit(fixturePath('vitest', 'one-passed.junit.xml'));
    const goodJson = readVitestJson(fixturePath('vitest', 'one-passed.json'));
    const good = crossCheck(goodXml, goodJson);
    assert(good.agree && good.verdict === 'agree', `the real pair this fixture was derived from must agree; crossCheck said ${JSON.stringify(good)}`);

    // `agree` is not a verdict about tests: the all-failed pair AGREES about a
    // red run, which is the correct answer and the reason the field was renamed.
    const redPair = crossCheck(readJUnit(fixturePath('vitest', 'all-failed.junit.xml')), readVitestJson(fixturePath('vitest', 'all-failed.json')));
    assert(redPair.agree, `the two channels of the red run must agree about it being red: ${JSON.stringify(redPair.reasons)}`);
  }),

  probe('junit: entity decoding is not politeness — a case whose title holds a quote is unfindable without it', () => {
    const xml = readFixture('vitest', 'core-skeleton.junit.xml');
    assert(/name="sha256 against the published vectors &gt; hashes &quot;abc&quot;"/.test(xml), 'the captured core run should carry the &quot;-escaped case name; re-capture the fixture');
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

  probe('test-cases: the text scan agrees with the captured artefact, and the list needs UNESCAPING first', (ctx) => {
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

    const parsed = parseJUnit(readFixture('vitest', 'core-skeleton.junit.xml'));
    const fromXml = parsed.cases.filter((c) => c.classname === SKELETON).map((c) => c.name).toSorted(byCodepoint);
    const fromScan = [...scanned.names].toSorted(byCodepoint);
    assert(
      fromScan.length === fromXml.length && fromScan.every((n, i) => n === fromXml[i]),
      `the scan and the artefact must name the same cases.\n  scan (${fromScan.length}): ${JSON.stringify(fromScan)}\n  xml  (${fromXml.length}): ${JSON.stringify(fromXml)}`,
    );

    // The runner's own collection, and the measured escape. `name` from
    // `vitest list --json` carries a BACKSLASH and a quote after JSON.parse.
    const list = fixtureJson('vitest', 'list-core.json');
    const listed = list.filter((e) => e.file === SKELETON).map((e) => e.name);
    const quoted = listed.find((n) => n.includes('abc'));
    assert(quoted !== undefined, `the list fixture must carry the quoted case; it carries ${JSON.stringify(listed.slice(0, 3))}`);
    assert(
      quoted.includes('\\"'),
      `the measured list form double-escapes the quote (code points 92 34); this fixture has ${JSON.stringify(quoted)} — re-capture it`,
    );
    assert(
      !fromXml.includes(quoted),
      `and WITHOUT unescaping it must NOT match the artefact of record — if it did, the unescape step would be decoration. The raw list name is ${JSON.stringify(quoted)}`,
    );
    const unescaped = listed.map(unescapeListName).toSorted(byCodepoint);
    assert(
      unescaped.length === fromXml.length && unescaped.every((n, i) => n === fromXml[i]),
      `after unescaping, all ${fromXml.length} names must agree with the XML.\n  list: ${JSON.stringify(unescaped)}\n  xml:  ${JSON.stringify(fromXml)}`,
    );
    // An explicit pass: only SKIP / skipped() mean "did not run" (see _harness.mjs).
    return null;
  }),

  probe('test-cases: a case the source does not name is honestly unknown, never counted as zero', () => {
    const each = [
      "import { describe, it, expect } from 'vitest';",
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

  probe('test-cases: the LIVE runner collection agrees with the text scan (needs node_modules)', (ctx) => {
    if (!havePremise(ctx, 'vitest')) return skipped(`premise "vitest" absent: ${ctx.premises.vitest.rel} does not exist — ${ctx.premises.vitest.cure}`);
    const res = runBin('vitest', ['list', '--json', '--project', 'core'], { cwd: ctx.root });
    if (res.status === null) return skipped(`vitest could not be started (${String(res.spawnError)}) — ${res.out.slice(0, 200)}`);
    assert(res.status === 0, `vitest list must exit 0, it exited ${String(res.status)}: ${res.out.slice(0, 400)}`);
    let listed = null;
    let parseError = null;
    try {
      listed = JSON.parse(res.stdout);
    } catch (e) {
      parseError = String(e.message);
    }
    assert(parseError === null, `vitest list --json must print JSON (${String(parseError)}); its stdout begins ${JSON.stringify(res.stdout.slice(0, 300))}`);
    assert(Array.isArray(listed) && listed.length > 0, `the listing must be a non-empty array, it is ${JSON.stringify(listed).slice(0, 200)}`);

    // MEASURED: `file` is ABSOLUTE, so it is relativised before comparing.
    const root = `${ctx.root}/`;
    assert(
      listed.every((e) => e.file.startsWith('/')),
      `every file in the listing is absolute (measured); got ${JSON.stringify(listed.map((e) => e.file).slice(0, 2))}`,
    );
    const byFile = new Map();
    for (const e of listed) {
      const rel = e.file.startsWith(root) ? e.file.slice(root.length) : e.file;
      if (!byFile.has(rel)) byFile.set(rel, []);
      byFile.get(rel).push(unescapeListName(e.name));
    }
    for (const [rel, names] of byFile) {
      const abs = join(ctx.root, rel);
      assert(existsSync(abs), `the listing names ${rel}, which is not on disk under ${ctx.root}`);
      const scanned = listCases(readFileSync(abs, 'utf8'), { file: rel });
      assert(!scanned.cannotVerify, `${rel}: the scanner could not enumerate it (${JSON.stringify(scanned.note)}), so the cross-check is CANNOT VERIFY rather than a disagreement`);
      const a = [...names].toSorted(byCodepoint);
      const b = [...scanned.names].toSorted(byCodepoint);
      assert(
        a.length === b.length && a.every((n, i) => n === b[i]),
        `${rel}: the runner's own collection and the text scan disagree — report CANNOT VERIFY, never pick a side.\n  vitest list (${a.length}): ${JSON.stringify(a)}\n  scan        (${b.length}): ${JSON.stringify(b)}`,
      );
    }
    return null;
  }),
];
