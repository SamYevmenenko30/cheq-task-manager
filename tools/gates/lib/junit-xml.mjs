/**
 * The reader of the test artefact of record: Vitest's JUnit XML.
 *
 * Zero dependencies, `node:` builtins only — regex over text, no XML library.
 * The shape is fixed by its producer (vitest 5.0.5, `--reporter=junit`) and
 * every element and attribute named below was OBSERVED, not assumed. A parse
 * that cannot find `<testsuites` returns CANNOT VERIFY; it never guesses.
 *
 * THE MEASURED SHAPE (rerun: `pnpm exec vitest run --project core
 * --reporter=junit --outputFile.junit=<path>`):
 *
 *   <testsuites name tests failures errors time>          — NO `skipped` here
 *     <testsuite name timestamp hostname tests failures errors skipped time>
 *       <testcase classname name time>                    — green: empty body
 *       <testcase …><failure message type>…</failure></testcase>
 *       <testcase …><skipped/></testcase>                 — .skip AND .todo
 *
 * `classname` IS the file path, relative to the Vitest config root (measured:
 * `packages/core/test/skeleton/digest.test.ts` while the project's own root is
 * `./packages/core`). `name` IS `"<describe> > <test>"`, ` > ` separated, with
 * XML entities escaped in both attributes and bodies — `&apos; &gt; &lt; &amp;
 * &quot;` all appear in real output, so a case whose title contains a quote is
 * unfindable without decoding. `decodeXml` is therefore not politeness.
 *
 * THE THREE — MEASURED AS FOUR — REASONS A CASE IS RED
 * (measured 2026-11-01 by planting each defect and reading the XML):
 *
 *  | planted                      | type            | message                              | reason          |
 *  |------------------------------|-----------------|--------------------------------------|-----------------|
 *  | expect('a').toBe('b')        | AssertionError  | expected 'a' to be 'b' // Object.is… | assertion       |
 *  | call an unexported name      | TypeError       | completeTask is not a function       | missing-symbol  |
 *  | import a path nobody wrote   | Error           | Cannot find module './nope/x.ts' …   | missing-module  |
 *  | import an uninstalled package| Error           | Cannot find package '@cheq/core' …   | not-installed   |
 *
 * `not-installed` is a FOURTH reason, measured in this session and not in the
 * table it extends. It matters because it is the one reason that is NOT about
 * the code under test: `Cannot find package '@cheq/core'` means the worktree
 * was never installed, and accepting it as `missing-module` would let a gate
 * read "pending implementation" off a repository that simply has no
 * node_modules. Callers that switch on a reason should assert exhaustiveness
 * against RED_REASONS rather than list the cases by hand.
 *
 * A COLLECTION FAILURE DOES NOT REACH THE CASE. When an import fails, Vitest
 * emits ONE synthetic testcase for the whole file, and its `name` is the file
 * BASENAME while `classname` stays the full path (measured: name
 * `c-module.test.ts`, classname `.ci/probe-junit/c-module.test.ts`). The note
 * this reader was written against recorded `name` equal to the full PATH, which
 * is a different string; `isCollectionFailure` accepts either, because which
 * one appears is the reporter's business and both mean the same thing — the
 * declared case never ran, so it is not proven red.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

/** The closed set of reasons `redReason` returns. */
export const RED_REASONS = Object.freeze(['assertion', 'missing-symbol', 'missing-module', 'not-installed', 'unknown']);

/** The only `<failure type>` this project reads as an honest assertion. Vitest
 * 5.0.5 writes exactly this string for a failed `expect` (measured). Any other
 * type is `unknown` ⇒ CANNOT VERIFY: a closed set fails closed. */
export const ASSERTION_TYPES = Object.freeze(['AssertionError']);

/** Whitespace-collapsed, trimmed — the one normalisation applied before any
 * name comparison, so two readers never disagree about a double space. */
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const num = (v) => (v === null || v === '' ? null : Number(v));

/** XML entities, `&amp;` LAST so `&amp;lt;` does not become `<`. */
export function decodeXml(s) {
  if (s === null || s === undefined) return s;
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * JUnit XML text → the parsed run. THROWS when `<testsuites` is absent; the
 * caller (`readJUnit`) maps that to CANNOT VERIFY.
 *
 * → { totals: {tests, failures, errors, time},
 *     suites: [{name, tests, failures, errors, skipped, time}],
 *     cases: [{classname, name, time, status, failure, suite}] }
 *
 * `status` is one of `passed | failed | errored | skipped`.
 * `failure` is `{ message, type, body } | null`, all entity-decoded.
 */
export function parseJUnit(xml) {
  const rootTag = xml.match(/<testsuites\b[^>]*>/);
  if (!rootTag) throw new Error('no <testsuites> root element — not a Vitest JUnit report');
  const root = rootTag[0];

  const suites = [];
  const cases = [];

  const suiteRe = /<testsuite\b([^>]*?)(\/>|>([\s\S]*?)<\/testsuite>)/g;
  let sm;
  while ((sm = suiteRe.exec(xml))) {
    const head = `<testsuite${sm[1]}>`;
    const body = sm[3] ?? '';
    const suite = {
      name: decodeXml(attr(head, 'name')),
      tests: num(attr(head, 'tests')),
      failures: num(attr(head, 'failures')),
      errors: num(attr(head, 'errors')),
      skipped: num(attr(head, 'skipped')),
      time: num(attr(head, 'time')),
    };
    suites.push(suite);

    const caseRe = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
    let cm;
    while ((cm = caseRe.exec(body))) {
      const chead = `<testcase${cm[1]}>`;
      const cbody = cm[3] ?? '';
      const fm = cbody.match(/<(failure|error)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/);
      const isSkipped = /<skipped\b[^>]*\/?>/.test(cbody);
      let failure = null;
      let status = 'passed';
      if (fm) {
        const ftag = `<${fm[1]}${fm[2]}>`;
        failure = {
          message: decodeXml(attr(ftag, 'message')) ?? '',
          type: decodeXml(attr(ftag, 'type')) ?? '',
          body: decodeXml(fm[4] ?? '').trim(),
        };
        status = fm[1] === 'error' ? 'errored' : 'failed';
      } else if (isSkipped) {
        status = 'skipped';
      }
      cases.push({
        classname: decodeXml(attr(chead, 'classname')) ?? '',
        name: decodeXml(attr(chead, 'name')) ?? '',
        time: num(attr(chead, 'time')),
        status,
        failure,
        suite: suite.name,
      });
    }
  }

  return {
    totals: {
      tests: num(attr(root, 'tests')),
      failures: num(attr(root, 'failures')),
      errors: num(attr(root, 'errors')),
      // `<testsuites>` carries NO `skipped` attribute (measured) — it is summed
      // from the suites, which do, so a caller never reads `null` as zero.
      skipped: suites.reduce((n, s) => n + (s.skipped ?? 0), 0),
      time: num(attr(root, 'time')),
    },
    suites,
    cases,
  };
}

/**
 * Read one JUnit XML artefact by its EXPLICIT path. No glob, no "the newest
 * one" — see tools/gates/lib/run-dir.mjs for why.
 *
 * → { ok, verdict, reason, path, totals, suites, cases, collectionFailures }
 *
 * `ok: false` is always CANNOT VERIFY and always names its reason:
 *  - the file does not exist: a missing artefact is CANNOT VERIFY, never green;
 *  - the file is unreadable or has no `<testsuites>` root;
 *  - `tests="0"`: a filter that matched nothing writes a well-formed report and
 *    exits 0, so zero is the one count that can never be a verdict.
 *
 * `ok: true` sets `verdict: null` on purpose. A run-level pass/fail is not a
 * verdict about anything a gate asked; ask `fileVerdict` or `toTri`.
 */
export function readJUnit(path) {
  if (!path) return { ok: false, verdict: 'cannot-verify', reason: 'readJUnit: no path given', path: null };
  if (!existsSync(path))
    return { ok: false, verdict: 'cannot-verify', reason: `no such file: ${path} — a missing artefact is CANNOT VERIFY, never green`, path };
  let xml;
  try {
    xml = readFileSync(path, 'utf8');
  } catch (e) {
    return { ok: false, verdict: 'cannot-verify', reason: `unreadable: ${path}: ${String(e.message)}`, path };
  }
  let parsed;
  try {
    parsed = parseJUnit(xml);
  } catch (e) {
    return { ok: false, verdict: 'cannot-verify', reason: `${path}: ${String(e.message)}`, path };
  }
  if (!parsed.totals.tests)
    return {
      ok: false,
      verdict: 'cannot-verify',
      reason: `${path}: tests="${parsed.totals.tests ?? '?'}" — the run matched no test, and a run that never happened is not a verdict`,
      path,
      ...parsed,
      collectionFailures: [],
    };
  const collectionFailures = parsed.cases.filter(isCollectionFailure);
  return { ok: true, verdict: null, reason: null, path, ...parsed, collectionFailures };
}

/**
 * Did this `<testcase>` stand for a whole file that never loaded?
 *
 * Measured: `name` is the file BASENAME and `classname` the path. The note this
 * was written against recorded `name` equal to the full path. Both forms are
 * accepted — see the header.
 */
export function isCollectionFailure(c) {
  const name = (c?.name ?? '').trim();
  const cls = (c?.classname ?? '').trim();
  if (!name || !cls) return false;

  // MEASURED 2026-11-01, and the reason this is not a one-line equality: on a
  // collection failure the two attributes carry the SAME file in TWO different
  // spellings — `classname` relative to the repository root, `name` relative to
  // the project root:
  //
  //   <testcase classname="packages/core/test/__v/b.test.ts"
  //             name="test/__v/b.test.ts" />
  //
  // (the project's `root` is ./packages/core, so `name` loses that prefix).
  // `name === classname` is false here, and so is `name === basename(classname)`.
  // A gate relying on either reads a file that never collected as an ordinary
  // red case, and red-check would accept "red on base" from a test that was
  // never even parsed. Both spellings are kept, and the suffix form is what
  // actually fires.
  if (name === cls || name === basename(cls)) return true;
  if (cls.endsWith('/' + name) || cls === name) return true;

  // Last resort, independent of either spelling: a case name that carries no
  // ' > ' separator and ends in a test-file extension is a file, not a case —
  // a real case name is always "<describe> > <test>" or at least a title, and a
  // title ending in '.test.ts' is not something anyone writes.
  return !name.includes(' > ') && /\.(test|spec)\.tsx?$/.test(name);
}

/**
 * Per-case tri-state: `green | red | cannot-verify`.
 *
 * `skipped` is not a fourth label here, and that is deliberate: `.skip` and
 * `.todo` both produce `<skipped/>` (measured — the XML cannot tell them apart,
 * while the JSON channel can), and a case that did not execute proves nothing.
 * It is never red, so it can never satisfy red-check, and never green, so it
 * can never satisfy a `green:` trailer. CANNOT VERIFY says exactly that.
 *
 * A collection failure is also CANNOT VERIFY, not red: the declared case never
 * ran. Use `redReason` on its failure to learn whether an implementation is
 * merely absent.
 *
 * `caseStatus` is available for a caller that needs the raw bucket.
 */
export function toTri(c) {
  const s = caseStatus(c);
  if (s === 'passed') return 'green';
  if (s === 'skipped') return 'cannot-verify';
  if (isCollectionFailure(c)) return 'cannot-verify';
  if (s === 'failed' || s === 'errored') return 'red';
  return 'cannot-verify'; // an unknown status is never a pass and never red
}

/** The raw bucket: `passed | failed | errored | skipped`. */
export function caseStatus(c) {
  const s = c?.status;
  return s === 'passed' || s === 'failed' || s === 'errored' || s === 'skipped' ? s : 'skipped';
}

/**
 * Why a case is red, from its `<failure>`. → one of RED_REASONS.
 *
 * Accepts the `failure` object from `parseJUnit`, or a `{ message, type }` of
 * the caller's own. Every row is the measured table in the header; anything
 * that matches no row is `unknown`, which a gate must treat as CANNOT VERIFY
 * rather than as either kind of red.
 *
 * → { reason, type, message, specifier }
 * `specifier` is the quoted module or package name for the two resolution
 * reasons, and the symbol name for `missing-symbol`, so a caller can check
 * whether the name ever existed in the sources without re-parsing the message.
 *
 * ONE CAVEAT ON THE `missing-symbol` SPECIFIER, measured: the name in a
 * TypeError is whatever the EXPRESSION was called as, not necessarily an export
 * name. `completeTask()` gives `completeTask`, but a test that binds the symbol
 * first — `const f = mod.completeTask; f()` — gives `f`. A gate that checks the
 * name against the sources at base must therefore treat a specifier it cannot
 * find as INCONCLUSIVE rather than as "the symbol never existed".
 */
export function redReason(failure) {
  const type = String(failure?.type ?? '').trim();
  const message = String(failure?.message ?? failure?.body ?? '');
  const out = (reason, specifier = null) => ({ reason, type, message, specifier });

  if (ASSERTION_TYPES.includes(type)) return out('assertion');

  // `Cannot find package '<name>' imported from <file>` — the worktree was
  // never installed. Checked BEFORE module, because both are type="Error" and
  // only this one is not about the code under test.
  const pkg = message.match(/Cannot find package '([^']+)'/);
  if (pkg) return out('not-installed', pkg[1]);

  const mod = message.match(/Cannot find module '([^']+)'/);
  if (mod) return out('missing-module', mod[1]);

  if (type === 'TypeError') {
    const sym = message.match(/^(.+?) is not a function$/);
    if (sym) return out('missing-symbol', sym[1]);
  }

  // MEASURED 2026-11-01: there are TWO ways an absent symbol reaches the
  // artifact, and only one of them is a TypeError.
  //
  //   import { completeTask } from '…'   (module exists, export does not)
  //     -> type="TypeError"      "completeTask is not a function"
  //   absentFn(x)                        (never imported, never declared)
  //     -> type="ReferenceError"  "absentFn is not defined"
  //
  // The second one fell through to 'unknown' here, which red-check reads as
  // "red for a reason I cannot name" — a spec test calling an unwritten
  // function, the single most common shape of the test phase, would have been
  // refused as inconclusive instead of accepted as crash-red.
  if (type === 'ReferenceError') {
    const sym = message.match(/^(.+?) is not defined$/);
    if (sym) return out('missing-symbol', sym[1]);
  }

  return out('unknown');
}

/** ` > `-separated `"<describe> > <test>"` → its parts, already decoded. */
export function caseNameParts(name) {
  return String(name ?? '')
    .split(' > ')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Does an XML case `name` denote the declared case `want`?
 * Compared on the trailing segment after ` > `, with whitespace collapsed:
 * a gate declares the test's own title, while the XML prefixes every enclosing
 * `describe`.
 */
export function nameMatches(xmlName, want) {
  const parts = caseNameParts(xmlName);
  const w = norm(want);
  if (!w) return false;
  if (norm(xmlName) === w) return true;
  if (parts.length && norm(parts[parts.length - 1]) === w) return true;
  return norm(xmlName).endsWith(` > ${w}`);
}

/**
 * The verdict for ONE test file inside a parsed run.
 *
 * `parsed` is a successful `readJUnit` result. `file` is the path as `classname`
 * spells it. `expectedNames` are the case titles the source declares; `expected`
 * is how many cases the source declares, or null when the caller does not know.
 *
 * The order of the checks is the verdict, and it is the Resonance order:
 *   1. no case of `file` in the run        ⇒ cannot-verify (the wrong artefact)
 *   2. a case of `file` is a collection failure ⇒ cannot-verify, with the
 *      redReason named: nothing in that file ran
 *   3. none of `expectedNames` present     ⇒ cannot-verify
 *   4. `expected` given and the count differs ⇒ cannot-verify — "a filter is
 *      not the proof": matching fewer cases than were declared is a filter
 *      that missed, not a suite that passed
 *   5. any case green                      ⇒ GREEN (named, so a gate expecting
 *      red fails with the case that passed)
 *   6. any case skipped                    ⇒ cannot-verify
 *   7. otherwise                           ⇒ red, with each case's redReason
 *
 * → { verdict: 'green'|'red'|'cannot-verify', why, cases, reasons }
 */
export function fileVerdict(parsed, { file, expectedNames = null, expected = null } = {}) {
  const mine = (parsed?.cases ?? []).filter((c) => c.classname === file);
  if (!mine.length)
    return {
      verdict: 'cannot-verify',
      why: `no <testcase classname="${file}"> in the run (${(parsed?.cases ?? []).length} case(s) present) — this artefact is about other files`,
      cases: [],
      reasons: [],
    };

  const collection = mine.filter(isCollectionFailure);
  if (collection.length) {
    const r = redReason(collection[0].failure);
    return {
      verdict: 'cannot-verify',
      why: `${file} never loaded: ${r.type}: ${r.message} (${r.reason}) — the declared case did not run, so it is not proven red`,
      cases: mine,
      reasons: collection.map((c) => redReason(c.failure)),
    };
  }

  if (expectedNames && expectedNames.length) {
    const found = expectedNames.filter((n) => mine.some((c) => nameMatches(c.name, n)));
    if (!found.length)
      return {
        verdict: 'cannot-verify',
        why: `none of the ${expectedNames.length} declared case name(s) appear in ${file}: the run has ${mine.map((c) => JSON.stringify(c.name)).join(', ')}`,
        cases: mine,
        reasons: [],
      };
  }

  if (expected !== null && expected !== undefined && mine.length !== expected)
    return {
      verdict: 'cannot-verify',
      why: `${file} ran ${mine.length} case(s) but the source declares ${String(expected)} — a filter is not the proof`,
      cases: mine,
      reasons: [],
    };

  const tri = mine.map((c) => Object.assign({ tri: toTri(c) }, c));
  const green = tri.filter((c) => c.tri === 'green');
  if (green.length)
    return {
      verdict: 'green',
      why: `${green.length} case(s) passed: ${green.map((c) => JSON.stringify(c.name)).join(', ')}`,
      cases: tri,
      reasons: [],
    };

  const skipped = tri.filter((c) => caseStatus(c) === 'skipped');
  if (skipped.length)
    return {
      verdict: 'cannot-verify',
      why: `${skipped.length} case(s) skipped (.skip or .todo — the XML cannot tell which): ${skipped.map((c) => JSON.stringify(c.name)).join(', ')}`,
      cases: tri,
      reasons: [],
    };

  const reasons = tri.map((c) => {
    const r = redReason(c.failure);
    return { name: c.name, reason: r.reason, type: r.type, message: r.message, specifier: r.specifier };
  });
  return {
    verdict: 'red',
    why: `${tri.length} case(s) failed: ${reasons.map((r) => `${JSON.stringify(r.name)} ${r.reason}`).join(', ')}`,
    cases: tri,
    reasons,
  };
}

/** Every distinct `classname` in a run — the files the artefact is about. */
export function filesIn(parsed) {
  return [...new Set((parsed?.cases ?? []).map((c) => c.classname))].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
