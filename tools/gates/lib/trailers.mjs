// Commit-message trailers, anchored to COLUMN ZERO.
//
// The whole property of this module is the negative one: an indented, quoted, bulleted or
// differently-cased copy of a trailer declares NOTHING. That is what lets a commit message, a
// doc, a skill or a review quote `package: …` as an example without the gate reading the example
// as a declaration. The port keeps it mechanical rather than hoping nobody copies a line.
//
// And the other half of the property: a near-miss is REPORTED, not dropped. A line that looks
// like a declaration and is not one is the single most expensive silence a gate can keep — the
// author believes they declared something. Every near-miss lands in `rejected` with the reason,
// and the gate that was looking for that trailer prints it.
//
// The five names, and the rule each one carries:
//   spec-approved: <name> <YYYY-MM-DD>   a spec is approved; an edit after it makes it stale
//   package: <name> — <why>              a dependency may enter a manifest
//   green: S<n> via <runner> <artifact>  an assertion is green, with the artifact that says so
//   spec-conflict: …                     the implementer disagrees with a spec test
//   spec-change: …                       the implementer asks for a spec change
//
// Deliberate divergence from git's own trailer rules: git reads trailers only from the last
// paragraph of a message. This module scans EVERY line, because the rules say "a line BEGINNING
// with" — a declaration in the middle of a body is a declaration. The consequence belongs in
// docs/knowledge/process.md: an EXAMPLE of a trailer is kept indented by at least one space.
//
// Zero dependencies. This module reads a string; it never calls git. The caller passes the
// message (from `git log --format=%B`, from COMMIT_EDITMSG, or from a range), and the caller owns
// the decision — this module only says what was declared, what was not, and why.

// The list of names has ONE source: spec-parse.mjs, which declares it as TRAILER_KEYS and says
// so at tools/gates/lib/spec-parse.mjs:181. A second copy here would be a second answer waiting
// to happen. What this module does NOT reuse is that module's TRAILER_LINE_RE
// (spec-parse.mjs:188): it accepts an empty value, and this module reports `package:` with
// nothing after it as a near-miss instead of as a declaration.
import { TRAILER_KEYS } from './spec-parse.mjs';

/** The closed set of trailer names. Nothing else is a trailer, however much it looks like one. */
export const TRAILER_NAMES = Object.freeze([...TRAILER_KEYS]);

const NAME_GROUP = TRAILER_NAMES.join('|');

// A declaration: column zero, the exact lowercase name, a colon, exactly one space, a value.
const DECLARES_RE = new RegExp(`^(${NAME_GROUP}): (\\S.*)$`);

// A near-miss: the same names after any prefix, with any spacing or casing. Matching this and
// NOT matching DECLARES_RE is what `rejected` is made of.
const NEAR_RE = new RegExp(`^([\\s>#*\\-+•|"'\`(\\[]*)(${NAME_GROUP})([ \\t]*:[ \\t]*)(.*)$`, 'i');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function rejectReasons(prefix, name, sep, value) {
  const reasons = [];
  if (prefix !== '') {
    if (/^[\s]+$/.test(prefix)) reasons.push('indented — a trailer is anchored to column zero');
    else reasons.push(`prefixed with "${prefix}" — a quoted or bulleted copy declares nothing`);
  }
  if (name !== name.toLowerCase()) reasons.push(`"${name}" — a trailer name is lowercase`);
  if (prefix === '' && name === name.toLowerCase()) {
    if (!sep.startsWith(':')) reasons.push('no colon directly after the name');
    else if (sep !== ': ') {
      reasons.push(
        sep === ':'
          ? 'no space after the colon'
          : `"${sep.replace(/\t/g, '\\t')}" after the name — exactly one space is required`,
      );
    }
    if (value.trim() === '') reasons.push('empty value');
  }
  return reasons;
}

function parseValue(name, value) {
  if (name === 'spec-approved') {
    const m = /^(.+?)\s+(\d{4}-\d{2}-\d{2})$/.exec(value);
    if (m === null) {
      return { shapeOk: false, expected: 'spec-approved: <name> <YYYY-MM-DD>', who: null, date: null };
    }
    return { shapeOk: DATE_RE.test(m[2]), expected: 'spec-approved: <name> <YYYY-MM-DD>', who: m[1].trim(), date: m[2] };
  }
  if (name === 'package') {
    // The em dash is the declared separator (rule 11 of the source project, carried over).
    const m = /^(\S+)\s+—\s+(\S.*)$/.exec(value);
    if (m === null) {
      return { shapeOk: false, expected: 'package: <name> — <why>', pkg: null, why: null };
    }
    return { shapeOk: true, expected: 'package: <name> — <why>', pkg: m[1], why: m[2].trim() };
  }
  if (name === 'green') {
    const m = /^(S[1-9]\d*)\s+via\s+(\S+)\s+(\S.*)$/.exec(value);
    if (m === null) {
      return { shapeOk: false, expected: 'green: S<n> via <runner> <artifact>', assertionId: null, runner: null, artifact: null };
    }
    return { shapeOk: true, expected: 'green: S<n> via <runner> <artifact>', assertionId: m[1], runner: m[2], artifact: m[3].trim() };
  }
  // spec-conflict / spec-change: free prose by design. UNVERIFIED: no shape for these is declared
  // anywhere in the ported rules, so this module declares none either — shapeOk is null, not false.
  return { shapeOk: null, expected: null };
}

/**
 * Parse every trailer in a commit message.
 *
 * @param {string} message the full commit message (subject and body)
 * @returns {{
 *   trailers: Array<{name: string, value: string, line: number, parsed: object}>,
 *   byName: Record<string, string[]>,
 *   rejected: Array<{line: number, text: string, name: string, reasons: string[]}>,
 *   names: string[]
 * }}
 */
export function parseTrailers(message) {
  const text = typeof message === 'string' ? message : '';
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));

  const trailers = [];
  const rejected = [];
  const byName = {};
  for (const n of TRAILER_NAMES) byName[n] = [];

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const hit = DECLARES_RE.exec(line);
    if (hit !== null) {
      const [, name, value] = hit;
      const entry = { name, value: value.trimEnd(), line: lineNo, parsed: parseValue(name, value.trimEnd()) };
      trailers.push(entry);
      byName[name].push(entry.value);
      return;
    }
    const near = NEAR_RE.exec(line);
    if (near === null) return;
    const [, prefix, name, sep, value] = near;
    const reasons = rejectReasons(prefix, name, sep, value);
    rejected.push({
      line: lineNo,
      text: line,
      name: name.toLowerCase(),
      reasons: reasons.length > 0 ? reasons : ['does not begin at column zero as "<name>: <value>"'],
    });
  });

  return {
    trailers,
    byName,
    rejected,
    names: [...new Set(trailers.map((t) => t.name))],
  };
}

/**
 * Whether a message declares a trailer at all. Throws on an unknown name, so a typo in a gate is
 * a crash rather than a quiet `false`.
 *
 * @param {string} message
 * @param {'spec-approved'|'package'|'green'|'spec-conflict'|'spec-change'} name
 * @returns {boolean}
 */
export function hasTrailer(message, name) {
  if (!TRAILER_NAMES.includes(name)) {
    throw new TypeError(`unknown trailer "${name}" — known: ${TRAILER_NAMES.join(', ')}`);
  }
  return parseTrailers(message).byName[name].length > 0;
}

/** Every value declared under one name, in message order. Throws on an unknown name. */
export function trailerValues(message, name) {
  if (!TRAILER_NAMES.includes(name)) {
    throw new TypeError(`unknown trailer "${name}" — known: ${TRAILER_NAMES.join(', ')}`);
  }
  return parseTrailers(message).byName[name];
}

/**
 * Near-misses for one name, for the gate that went looking for it. A gate that reports "no
 * `package:` trailer found" while the message carries an indented one is technically right and
 * practically useless; this is what it prints instead.
 */
export function rejectedFor(message, name) {
  if (!TRAILER_NAMES.includes(name)) {
    throw new TypeError(`unknown trailer "${name}" — known: ${TRAILER_NAMES.join(', ')}`);
  }
  return parseTrailers(message).rejected.filter((r) => r.name === name);
}

/**
 * Parse a RANGE of messages at once.
 *
 * @param {Array<{sha?: string, message: string}>|string[]} commits
 * @returns {Array<{sha: string|null, message: string, trailers: object[], byName: object, rejected: object[]}>}
 */
export function parseRange(commits) {
  return (commits ?? []).map((c) => {
    const message = typeof c === 'string' ? c : (c.message ?? '');
    const parsed = parseTrailers(message);
    return {
      sha: typeof c === 'string' ? null : (c.sha ?? null),
      message,
      trailers: parsed.trailers,
      byName: parsed.byName,
      rejected: parsed.rejected,
      names: parsed.names,
    };
  });
}
