/**
 * The SECOND channel on a test run: Vitest's JSON reporter.
 *
 * Zero dependencies, `node:` builtins only. One run writes both reports, and
 * this one exists to disagree with the first. The JUnit XML is the artefact of
 * record for a per-case verdict; the JSON counters are the cross-check that the
 * XML describes the whole run. A reader that only ever agrees with itself is
 * not a check.
 *
 * ASK FOR BOTH REPORTS WITH DOTTED KEYS. Measured 2026-11-01, and it is a trap
 * worth the ink: the command
 *
 *     vitest run … --reporter=junit --outputFile=A --reporter=json --outputFile.json=B
 *
 * CRASHES vitest 5.0.5 before any test runs —
 *   `TypeError: Cannot create property 'json' on string 'A'` — because the bare
 * `--outputFile` sets a string that `--outputFile.json` then tries to index.
 * It exits **1 and writes NO artefact**, which is indistinguishable from a
 * failing test suite if anyone reads the exit code. The form that works, and
 * the one a wrapper must use, names both:
 *
 *     --reporter=junit --outputFile.junit=A --reporter=json --outputFile.json=B
 *
 * THE MEASURED SHAPE (top level):
 *   numTotalTests · numPassedTests · numFailedTests · numPendingTests ·
 *   numTodoTests · numTotalTestSuites · numPassedTestSuites ·
 *   numFailedTestSuites · numPendingTestSuites · success · startTime ·
 *   snapshot · testResults[]
 * and per file: `{ name (ABSOLUTE path), status, message, assertionResults:
 * [{ ancestorTitles, fullName, title, status, duration, failureMessages }] }`.
 *
 * WHAT A COLLECTION FAILURE DOES TO THIS CHANNEL — measured, where the note
 * this reader was written against recorded it as NOT measured and told the
 * reader to answer CANNOT VERIFY rather than guess. There is no longer anything
 * to guess, so the measurement is written down instead (rerun: plant an import
 * of a path nobody wrote, then read both reports from one run):
 *
 *   a file that failed to collect appears in `testResults` with
 *   `status: "failed"`, `assertionResults: []` and the resolution error in
 *   `message` — and it contributes NOTHING to `numTotalTests`.
 *
 * So on the run that measured it: XML `tests="6" failures="4"`, JSON
 * `numTotalTests: 5, numFailedTests: 3`, with one collection failure. The two
 * channels disagree BY CONSTRUCTION on exactly the number of collection
 * failures, and a naive equality cross-check would report CANNOT VERIFY on
 * every legitimately-pending red run — turning the check into noise. `crossCheck`
 * reconciles with that arithmetic and fails only when the arithmetic does not
 * close.
 *
 * The task's instruction still holds where it was actually about ignorance: a
 * collection-failed file has no `assertionResults`, so this channel can say
 * nothing about any case in it. `jsonCaseStatus` returns `cannot-verify` there,
 * and names the file as the reason.
 *
 * TWO COUNTERS THAT MUST NOT BE COMPARED:
 *  - `numTotalTestSuites` counts `describe` blocks, not files: measured 9 where
 *    the XML has 5 `<testsuite>` elements. Comparing them is a false alarm.
 *  - a file whose every test is skipped reports `status: "passed"` (measured on
 *    a file holding one `.skip` and one `.todo`). File status is not a verdict.
 */

import { existsSync, readFileSync } from 'node:fs';

/**
 * Read one JSON report by its EXPLICIT path (no glob — see
 * tools/gates/lib/run-dir.mjs).
 *
 * → { ok, reason, path, counts, success, startTime, files, collectionFailures }
 *
 * `counts` = { total, passed, failed, pending, todo, suitesTotal, suitesPassed,
 * suitesFailed, suitesPending }. A counter absent from the report is `null`, not
 * 0: "the reporter did not say" and "it said zero" are different facts.
 *
 * `ok: false` is CANNOT VERIFY with the reason named: no file, unreadable, not
 * JSON, no `testResults` array, or `numTotalTests` of 0 — the same rule as the
 * XML, because a run that matched nothing exits 0 and writes a tidy report.
 */
export function readVitestJson(path) {
  if (!path) return { ok: false, reason: 'readVitestJson: no path given', path: null };
  if (!existsSync(path))
    return { ok: false, reason: `no such file: ${path} — a missing artefact is CANNOT VERIFY, never green`, path };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { ok: false, reason: `unreadable: ${path}: ${String(e.message)}`, path };
  }
  let j;
  try {
    j = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: `${path}: not JSON: ${String(e.message)}`, path };
  }
  if (!Array.isArray(j?.testResults))
    return { ok: false, reason: `${path}: no testResults array — not a Vitest JSON report`, path };

  const n = (k) => (typeof j[k] === 'number' ? j[k] : null);
  const counts = {
    total: n('numTotalTests'),
    passed: n('numPassedTests'),
    failed: n('numFailedTests'),
    pending: n('numPendingTests'),
    todo: n('numTodoTests'),
    suitesTotal: n('numTotalTestSuites'),
    suitesPassed: n('numPassedTestSuites'),
    suitesFailed: n('numFailedTestSuites'),
    suitesPending: n('numPendingTestSuites'),
  };

  const files = j.testResults.map((r) => ({
    name: String(r?.name ?? ''),
    status: String(r?.status ?? ''),
    message: String(r?.message ?? ''),
    assertionResults: Array.isArray(r?.assertionResults)
      ? r.assertionResults.map((a) => ({
          fullName: String(a?.fullName ?? ''),
          title: String(a?.title ?? ''),
          ancestorTitles: Array.isArray(a?.ancestorTitles) ? a.ancestorTitles.map(String) : [],
          status: String(a?.status ?? ''),
          duration: typeof a?.duration === 'number' ? a.duration : null,
          failureMessages: Array.isArray(a?.failureMessages) ? a.failureMessages.map(String) : [],
        }))
      : [],
  }));

  // The measured signature of a file that never loaded: no assertionResults and
  // a message. Its tests are missing from numTotalTests, which is what
  // crossCheck has to account for.
  const collectionFailures = files.filter((f) => f.assertionResults.length === 0 && f.message.trim().length > 0);

  if (!counts.total)
    return {
      ok: false,
      reason: `${path}: numTotalTests=${counts.total ?? 'absent'} — the run matched no test, and a run that never happened is not a verdict`,
      path,
      counts,
      success: j.success ?? null,
      startTime: typeof j.startTime === 'number' ? j.startTime : null,
      files,
      collectionFailures,
    };

  return {
    ok: true,
    reason: null,
    path,
    counts,
    success: j.success ?? null,
    startTime: typeof j.startTime === 'number' ? j.startTime : null,
    files,
    collectionFailures,
  };
}

/** The plan's name for `readVitestJson`, kept so either spelling works. */
export const readJson = readVitestJson;

/**
 * Cross-check the two channels of ONE run.
 *
 * `junit` is a `readJUnit` result, `json` a `readVitestJson` result. Either one
 * `ok: false` is CANNOT VERIFY, carrying that reader's reason: one channel is
 * not a cross-check of itself.
 *
 * The three identities, each MEASURED on a run with one collection failure
 * (XML tests=6 failures=4 skipped=2; JSON total=5 failed=3 pending=1 todo=1):
 *
 *   XML tests    === JSON numTotalTests  + collection failures   (6 = 5 + 1)
 *   XML failures === JSON numFailedTests + collection failures   (4 = 3 + 1)
 *   XML skipped  === JSON numPendingTests + numTodoTests         (2 = 1 + 1)
 *
 * The third is also the only place the `.skip` / `.todo` distinction survives:
 * the XML writes `<skipped/>` for both.
 *
 * Suite counts are NOT compared (measured 9 vs 5 — they count different things).
 *
 * → { ok, agree: true|false, verdict: 'agree'|'cannot-verify', reasons: [string], detail }
 *
 * The field is called `agree`, not `verdict`, and that is deliberate. This
 * function answers ONE question — "do the two channels describe the same run?" —
 * and a run where both channels agree that three tests failed is a RED run with
 * agreeing channels. A field named `verdict` holding the string `'green'` for
 * that run is a label waiting to be misread: `if (crossCheck(a, b).verdict ===
 * 'green')` would read as "the tests passed" to everyone who writes it. The
 * verdict about tests comes from `fileVerdict` in junit-xml.mjs and from
 * nowhere else. `verdict` is kept only as the string 'agree' | 'cannot-verify',
 * so the two vocabularies can never be confused by accident.
 */
export function crossCheck(junit, json) {
  const reasons = [];
  if (!junit?.ok) reasons.push(`JUnit channel unusable: ${junit?.reason ?? 'no result given'}`);
  if (!json?.ok) reasons.push(`JSON channel unusable: ${json?.reason ?? 'no result given'}`);
  if (reasons.length) return { ok: false, agree: false, verdict: 'cannot-verify', reasons, detail: null };

  const cfXml = junit.collectionFailures?.length ?? 0;
  const cfJson = json.collectionFailures?.length ?? 0;
  const detail = {
    xml: { tests: junit.totals.tests, failures: junit.totals.failures, errors: junit.totals.errors, skipped: junit.totals.skipped, collectionFailures: cfXml },
    json: { ...json.counts, collectionFailures: cfJson },
  };

  if (cfXml !== cfJson)
    reasons.push(
      `the channels count collection failures differently: XML ${cfXml} (a testcase named after its file), JSON ${cfJson} (a file with no assertionResults and a message)`,
    );

  const cf = Math.max(cfXml, cfJson);

  if (json.counts.total !== null && junit.totals.tests !== json.counts.total + cf)
    reasons.push(
      `test counts do not reconcile: XML tests=${junit.totals.tests}, JSON numTotalTests=${json.counts.total} + ${cf} collection failure(s) = ${json.counts.total + cf}`,
    );

  if (json.counts.failed !== null && junit.totals.failures !== null && junit.totals.failures !== json.counts.failed + cf)
    reasons.push(
      `failure counts do not reconcile: XML failures=${junit.totals.failures}, JSON numFailedTests=${json.counts.failed} + ${cf} collection failure(s) = ${json.counts.failed + cf}`,
    );

  if (json.counts.pending !== null && json.counts.todo !== null && junit.totals.skipped !== json.counts.pending + json.counts.todo)
    reasons.push(
      `skip counts do not reconcile: XML skipped=${junit.totals.skipped}, JSON numPendingTests=${json.counts.pending} + numTodoTests=${json.counts.todo} = ${json.counts.pending + json.counts.todo}`,
    );

  return reasons.length
    ? { ok: false, agree: false, verdict: 'cannot-verify', reasons, detail }
    : { ok: true, agree: true, verdict: 'agree', reasons: [], detail };
}

/**
 * This channel's word on one case: `green | red | cannot-verify`.
 *
 * `file` is matched by suffix, because the JSON reporter writes an ABSOLUTE path
 * while the XML's `classname` is relative to the config root (both measured).
 *
 * `cannot-verify` when the file is not in the report, when the file failed to
 * collect (no `assertionResults` — this channel genuinely does not know), when
 * no assertion matches `name`, or when the status word is one this reader has
 * not measured. `pending` and `todo` are cannot-verify: not run, not a verdict.
 *
 * → { verdict, why }
 */
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function jsonCaseStatus(json, file, name) {
  if (!json?.ok) return { verdict: 'cannot-verify', why: `JSON channel unusable: ${json?.reason ?? 'no result given'}` };
  const f = json.files.find((x) => x.name === file || x.name.endsWith(`/${file}`) || x.name.endsWith(file));
  if (!f) return { verdict: 'cannot-verify', why: `${file} is not in ${json.path}` };
  if (!f.assertionResults.length)
    return {
      verdict: 'cannot-verify',
      why: `${file} has no assertionResults in the JSON channel${f.message ? `: ${f.message.split('\n')[0]}` : ''} — the file never collected, so this channel knows nothing about its cases`,
    };
  const want = norm(name);
  const a = f.assertionResults.find((x) => norm(x.title) === want || norm(x.fullName) === want || norm(x.fullName).endsWith(` ${want}`));
  if (!a) return { verdict: 'cannot-verify', why: `no assertion named ${JSON.stringify(name)} in ${file}` };
  if (a.status === 'passed') return { verdict: 'green', why: `${file}: ${JSON.stringify(a.title)} passed` };
  if (a.status === 'failed') return { verdict: 'red', why: `${file}: ${JSON.stringify(a.title)} failed` };
  return { verdict: 'cannot-verify', why: `${file}: ${JSON.stringify(a.title)} status="${a.status}" — not run is not a verdict` };
}
