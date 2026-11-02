/**
 * L-lint — the lint lane, and the three things about it that are NOT visible in
 * its output: that the run was type-aware, that the rules it needs are actually
 * configured, and that nobody switched one off in a file.
 *
 * Zero dependencies, Node 22 ESM. The verdict comes from the ARTEFACT
 * `.ci/lights/oxlint.json`, read by `../lib/oxlint-json.mjs` — the one reader of
 * that format. The child's exit code is captured separately by `sh` (which never
 * pipes) and stays advisory.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * 1. `--type-aware` IS LOAD-BEARING AND ITS ABSENCE IS SILENT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * MEASURED: without the flag the typed rules simply do not run and NOTHING says
 * so — the output is a clean pass over the same files. TD-0003 re-demonstrated it
 * on a planted `async` function with no `await`: the same config, the same file,
 * `exit=0` and no output without the flag.
 *
 * So the argv is a declared constant (`LINT_ARGV`), the light ASSERTS the flag is
 * in it before running anything, and the argv it used is printed in the detail.
 * The assertion looks circular and is not: the flag and the check are in two
 * places that a future edit can separate, and the day somebody trims the argv
 * "because it is slow" the row goes red instead of going quietly green. The
 * `gate-probes` fixture is the other half — a planted floating promise must come
 * out GREEN without the flag, which is what proves the flag carries meaning.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * 2. THE RULE SET IS A HAND-WRITTEN LIST, SO IT IS ASSERTED NUMERICALLY
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * MEASURED, and it made a first comparison of oxlint against eslint come out
 * WRONG: the `any`-leak family (`no-explicit-any`, `no-unsafe-*`) is in NO
 * default category. A config written with `categories` alone silently checks
 * less than it appears to, and oxlint looked incapable when it was merely
 * unconfigured. The cure is not a category, it is a list of ids — and a list
 * nobody checks is a list one edit away from being shorter.
 *
 * `REQUIRED_RULES` is that list, and the assertion is numeric: every id must be
 * present in `.oxlintrc.jsonc` → `rules` with severity `error`, and the count of
 * satisfied ids must equal the count of required ones. This is TD-0003 piece 2,
 * named there as this light's job. Completeness is a different claim and stays
 * UNVERIFIED until a probe plants one defect per bug class; this light asserts
 * that the list is not quietly shrinking, nothing more.
 *
 * WHAT THIS LIGHT DOES NOT HAVE TO GUARD, measured: a typo. An unknown rule or
 * plugin makes oxlint fail to START — `Failed to parse oxlint configuration
 * file.` on stdout, exit 1, even under `--format=json`. So "the config looks
 * configured and checks nothing" is closed by the tool for MISSPELLED ids and
 * open only for ABSENT ones, which is exactly what the list above covers.
 * `readOxlint` recognises that plain-text output and answers cannot-verify with
 * the tool's own first line, so a config failure can never read as a clean tree.
 *
 * AND THE OVERRIDE TRAP. The port plan found it in the scaffold and it is worth
 * generalising: an override saying "tests may do more" covered every path under
 * a `test` directory in ANY package — `packages/core/test` included, the one
 * place determinism is mandatory. (The glob cannot be written in this comment:
 * a doubled star followed by a slash closes a block comment, which is how this
 * very header first failed to parse.) So this light refuses an `overrides` entry
 * that relaxes a
 * REQUIRED rule for any path under `packages/core`, using the pattern matcher
 * `./visible.mjs` owns. (The determinism ban itself is not a lint rule at all:
 * oxlint has no `no-restricted-syntax` and `no-restricted-globals` on
 * `Date`/`Math` was the wrong shape — it refused `instanceof Date`, `new Date(0)`
 * and `Math.floor`. It lives in `L-core-purity`'s token scan.)
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * 3. SUPPRESSION: ONLY THE FILE-LEVEL FORM WORKS, AND IT IS THE ONE THAT FAILS
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * MEASURED on a type-aware rule:
 *
 *   `// oxlint-disable no-floating-promises`                      SUPPRESSES
 *   `// oxlint-disable-next-line no-floating-promises`            does not
 *   `// oxlint-disable-next-line typescript/no-floating-promises` does not
 *   `// eslint-disable-next-line no-floating-promises`            does not
 *
 * So a FILE-LEVEL `oxlint-disable` naming a required rule is a fail: it really
 * does turn the rule off for that file. A file-level directive naming NOTHING is
 * a fail too — it turns off everything. The forms that suppress nothing are still
 * NAMED in the detail, for two reasons: on a type-aware rule their ineffectiveness
 * is measured, but on a NON-type-aware rule the `-next-line` behaviour is
 * UNMEASURED and must not be assumed; and their presence means somebody tried,
 * which is a fact about the code worth reading off a row.
 *
 * SCOPE: `packages/`, `apps/`, `e2e/`. Not `tools/`, for the reason
 * `.oxlintrc.jsonc:70-80` already gives — the gates are plain JavaScript on
 * purpose and are judged by `gate-probes`, which plants a defect and checks the
 * gate caught it. There is a second, duller reason, and it is this file: a scan
 * of `tools/` would find the directive names written out in this very header.
 *
 * A COMMENT IS FOUND BY THE MASK, NOT BY A REGEX ON RAW TEXT. `scanSource` masks
 * comments AND string literals while recording every literal's span, so a
 * position that is masked and lies in no literal is a comment — which is how a
 * `"oxlint-disable"` inside a string stays out of the finding list.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * NO MODULE-LEVEL PREMISE, ON PURPOSE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Sections 2 and 3 need nothing installed. Declaring `premises: ['oxlint']` would
 * make `lights/run.mjs` refuse the whole row before `run` was called, and the two
 * halves that work in a bare checkout would be lost with it. Section 1 asks
 * `requirePremise` itself and reports the missing premise BY NAME, which is
 * cannot-verify and blocks — a lane that did not run is not a lane that passed.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readOxlint } from '../lib/oxlint-json.mjs';
import { PENDING_IMPLEMENTATION_PREFIX } from '../lib/spec-parse.mjs';
import { isSpecTest } from '../lib/test-file-patterns.mjs';
import { readVisible, requirePremise, readPremises, scanSource, sh, walk } from './_shared.mjs';
import { cite, readJsoncFile, LIGHT_ARTIFACT_DIR } from './tsc.mjs';
import { globToRegex } from './visible.mjs';

/**
 * The rule ids a MISSING IMPLEMENTATION makes fire inside a spec test, and nothing else does.
 *
 * MEASURED 2026-11-02 on CHQ-001's seven spec tests, which is what put this set here. A spec test
 * has to reach a symbol nobody has written yet, and how it reaches it is not free: a NAMED import
 * of an absent export is an ESM link error, so the file never loads and the artefact carries no
 * `<testcase>` for any case at all — red-check then reads the whole file as one weak crash-red
 * instead of twenty-nine per-case rows. Reaching it through the NAMESPACE keeps the file loading,
 * and costs exactly these two findings:
 *
 *   import(namespace)                  the property is genuinely not on the namespace yet
 *   typescript(no-unsafe-assignment)   so its type is an error type, and assigning it is unsafe
 *
 * Both are TRUE, both name the absent implementation precisely, and both VANISH with no edit to
 * the test when it lands — measured by adding the implementation and re-running: zero findings in
 * the spec tests. That self-healing is not a nicety, it is required: a spec test is read-only for
 * `implement-to-green`, so a construct that needed editing afterwards would be illegal.
 *
 * So they are the same shape as L-tsc's missing-symbol diagnostics, and they get the same
 * treatment and no more: the HOOK prints them as a warning, every strict run still fails, and the
 * tolerance holds only when EVERY finding is one of these ids inside a placed spec test. One
 * finding anywhere else, or one other rule, and the whole tree is judged strictly again — an
 * `any` that a test leaked for its own reasons must not ride in behind a missing function.
 */
const PENDING_IMPLEMENTATION_RULES = Object.freeze(['import(namespace)', 'typescript(no-unsafe-assignment)']);

export const id = 'L-lint';
export const severity = 'hard';

/** The config of record. MEASURED (delta Д11): oxlint picks `.jsonc` up on its
 * own and accepts comments and trailing commas, and it REFUSES to start when
 * both spellings exist (`Both '.oxlintrc.json' and '.oxlintrc.jsonc' found`). A
 * plain `.json` also rejects a `"//"` key as an unknown field, which is why the
 * comments in this repository's config need the `.jsonc` form. */
const CONFIG = '.oxlintrc.jsonc';
const CONFIG_PLAIN = '.oxlintrc.json';

/** The argv of record. `--type-aware` is first because it is the reason this
 * list is a constant at all; `--format=json` is what makes the output an
 * artefact a reader owns instead of text a gate scrapes. `--format=junit` exists
 * and is deliberately NOT used: a JUnit XML under `.ci/` must mean "a test run
 * happened" and nothing else. */
export const LINT_ARGV = Object.freeze(['--type-aware', '--format=json']);

/** The artefact this light writes and then reads back. */
const ARTIFACT = `${LIGHT_ARTIFACT_DIR}/oxlint.json`;

/** The roots the suppression scan covers, and the extensions it reads. */
const SCANNED_ROOTS = Object.freeze(['packages', 'apps', 'e2e']);
const SCANNED_EXTS = Object.freeze(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs']);

/** The pure package: an override that relaxes a required rule here is refused
 * however it is spelled. */
const CORE = 'packages/core';

/**
 * The rules that must be configured as errors, each with the bug class it is
 * there for. A CLOSED, hand-written list — that is what TD-0003 is about — and
 * the point of asserting it numerically is that shortening it is a visible
 * failure rather than a quiet relaxation.
 */
export const REQUIRED_RULES = Object.freeze([
  { ruleId: 'typescript/no-floating-promises', why: 'a promise nobody awaited: tsc --noEmit does not report it, and it is the single most common way an async bug reaches production' },
  { ruleId: 'typescript/no-misused-promises', why: 'an async function handed to something that wants a boolean — measured on `.filter(async …)`' },
  { ruleId: 'typescript/await-thenable', why: '`await 42` is a statement about a value that cannot be awaited; the compiler allows it' },
  { ruleId: 'typescript/no-explicit-any', why: 'the entry point of the any-leak family, and in NO default category — it has to be named' },
  { ruleId: 'typescript/no-unsafe-argument', why: 'an `any` crossing a call boundary is where a type lane stops meaning anything' },
  { ruleId: 'typescript/no-unsafe-assignment', why: 'the same leak through a binding; measured to catch `document.title` in a lib-less project' },
  { ruleId: 'typescript/no-unsafe-call', why: 'calling an `any` makes every assertion below it about an unknown value' },
  { ruleId: 'typescript/no-unsafe-member-access', why: 'reading through an `any` is how a renamed field stops being a compile error' },
  { ruleId: 'typescript/no-unsafe-return', why: 'an `any` returned re-enters typed code as a type the compiler trusts' },
]);

/** The severities that count as "configured". A rule set to `warn` is not: this
 * lane is run with warnings fatal, but a warning in the CONFIG is a statement
 * that the rule may be relaxed later, and the required list is not negotiable. */
const ERROR_SEVERITIES = Object.freeze(['error', 2]);

/** Both spellings a directive can name a rule by. */
const bareOf = (ruleId) => (ruleId.includes('/') ? ruleId.slice(ruleId.indexOf('/') + 1) : ruleId);

/** A disable directive, with or without the line-scoped suffix, plus its tail. */
const DIRECTIVE_RE = /\b(oxlint|eslint)-disable(-next-line|-line)?\b([^\n]*)/g;

/** A plausible rule id in a directive's tail. */
const RULE_TOKEN_RE = /^[@a-z][\w@/-]*$/;

/** 1-based line of an offset. Local on purpose, as in `core-purity.mjs:179`. */
function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/** Is this offset inside a comment? Masked by `scanSource` AND in no literal. */
function offsetInComment(scan, text, offset) {
  if (scan.code[offset] !== ' ' || text[offset] === ' ') return false;
  for (const lit of scan.literals.values()) if (offset >= lit.start && offset < lit.end) return false;
  return true;
}

/** The rule ids a directive's tail names, stopping at the `--` description. */
export function rulesNamedBy(tail) {
  const cut = tail.indexOf('--');
  const body = cut === -1 ? tail : tail.slice(0, cut);
  return body
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && RULE_TOKEN_RE.test(t));
}

// ------------------------------------------------------------- the rule pin

/**
 * `.oxlintrc.jsonc` → `rules`, against `REQUIRED_RULES`, numerically.
 * → { problems, notes, satisfied }
 */
export function rulePin(root) {
  const problems = [];
  const notes = [];

  const plain = readJsoncFile(root, CONFIG_PLAIN);
  if (plain.exists)
    problems.push(
      `${CONFIG_PLAIN} exists beside ${CONFIG} — MEASURED: oxlint refuses to start with both (\`Both '.oxlintrc.json' and '.oxlintrc.jsonc' found\`), so the lane would not run at all; delete ${CONFIG_PLAIN}`,
    );

  const cfg = readJsoncFile(root, CONFIG);
  if (!cfg.ok) {
    problems.push(`${CONFIG}: ${String(cfg.reason)} — the required-rule list is asserted against this file, so nothing about the rule set is asserted`);
    return { problems, notes, satisfied: 0 };
  }

  const rules = cfg.data?.rules;
  if (rules === null || rules === undefined || typeof rules !== 'object' || Array.isArray(rules)) {
    problems.push(
      `${CONFIG}: no "rules" object — the any-leak family is in NO default category (measured), so a config written with "categories" alone checks less than it appears to; name every id in ${REQUIRED_RULES.length} required rule(s) under "rules"`,
    );
    return { problems, notes, satisfied: 0 };
  }

  let satisfied = 0;
  for (const req of REQUIRED_RULES) {
    const where = cite(CONFIG, cfg.text === null ? null : lineAt(cfg.text, cfg.text.indexOf(`"${req.ruleId}"`)));
    if (!Object.hasOwn(rules, req.ruleId)) {
      problems.push(
        `${CONFIG}: the required rule "${req.ruleId}" is not named under "rules" — add "${req.ruleId}": "error"; ${req.why}. It is in no default category, so a category list does not cover it (TD-0003)`,
      );
      continue;
    }
    const value = rules[req.ruleId];
    const level = Array.isArray(value) ? value[0] : value;
    if (!ERROR_SEVERITIES.includes(level)) {
      problems.push(`${where}: "${req.ruleId}" is configured as ${JSON.stringify(level)} and must be "error" — ${req.why}`);
      continue;
    }
    satisfied += 1;
  }
  if (satisfied !== REQUIRED_RULES.length)
    problems.push(`${CONFIG}: ${String(satisfied)} of ${String(REQUIRED_RULES.length)} required rule(s) are configured as errors — the count is the assertion (TD-0003 piece 2), so a shorter list is a failure and not a quiet relaxation`);
  else notes.push(`${String(satisfied)}/${String(REQUIRED_RULES.length)} required rule(s) configured as errors in ${CONFIG}`);

  // The override trap: a relaxation that reaches packages/core.
  const overrides = Array.isArray(cfg.data?.overrides) ? cfg.data.overrides : [];
  for (let i = 0; i < overrides.length; i += 1) {
    const ov = overrides[i];
    const files = Array.isArray(ov?.files) ? ov.files : [];
    const ovRules = ov?.rules === null || typeof ov?.rules !== 'object' || Array.isArray(ov?.rules) ? {} : ov.rules;
    const relaxed = REQUIRED_RULES.filter((req) => {
      if (!Object.hasOwn(ovRules, req.ruleId)) return false;
      const value = ovRules[req.ruleId];
      const level = Array.isArray(value) ? value[0] : value;
      return !ERROR_SEVERITIES.includes(level);
    });
    if (relaxed.length === 0) continue;
    for (const pat of files) {
      const compiled = globToRegex(pat);
      if (!compiled.ok) {
        problems.push(`${CONFIG}: overrides[${String(i)}].files pattern ${String(compiled.reason)} — an override whose scope nobody can read may relax ${relaxed.map((r) => r.ruleId).join(', ')} anywhere`);
        continue;
      }
      // Does the pattern reach INTO the pure package? Probed with the shapes a
      // path under packages/core really has, because the question is reach, not
      // a pattern-to-pattern comparison.
      const probes = [`${CORE}/src/x.ts`, `${CORE}/src/a/b.ts`, `${CORE}/test/skeleton/x.test.ts`, `${CORE}/test/CHQ-001/S1_x.test.ts`];
      const reached = probes.filter((p) => compiled.re.test(p));
      if (reached.length === 0) continue;
      problems.push(
        `${CONFIG}: overrides[${String(i)}].files ${JSON.stringify(pat)} reaches ${CORE} (e.g. ${reached[0]}) and relaxes ${relaxed.map((r) => r.ruleId).join(', ')} — narrow the pattern so it cannot cover the pure package; the port plan found exactly this shape in the scaffold, where "tests may do more" covered **/test/** and therefore ${CORE}/test/**, the one place the boundary is mandatory`,
      );
    }
  }
  if (overrides.length) notes.push(`${String(overrides.length)} override(s) in ${CONFIG}, none relaxing a required rule inside ${CORE}`);

  return { problems, notes, satisfied };
}

// --------------------------------------------------------- the suppressions

/**
 * Every disable directive under the scanned roots.
 * → { problems, notes }
 */
export function suppressions(root) {
  const problems = [];
  const notes = [];
  const required = REQUIRED_RULES.map((r) => r.ruleId);
  const requiredBare = new Set(required.map((r) => bareOf(r)));
  const ineffective = [];

  const found = walk(root, { roots: SCANNED_ROOTS, exts: SCANNED_EXTS, visible: readVisible(root) });
  for (const p of found.problems) problems.push(`suppression scan: ${p}`);

  for (const rel of found.files) {
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch (e) {
      problems.push(`${rel}: unreadable (${String(e.message)}) — a file the suppression scan could not read is not a file with no suppression in it`);
      continue;
    }
    if (!text.includes('-disable')) continue;
    const scan = scanSource(text);
    for (const p of scan.problems) problems.push(`${rel}: the mask itself may be wrong (${p}) — this file cannot be scanned for suppressions`);
    if (scan.problems.length) continue;

    DIRECTIVE_RE.lastIndex = 0;
    let m = DIRECTIVE_RE.exec(text);
    while (m !== null) {
      const start = m.index;
      if (!offsetInComment(scan, text, start)) {
        m = DIRECTIVE_RE.exec(text);
        continue;
      }
      const tool = m[1];
      const scoped = m[2] !== undefined && m[2] !== '';
      const named = rulesNamedBy(m[3] ?? '');
      const where = `${rel}:${String(lineAt(text, start))}`;
      const hits = named.filter((n) => required.includes(n) || requiredBare.has(bareOf(n)));

      if (tool === 'eslint') {
        ineffective.push(`${where} ${tool}-disable${scoped ? m[2] : ''} ${named.join(',') || '(no rule named)'} — there is no eslint in this repository, so it suppresses nothing; its presence means somebody tried`);
      } else if (!scoped && named.length === 0) {
        problems.push(
          `${where}: a file-level \`oxlint-disable\` naming NO rule — it turns off every rule for this whole file; name the single rule you mean and say why, or delete the line`,
        );
      } else if (!scoped && hits.length) {
        problems.push(
          `${where}: a file-level \`oxlint-disable ${hits.join(', ')}\` — MEASURED: the file-level form really does suppress a type-aware rule, and ${hits.length === 1 ? 'that rule' : 'those rules'} ${hits.length === 1 ? 'is' : 'are'} on the required list this lane exists for; delete the directive and fix the finding, or take the rule off REQUIRED_RULES in tools/gates/lights/lint.mjs with a TD entry`,
        );
      } else if (scoped && hits.length) {
        ineffective.push(
          `${where} oxlint-disable${m[2]} ${hits.join(',')} — MEASURED not to suppress a type-aware rule; on a NON-type-aware rule the line-scoped form is UNMEASURED, so this is named rather than assumed harmless`,
        );
      } else if (!scoped) {
        notes.push(`${where} file-level oxlint-disable ${named.join(',')} (no required rule named)`);
      }
      m = DIRECTIVE_RE.exec(text);
    }
  }

  if (ineffective.length) notes.push(`${String(ineffective.length)} directive(s) that suppress nothing here: ${ineffective.slice(0, 4).join(' ; ')}${ineffective.length > 4 ? ` (+${String(ineffective.length - 4)} more)` : ''}`);
  notes.push(`suppression scan: ${String(found.files.length)} file(s) under ${SCANNED_ROOTS.join(' + ')} (tools/** is judged by gate-probes, not by this scan)`);
  return { problems, notes };
}

// -------------------------------------------------------------------- the run

export function run({ root = process.cwd(), premises = null } = {}) {
  const probe = premises ?? readPremises(root);
  const problems = [];
  const unverifiable = [];
  const notes = [];
  /** Every diagnostic the lane itself reported, for the pending-implementation test below. */
  const lintFindings = [];

  const pin = rulePin(root);
  problems.push(...pin.problems);
  notes.push(...pin.notes);

  const supp = suppressions(root);
  problems.push(...supp.problems);
  notes.push(...supp.notes);

  // The mechanical guard on the flag: two places a future edit can separate.
  if (!LINT_ARGV.includes('--type-aware'))
    problems.push(
      'LINT_ARGV in tools/gates/lights/lint.mjs does not carry --type-aware — MEASURED: without the flag every typed rule silently does not run and the output looks like a clean pass, so this lane would report about something weaker than the code',
    );

  const prem = requirePremise(probe, 'oxlint');
  if (!prem.ok) {
    unverifiable.push(`the lint RUN did not happen: ${prem.reason} — the rule pin and the suppression scan above need nothing installed, but a verdict about this tree does`);
  } else {
    let dir = join(root, LIGHT_ARTIFACT_DIR);
    let dirOk = true;
    try {
      mkdirSync(dir, { recursive: true });
    } catch (e) {
      unverifiable.push(`${LIGHT_ARTIFACT_DIR}: not writable (${String(e.message)}) — the verdict is read from a file this light writes, so there is nothing to read`);
      dirOk = false;
      dir = null;
    }
    if (dirOk) {
      const r = sh(prem.premise.path, [...LINT_ARGV], { cwd: root });
      const argvNote = `argv: ${r.argv.join(' ')} (exit ${String(r.code)}, advisory)`;
      if (r.code === null) unverifiable.push(`could not run ${prem.premise.rel}: ${r.spawnError ?? 'spawn failed'}`);
      else {
        // stdout ONLY: the JSON report is written there, and folding stderr in
        // would break the parse for any banner a future version prints.
        const artifactPath = join(dir, 'oxlint.json');
        let written = true;
        try {
          writeFileSync(artifactPath, r.stdout, 'utf8');
        } catch (e) {
          unverifiable.push(`${ARTIFACT}: could not be written (${String(e.message)}) — a missing artefact is CANNOT VERIFY, never green`);
          written = false;
        }
        if (written) {
          const read = readOxlint(artifactPath);
          const stderrNote = r.stderr.trim() === '' ? '' : ` · stderr: ${r.stderr.split('\n')[0] ?? ''}`;
          // ONE chain, on purpose. Splitting it so the findings could be captured sent a GREEN
          // report down the final `else` and into `unverifiable` — a clean lane reported as a
          // missing premise. Caught by the L-lint REVERSE probe, which is what that probe is for.
          if (read.verdict === 'green') notes.push(`${ARTIFACT}: ${read.reason} · ${argvNote}${stderrNote}`);
          else if (read.verdict === 'red') {
            lintFindings.push(...read.diagnostics);
            problems.push(
              `${ARTIFACT}: ${read.reason} — ${read.diagnostics
                .slice(0, 6)
                .map((d) => `${d.filename}:${String(d.line ?? '?')} ${d.code} ${d.message}`)
                .join(' | ')}${read.diagnostics.length > 6 ? ` (+${String(read.diagnostics.length - 6)} more)` : ''} · ${argvNote}`,
            );
          } else unverifiable.push(`${ARTIFACT}: ${read.reason} · ${argvNote}${stderrNote}`);
        }
      }
    }
  }

  const summary = [...new Set(notes)].join(' · ');
  if (problems.length) {
    // Is EVERY finding a pending implementation inside a spec test? `lintFindings` is empty unless
    // the lane actually produced a report, so a problem from the rule-set or suppression checks —
    // which never populates it — leaves this false and the detail unprefixed.
    const pending =
      lintFindings.length > 0 &&
      problems.length === 1 &&
      // The reader already hands back a repo-relative `filename` (measured: oxlint's own
      // `labels[].span.file` is repo-relative), which is the spelling `isSpecTest` classifies.
      lintFindings.every((d) => PENDING_IMPLEMENTATION_RULES.includes(d.code) && isSpecTest(d.filename));
    if (pending) {
      const where = [...new Set(lintFindings.map((d) => d.filename))];
      return {
        id,
        severity,
        // `cannot-verify`, exactly as L-tsc reports the same shape, and for the same reason: the
        // lane ran, but what it found is the absent implementation rather than anything about the
        // code's quality, so there is no lint verdict to be had yet. It is also the status the
        // tolerance in lights/run.mjs is keyed to — a `fail` would never reach it.
        status: 'cannot-verify',
        detail:
          `${PENDING_IMPLEMENTATION_PREFIX} every finding is a missing implementation reached from a placed spec test — ` +
          `${String(lintFindings.length)} finding(s) of ${PENDING_IMPLEMENTATION_RULES.join(' / ')} across ${String(where.length)} spec test(s): ` +
          `${where.slice(0, 4).join(', ')}${where.length > 4 ? ` (+${String(where.length - 4)} more)` : ''} · ` +
          `${problems.join(' || ')} · ${summary} · every strict run fails on this tree; only the hook prints it as a warning`,
      };
    }
    return { id, severity, status: 'fail', detail: `${String(problems.length)} problem(s): ${problems.join(' || ')} · ${summary}` };
  }
  if (unverifiable.length)
    return { id, severity, status: 'cannot-verify', detail: `${String(unverifiable.length)} premise(s) missing: ${unverifiable.join(' || ')} · ${summary} · a lane that did not run is not a lane that passed` };
  return { id, severity, status: 'pass', detail: `the lint lane is green and the rule set is intact · ${summary}` };
}
