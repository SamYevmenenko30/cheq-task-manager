/**
 * The SECOND channel on a test run: the runner's `--json` report.
 *
 * Zero dependencies, `node:` builtins only. One run writes both reports, and
 * this one exists to disagree with the first. The JUnit XML is the artefact of
 * record for a per-case verdict; the JSON counters are the cross-check that the
 * XML describes the whole run. A reader that only ever agrees with itself is
 * not a check.
 *
 * THE TWO REPORTS ARE ASKED FOR IN TWO DIFFERENT PLACES, and that is the trap
 * worth the ink. Measured 2026-11-02: `--json --outputFile=<p>` is this channel,
 * while the JUnit one is NOT on the command line at all — jest-junit is declared
 * in jest.config.mjs with no `outputFile` and takes its path from the environment
 * variable `JEST_JUNIT_OUTPUT_FILE`. Without that variable the reporter writes
 * `junit.xml` into the cwd, i.e. one file every run overwrites.
 *
 * The DOTTED form `--outputFile.json=<p>` is the PREVIOUS runner's, which required
 * it; this parser accepts it without a word, runs every test and writes no file at
 * all — worse than the crash it used to cause, because the run looks complete.
 * `L-artifacts` refuses it. So the pair a wrapper must produce is:
 *
 *     jest --selectProjects <kind> --ci --runInBand --json --outputFile=<json>
 *     env JEST_JUNIT_OUTPUT_FILE=<junit.xml>
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
 * JSON, no `testResults` array, `numTotalTests` of 0, or NO CASE EXECUTED — the
 * same rule as the XML, because a run that matched nothing exits 0 and writes a
 * tidy report.
 *
 * THE MEASURED SILENT PASS THIS READER EXISTS TO REFUSE (2026-11-02, jest 30).
 * A `-t` filter that matches no case does NOT make the runner fail. Measured on
 * the `core` project with `-t 'nothing matches this xyzzy'`:
 *
 *     exit 0 · success: true · numTotalTests: 17 · numPassedTests: 0
 *             numFailedTests: 0 · numPendingTests: 17
 *
 * Every case is reported PENDING and the run calls itself a success. No flag
 * prevents it: `--passWithNoTests` governs whether test FILES were found, and
 * they were — so a mistyped filter yields a well-formed report, a zero exit code
 * and a green lane. `numTotalTests` is 17, so the "matched nothing" rule above
 * does not catch it either. The only honest test is whether any case actually
 * RAN, which is `passed + failed`. A run where that is zero is CANNOT VERIFY: it
 * says nothing about the code, whatever its exit code claims.
 */
export function readJestJson(path) {
  if (!path) return { ok: false, parsed: false, reason: 'readJestJson: no path given', path: null };
  if (!existsSync(path))
    return { ok: false, parsed: false, reason: `no such file: ${path} — a missing artefact is CANNOT VERIFY, never green`, path };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { ok: false, parsed: false, reason: `unreadable: ${path}: ${String(e.message)}`, path };
  }
  let j;
  try {
    j = JSON.parse(text);
  } catch (e) {
    return { ok: false, parsed: false, reason: `${path}: not JSON: ${String(e.message)}`, path };
  }
  if (!Array.isArray(j?.testResults))
    return { ok: false, parsed: false, reason: `${path}: no testResults array — not a JSON report this reader knows`, path };

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

  const refuse = (reason) => ({
    ok: false,
    // PARSED but not a VERDICT. `ok` answers "may a verdict be read from this";
    // `parsed` answers "did the file yield the shape". `crossCheck` needs the
    // second, because whether the two channels describe the SAME RUN is
    // arithmetic, and that stays answerable on a run that is no verdict at all —
    // which is precisely a run where every case was skipped.
    parsed: true,
    reason,
    path,
    counts,
    success: j.success ?? null,
    startTime: typeof j.startTime === 'number' ? j.startTime : null,
    files,
    collectionFailures,
  });

  if (!counts.total)
    return refuse(
      `${path}: numTotalTests=${counts.total ?? 'absent'} — the run matched no test, and a run that never happened is not a verdict`,
    );

  // No case EXECUTED, although cases were found — the measured silent pass in the
  // header. A collection failure is not this case: it reports nothing about its
  // own cases and is accounted for separately, so a run that is nothing BUT
  // collection failures is already refused by the rule above.
  const ran = (counts.passed ?? 0) + (counts.failed ?? 0);
  if (ran === 0)
    return refuse(
      `${path}: numTotalTests=${String(counts.total)} but numPassedTests=${String(counts.passed ?? 0)} and ` +
        `numFailedTests=${String(counts.failed ?? 0)} — not one case executed (${String(counts.pending ?? 0)} pending, ` +
        `${String(counts.todo ?? 0)} todo), so the run says nothing about the code. This is what a filter that matched ` +
        `no case looks like: the runner exits 0 and reports success="${String(j.success ?? 'absent')}" (measured)`,
    );

  return {
    ok: true,
    parsed: true,
    reason: null,
    path,
    counts,
    success: j.success ?? null,
    startTime: typeof j.startTime === 'number' ? j.startTime : null,
    files,
    collectionFailures,
  };
}

/** The plan's name for `readJestJson`, kept so either spelling works. */
export const readJson = readJestJson;

/**
 * Cross-check the two channels of ONE run.
 *
 * `junit` is a `readJUnit` result, `json` a `readJestJson` result. Either one
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
  // PARSED, not ok: see `parsed` in the reader above. A run where every case was
  // skipped is no verdict, and the arithmetic below is still the only thing that
  // says whether the two channels describe the same run — refusing to compute it
  // would leave that question permanently unanswerable on exactly the runs where
  // the two producers disagree most.
  if (json?.parsed !== true) reasons.push(`JSON channel unusable: could not be parsed at all — ${json?.reason ?? 'no result given'}`);
  if (reasons.length) return { ok: false, agree: false, verdict: 'cannot-verify', reasons, detail: null };

  const cfXml = junit.collectionFailures?.length ?? 0;
  const cfJson = json.collectionFailures?.length ?? 0;
  // A `.todo` is emitted as a <testcase> that the suite's own `tests` attribute
  // EXCLUDES (measured 2026-11-02), so the XML can count the excess but cannot
  // say which row it is. `parseJUnit` records that per suite as
  // `caseCount - tests`; the JSON names the same quantity outright as
  // `numTodoTests`. Comparing them is what ties the one thing each channel knows
  // and the other does not.
  const xmlUncounted = (junit.suites ?? []).reduce(
    (n, su) => n + (su.tests === null ? 0 : Math.max(0, (su.caseCount ?? 0) - su.tests)),
    0,
  );
  const detail = {
    xml: {
      tests: junit.totals.tests,
      failures: junit.totals.failures,
      errors: junit.totals.errors,
      skipped: junit.totals.skipped,
      collectionFailures: cfXml,
      uncountedCases: xmlUncounted,
    },
    json: { ...json.counts, collectionFailures: cfJson },
    // Said out loud so no caller mistakes `agree` for a verdict on a run that was
    // never one. `agree` is about the two channels, never about the code.
    jsonIsVerdict: json.ok === true,
  };

  if (cfXml !== cfJson)
    reasons.push(
      `the channels count collection failures differently: XML ${cfXml} (a testcase named after its file), JSON ${cfJson} (a file with no assertionResults and a message)`,
    );

  const cf = Math.max(cfXml, cfJson);

  // MEASURED 2026-11-02, and it is why this identity changed with the runner:
  // jest-junit leaves a `.todo` out of `<testsuites tests>` while the JSON counts
  // it in `numTotalTests`. The previous runner counted it in BOTH, so the old
  // identity (XML tests === JSON total + cf) now fails on every file holding a
  // `.todo` — a disagreement about nothing, which is how a cross-check gets
  // switched off. The todo is subtracted instead.
  const todo = json.counts.todo ?? 0;
  if (json.counts.total !== null && junit.totals.tests !== json.counts.total - todo + cf)
    reasons.push(
      `test counts do not reconcile: XML tests=${junit.totals.tests}, JSON numTotalTests=${json.counts.total} - numTodoTests=${todo} + ${cf} collection failure(s) = ${json.counts.total - todo + cf}`,
    );

  if (json.counts.todo !== null && xmlUncounted !== json.counts.todo)
    reasons.push(
      `the channels disagree about how many cases never ran: the XML carries ${xmlUncounted} <testcase> element(s) beyond its suites' own tests= counts, the JSON names numTodoTests=${json.counts.todo}`,
    );

  if (json.counts.failed !== null && junit.totals.failures !== null && junit.totals.failures !== json.counts.failed + cf)
    reasons.push(
      `failure counts do not reconcile: XML failures=${junit.totals.failures}, JSON numFailedTests=${json.counts.failed} + ${cf} collection failure(s) = ${json.counts.failed + cf}`,
    );

  // Same measurement, the other half: the suite's `skipped` attribute counts the
  // `<skipped/>` rows only, so it equals numPendingTests alone. The todo is
  // accounted for by the identity above.
  if (json.counts.pending !== null && junit.totals.skipped !== json.counts.pending)
    reasons.push(
      `skip counts do not reconcile: XML skipped=${junit.totals.skipped}, JSON numPendingTests=${json.counts.pending} (a .todo is counted by neither, and is reconciled separately)`,
    );

  return reasons.length
    ? { ok: false, agree: false, verdict: 'cannot-verify', reasons, detail }
    : { ok: true, agree: true, verdict: 'agree', reasons: [], detail };
}

/**
 * Why a file FAILED TO COLLECT, in the same closed vocabulary `redReason` uses, so a caller can
 * classify a collection failure and an ordinary failure through one code path.
 *
 * This exists because the two channels know different things. A file that never loaded has NO row
 * in the JUnit XML at all — no `<testsuite>`, no `<testcase>` (measured 2026-11-02) — so the XML
 * reads `tests="0"` and is indistinguishable from an empty run. The JSON channel is the only one
 * that names the file, as `status: 'failed'` with `assertionResults: []` and a `message`. That
 * message is the only evidence there is, and this is where it is read.
 *
 * It matters more than it looks: "a new test imports the function the spec asks for, and nobody has
 * written it yet" is the COMMONEST shape of the red-test phase, and under this runner it is a
 * collection failure rather than a failing case. Without this, red-check answers CANNOT VERIFY to
 * every honest red test of that shape and the phase cannot proceed.
 *
 * THE MEASURED SIGNATURES, 2026-11-02, jest 30 + @swc/jest, each from a planted file:
 *
 *   import { x } from '../src/nope.ts'        (the module does not exist)
 *     -> "Configuration error: Could not locate module ../src/nope.ts mapped as: …"
 *   import { absentExport } from '../src/real.ts'   (module exists, export does not)
 *     -> "SyntaxError: The requested module '../src/real.ts' does not provide an export named
 *         'absentExport'"
 *
 * A RELATIVE specifier is this project's own unwritten module, which is an absence the red-test
 * phase is entitled to. A BARE specifier is a package that is not installed, which says nothing
 * about the test — so it is `not-installed`, which every caller reads as CANNOT VERIFY. That
 * distinction is the whole reason this does not simply return `missing-module` for both.
 *
 * → { reason, specifier, message } with `reason` one of RED_REASONS; `unknown` when no measured
 * signature matches, which blocks rather than guesses.
 */
export function collectionReason(message) {
  const text = String(message ?? '');
  const out = (reason, specifier = null) => ({ reason, specifier, message: text });

  const located = text.match(/Could not locate module\s+(\S+)/);
  if (located) {
    const spec = located[1];
    return spec.startsWith('.') ? out('missing-module', spec) : out('not-installed', spec);
  }

  const noExport = text.match(/The requested module '([^']+)' does not provide an export named '([^']+)'/);
  if (noExport) return out('missing-symbol', noExport[2]);

  // The two signatures `redReason` already measured on a FAILING case reach this channel too, when
  // the resolution error comes from node rather than from the runner's own resolver.
  const pkg = text.match(/Cannot find package '([^']+)'/);
  if (pkg) return out('not-installed', pkg[1]);

  const mod = text.match(/Cannot find module '([^']+)'/);
  if (mod) {
    const spec = mod[1];
    return spec.startsWith('.') ? out('missing-module', spec) : out('not-installed', spec);
  }

  return out('unknown');
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
