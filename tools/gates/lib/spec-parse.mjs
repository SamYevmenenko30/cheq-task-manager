/**
 * spec-parse — the ONE reader of `docs/specs/CHQ-<nnn>.md`, and the ONE home of
 * every closed dictionary the pipeline spells out loud (kinds, verdict labels,
 * standing light ids, required sections, trailer keys).
 *
 * Why one reader: a spec format with two readers drifts SILENTLY. The second
 * reader tolerates a shape the first refuses, or splits a field one character
 * differently, and nothing fails — the two just disagree about what the spec
 * says, and the gate that happened to be asked wins. So spec-gate, red-check,
 * test-guard, ready.mjs, the lights and the digest generator all import this
 * module and none of them matches a spec line with a regex of its own. The same
 * applies to the dictionaries: a `kind` list copied into a second file is a
 * second list, and the day a kind is added one of them is quietly wrong.
 *
 * What it reads (the shape `docs/templates/SPEC.md` ships):
 *   front-matter (`contracts: forbidden|allowed` — the ONLY field) ·
 *   `# SPEC: CHQ-nnn — <title>` · `Revision: <n>` · the twelve `##` sections ·
 *   assertions `- **S1** …` with their `key: value · key: value` sub-bullets ·
 *   the `## AC map` and `## Lights` tables · `## Open questions` (Qn) ·
 *   `## Syrup` (Yn) · the `## Appendix` boundary the test phase must not cross.
 *
 * Three properties this module is responsible for:
 *   1. NO FILESYSTEM. `parseSpec(text, { path })` is pure, so it can be called
 *      on the output of `git show HEAD:docs/specs/CHQ-001.md` — which is what a
 *      gate must do: reading the working tree would turn an uncommitted edit
 *      into a green hook. `readSpecAtRev()` is the one function that shells out
 *      to git, it is never called from parseSpec, and nothing else here touches
 *      a path.
 *   2. NEVER THROWS ON CONTENT. A shape problem lands in `unparsable[]` or in an
 *      item's `problems[]` with a code from a closed list, and the caller fails
 *      closed on it. A form that is not in a dictionary is CANNOT VERIFY — never
 *      "looks like" the nearest known form.
 *   3. VERBATIM STAYS VERBATIM. `## Vision (verbatim)` is returned as text, not
 *      as parsed items, and `isVerbatimQuote()` is an exact-substring test, so a
 *      Yn that was tidied up while being quoted fails instead of passing.
 *
 * Zero dependencies, Node 22 ESM: only `node:child_process` is imported, and
 * only by `readSpecAtRev`. A gate must run in a fresh worktree before an
 * install has finished.
 */

import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------- dictionaries

/**
 * The four kinds. `kind` is the whole routing table: a kind names the jest
 * project of the same name, the directory a spec test lives in, the artifact the
 * verdict is read from, and the runner `verify:` prints. There is no registry in
 * the middle, which is why the name has to be the same word in all four places.
 */
export const SPEC_KINDS = ['core', 'api', 'web', 'e2e'];
/** Alias: the port plan calls this list `KINDS`. One array, two names, no copy. */
export const KINDS = SPEC_KINDS;

/**
 * What a gate may say about a lane. `cannot-verify` is a first-class verdict,
 * not a dressed-up failure: a missing artifact, `tests="0"` with cases in the
 * sources, an unreadable log and a run that never happened are all this word,
 * and none of them is green. `n/a` is narrower and is decided from the SOURCES
 * only (a project whose sources declare no case is not launched).
 */
export const VERDICTS = ['green', 'red', 'cannot-verify', 'n/a'];
export const VERDICT_LABELS = {
  green: 'GREEN',
  red: 'RED',
  'cannot-verify': 'CANNOT VERIFY',
  'n/a': 'n/a',
};
/** Per-case tri-state (`junit-xml.mjs` `toTri` maps into exactly these). */
export const CASE_VERDICTS = ['green', 'red', 'skipped'];
/** A light reports one of these; `cannot-verify` prints as `CANNOT VERIFY`. */
export const LIGHT_STATUSES = ['pass', 'fail', 'cannot-verify'];
export const SEVERITIES = ['hard', 'soft'];

/**
 * `pending implementation` is NOT a verdict — it is a hook-only tolerance. The
 * tree where every type error is a missing symbol inside a placed spec test is
 * the normal state between the test phase and the implementation phase, so
 * `ready.mjs --quick` prints it as a warning; every strict run on the same tree
 * fails. Gates that construct the detail string use this prefix so the one place
 * that recognises the tolerance can keep recognising it.
 */
export const PENDING_IMPLEMENTATION = 'pending implementation';
export const PENDING_IMPLEMENTATION_PREFIX = `${PENDING_IMPLEMENTATION}:`;

/**
 * `verify:` is DERIVED from `kind:` and never typed by hand. It names the RUNNER
 * of record and nothing else: no version, no path, no machine-local state. The
 * reason is recorded rather than assumed — in Resonance a `(pending-calibration)`
 * suffix made a committed spec a function of a gitignored per-machine file, so
 * the spec failed its own gate after every package change and on every fresh
 * clone. Machine-local conditions are REPORTED by the gate, never compared with
 * a spec.
 */
export function deriveVerify(kind) {
  switch (kind) {
    case 'core':
      return 'tsc-noemit + jest-core';
    case 'api':
      return 'tsc-noemit + jest-api';
    case 'web':
      return 'tsc-noemit + jest-web';
    case 'e2e':
      return 'playwright-chromium';
    default:
      return null;
  }
}

export const DERIVED_VERIFY = Object.freeze(
  Object.fromEntries(SPEC_KINDS.map((k) => [k, deriveVerify(k)])),
);

/**
 * Retired `verify:` spellings — a spec still carrying one FAILS, it is never
 * tolerated. The list is EMPTY on purpose: nothing has been retired in this
 * repository yet. It stays as the hook a format migration hangs on, so the
 * migration is a line here instead of a silent pass.
 */
export const RETIRED_VERIFY = [];

/** Front-matter `contracts:` — the only field, and these are the only values. */
export const CONTRACTS = ['forbidden', 'allowed'];
export const DEFAULT_CONTRACTS = 'forbidden';

/**
 * `home:` forms (rule 16: one owner per shared file). A home either names a form
 * from this list plus a path, or is a bare package/module name. A `<word>: …`
 * value whose word is not here is CANNOT VERIFY — `component:` is not silently
 * read as `screen:`.
 */
export const HOME_FORMS = ['module', 'route', 'screen'];

/**
 * The sixteen standing lights, in the order `ready` prints them.
 *
 * `severity` is declared for every id, and each value was READ OUT OF the light
 * module that owns it (`export const severity` in
 * `tools/gates/lights/<id without L->.mjs`), never chosen here: two of the
 * sixteen are `soft` — `L-homes`, because a hard light on shared files would
 * block ordinary work until enough specs exist to name their homes, and
 * `L-browser`, because no browser is installed (TD-0001) — and the other
 * fourteen are `hard`. The probe
 * `probes/lights.mjs` → "STANDING_LIGHTS agrees with each module's own severity"
 * compares the two sides mechanically, so the pair cannot drift: nine of these
 * rows stood at `null` while every module declared one, and the pack read all
 * nine as `hard` and printed a line naming them.
 *
 * A row may still be `null` — a light whose module is not written yet — and
 * `severityOf` below says how an aggregator must treat one: fail closed, and say
 * out loud that it was undeclared.
 *
 * `fast` is membership in `lights --fast`, the set the pre-commit hook runs:
 * everything Editor-free in Resonance's sense, i.e. no browser, no worktree, no
 * network, no double run.
 */
export const STANDING_LIGHTS = [
  { id: 'L-tsc', severity: 'hard', fast: true, title: 'every project typechecks; pending-implementation is a hook tolerance only' },
  { id: 'L-core-purity', severity: 'hard', fast: true, title: 'the core boundary: compiler, loaded-file graph, token scan' },
  { id: 'L-graph', severity: 'hard', fast: true, title: 'the package dependency graph, no cycle' },
  { id: 'L-lint', severity: 'hard', fast: true, title: 'oxlint ran type-aware, linted more than zero files, no file-level suppression of a boundary rule' },
  { id: 'L-type-engines', severity: 'hard', fast: true, title: 'exactly ONE type engine, and tsgolint on the same major' },
  { id: 'L-testshape', severity: 'hard', fast: true, title: 'spec tests carry literal S<n>_ titles and no @ts-expect-error / @ts-nocheck / as any' },
  { id: 'L-testguard', severity: 'hard', fast: true, title: 'test-guard as a light' },
  { id: 'L-deps', severity: 'hard', fast: true, title: 'no dependency without a `package:` line and a lockfile change; vendor digest present' },
  { id: 'L-orphans', severity: 'hard', fast: true, title: 'no tracked source outside its project; every test matched by exactly one jest project' },
  { id: 'L-visible', severity: 'hard', fast: true, title: 'every blind spot of every walk is declared' },
  // NOT on the fast path, and that is about HORIZONS rather than cost. This light's subject is what
  // the COMMITTED file says: it reads `git show HEAD:<path>` on purpose and documents why — a
  // work-tree read would pass on a fresh render nobody committed, leaving history with a stale
  // projection. The hook runs BEFORE the commit, so HEAD is the PREVIOUS one, and every commit that
  // legitimately regenerates a file therefore looks stale to it. Measured 2026-11-02 on CHQ-001's
  // test-phase commit, which regenerates docs/digests/core-exports.md: the hook refused it, and the
  // refusal was about a commit that did not exist yet. It stays `hard` in `--all`, which is the check
  // of record and runs on a clean tree where HEAD and the work tree are the same bytes.
  { id: 'L-generated', severity: 'hard', fast: false, title: 'a generated file is re-generated and diffed, never hand-edited' },
  { id: 'L-stubkit', severity: 'hard', fast: true, title: 'a stub renders no invented data: path, STUB marker, stubkit only' },
  { id: 'L-homes', severity: 'soft', fast: false, title: 'an edit outside the homes a spec named is REPORTED' },
  { id: 'L-env-parity', severity: 'hard', fast: false, title: 'the core set under node and under jsdom agree case by case' },
  { id: 'L-browser', severity: 'soft', fast: false, title: 'the e2e lane: CANNOT VERIFY until the browser probe is observed' },
  { id: 'L-artifacts', severity: 'hard', fast: false, title: 'a run of record writes only into its own run directory; one browser run at a time' },
];
export const STANDING_LIGHT_IDS = STANDING_LIGHTS.map((l) => l.id);
export const FAST_LIGHT_IDS = STANDING_LIGHTS.filter((l) => l.fast).map((l) => l.id);

/**
 * `{ severity, declared }` for a light id. An UNDECLARED severity is treated as
 * `hard` by an aggregator — a light nobody classified must not be the one that
 * stays green — and the aggregator prints `(severity undeclared)` so the gap is
 * visible instead of inherited.
 */
export function severityOf(id) {
  const row = STANDING_LIGHTS.find((l) => l.id === id);
  if (!row) return { severity: null, declared: false, known: false };
  return { severity: row.severity ?? 'hard', declared: row.severity !== null, known: true };
}

/** Commit-message trailer keys. `trailers.mjs` imports this list, never its own copy. */
export const TRAILER_KEYS = ['green', 'spec-approved', 'spec-conflict', 'spec-change', 'package'];
/**
 * A trailer is a line that BEGINS at column zero. An indented or quoted copy
 * declares nothing — which is exactly how `process.md` tells a commit message
 * to show an example trailer without making it real.
 */
export const TRAILER_LINE_RE = new RegExp(`^(${TRAILER_KEYS.join('|')}): (.*)$`);

/** The spellings that mean "no open question". A localised `- нет` is a LIVE question. */
export const NO_ITEM_MARKERS = ['none', 'n/a', '<none>'];
const NO_ITEM_RE = /^(none|n\/a|<none>)[.!]?$/i;

// ------------------------------------------------------------------- spec ids

export const SPEC_ID_RE = /^CHQ-(\d{3,})$/;
export const SPEC_FILE_RE = /^docs\/specs\/CHQ-(\d{3,})\.md$/;

export const isSpecId = (s) => SPEC_ID_RE.test(String(s ?? ''));

/** `CHQ-007` → `docs/specs/CHQ-007.md`. Repo-relative, forward slashes, always. */
export function specPath(id) {
  if (!isSpecId(id)) throw new Error(`not a spec id: ${JSON.stringify(id)} (expected CHQ-<nnn>)`);
  return `docs/specs/${id}.md`;
}

/** `docs/specs/CHQ-007.md` → `CHQ-007`, else null. Accepts a leading `./`. */
export function specIdOfPath(path) {
  const m = String(path ?? '').replace(/^\.\//, '').match(SPEC_FILE_RE);
  return m ? `CHQ-${m[1]}` : null;
}

/** `contracts: allowed` puts the interfaces here and nowhere else. */
export function contractsDir(id) {
  if (!isSpecId(id)) throw new Error(`not a spec id: ${JSON.stringify(id)}`);
  return `packages/core/src/contracts/${id}`;
}

/**
 * The next free id, given the ids that exist (the CALLER lists them — this
 * module does not read the filesystem). Numbers are never reused, so the next id
 * is max + 1 and not the first gap.
 */
export function nextSpecId(existingIds = []) {
  let max = 0;
  for (const id of existingIds) {
    const m = String(id ?? '').match(SPEC_ID_RE);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const width = Math.max(3, String(max + 1).length);
  return `CHQ-${String(max + 1).padStart(width, '0')}`;
}

// ------------------------------------------------------------- YAML subset

const stripComment = (s) => {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === q) q = null;
    } else if (ch === '"' || ch === "'") q = ch;
    else if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s;
};

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

/** Flow collections: `{a: 1, b: [x, y]}` / `[a, b]`. Returns [value, restIndex]. */
function parseFlow(s, i) {
  const skip = () => {
    while (i < s.length && /\s/.test(s[i])) i++;
  };
  skip();
  if (s[i] === '{') {
    i++;
    const obj = {};
    skip();
    if (s[i] === '}') return [obj, i + 1];
    for (;;) {
      skip();
      let key = '';
      if (s[i] === '"' || s[i] === "'") {
        const q = s[i++];
        while (i < s.length && s[i] !== q) key += s[i++];
        i++;
      } else while (i < s.length && s[i] !== ':') key += s[i++];
      if (s[i] !== ':') throw new Error(`flow map: expected ':' near "${s.slice(i, i + 20)}"`);
      i++;
      const [v, ni] = parseFlow(s, i);
      obj[key.trim()] = v;
      i = ni;
      skip();
      if (s[i] === ',') {
        i++;
        continue;
      }
      if (s[i] === '}') return [obj, i + 1];
      throw new Error(`flow map: expected ',' or '}' near "${s.slice(i, i + 20)}"`);
    }
  }
  if (s[i] === '[') {
    i++;
    const arr = [];
    skip();
    if (s[i] === ']') return [arr, i + 1];
    for (;;) {
      const [v, ni] = parseFlow(s, i);
      arr.push(v);
      i = ni;
      skip();
      if (s[i] === ',') {
        i++;
        continue;
      }
      if (s[i] === ']') return [arr, i + 1];
      throw new Error(`flow list: expected ',' or ']' near "${s.slice(i, i + 20)}"`);
    }
  }
  if (s[i] === '"' || s[i] === "'") {
    const q = s[i++];
    let v = '';
    while (i < s.length && s[i] !== q) v += s[i++];
    return [v, i + 1];
  }
  let v = '';
  while (i < s.length && !/[,}\]]/.test(s[i])) v += s[i++];
  return [parseScalar(v), i];
}

function parseValue(raw) {
  const s = stripComment(raw).trim();
  if (s.startsWith('{') || s.startsWith('[')) {
    const [v, end] = parseFlow(s, 0);
    if (s.slice(end).trim()) throw new Error(`trailing text after flow value: "${s.slice(end)}"`);
    return v;
  }
  return parseScalar(s);
}

function parseBlock(lines, start, indent) {
  if (start >= lines.length) return [null, start];
  const first = lines[start];
  if (first.indent !== indent) throw new Error(`unexpected indent ${first.indent} (expected ${indent}) at "${first.text}"`);
  if (first.text.startsWith('- ') || first.text === '-') return parseList(lines, start, indent);
  return parseMap(lines, start, indent);
}

const KEY_RE = /^([A-Za-z_][\w.-]*|"[^"]*"|'[^']*'):(\s+(.*))?$/;

function parseMap(lines, start, indent) {
  const obj = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const { text } = lines[i];
    if (text.startsWith('- ')) break;
    const m = text.match(KEY_RE);
    if (!m) throw new Error(`not a key: "${text}"`);
    const key = m[1].replace(/^["']|["']$/g, '');
    const rest = m[3] ?? '';
    if (rest.trim()) {
      obj[key] = parseValue(rest);
      i++;
    } else {
      i++;
      if (i < lines.length && lines[i].indent > indent) {
        const [v, ni] = parseBlock(lines, i, lines[i].indent);
        obj[key] = v;
        i = ni;
      } else obj[key] = null;
    }
  }
  return [obj, i];
}

function parseList(lines, start, indent) {
  const arr = [];
  let i = start;
  while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
    const rest = lines[i].text.slice(1).trim();
    if (!rest) {
      i++;
      if (i < lines.length && lines[i].indent > indent) {
        const [v, ni] = parseBlock(lines, i, lines[i].indent);
        arr.push(v);
        i = ni;
      } else arr.push(null);
      continue;
    }
    const km = rest.match(KEY_RE);
    if (km && !rest.startsWith('{') && !rest.startsWith('[') && !rest.startsWith('"') && !rest.startsWith("'")) {
      // `- key: value` → a map whose further keys sit at indent + 2 (the column of `key`)
      const col = indent + 2;
      const synthetic = [{ indent: col, text: rest }];
      let j = i + 1;
      while (j < lines.length && lines[j].indent >= col && lines[j].indent !== indent) synthetic.push(lines[j++]);
      const [v] = parseMap(synthetic, 0, col);
      arr.push(v);
      i = j;
    } else {
      arr.push(parseValue(rest));
      i++;
    }
  }
  return [arr, i];
}

/**
 * A hand-written YAML SUBSET: scalars, flow and block lists, nested maps. No
 * anchors, no multi-line scalars, no tabs. Anything outside the subset THROWS,
 * and `splitFrontMatter` turns that into an `unparsable[]` entry — the gates
 * have zero dependencies, so a shape nobody wrote a parser for must be refused
 * rather than guessed at.
 */
export function parseYamlSubset(text) {
  const lines = [];
  for (const raw of text.split('\n')) {
    const line = stripComment(raw.replace(/\r$/, ''));
    if (!line.trim()) continue;
    if (/\t/.test(line.match(/^\s*/)[0])) throw new Error('tabs in indentation');
    lines.push({ indent: line.match(/^ */)[0].length, text: line.trim() });
  }
  if (!lines.length) return {};
  const [v, end] = parseBlock(lines, 0, lines[0].indent);
  if (end < lines.length) throw new Error(`trailing content at "${lines[end].text}"`);
  return v;
}

/** `---\n…\n---` at the very top. Returns { frontMatter, body, bodyOffset, error }. */
export function splitFrontMatter(text) {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  if (lines[0] !== '---') return { frontMatter: null, body: text, bodyOffset: 0, error: null };
  const end = lines.indexOf('---', 1);
  if (end === -1) return { frontMatter: null, body: text, bodyOffset: 0, error: 'front-matter opened with --- but never closed' };
  const yaml = lines.slice(1, end).join('\n');
  try {
    return { frontMatter: parseYamlSubset(yaml), body: lines.slice(end + 1).join('\n'), bodyOffset: end + 1, error: null };
  } catch (e) {
    return { frontMatter: null, body: lines.slice(end + 1).join('\n'), bodyOffset: end + 1, error: `front-matter: ${e.message}` };
  }
}

// ------------------------------------------------------------------ sections

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The twelve `##` sections, in the order `docs/templates/SPEC.md` ships them.
 * The ORDER is prose in the README; the COMPOSITION is checked by spec-gate
 * against `REQUIRED_SECTION_KEYS`.
 *
 * `verbatim: true` marks the section whose text is never re-worded and never
 * parsed into items. `prefix: true` matches a heading that carries more words
 * after the name (`## Appendix: implementation notes`).
 */
export const SPEC_SECTIONS = [
  { key: 'vision', title: 'Vision (verbatim)', verbatim: true },
  { key: 'premise', title: 'Premise check' },
  { key: 'assertions', title: 'Assertions' },
  { key: 'acMap', title: 'AC map' },
  { key: 'crossPackage', title: 'Cross-package effects' },
  { key: 'nonGoals', title: 'Non-goals' },
  { key: 'lights', title: 'Lights' },
  { key: 'openQuestions', title: 'Open questions' },
  { key: 'answered', title: 'Answered questions' },
  { key: 'syrup', title: 'Syrup' },
  { key: 'contradictions', title: 'Contradictions with the project as it stands' },
  { key: 'appendix', title: 'Appendix', prefix: true, titleShown: 'Appendix: implementation notes' },
].map((s) =>
  Object.assign({}, s, {
    re: s.prefix
      ? new RegExp(`^#{2,6}\\s+${escapeRe(s.title)}\\b.*$`, 'i')
      : new RegExp(`^#{2,6}\\s+${escapeRe(s.title)}\\s*$`, 'i'),
  }),
);
export const REQUIRED_SECTION_KEYS = SPEC_SECTIONS.map((s) => s.key);
export const SECTION_TITLES = SPEC_SECTIONS.map((s) => s.titleShown ?? s.title);

/** Every heading in the body, with its level and 1-based line (within `lines`). */
export function sectionsAll(lines) {
  const out = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (m) out.push({ level: m[1].length, title: m[2], line: i + 1 });
  });
  return out;
}

/**
 * Body lines (1-based numbers) under the FIRST heading matching `re`, up to the
 * next heading of the same or lower depth. `start` is the HEADING's own line, so
 * a message about the section as a whole points at its title. A second heading
 * with the same title is never reached here — `parseSpec` names it as a
 * duplicate instead of silently preferring one of the two.
 */
function sectionBy(lines, re) {
  const start = lines.findIndex((l) => re.test(l.trim()));
  if (start === -1) return null;
  const level = lines[start].match(/^#+/)[0].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const h = lines[i].match(/^(#{1,6})\s/);
    if (h && h[1].length <= level) break;
    body.push({ line: i + 1, text: lines[i] });
  }
  return { start: start + 1, body };
}

// ------------------------------------------------------------------- pieces

const stripTicks = (s) => s.replace(/`/g, '').trim();

/** `key: value · key: value` sub-bullet pairs → object. Separator is ` · ` (U+00B7). */
function parsePairs(text) {
  const out = {};
  for (const part of text.split(/\s+·\s+/)) {
    const m = part.match(/^\s*([a-z_]+):\s*(.*)$/i);
    if (m) out[m[1].toLowerCase()] = stripTicks(m[2]);
  }
  return out;
}

/**
 * A `home:` value. `module|route|screen: <path>` → `{ form, path }`; a bare value
 * (`@cheq/core`) → `{ form: null, path: null, raw }`. A `<word>: …` whose word is
 * not a HOME_FORM is `{ unknownForm: '<word>' }` — the caller refuses it rather
 * than reading it as the nearest known form.
 */
export function parseHome(raw) {
  const value = stripTicks(String(raw ?? ''));
  if (!value) return { form: null, path: null, raw: '', empty: true, unknownForm: null };
  const m = value.match(/^([a-z-]+):\s*(.*)$/i);
  if (!m) return { form: null, path: null, raw: value, empty: false, unknownForm: null };
  const form = m[1].toLowerCase();
  if (!HOME_FORMS.includes(form)) return { form: null, path: null, raw: value, empty: false, unknownForm: form };
  return { form, path: m[2].trim(), raw: value, empty: false, unknownForm: null };
}

/** `due_date=differs, timezone=invariant` → [{ name, value }]; a part with no `=` is reported. */
export function parseInputs(raw) {
  const pairs = [];
  const bad = [];
  for (const part of String(raw ?? '').split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^([A-Za-z_][\w.-]*)\s*=\s*(.+)$/);
    if (m) pairs.push({ name: m[1], value: m[2].trim() });
    else bad.push(t);
  }
  return { pairs, unparsable: bad };
}

/** Closed list of the problems an assertion row can carry. A code not here is not reported. */
export const ASSERTION_PROBLEMS = [
  'kind-missing',
  'kind-unknown',
  'verify-missing',
  'verify-mismatch',
  'verify-retired',
  'check-missing',
  'home-unknown-form',
  'inputs-unparsable',
  'id-duplicate',
  'text-empty',
];

function parseAssertions(sec) {
  const assertions = [];
  if (!sec) return assertions;
  let cur = null;
  for (const { line, text } of sec.body) {
    const live = text.match(/^\s*[-*]\s+\*\*(S\d+)\*\*\s*(.*)$/);
    const withdrawn = text.match(/^\s*[-*]\s+~~(S\d+)~~\s*(.*)$/);
    if (live || withdrawn) {
      const m = live ?? withdrawn;
      cur = { id: m[1], text: m[2].trim(), withdrawn: Boolean(withdrawn), line, sub: {}, subLines: [] };
      assertions.push(cur);
      continue;
    }
    if (!cur) continue;
    const sub = text.match(/^\s{2,}[-*]\s+(.*)$/);
    if (sub) {
      // Several sub-bullets merge into ONE field map: `kind:` may sit on the
      // first line and `check:` three lines down without changing the meaning.
      Object.assign(cur.sub, parsePairs(sub[1]));
      cur.subLines.push(line);
    } else if (/^\s{2,}\S/.test(text) && !cur.subLines.length) cur.text += ` ${text.trim()}`;
  }
  // Promote the fields the gates ask for by name, and classify every deviation.
  const seen = new Map();
  for (const a of assertions) {
    a.kind = a.sub.kind ?? null;
    a.verify = a.sub.verify ?? null;
    a.check = a.sub.check ?? null;
    a.homeRaw = a.sub.home ?? null;
    a.home = a.homeRaw === null ? null : parseHome(a.homeRaw);
    a.inputsRaw = a.sub.inputs ?? null;
    a.inputs = a.inputsRaw === null ? null : parseInputs(a.inputsRaw);
    a.verifyExpected = a.kind === null ? null : deriveVerify(a.kind);
    a.problems = [];
    const problem = (code, detail) => a.problems.push({ code, detail });

    if (seen.has(a.id)) problem('id-duplicate', `S id already used at line ${seen.get(a.id)}`);
    else seen.set(a.id, a.line);
    if (a.withdrawn) continue; // a withdrawn assertion carries a reason, not fields

    if (!a.text) problem('text-empty', 'the assertion has no text');
    if (a.kind === null) problem('kind-missing', `kind: must be one of ${SPEC_KINDS.join('|')}`);
    else if (!SPEC_KINDS.includes(a.kind)) problem('kind-unknown', `kind: ${JSON.stringify(a.kind)} is not one of ${SPEC_KINDS.join('|')}`);
    if (a.verify === null) problem('verify-missing', `verify: is derived from kind — expected ${JSON.stringify(a.verifyExpected)}`);
    else if (RETIRED_VERIFY.some((re) => re.test(a.verify))) problem('verify-retired', `verify: ${JSON.stringify(a.verify)} is a retired spelling`);
    else if (a.verifyExpected !== null && a.verify !== a.verifyExpected)
      problem('verify-mismatch', `verify: ${JSON.stringify(a.verify)} but kind ${a.kind} derives ${JSON.stringify(a.verifyExpected)}`);
    if (a.check === null) problem('check-missing', 'check: is absent (write `check: TODO` while the test is unwritten)');
    if (a.home?.unknownForm) problem('home-unknown-form', `home: form ${JSON.stringify(a.home.unknownForm)} is not one of ${HOME_FORMS.join('|')}`);
    if (a.inputs?.unparsable.length) problem('inputs-unparsable', `inputs: ${a.inputs.unparsable.map((s) => JSON.stringify(s)).join(', ')} — expected name=value`);
  }
  return assertions;
}

function parseTable(sec) {
  if (!sec) return [];
  const rows = [];
  for (const { line, text } of sec.body) {
    if (!/^\s*\|/.test(text)) continue;
    const cells = text.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator
    rows.push({ line, cells });
  }
  return rows;
}

/**
 * `## AC map` — `| Vision § | Assertions | Planned home | Notes |`.
 *
 * MAGIC STRING: the header row is skipped by its FIRST CELL, `vision §`.
 * Renaming that column without editing this line turns the header into a data
 * row. The template keeps the column name beside the table for the same reason.
 */
const AC_HEADER_RE = /^vision\s*§$/i;

function parseAcRows(sec) {
  const out = [];
  for (const r of parseTable(sec)) {
    if (AC_HEADER_RE.test(r.cells[0] ?? '')) continue;
    const [ac, assertions, home, notes] = r.cells;
    const blocked = (home ?? '').match(/\bblocked:\s*(Q\d+)/i);
    out.push({
      line: r.line,
      ac: ac ?? '',
      assertions: (assertions ?? '').split(/[,\s]+/).filter((s) => /^S\d+$/.test(s)),
      home: stripTicks(home ?? ''),
      notes: notes ?? '',
      blockedOn: blocked ? blocked[1].toUpperCase() : null,
    });
  }
  return out;
}

/**
 * `## Lights` — `| id | kind | check | severity | title |`.
 *
 * MAGIC STRING: the header row is skipped by its first cell, `id`.
 * The table carries every id in `STANDING_LIGHT_IDS`; drift between this
 * dictionary and the template's rows is a separate probe in gate-probes.
 */
const LIGHTS_HEADER_RE = /^id$/i;

function parseLights(sec) {
  const out = [];
  for (const r of parseTable(sec)) {
    if (LIGHTS_HEADER_RE.test(r.cells[0] ?? '')) continue;
    const [id, kind, check, severity, title] = r.cells.map((c) => stripTicks(c ?? ''));
    out.push({ line: r.line, id, kind, check, severity, title: title ?? '' });
  }
  return out;
}

/** What the spec's Lights table says versus the standing dictionary. */
function diffLights(rows) {
  const ids = new Set(rows.map((r) => r.id));
  const missing = STANDING_LIGHT_IDS.filter((id) => !ids.has(id));
  const unknown = rows.filter((r) => r.id && !STANDING_LIGHT_IDS.includes(r.id)).map((r) => ({ id: r.id, line: r.line }));
  const severityDrift = [];
  for (const r of rows) {
    const s = severityOf(r.id);
    if (!s.known || !s.declared || !r.severity) continue;
    if (r.severity.toLowerCase() !== s.severity) severityDrift.push({ id: r.id, line: r.line, spec: r.severity, dictionary: s.severity });
  }
  const undeclared = rows.filter((r) => severityOf(r.id).known && !severityOf(r.id).declared).map((r) => r.id);
  return { missing, unknown, severityDrift, severityUndeclared: undeclared };
}

/**
 * `## Open questions`. List items only. `- none` / `- n/a` / `- <none>` is
 * empty; an indented line continues the previous item; ANY other non-blank line
 * is `unparsable` and the caller reads CANNOT VERIFY — a question written as a
 * paragraph is a question nobody counted.
 *
 * A Yn under Open questions is kept apart (`syrupUnderQuestions`): syrup never
 * blocks the test phase, so a Yn filed as a question would make a blocker out of
 * something the rules say is not one.
 */
export function parseQuestions(sec) {
  if (!sec) return { missing: true, open: [], unparsable: [], syrupUnderQuestions: [] };
  const open = [];
  const unparsable = [];
  const syrupUnderQuestions = [];
  for (const { line, text } of sec.body) {
    const item = text.match(/^\s*(?:[-*]|\d+[.)])\s+(.*\S)/);
    if (item) {
      const t = item[1].trim();
      if (/^\*\*Y\d+\*\*/.test(t) || /^~~Y\d+~~/.test(t)) syrupUnderQuestions.push({ line, text: t });
      else if (!NO_ITEM_RE.test(t)) {
        // `**Q1** <text>` / `Q1. <text>` / a bare item. The id is lifted out so a
        // gate printing `${id} ${text}` does not print it twice; `raw` keeps the
        // line as written.
        const idm = t.match(/^(?:\*\*)?(Q\d+)(?:\*\*)?[.:)]?\s*/);
        open.push({ line, id: idm ? idm[1] : null, text: idm ? t.slice(idm[0].length).trim() : t, raw: t });
      }
    } else if (/^\s+\S/.test(text) && open.length + unparsable.length + syrupUnderQuestions.length > 0) {
      if (open.length) open[open.length - 1].text += ` ${text.trim()}`;
    } else if (text.trim()) {
      unparsable.push({ line, text: text.trim() });
    }
  }
  return { missing: false, open, unparsable, syrupUnderQuestions };
}

/**
 * `## Syrup` items: `- **Y1** "<quote>" · <pairs>` and
 * `- ~~Y2~~ promoted → S4` / `- ~~Y3~~ dropped: <why>`.
 *
 * The quote is kept as written, including its quotation marks' content, because
 * rule 8 is that a Yn is a character-for-character quote of the Vision. Nothing
 * here normalises it; `isVerbatimQuote` is what checks it.
 */
function parseSyrup(sec) {
  const out = [];
  if (!sec) return out;
  let cur = null;
  for (const { line, text } of sec.body) {
    const live = text.match(/^\s*[-*]\s+\*\*(Y\d+)\*\*\s*(.*)$/);
    const gone = text.match(/^\s*[-*]\s+~~(Y\d+)~~\s*(.*)$/);
    if (live) {
      const rest = live[2];
      const quoted = rest.match(/^["“«](.*?)["”»]\s*(.*)$/);
      const pairs = parsePairs(quoted ? quoted[2] : rest);
      cur = {
        id: live[1],
        line,
        text: quoted ? quoted[1] : rest.split(/\s+·\s+/)[0].trim(),
        quoted: Boolean(quoted),
        carrier: pairs.carrier && pairs.carrier !== 'none' ? pairs.carrier : null,
        promoted: null,
        dropped: null,
        stubs: [],
      };
      out.push(cur);
      continue;
    }
    if (gone) {
      const rest = gone[2];
      const prom = rest.match(/promoted\s*(?:→|->)\s*(S\d+)/);
      const drop = rest.match(/dropped\s*(?:\(([^)]*)\))?:?\s*(.*)$/);
      cur = {
        id: gone[1],
        line,
        text: null,
        quoted: false,
        carrier: null,
        promoted: prom ? prom[1] : null,
        dropped: drop ? drop[2] || drop[1] || 'dropped' : prom ? null : rest.trim(),
        stubs: [],
      };
      out.push(cur);
      continue;
    }
    const stub = text.match(/^\s{2,}[-*]\s+stub:\s*(.*)$/);
    if (stub && cur) cur.stubs.push(stripTicks(stub[1]));
  }
  return out;
}

function parseListItems(sec) {
  if (!sec) return [];
  return sec.body
    .map(({ line, text }) => ({ line, m: text.match(/^\s*(?:[-*]|\d+[.)])\s+(.*\S)/) }))
    .filter(({ m }) => m && !NO_ITEM_RE.test(m[1].trim()))
    .map(({ line, m }) => ({ line, text: m[1].trim() }));
}

const flattenWs = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * Is `quote` a character-for-character substring of the Vision text?
 *
 * `exact` is the rule. `collapsed` is REPORTED, never accepted: it says the
 * quote differs from the Vision only in whitespace, which is the common case of
 * a quote re-wrapped while being copied, and the gate's message is far more
 * useful when it can say that instead of "not found". CR is dropped first
 * because .gitattributes:3 forces LF and a \r here would be an artefact of the
 * checkout, not of the text.
 */
export function isVerbatimQuote(quote, visionText) {
  const q = String(quote ?? '').replace(/\r/g, '');
  const v = String(visionText ?? '').replace(/\r/g, '');
  if (!q) return { exact: false, collapsed: false, reason: 'the quote is empty' };
  if (!v) return { exact: false, collapsed: false, reason: 'the spec has no `## Vision (verbatim)` text' };
  if (v.includes(q)) return { exact: true, collapsed: true, reason: null };
  if (flattenWs(v).includes(flattenWs(q))) return { exact: false, collapsed: true, reason: 'differs from the Vision only in whitespace — a Yn is quoted character for character' };
  return { exact: false, collapsed: false, reason: 'not a substring of the Vision text' };
}

// --------------------------------------------------------- approval trailer

/**
 * `spec-approved: CHQ-nnn <name> <YYYY-MM-DD>` beginning a line of a COMMIT
 * message (rule 14). Two forms are recognised and kept apart:
 *   `with-id`    — the required form; the id is matched against the spec asked for
 *   `without-id` — `spec-approved: <name> <date>`; parsed so the gate can say
 *                  what is wrong with it, and REPORTED as not an approval of any
 *                  particular spec. It is never promoted to an approval by
 *                  guessing which spec was meant.
 *
 * Anchored at column zero: an indented or quoted copy declares nothing, which is
 * how a commit message shows an example without signing anything.
 */
const APPROVAL_RE = /^spec-approved:[ \t]+(?:(CHQ-\d{3,})[ \t]+)?(.+?)[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*$/;

const isCalendarDate = (s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** One line → an approval, or null when the line is not one. */
export function parseApprovalTrailer(line, { commit = null, lineNo = null } = {}) {
  const raw = String(line ?? '').replace(/\r$/, '');
  if (!raw.startsWith('spec-approved:')) return null;
  const m = raw.match(APPROVAL_RE);
  if (!m) {
    return {
      specId: null,
      name: null,
      date: null,
      form: 'malformed',
      raw,
      commit,
      line: lineNo,
      problems: [{ code: 'malformed', detail: 'expected `spec-approved: CHQ-nnn <name> <YYYY-MM-DD>`' }],
    };
  }
  const problems = [];
  if (!m[1]) problems.push({ code: 'id-missing', detail: 'the trailer must name the spec: `spec-approved: CHQ-nnn <name> <date>`' });
  if (!isCalendarDate(m[3])) problems.push({ code: 'date-not-a-date', detail: `${m[3]} is not a calendar date` });
  return {
    specId: m[1] ?? null,
    name: m[2].trim(),
    date: m[3],
    form: m[1] ? 'with-id' : 'without-id',
    raw,
    commit,
    line: lineNo,
    problems,
  };
}

/** Every column-zero `spec-approved:` line of a commit message, in order. */
export function parseApprovals(message, { commit = null } = {}) {
  const out = [];
  String(message ?? '')
    .split('\n')
    .forEach((l, i) => {
      const a = parseApprovalTrailer(l, { commit, lineNo: i + 1 });
      if (a) out.push(a);
    });
  return out;
}

/**
 * Lines that LOOK like an approval but are indented, and therefore declare
 * nothing. This is the trap worth naming out loud: a human who indents the
 * trailer — because an editor wrapped it, or because they copied it out of a
 * document that showed it as an example — believes they signed, and git agrees
 * with neither of them. The gate reports these; it never promotes one.
 */
export function indentedApprovals(message, { commit = null } = {}) {
  const out = [];
  String(message ?? '')
    .split('\n')
    .forEach((l, i) => {
      const raw = l.replace(/\r$/, '');
      if (/^\s+/.test(raw) && raw.trimStart().startsWith('spec-approved:')) out.push({ line: i + 1, raw, commit });
    });
  return out;
}

/**
 * The approval verdict for one spec, LOUDLY.
 *
 * The caller brings the git facts, because this module does not read git:
 *   `approvals`      — approvals parsed out of the commit range, newest FIRST
 *                      (`git log --format=%H%n%B <range>`), each with `.commit`
 *   `editedAfter`    — commits that changed the spec's CONTENT after the newest
 *                      matching approval commit, newest first
 *                      (`git log --format=%H <approvalCommit>..HEAD -- docs/specs/<id>.md`)
 *                      Content means the file's text: a reflow is a change here,
 *                      because this module cannot tell a reflow from a rewrite.
 *   `indented`       — `indentedApprovals()` of the same messages, so the gate can
 *                      say "you indented it" instead of "there is no approval".
 *
 * Returns a verdict from VERDICTS. Only `green` is an approval; `--require-approved`
 * fails on everything else, and `reasons[]` is what it prints. A stale approval is
 * reported as STALE with every later commit named, never as "approved anyway".
 */
export function approvalStatus({ specId, approvals = [], editedAfter = [], indented = [] } = {}) {
  const reasons = [];
  if (!isSpecId(specId)) return { verdict: 'cannot-verify', approved: null, stale: false, reasons: [`not a spec id: ${JSON.stringify(specId)}`] };

  const matching = approvals.filter((a) => a.specId === specId);
  const withoutId = approvals.filter((a) => a.form === 'without-id');
  const malformed = approvals.filter((a) => a.form === 'malformed');

  for (const a of malformed) reasons.push(`malformed spec-approved: trailer${a.commit ? ` in ${a.commit.slice(0, 9)}` : ''}: ${a.raw}`);
  for (const a of indented)
    reasons.push(`an INDENTED spec-approved: line declares nothing — a trailer begins at column zero${a.commit ? ` (${a.commit.slice(0, 9)})` : ''}: ${JSON.stringify(a.raw)}`);
  for (const a of withoutId)
    reasons.push(`spec-approved: trailer names no spec id${a.commit ? ` in ${a.commit.slice(0, 9)}` : ''} — rule 14 requires \`spec-approved: ${specId} <name> <date>\`: ${a.raw}`);

  if (!matching.length) {
    reasons.push(`no \`spec-approved: ${specId} <name> <YYYY-MM-DD>\` trailer at column zero in the range`);
    return { verdict: 'cannot-verify', approved: null, stale: false, reasons };
  }
  const approved = matching[0];
  for (const p of approved.problems) reasons.push(`spec-approved: ${p.code} — ${p.detail}`);

  const stale = editedAfter.length > 0;
  if (stale) {
    reasons.push(
      `STALE APPROVAL: ${specId} was approved by ${approved.name} on ${approved.date}` +
        `${approved.commit ? ` (${approved.commit.slice(0, 9)})` : ''}, and the spec changed ${editedAfter.length} time(s) after that: ` +
        editedAfter.map((c) => (typeof c === 'string' ? c.slice(0, 9) : String(c.commit ?? c).slice(0, 9))).join(', ') +
        ' — re-approve the text as it stands now',
    );
  }
  const verdict = stale || approved.problems.length ? 'cannot-verify' : 'green';
  return { verdict, approved, stale, reasons };
}

// ------------------------------------------------------------------ the spec

/**
 * parseSpec(text, { path }) → the whole spec as data. PURE: pass it the output
 * of `git show HEAD:docs/specs/CHQ-nnn.md`, never a path.
 *
 * Never throws on content. Shape problems land in `unparsable[]` (file-level) or
 * in an item's `problems[]`; a caller fails closed on either.
 *
 * Line numbers are reported against the WHOLE FILE, front-matter included, so
 * every message can be printed as `path:line`. That is also why HTML comments
 * are blanked instead of deleted: `c.replace(/[^\n]/g, '')` keeps every newline,
 * and without it each line number after the first comment would be a lie.
 */
export function parseSpec(text, { path = null } = {}) {
  const src = String(text ?? '');
  const { frontMatter, body, bodyOffset, error } = splitFrontMatter(src);
  const unparsable = [];
  const add = (line, t) => unparsable.push({ line, text: t });
  if (error) add(1, error);

  const stripped = body.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ''));
  const lines = stripped.split('\n').map((l) => l.replace(/\r$/, ''));
  const lineNo = (oneBased) => oneBased + bodyOffset;

  const sec = (spec) => {
    const s = sectionBy(lines, spec.re);
    if (!s) return null;
    return { key: spec.key, start: lineNo(s.start), body: s.body.map((b) => ({ line: lineNo(b.line), text: b.text })) };
  };
  const byKey = {};
  for (const s of SPEC_SECTIONS) byKey[s.key] = sec(s);

  // --- heading inventory: missing sections, duplicated sections, order
  const headings = sectionsAll(lines).map((h) => ({ level: h.level, title: h.title, line: lineNo(h.line) }));
  const sectionsMissing = SPEC_SECTIONS.filter((s) => !byKey[s.key]).map((s) => s.titleShown ?? s.title);
  for (const t of sectionsMissing) add(lineNo(1), `required section missing: ## ${t}`);
  // A second `## Open questions` copied into an appendix would be invisible to a
  // parser that takes the first match — so the duplicate is named, not resolved.
  const dupes = [];
  const byTitle = new Map();
  for (const h of headings.filter((x) => x.level >= 2)) {
    const norm = h.title.trim().toLowerCase();
    if (byTitle.has(norm)) {
      dupes.push({ title: h.title, lines: [byTitle.get(norm), h.line] });
      add(h.line, `duplicate section "${h.title}" at lines ${byTitle.get(norm)}, ${h.line}`);
    } else byTitle.set(norm, h.line);
  }
  const present = SPEC_SECTIONS.filter((s) => byKey[s.key]);
  const sectionsOutOfOrder = present
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => i > 0 && byKey[s.key].start < byKey[present[i - 1].key].start)
    .map(({ s }) => s.titleShown ?? s.title);
  // Vision must be the FIRST section: everything downstream quotes it, and a
  // spec whose Vision sits under an Appendix has been re-ordered, not written.
  const firstSectionKey = present.length
    ? present.reduce((a, b) => (byKey[a.key].start <= byKey[b.key].start ? a : b)).key
    : null;
  const visionIsFirst = firstSectionKey === 'vision';
  if (byKey.vision && !visionIsFirst) add(byKey.vision.start, '`## Vision (verbatim)` is not the first section');

  // --- title, id, revision
  const titleLineIdx = lines.findIndex((l) => /^#\s+SPEC:/i.test(l));
  const titleLine = titleLineIdx === -1 ? '' : lines[titleLineIdx];
  const idm = titleLine.match(/\b(CHQ-\d{3,})\b/);
  const id = idm ? idm[1] : null;
  if (titleLineIdx === -1) add(lineNo(1), 'no `# SPEC: CHQ-nnn — <title>` heading');
  else if (!id) add(lineNo(titleLineIdx + 1), `the SPEC heading names no CHQ-nnn id: ${titleLine.trim()}`);
  const idFromPath = path ? specIdOfPath(path) : null;
  if (id && idFromPath && id !== idFromPath) add(lineNo(titleLineIdx + 1), `the heading says ${id} but the file is ${idFromPath}`);
  const revLineIdx = lines.findIndex((l) => /^Revision:/i.test(l));
  const revm = revLineIdx === -1 ? null : lines[revLineIdx].match(/Revision:\s*(\d+)/i);
  if (revLineIdx === -1) add(lineNo(1), 'no `Revision: <n>` line');
  else if (!revm) add(lineNo(revLineIdx + 1), `Revision: is not a number: ${lines[revLineIdx].trim()}`);

  // --- front-matter: `contracts` is the ONLY field
  let contracts = DEFAULT_CONTRACTS;
  if (frontMatter) {
    if (typeof frontMatter !== 'object' || Array.isArray(frontMatter)) add(1, 'front-matter is not a map');
    else {
      for (const key of Object.keys(frontMatter)) {
        if (key === 'contracts') continue;
        if (key === 'wave')
          add(1, 'front-matter: `wave:` — waves were not ported to this repository; there is no allow_packages / allow_scenes escape clause');
        else add(1, `front-matter: unknown field ${JSON.stringify(key)} — \`contracts\` is the only field`);
      }
      if (frontMatter.contracts !== undefined) {
        if (!CONTRACTS.includes(frontMatter.contracts)) add(1, `contracts: must be ${CONTRACTS.join('|')}, got ${JSON.stringify(frontMatter.contracts)}`);
        else contracts = frontMatter.contracts;
      }
    }
  }

  // --- the sections themselves
  const assertions = parseAssertions(byKey.assertions);
  const questions = parseQuestions(byKey.openQuestions);
  for (const u of questions.unparsable) add(u.line, `## Open questions: not a list item — "${u.text}"`);
  for (const y of questions.syrupUnderQuestions) add(y.line, `## Open questions: a syrup item (${y.text.slice(0, 24)}…) is not a question — syrup never blocks the test phase`);
  // The Lights diff stays DATA. It is not pushed into `unparsable[]`: a missing
  // row is a complete row that is absent, not a shape nobody could read, and
  // thirteen absent rows would bury the one line that says the front-matter is
  // broken. `blockers()` reports the diff as one entry per category.
  const lightRows = parseLights(byKey.lights);
  const lightsDiff = diffLights(lightRows);
  lightsDiff.line = byKey.lights?.start ?? null;

  const visionText = byKey.vision ? byKey.vision.body.map((b) => b.text).join('\n').trim() : null;
  const syrup = parseSyrup(byKey.syrup);
  // Rule 8 checked where the quote and the Vision are both in hand. The verdict
  // is the caller's; the evidence is attached here so two gates cannot disagree.
  for (const y of syrup) {
    // A withdrawn Yn carries a reason, not a quote: there is nothing to compare,
    // and the field is null rather than absent so no caller reads `undefined`.
    y.verbatim = y.text === null ? null : isVerbatimQuote(y.text, visionText);
  }

  const appendixStart = byKey.appendix ? byKey.appendix.start : null;

  return {
    path,
    id,
    idFromPath,
    revision: revm ? Number(revm[1]) : null,
    title: titleLine.replace(/^#\s+SPEC:\s*/i, '').trim() || null,
    frontMatter: frontMatter ?? null,
    contracts,

    vision: visionText,
    visionLines: byKey.vision ? { start: byKey.vision.start, end: byKey.vision.body.length ? byKey.vision.body[byKey.vision.body.length - 1].line : byKey.vision.start } : null,
    premise: parseListItems(byKey.premise),
    assertions,
    acRows: parseAcRows(byKey.acMap),
    crossPackage: parseListItems(byKey.crossPackage),
    nonGoals: parseListItems(byKey.nonGoals),
    lights: lightRows,
    lightsDiff,
    openQuestions: questions.open,
    questionsMissing: questions.missing,
    questionsUnparsable: questions.unparsable,
    syrupUnderQuestions: questions.syrupUnderQuestions,
    answered: parseListItems(byKey.answered),
    syrup,
    contradictions: parseListItems(byKey.contradictions),
    appendixStart,

    sections: Object.fromEntries(Object.entries(byKey).map(([k, v]) => [k, v ? { start: v.start, lines: v.body.length } : null])),
    headings,
    sectionsMissing,
    sectionsDuplicated: dupes,
    sectionsOutOfOrder,
    visionIsFirst,

    /** `blocked: Qn` anywhere in the body — an AC still waiting on an answer. */
    stillBlocked: lines
      .map((l, i) => ({ line: lineNo(i + 1), text: l.trim() }))
      .filter((l) => /\bblocked:\s*Q\d+/i.test(l.text)),

    /**
     * An approval written INTO the spec is NOT an approval: rule 14 puts the
     * trailer in a commit message, after the spec's last content change. A line
     * in the file would approve itself in the same edit, so it is collected here
     * only to be reported.
     */
    approvalInFile: lines
      .map((l, i) => parseApprovalTrailer(l, { lineNo: lineNo(i + 1) }))
      .filter(Boolean),

    unparsable,
  };
}

/**
 * Is the test phase blocked? One place decides, because this is the question the
 * whole spec phase exists to answer.
 *
 * Blocked by: an unanswered `## Open questions` item · a `## Open questions`
 * section that is missing or carries a line nobody could parse · any file-level
 * `unparsable` · an assertion with a problem · a live `blocked: Qn` reference.
 * NEVER blocked by: a `## Syrup` item — rule 8, and a Yn is not re-worded to
 * make it one.
 */
export function blockers(spec) {
  const out = [];
  const at = (line) => (spec.path ? `${spec.path}:${line}` : `line ${line}`);
  for (const u of spec.unparsable) out.push({ kind: 'unparsable', where: at(u.line), text: u.text });
  const ld = spec.lightsDiff ?? { missing: [], unknown: [], severityDrift: [] };
  const lightsAt = at(ld.line ?? 1);
  if (ld.missing.length) out.push({ kind: 'lights-missing', where: lightsAt, text: `## Lights carries ${STANDING_LIGHT_IDS.length - ld.missing.length} of ${STANDING_LIGHT_IDS.length} standing ids; absent: ${ld.missing.join(', ')}` });
  for (const u of ld.unknown) out.push({ kind: 'lights-unknown-id', where: at(u.line), text: `${u.id} is not a standing light id` });
  for (const d of ld.severityDrift) out.push({ kind: 'lights-severity-drift', where: at(d.line), text: `${d.id}: the spec says ${d.spec}, the dictionary says ${d.dictionary}` });
  if (spec.questionsMissing) out.push({ kind: 'questions-missing', where: spec.path ?? '?', text: '`## Open questions` is absent — an absent section is not an empty one' });
  for (const q of spec.openQuestions) out.push({ kind: 'open-question', where: at(q.line), text: `${q.id ? `${q.id} ` : ''}${q.text}` });
  for (const b of spec.stillBlocked) out.push({ kind: 'blocked-on-question', where: at(b.line), text: b.text });
  for (const a of spec.assertions)
    for (const p of a.problems ?? []) out.push({ kind: `assertion-${p.code}`, where: at(a.line), text: `${a.id}: ${p.detail}` });
  return out;
}

// --------------------------------------------------- the one git/FS function

/**
 * The ONE function here that leaves the process: `git show <rev>:docs/specs/<id>.md`.
 *
 * A gate reads the spec at a REVISION, never from the working tree — reading the
 * tree makes the pre-commit hook green on an edit that was never committed, and
 * red-check's base runs must see the spec as the base had it. argv form, never a
 * shell string; the exit code is captured and the verdict comes from whether
 * there is content. `maxBuffer` is raised because the 1 MiB default kills a
 * chatty child and reports a failure that never happened.
 *
 * `LANG`/`LC_ALL` are forced to C because git on this Mac speaks the OS
 * language: measured 2026-11-01, `git log` in the session shell answered
 * `Schwerwiegend: …` (German) while the same call with these two set answered
 * `fatal: …`. Any gate that matches git's own words needs both.
 */
export function readSpecAtRev(root, id, rev = 'HEAD') {
  const rel = specPath(id);
  const res = spawnSync('git', ['show', `${rev}:${rel}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0', TZ: 'UTC', LANG: 'C', LC_ALL: 'C' },
  });
  if (res.error) return { ok: false, text: null, source: `${rev}:${rel}`, exitCode: null, error: res.error.message };
  if (res.status !== 0 || !res.stdout)
    return { ok: false, text: null, source: `${rev}:${rel}`, exitCode: res.status, error: (res.stderr ?? '').trim() || `git show exited ${res.status} with no output` };
  return { ok: true, text: res.stdout, source: `${rev}:${rel}`, exitCode: res.status, error: null };
}
