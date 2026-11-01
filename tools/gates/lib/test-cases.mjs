// Enumerating test cases WITHOUT running anything, from the text of the file.
//
// Why not `vitest list`: collection is an import. On the base revision the implementation does
// not exist yet, the import throws `Cannot find module …` and the listing is empty — measured
// (measured-toolchain.md:111). An enumerator that returns zero on the base turns "a test was
// added" into "there is nothing to make red" and greens the gate it was supposed to block.
// `vitest list` is advisory cross-checking on HEAD only, never a verdict, never on the base.
//
// Why not the TypeScript compiler API: a gate never parses the language it judges (rule 2). This
// module is a token scan — comments, string literals, regex literals and `${…}` substitutions are
// masked, and the mask is what `codeOnly` returns. Nothing here knows what a type is.
//
// ── What the names mean, measured 2026-11-01 ────────────────────────────────────────────────
// Repeat with:
//   pnpm exec vitest run --project core --reporter=junit --outputFile=<somewhere>/core.junit.xml
//
// The JUnit reporter writes `<testcase classname="<repo-relative file>" name="<suites> > <test>">`.
// Written as "source shape → artifact", with the call heads spelled out rather than written as
// calls, so this header is not itself mistaken for commented-out tests:
//
//   describe "core skeleton" wrapping it "names itself"
//     → classname="packages/core/test/skeleton/marker.test.ts" name="core skeleton > names itself"
//   describe "outer" wrapping describe "inner" wrapping it "leaf case"
//     → name="outer > inner > leaf case"          (the FULL suite path, joined by ' > ')
//   it "top level no describe", with no describe at all
//     → name="top level no describe"               (no prefix, no separator)
//   the .skip and .todo modifiers
//     → a <testcase> IS emitted, with a <skipped/> child — so a skipped case still counts in
//       `tests=` and must be counted in `expected`
//   the .each modifier over the literal table [[1, 2], [3, 4]] with the name "adds %i and %i"
//     → TWO testcases, names "outer > adds 1 and 2" and "outer > adds 3 and 4": the placeholders
//       are FORMATTED per row. Reproducing that means reimplementing Vitest's formatter, so every
//       `.each`/`.for` case is `unresolved` here — honestly unknown, never counted.
//   a name given as a template literal carrying a substitution
//     → the name is resolved at RUNTIME ("template computed name"); in the source it is not a
//       literal, so it is `unresolved`.
//
// So this module produces two identifiers per case:
//   name — exactly the JUnit `testcase name`, for matching against the artifact;
//   key  — `<innermost describe>::<test name>`, for diffing. The key deliberately cuts the outer
//          suites, so renaming an OUTER describe does not make every nested case "new". That is
//          the direct port of Resonance's caseMethodKey, which cuts the namespace on purpose.
//
// ── The honest-unknown contract ─────────────────────────────────────────────────────────────
// A case whose name is not a literal in the source is NOT enumerated. It lands in `unresolved`
// with a reason, `expected` becomes null, and every caller must read that as CANNOT VERIFY for
// this file — never as "no cases" and never as "the artifact count is fine". A count that cannot
// be derived is the `derivable = false` lane of Resonance's [TestCaseSource], and it is printed,
// not swallowed.
//
// ── Known limits, stated rather than hidden ─────────────────────────────────────────────────
// • JSX text is not parsed. An apostrophe in JSX text (`<p>don't</p>`) opens a string state; the
//   scanner reports `unterminated ' string at line N` in `unparsable` and the whole file becomes
//   CANNOT VERIFY. If two such apostrophes pair up, the scan can be wrong without saying so —
//   this is the one case where this module could be silently mistaken, and the balance check
//   below is what usually catches it.
// • `bench(` sites are collected separately in `benches` and are NOT cases: `vitest run` does not
//   execute benchmarks, so counting them in `expected` would make every count comparison lie.
// • A case generated inside a loop or an iteration callback is `unresolved` by enclosure, even
//   when its name happens to be a literal: multiplicity is unknown. The enclosure test
//   over-approximates on purpose — it errs toward CANNOT VERIFY, never toward green.
// • A RENAMED test head is not followed. `test.extend({…})` assigned to a name is DETECTED and
//   makes the file not enumerable (it lands in `unparsable`), because its cases would otherwise
//   be invisible — an undercount is the one direction a gate must never fail in. A plain alias
//   (`const t = it;`) is NOT detectable by a token scan and would undercount silently: that is
//   the reason L-testshape requires the declared call heads in a spec test, and the reason this
//   limit is written down here rather than left to be discovered.

import { createHash } from 'node:crypto';

/** Call heads this module recognises. `suite` is Vitest's alias of `describe`. */
const SUITE_HEADS = new Set(['describe', 'suite']);
const TEST_HEADS = new Set(['it', 'test']);
const BENCH_HEADS = new Set(['bench']);

/** Modifiers that take their own argument list before the name: `it.each(table)('…')`. */
const CALL_MODIFIERS = new Set(['each', 'for', 'skipIf', 'runIf', 'extend']);

/** Every modifier this module knows. An unknown one makes the case unresolved, not ignored. */
const KNOWN_MODIFIERS = new Set([
  'each',
  'for',
  'skip',
  'todo',
  'only',
  'fails',
  'concurrent',
  'sequential',
  'shuffle',
  'skipIf',
  'runIf',
  'extend',
  'scoped',
]);

const KEYWORDS_BEFORE_REGEX = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'yield',
  'await',
  'case',
  'do',
  'else',
]);

// A '/' after one of these characters starts a regex literal; after anything else it is division.
// '<' and '>' are deliberately NOT here: in a .tsx file `</div>` would otherwise be read as the
// start of a regex and swallow the rest of the line.
const REGEX_PRECEDERS = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '^', '~']);

const IDENT_CHAR = /[A-Za-z0-9_$]/;

function isWs(c) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function posAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] + 1 };
}

function readEscape(text, i) {
  // i points at the backslash. Only the escapes that can change a NAME are cooked; the rest are
  // kept literally, which is enough for comparing a name against the artifact.
  const c = text[i + 1];
  if (c === undefined) return ['\\', i + 1];
  if (c === 'n') return ['\n', i + 2];
  if (c === 't') return ['\t', i + 2];
  if (c === 'r') return ['\r', i + 2];
  if (c === '0') return ['\0', i + 2];
  if (c === 'u' && text[i + 2] === '{') {
    const close = text.indexOf('}', i + 3);
    if (close > 0) {
      const code = Number.parseInt(text.slice(i + 3, close), 16);
      if (Number.isFinite(code)) return [String.fromCodePoint(code), close + 1];
    }
    return [c, i + 2];
  }
  if (c === 'u') {
    const code = Number.parseInt(text.slice(i + 2, i + 6), 16);
    if (Number.isFinite(code)) return [String.fromCharCode(code), i + 6];
    return [c, i + 2];
  }
  if (c === 'x') {
    const code = Number.parseInt(text.slice(i + 2, i + 4), 16);
    if (Number.isFinite(code)) return [String.fromCharCode(code), i + 4];
    return [c, i + 2];
  }
  if (c === '\n') return ['', i + 2];
  return [c, i + 2];
}

/**
 * Mask everything that is not code: comments, string and template literals, regex literals and
 * `${…}` substitutions. Newlines survive, so every offset keeps its line — otherwise every
 * `path:line` this module reports would be a lie.
 *
 * @param {string} text
 * @returns {{ code: string, literals: Map<number, object>, problems: string[] }}
 */
export function scanSource(text) {
  if (typeof text !== 'string') {
    throw new TypeError('scanSource(text): the file text must be a string');
  }
  const src = text;
  const n = src.length;
  // One slot per UTF-16 code UNIT, not per code point: `[...src]` would split by code points, a
  // surrogate pair would occupy one slot, and every offset after the first astral character
  // (an emoji in a case name, say) would be off by one. Offsets are what `path:line` is made of.
  const out = Array.from({ length: n }, (_, i) => src[i]);
  const literals = new Map();
  const problems = [];
  const starts = lineStarts(src);
  const at = (o) => posAt(starts, o);

  const mask = (a, b) => {
    for (let k = Math.max(0, a); k < Math.min(b, n); k += 1) if (out[k] !== '\n') out[k] = ' ';
  };

  let prevChar = '';
  let prevWord = '';

  function readQuoted(start) {
    const q = src[start];
    let i = start + 1;
    let value = '';
    let terminated = false;
    while (i < n) {
      const c = src[i];
      if (c === '\\') {
        const [v, ni] = readEscape(src, i);
        value += v;
        i = ni;
        continue;
      }
      if (c === q) {
        i += 1;
        terminated = true;
        break;
      }
      if (c === '\n') {
        problems.push(`unterminated ${q} string at line ${at(start).line}`);
        break;
      }
      value += c;
      i += 1;
    }
    if (!terminated && i >= n) problems.push(`unterminated ${q} string at line ${at(start).line}`);
    literals.set(start, { start, end: i, kind: 'quoted', quote: q, value, isLiteral: terminated });
    mask(start, i);
    return i;
  }

  function readRegex(start) {
    // Returns -1 when this '/' is not a regex after all (a newline inside, or an empty body).
    let i = start + 1;
    let inClass = false;
    while (i < n) {
      const c = src[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '\n') return -1;
      if (inClass) {
        if (c === ']') inClass = false;
        i += 1;
        continue;
      }
      if (c === '[') {
        inClass = true;
        i += 1;
        continue;
      }
      if (c === '/') {
        i += 1;
        while (i < n && IDENT_CHAR.test(src[i])) i += 1;
        literals.set(start, { start, end: i, kind: 'regex', value: null, isLiteral: false });
        mask(start, i);
        return i;
      }
      i += 1;
    }
    return -1;
  }

  function readTemplate(start) {
    let i = start + 1;
    let value = '';
    let isLiteral = true;
    let terminated = false;
    while (i < n) {
      const c = src[i];
      if (c === '\\') {
        const [v, ni] = readEscape(src, i);
        value += v;
        i = ni;
        continue;
      }
      if (c === '`') {
        i += 1;
        terminated = true;
        break;
      }
      if (c === '$' && src[i + 1] === '{') {
        isLiteral = false;
        // The whole substitution is cut, braces included: cutting a balanced region keeps the
        // paren/brace balance of `code` intact, which is what the call-site matcher relies on.
        i = scanCode(i + 2, true);
        continue;
      }
      value += c;
      i += 1;
    }
    if (!terminated) problems.push(`unterminated template literal at line ${at(start).line}`);
    // A literal leaves NO trace in `code`, template or not: that single rule is why a caller may
    // rely on `code` holding nothing but code. The literals map is how a call site finds its name.
    mask(start, i);
    literals.set(start, {
      start,
      end: i,
      kind: 'template',
      quote: '`',
      value: isLiteral ? value : null,
      isLiteral: isLiteral && terminated,
    });
    return i;
  }

  function regexAllowed() {
    if (prevWord !== '' && KEYWORDS_BEFORE_REGEX.has(prevWord)) return true;
    if (prevChar !== '' && IDENT_CHAR.test(prevChar)) return false;
    return REGEX_PRECEDERS.has(prevChar);
  }

  function scanCode(from, stopAtBrace) {
    let i = from;
    let depth = 0;
    while (i < n) {
      const c = src[i];
      const two = c + (src[i + 1] ?? '');
      if (two === '//') {
        let e = src.indexOf('\n', i);
        if (e < 0) e = n;
        mask(i, e);
        i = e;
        continue;
      }
      if (two === '/*') {
        const found = src.indexOf('*/', i + 2);
        const e = found < 0 ? n : found + 2;
        if (found < 0) problems.push(`unterminated block comment at line ${at(i).line}`);
        mask(i, e);
        i = e;
        continue;
      }
      if (c === "'" || c === '"') {
        i = readQuoted(i);
        prevChar = ')';
        prevWord = '';
        continue;
      }
      if (c === '`') {
        i = readTemplate(i);
        prevChar = ')';
        prevWord = '';
        continue;
      }
      if (c === '/' && regexAllowed()) {
        const e = readRegex(i);
        if (e > 0) {
          i = e;
          prevChar = ')';
          prevWord = '';
          continue;
        }
      }
      if (stopAtBrace) {
        if (c === '{') depth += 1;
        else if (c === '}') {
          if (depth === 0) return i + 1;
          depth -= 1;
        }
      }
      if (!isWs(c)) {
        prevChar = c;
        if (IDENT_CHAR.test(c)) {
          let j = i;
          let word = '';
          while (j < n && IDENT_CHAR.test(src[j])) {
            word += src[j];
            j += 1;
          }
          prevWord = word;
          i = j;
          prevChar = src[j - 1];
          continue;
        }
        prevWord = '';
      }
      i += 1;
    }
    if (stopAtBrace) problems.push('unterminated ${…} substitution');
    return i;
  }

  scanCode(0, false);
  const code = out.join('');

  // A balance check on the MASKED text. Code can of course be unbalanced while being edited, but
  // an imbalance here also means the mask itself may have gone wrong (an apostrophe in JSX text,
  // say) — so it is reported, and every caller reads this file as CANNOT VERIFY.
  const counts = { '(': 0, '{': 0, '[': 0 };
  const pairs = { ')': '(', '}': '{', ']': '[' };
  for (const c of code) {
    if (c === '(' || c === '{' || c === '[') counts[c] += 1;
    else if (c in pairs) counts[pairs[c]] -= 1;
  }
  for (const [open, delta] of Object.entries(counts)) {
    if (delta !== 0) problems.push(`unbalanced '${open}' in the masked source (${delta > 0 ? delta + ' unclosed' : -delta + ' extra closing'})`);
  }

  return { code, literals, problems };
}

/** The masked text alone — comments, literals and `${…}` gone, every offset and line preserved. */
export function codeOnly(text) {
  return scanSource(text).code;
}

function matchGroup(code, open, openChar = '(', closeChar = ')') {
  if (code[open] !== openChar) return -1;
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (c === openChar) depth += 1;
    else if (c === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function skipWs(code, i) {
  let j = i;
  while (j < code.length && isWs(code[j])) j += 1;
  return j;
}

/**
 * Advance to the next token, where a MASKED LITERAL counts as a token rather than as whitespace.
 * This is the one trap of scanning masked text: a literal becomes spaces, so a plain whitespace
 * skip walks straight over the name of the case it was looking for.
 */
function skipToToken(code, i, literals) {
  let j = i;
  while (j < code.length && isWs(code[j]) && !literals.has(j)) j += 1;
  return j;
}

// No lookahead for '(' here: the opening paren can be preceded by a masked literal, and a bare
// identifier that is not a call at all (`import { it } from 'vitest'`) is DROPPED after the
// post-check rather than reported as a broken case.
const SITE_RE = /(^|[^\w$.])(describe|suite|it|test|bench)((?:\.[A-Za-z]+)*)/g;

const LOOP_RE = /\bfor[ \t]*\(|\bwhile[ \t]*\(|\.(?:forEach|map|flatMap|reduce)[ \t]*\(/g;

function loopSpans(code) {
  const spans = [];
  LOOP_RE.lastIndex = 0;
  let m;
  while ((m = LOOP_RE.exec(code)) !== null) {
    const open = code.indexOf('(', m.index);
    if (open < 0) continue;
    const close = matchGroup(code, open);
    if (close < 0) continue;
    let end = close;
    const isStatement = /^\s*(for|while)/.test(m[0]);
    if (isStatement) {
      const next = skipWs(code, close + 1);
      if (code[next] === '{') {
        const brace = matchGroup(code, next, '{', '}');
        if (brace > 0) end = brace;
      } else {
        const semi = code.indexOf(';', close + 1);
        end = semi < 0 ? code.length : semi;
      }
    }
    spans.push({ start: m.index, end, what: m[0].trim().replace(/[ \t]*\($/, '') });
  }
  return spans;
}

function digestOf(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}

/**
 * A `.extend` whose call is not followed by a case name builds a renamed test function. Cases
 * called through that name are invisible to a token scan, and an UNDERCOUNT is the one direction
 * a gate must never fail in — so the file is declared not enumerable, loudly.
 */
function noteIfRenamedHead(chain, head, identStart, notes, starts) {
  if (!chain.includes('extend')) return;
  notes.push(
    `${head}.extend at line ${posAt(starts, identStart).line} builds a RENAMED test function; ` +
      'cases called through it are invisible to this enumerator, so the file is not enumerable',
  );
}

function collectSites(src, scan, starts) {
  const { code, literals } = scan;
  const sites = [];
  const notes = [];
  SITE_RE.lastIndex = 0;
  let m;
  while ((m = SITE_RE.exec(code)) !== null) {
    const identStart = m.index + m[1].length;
    const head = m[2];
    const chain = m[3] === '' ? [] : m[3].slice(1).split('.');
    let p = skipToToken(code, m.index + m[0].length, literals);

    const unknown = chain.filter((c) => !KNOWN_MODIFIERS.has(c));
    const callMods = chain.filter((c) => CALL_MODIFIERS.has(c));
    let bad = null;

    const tagged = literals.get(p);
    if (tagged !== undefined && tagged.kind === 'template') {
      // Tagged-template form: it.each`table`('name', fn). The backticks are masked, so the
      // literals map is the only way to see it.
      p = skipToToken(code, tagged.end, literals);
    } else if (code[p] !== '(') {
      // Not a call: an import binding, a re-export, a bare identifier. Dropped — but a dropped
      // `.extend` is never dropped quietly (see noteIfRenamedHead).
      noteIfRenamedHead(chain, head, identStart, notes, starts);
      continue;
    } else {
      for (let k = 0; k < callMods.length; k += 1) {
        if (code[p] !== '(') {
          bad = `expected the argument list of .${callMods[k]}`;
          break;
        }
        const close = matchGroup(code, p);
        if (close < 0) {
          bad = `unbalanced argument list of .${callMods[k]}`;
          break;
        }
        p = skipToToken(code, close + 1, literals);
      }
    }

    if (bad === null && code[p] !== '(') {
      if (tagged === undefined) {
        // `test.extend({…})` with no name group after it: a fixture-extended test FUNCTION, not
        // a case. Its own cases run under the name it is assigned to, which a token scan cannot
        // follow — so the file is declared not enumerable instead of silently undercounted.
        noteIfRenamedHead(chain, head, identStart, notes, starts);
        continue;
      }
      bad = 'no argument list after the tagged template';
    }

    let callOpen = -1;
    let callClose = -1;
    if (bad === null) {
      callOpen = p;
      callClose = matchGroup(code, p);
      if (callClose < 0) bad = 'unbalanced argument list';
    }

    let nameLiteral = null;
    let nameStart = -1;
    if (bad === null) {
      nameStart = skipToToken(code, callOpen + 1, literals);
      const lit = literals.get(nameStart);
      if (lit !== undefined && (lit.kind === 'quoted' || lit.kind === 'template')) nameLiteral = lit;
    }

    sites.push({
      head,
      chain,
      unknown,
      identStart,
      callOpen,
      callClose,
      end: callClose < 0 ? identStart : callClose,
      nameLiteral,
      nameStart,
      bad,
      raw: bad === null && callClose > 0 ? src.slice(identStart, Math.min(callClose + 1, nameStart + 60)) : src.slice(identStart, identStart + 60),
    });
  }
  return { sites, notes };
}

function innermostEnclosing(suites, site) {
  let best = null;
  for (const s of suites) {
    if (s.identStart < site.identStart && site.identStart <= s.end) {
      if (best === null || s.identStart > best.identStart) best = s;
    }
  }
  return best;
}

/**
 * Enumerate the cases of one test file from its text.
 *
 * @param {string} text the file's source
 * @param {{file?: string}} [options] `file` is used in messages only; it never changes a verdict
 * @returns {{
 *   cases: Array<{name: string, key: string, test: string, suite: string[], modifiers: string[],
 *                 skipped: boolean, only: boolean, line: number, column: number, offset: number,
 *                 bodyDigest: string, duplicate: boolean}>,
 *   unresolved: Array<{reason: string, head: string, modifiers: string[], suite: string[]|null,
 *                      line: number, column: number, raw: string}>,
 *   benches: Array<{name: string|null, line: number, column: number}>,
 *   suites: Array<{name: string|null, line: number, depth: number, resolved: boolean}>,
 *   expected: number|null,
 *   counts: {resolved: number, unresolved: number, skipped: number, only: number, sites: number},
 *   names: string[],
 *   keys: string[],
 *   duplicates: string[],
 *   hasOnly: boolean,
 *   topLevelSuites: number,
 *   unparsable: string[],
 *   cannotVerify: boolean,
 *   note: string|null
 * }}
 */
export function listCases(text, options = {}) {
  if (typeof text !== 'string') {
    throw new TypeError('listCases(text): the file text must be a string (use "" for a file that does not exist)');
  }
  const src = text;
  const scan = scanSource(src);
  const { code, problems } = scan;
  const starts = lineStarts(src);
  const at = (o) => posAt(starts, o);
  const loops = loopSpans(code);
  const { sites, notes: siteNotes } = collectSites(src, scan, starts);
  problems.push(...siteNotes);

  const suiteSites = sites.filter((s) => SUITE_HEADS.has(s.head));
  const testSites = sites.filter((s) => TEST_HEADS.has(s.head));
  const benchSites = sites.filter((s) => BENCH_HEADS.has(s.head));

  const unresolved = [];
  const suiteInfo = new Map();

  function loopAround(site) {
    for (const span of loops) {
      if (span.start < site.identStart && site.identStart <= span.end) return span.what;
    }
    return null;
  }

  function reasonsFor(site) {
    const r = [];
    if (site.bad !== null) r.push(site.bad);
    if (site.unknown.length > 0) r.push(`unknown modifier${site.unknown.length > 1 ? 's' : ''} .${site.unknown.join(', .')}`);
    const eachLike = site.chain.find((c) => c === 'each' || c === 'for');
    if (eachLike !== undefined) {
      r.push(`.${eachLike} — one case per row, and the row names are FORMATTED by Vitest (measured: '%i' is substituted), so the names cannot be derived from the source`);
    }
    if (site.bad === null && site.nameLiteral === null) r.push('the name is not a string literal');
    if (site.bad === null && site.nameLiteral !== null && !site.nameLiteral.isLiteral) {
      r.push('the name is a template literal with a ${…} substitution — resolved at runtime');
    }
    const loop = loopAround(site);
    if (loop !== null) r.push(`generated inside \`${loop}\` — the number of cases is not derivable`);
    return r;
  }

  // Suites first: an unresolved suite name makes every case under it unresolved, because the
  // JUnit name is the full suite path.
  for (const s of suiteSites) {
    const r = reasonsFor(s);
    const resolved = r.length === 0;
    suiteInfo.set(s, {
      site: s,
      resolved,
      name: resolved ? s.nameLiteral.value : null,
      reasons: r,
    });
  }

  function suitePath(site) {
    const path = [];
    let cur = innermostEnclosing(suiteSites, site);
    while (cur !== null) {
      path.unshift(cur);
      cur = innermostEnclosing(suiteSites, cur);
    }
    return path;
  }

  const cases = [];
  for (const s of testSites) {
    const path = suitePath(s);
    const brokenSuite = path.find((p) => !suiteInfo.get(p).resolved);
    const r = reasonsFor(s);
    if (brokenSuite !== undefined) {
      const info = suiteInfo.get(brokenSuite);
      r.push(`the enclosing describe at line ${at(brokenSuite.identStart).line} is unresolved (${info.reasons.join('; ')})`);
    }
    const pos = at(s.identStart);
    if (r.length > 0) {
      unresolved.push({
        reason: r.join('; '),
        head: s.head + (s.chain.length > 0 ? `.${s.chain.join('.')}` : ''),
        modifiers: s.chain,
        suite: brokenSuite === undefined ? path.map((p) => suiteInfo.get(p).name) : null,
        line: pos.line,
        column: pos.column,
        raw: s.raw.replace(/\s+/g, ' ').slice(0, 80),
      });
      continue;
    }
    const suite = path.map((p) => suiteInfo.get(p).name);
    const testName = s.nameLiteral.value;
    const body = src.slice(s.nameLiteral.end, s.callClose).replace(/\s+/g, ' ').trim();
    cases.push({
      name: [...suite, testName].join(' > '),
      key: `${suite.length > 0 ? suite[suite.length - 1] : ''}::${testName}`,
      test: testName,
      suite,
      modifiers: s.chain,
      skipped: s.chain.includes('skip') || s.chain.includes('todo'),
      only: s.chain.includes('only'),
      line: pos.line,
      column: pos.column,
      offset: s.identStart,
      bodyDigest: digestOf(body),
      duplicate: false,
    });
  }

  const benches = benchSites.map((b) => {
    const pos = at(b.identStart);
    return {
      name: b.nameLiteral !== null && b.nameLiteral.isLiteral ? b.nameLiteral.value : null,
      line: pos.line,
      column: pos.column,
    };
  });

  // Duplicate names: either a copy-paste or a loop this module could not see. Either way the
  // mapping name → case is not 1:1, so the artifact cannot be matched by name any more.
  const seen = new Map();
  for (const c of cases) seen.set(c.name, (seen.get(c.name) ?? 0) + 1);
  const duplicates = [...seen.entries()].filter(([, k]) => k > 1).map(([name]) => name);
  for (const c of cases) if (seen.get(c.name) > 1) c.duplicate = true;

  const skippedCount = cases.filter((c) => c.skipped).length;
  const onlyCount = cases.filter((c) => c.only).length;

  const notes = [];
  if (unresolved.length > 0) notes.push(`${unresolved.length} case site(s) could not be enumerated`);
  if (duplicates.length > 0) notes.push(`duplicate case name(s): ${duplicates.join(', ')}`);
  if (problems.length > 0) notes.push(`scanner: ${problems.join('; ')}`);
  if (benches.length > 0) notes.push(`${benches.length} bench() site(s) are not counted as cases (vitest run does not execute them)`);

  const derivable = unresolved.length === 0 && duplicates.length === 0 && problems.length === 0;

  return {
    cases,
    unresolved,
    benches,
    suites: [...suiteInfo.values()].map((i) => ({
      name: i.name,
      line: at(i.site.identStart).line,
      depth: suitePath(i.site).length,
      resolved: i.resolved,
    })),
    // `expected` is the number of <testcase> elements the artifact must carry for this file —
    // skipped and todo cases included, because a <testcase> IS emitted for them (measured).
    // null means "not derivable": the caller must read CANNOT VERIFY, never "zero".
    expected: derivable ? cases.length : null,
    counts: {
      resolved: cases.length,
      unresolved: unresolved.length,
      skipped: skippedCount,
      only: onlyCount,
      sites: testSites.length,
    },
    names: cases.map((c) => c.name),
    keys: cases.map((c) => c.key),
    duplicates,
    hasOnly: onlyCount > 0,
    topLevelSuites: [...suiteInfo.values()].filter((i) => suitePath(i.site).length === 0).length,
    unparsable: problems,
    cannotVerify: !derivable,
    note: notes.length > 0 ? `${options.file ? `${options.file}: ` : ''}${notes.join('; ')}` : null,
  };
}

/** The diff key of a case: innermost describe plus the test name, outer suites cut on purpose. */
export function caseKey(c) {
  if (c === null || typeof c !== 'object') return null;
  if (typeof c.key === 'string') return c.key;
  const suite = Array.isArray(c.suite) && c.suite.length > 0 ? c.suite[c.suite.length - 1] : '';
  return `${suite}::${c.test ?? ''}`;
}

/** The JUnit display name of a case: the full suite path and the test name, joined by ' > '. */
export function displayName(c) {
  if (typeof c.name === 'string') return c.name;
  return [...(c.suite ?? []), c.test].join(' > ');
}

/**
 * What changed between two revisions of ONE test file's text.
 *
 * Read `cannotVerify` FIRST. When it is true the diff is not a proof: a side carried cases this
 * module could not enumerate, so `added` being empty does NOT mean nothing was added. red-check
 * must report CANNOT VERIFY for the file instead of concluding there is nothing to make red.
 *
 * `renamed` is a 1:1 pairing only: an added case and a removed case whose bodies are byte-equal
 * after whitespace collapsing, when exactly one of each shares that body. Two copies of the same
 * body stay in `added`/`removed`, because which one was renamed is unknowable.
 *
 * @param {string} before source at the base revision ('' when the file did not exist)
 * @param {string} after source at HEAD
 * @returns {{
 *   added: object[], removed: object[],
 *   renamed: Array<{from: object, to: object}>,
 *   changed: Array<{key: string, before: object, after: object}>,
 *   focusChanged: Array<{key: string, before: string[], after: string[]}>,
 *   unchanged: string[],
 *   hasNew: boolean,
 *   cannotVerify: boolean,
 *   reasons: string[],
 *   before: object, after: object
 * }}
 */
export function caseDiff(before, after) {
  // null/undefined means the file did not exist at that revision — the honest empty enumeration.
  const a = listCases(typeof before === 'string' ? before : '');
  const b = listCases(typeof after === 'string' ? after : '');

  const byKeyA = new Map(a.cases.map((c) => [c.key, c]));
  const byKeyB = new Map(b.cases.map((c) => [c.key, c]));

  const added = [];
  const removed = [];
  const changed = [];
  const focusChanged = [];
  const unchanged = [];

  for (const [key, c] of byKeyB) {
    const old = byKeyA.get(key);
    if (old === undefined) {
      added.push(c);
      continue;
    }
    if (old.bodyDigest !== c.bodyDigest) changed.push({ key, before: old, after: c });
    else unchanged.push(key);
    if (old.modifiers.join(',') !== c.modifiers.join(',')) {
      focusChanged.push({ key, before: old.modifiers, after: c.modifiers });
    }
  }
  for (const [key, c] of byKeyA) if (!byKeyB.has(key)) removed.push(c);

  // Rename detection: a body that appears exactly once on each side.
  const renamed = [];
  const addedByBody = new Map();
  const removedByBody = new Map();
  for (const c of added) addedByBody.set(c.bodyDigest, (addedByBody.get(c.bodyDigest) ?? []).concat(c));
  for (const c of removed) removedByBody.set(c.bodyDigest, (removedByBody.get(c.bodyDigest) ?? []).concat(c));
  for (const [body, group] of addedByBody) {
    const peers = removedByBody.get(body);
    if (group.length === 1 && peers !== undefined && peers.length === 1) {
      renamed.push({ from: peers[0], to: group[0] });
    }
  }
  const renamedTo = new Set(renamed.map((r) => r.to.key));
  const renamedFrom = new Set(renamed.map((r) => r.from.key));
  const addedOut = added.filter((c) => !renamedTo.has(c.key));
  const removedOut = removed.filter((c) => !renamedFrom.has(c.key));

  const reasons = [];
  if (a.cannotVerify) reasons.push(`base revision: ${a.note ?? 'not enumerable'}`);
  if (b.cannotVerify) reasons.push(`head revision: ${b.note ?? 'not enumerable'}`);

  return {
    added: addedOut,
    removed: removedOut,
    renamed,
    changed,
    focusChanged,
    unchanged,
    hasNew: addedOut.length > 0,
    cannotVerify: a.cannotVerify || b.cannotVerify,
    reasons,
    before: a,
    after: b,
  };
}
