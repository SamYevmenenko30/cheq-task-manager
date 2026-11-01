#!/usr/bin/env node
/**
 * spec-gate — the spec phase's only mechanical reader of its own rules.
 *
 * A spec whose `## Open questions` are still live must not become tests: the
 * answers would be improvised by whoever wrote the tests. A spec the gates
 * cannot parse must not become tests either, because every later gate would
 * then be judging a shape nobody agreed on. Those two sentences are the whole
 * purpose of this file; the fifteen rules below are how they are enforced.
 *
 * WHERE A SPEC IS READ FROM. `git show HEAD:docs/specs/CHQ-nnn.md`, via
 * `readSpecAtRev`, never `readFileSync`. The pre-commit hook runs this gate, and
 * a gate that read the work tree would be green on an edit the commit it guards
 * does not contain. The one place the filesystem is read is `--next-id`, which
 * asks "which number is free" — a question, not a verdict — and even there both
 * HEAD and the directory are consulted, so a half-committed spec cannot hand out
 * a number twice. No gate reads the index.
 *
 * FAIL-CLOSED. Everything this gate could not check is CANNOT VERIFY, and
 * CANNOT VERIFY blocks exactly as a failure does. A blocker kind that
 * `spec-parse.mjs` grows later and this file has no case for is itself a
 * failure: a gate that shrugs at a shape it cannot name is not a gate.
 *
 * THE VERDICT IS THE FINDINGS, THE EXIT CODE FOLLOWS. Findings are collected,
 * printed as `path:line — what, and what to do`, counted into `summary.json`
 * under the run directory, and only then turned into an exit status. `ready.mjs`
 * reads that summary and the exit code, never this prose.
 *
 * THE FIFTEEN RULES, in the order they run:
 *   1  a touched spec with live questions + a test file added or modified in the
 *      range ⇒ FAIL. Questions alone ⇒ one WARNING and exit 0: drafting is
 *      exactly when questions are supposed to exist. `--diff-filter=d` in all
 *      three diffs: a DELETED spec does not block, and deleted tests are not a
 *      test phase.
 *   2  `blocked: Qn` whose `Qn` is no longer open ⇒ FAIL. Per QUESTION, not only
 *      when the list went empty — Q1 answered while Q2 stays open used to leave
 *      a row parked on Q1 that nobody named.
 *   3  every live `Sn`: `kind` ∈ KINDS · `verify` EQUALS `deriveVerify(kind)` to
 *      the character · `inputs:` mandatory on a live `kind: core` S, each pair
 *      `[a-z_]+=differs|invariant`.
 *   4  `home:` is one of the closed forms, several joined by ` + `; a bare value
 *      must be a workspace package that exists at HEAD, and the message names
 *      every package it could have been.
 *   5  `## Lights` carries every standing id; each row's `kind` ∈ rule|test|perf,
 *      `severity` ∈ hard|soft, `check` non-empty. A ticket light below the
 *      standing rows is legal and is reported, not failed.
 *   6  at least one LIVE assertion — "a spec with no live assertion contracts
 *      nothing". Every per-S rule is a loop over a possibly empty array, so
 *      without this rule a spec with zero assertions passes all of them.
 *   7  Vision coverage: every `§n` of `## Vision (verbatim)` has an AC-map row,
 *      and the FAIL lists the sentences nobody mapped.
 *   8  every live `Yn` under `## Syrup` is a substring of the Vision; a `Yn`
 *      filed under `## Open questions` fails (it reaches here through
 *      `parseSpec`'s `unparsable`).
 *   9  every AC row names a live `Sn` or carries an escape home; `—` alone is a
 *      silent absence.
 *   10 an unclassified file under a test directory ⇒ blocked BEFORE any spec is
 *      parsed: if a test file cannot be classified, "did this range enter the
 *      test phase" has no answer, and rule 1 rests on that answer.
 *   11 `check:` is REBOUND TO APPROVAL: `check: TODO` while the spec is
 *      unapproved; once approved, every live S's `check:` exists at HEAD,
 *      classifies as a spec test of that S's kind, sits under
 *      `<test dir>/CHQ-nnn/`, and no two S share one file.
 *   12 assertion ids are APPEND-ONLY from approval: a live `Sn` that vanished ⇒
 *      FAIL (withdraw with `~~Sn~~`), a live `Sn` whose text changed ⇒ FAIL
 *      ("reworded after approval"). The trigger is the APPROVAL, not a section.
 *   13 one WARNING when a touched spec carries a live `kind: e2e` S while the
 *      browser premise is not observed. This is the ONE place machine state is
 *      reported by this gate, and it is never compared with a spec.
 *   14 `--require-approved CHQ-nnn` is ADDITIVE: the structural rules run FIRST
 *      and their findings are kept, then the approval is judged. The id captured
 *      from the trailer is matched against the id ASKED FOR.
 *   15 `--next-id` is the only subcommand that works without a HEAD.
 *
 * Exit: 0 green · 1 any FAIL or CANNOT VERIFY · 2 only "not a git repository" /
 * "no commits yet". A WARNING never changes the exit code.
 *
 * Zero dependencies, Node 22 ESM: `node:` builtins and this repository's own
 * `tools/gates/lib/` only, because the gates must run in a fresh worktree
 * before an install has finished.
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SEVERITIES,
  HOME_FORMS,
  isSpecId,
  specPath,
  specIdOfPath,
  nextSpecId,
  parseSpec,
  parseHome,
  blockers,
  readSpecAtRev,
  parseApprovals,
  indentedApprovals,
  approvalStatus,
} from './lib/spec-parse.mjs';
import { classify, dirOfKind, isTestFile, isTestSupport } from './lib/test-file-patterns.mjs';
import {
  EMPTY_TREE,
  git,
  repoRoot,
  hasCommits,
  headSha,
  revParse,
  mergeBase,
  baseRev,
  diffNamesFiltered,
  existsAtHead,
  showAtHead,
  isTreeClean,
} from './lib/git.mjs';
import { readProbe, premise } from './lib/probe.mjs';
import { makeRunDir, artifactPath, writeRunJson } from './lib/run-dir.mjs';

const PREFIX = '[spec-gate]';

/**
 * `home:` forms that do NOT name a place in the tree. They are this gate's
 * vocabulary, not `spec-parse.mjs`': the library's `HOME_FORMS` holds the three
 * PATH forms (module/route/screen) and classifies everything else as
 * `unknownForm`, so a legal `new:` or `deferred:` arrives here as a library
 * "problem" and is re-judged below. That asymmetry is named in the report rather
 * than papered over with a second copy of the dictionary.
 */
const HOME_ESCAPE_FORMS = ['new', 'deferred', 'out of scope', 'blocked'];

/** The escapes that explain an AC row with no assertion (rule 9). */
const AC_ESCAPE_FORMS = ['deferred', 'out of scope', 'blocked'];

/** `## Lights` → `kind` column. The plan names these three; no library holds them. */
const LIGHT_KINDS = ['rule', 'test', 'perf'];

/** `inputs:` values. `differs`: changing it alone changes the observable; `invariant`: it must not. */
const INPUT_VALUES = ['differs', 'invariant'];
const INPUT_NAME_RE = /^[a-z_]+$/;

const NEW_PACKAGE_RE = /^@cheq\/[a-z0-9][a-z0-9-]*$/;
const TD_RE = /^TD-\d{4}$/;
const QUESTION_RE = /^Q\d+$/;
const TICKET_LIGHT_RE = /^L-[a-z0-9]+(?:-[a-z0-9]+)*$/;

const USAGE = `usage: node tools/gates/spec-gate.mjs [--base <ref>] [--since <sha>] [--require-approved CHQ-<nnn>] [--next-id]

  --base <ref>              diff HEAD against merge-base(<ref>, HEAD)   (default: main)
  --since <sha>             diff HEAD against <sha> exactly; ${EMPTY_TREE.slice(0, 7)}… = the empty tree
  --require-approved CHQ-n  ALSO require a \`spec-approved: CHQ-n <name> <date>\` trailer.
                            Additive: the structural rules still run and still report.
  --next-id                 print the next free spec id and exit (works without a HEAD)`;

const log = (msg) => console.log(`${PREFIX} ${msg}`);
const err = (msg) => console.error(`${PREFIX} ${msg}`);
const short = (sha) => (typeof sha === 'string' && sha.length > 9 ? sha.slice(0, 9) : String(sha ?? '?'));
const clip = (s, n = 72) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// --------------------------------------------------------------------- argv

/** → { ok, opts|reason }. An unknown flag is refused: a typo must not read as a default. */
export function parseArgv(argv) {
  const opts = { base: null, since: null, requireApproved: null, nextId: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = (name) => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { bad: `${name} needs a value` };
      i++;
      return { value: v };
    };
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--next-id') opts.nextId = true;
    else if (a === '--base') {
      const r = need('--base');
      if (r.bad) return { ok: false, reason: r.bad };
      opts.base = r.value;
    } else if (a === '--since') {
      const r = need('--since');
      if (r.bad) return { ok: false, reason: r.bad };
      opts.since = r.value;
    } else if (a === '--require-approved') {
      const r = need('--require-approved');
      if (r.bad) return { ok: false, reason: r.bad };
      opts.requireApproved = r.value;
    } else return { ok: false, reason: `unknown argument ${JSON.stringify(a)}` };
  }
  if (opts.base && opts.since) return { ok: false, reason: '--base and --since are two answers to one question; pass one' };
  if (opts.requireApproved !== null && !isSpecId(opts.requireApproved))
    return { ok: false, reason: `--require-approved ${JSON.stringify(opts.requireApproved)} is not a spec id (expected CHQ-<nnn>)` };
  return { ok: true, opts };
}

// ------------------------------------------------------------------ findings

/**
 * The report. `fail` and `cannot-verify` both block; they are kept apart because
 * they are different sentences: one says the spec is wrong, the other says this
 * gate could not tell. `warn` never blocks — rule 8's syrup and rule 13's probe
 * state are warnings by design, and a warning that could block would make a
 * machine-local condition a spec failure.
 */
function newReport() {
  const findings = [];
  const warnings = [];
  return {
    findings,
    warnings,
    fail: (where, what) => findings.push({ severity: 'fail', where: where ?? null, what: String(what) }),
    cannotVerify: (where, what) => findings.push({ severity: 'cannot-verify', where: where ?? null, what: String(what) }),
    warn: (where, what) => warnings.push({ where: where ?? null, what: String(what) }),
    get fails() {
      return findings.filter((f) => f.severity === 'fail');
    },
    get cannotVerifies() {
      return findings.filter((f) => f.severity === 'cannot-verify');
    },
  };
}

const show = (entry) => (entry.where ? `${entry.where} — ${entry.what}` : entry.what);

// ---------------------------------------------------------------- rule 15

/**
 * The next free spec id, from HEAD **and** from the directory. Both, because
 * either alone hands out a number twice: HEAD alone misses a spec written but
 * not committed, the directory alone misses one committed on another branch and
 * not checked out. Numbers are never reused, so this is max + 1, not the first
 * gap (`nextSpecId`).
 */
function nextIdOf(root) {
  const ids = new Set();
  const sources = [];
  const tree = git(['ls-tree', '-r', '--name-only', 'HEAD', '--', 'docs/specs'], { cwd: root });
  if (tree.code === 0) {
    sources.push('HEAD');
    for (const line of tree.stdout.split('\n')) {
      const id = specIdOfPath(line.trim());
      if (id) ids.add(id);
    }
  }
  try {
    for (const name of readdirSync(resolve(root, 'docs/specs'))) {
      const id = specIdOfPath(`docs/specs/${name}`);
      if (id) ids.add(id);
    }
    sources.push('docs/specs/');
  } catch {
    // No directory yet: an absent docs/specs is not an error for this question.
  }
  return { id: nextSpecId([...ids]), known: [...ids].toSorted(byString), sources };
}

// ----------------------------------------------------------------- the range

/** → { ok, base, kind, reason }. `--since <EMPTY_TREE>` is accepted by name: it
 * is a tree, not a commit, so `rev-parse <it>^{commit}` refuses it, and it is
 * exactly what `ready.mjs` passes for the range that starts at the first commit. */
function resolveRange(opts) {
  if (opts.since) {
    if (opts.since === EMPTY_TREE) return { ok: true, base: EMPTY_TREE, kind: 'empty-tree', reason: null };
    const r = revParse(opts.since);
    if (!r.ok) return { ok: false, base: null, kind: null, reason: `--since ${opts.since}: ${r.reason}` };
    return { ok: true, base: r.sha, kind: 'since', reason: null };
  }
  if (opts.base) {
    const ref = revParse(opts.base);
    if (!ref.ok) return { ok: false, base: null, kind: null, reason: `--base ${opts.base}: ${ref.reason}` };
    const head = headSha();
    if (!head.ok) return { ok: false, base: null, kind: null, reason: head.reason };
    const mb = mergeBase(ref.sha, head.sha);
    if (!mb.ok) return { ok: false, base: null, kind: null, reason: `no merge base between ${opts.base} and HEAD: ${mb.reason}` };
    return { ok: true, base: mb.sha, kind: 'merge-base', reason: null };
  }
  const auto = baseRev('main');
  if (!auto.ok) return { ok: false, base: null, kind: null, reason: auto.reason };
  return { ok: true, base: auto.rev, kind: auto.kind, reason: auto.reason };
}

/** Added-or-modified paths in the range. `--diff-filter=d` = everything except
 * deletions: a deleted spec must not block, and deleted tests are not a test phase. */
function touchedPaths(base, pathspec) {
  return diffNamesFiltered(base, 'HEAD', 'd', { pathspec });
}

// ------------------------------------------------------- workspace packages

/** Every workspace package NAME at HEAD, read from the manifests git has, never
 * from `node_modules` or from a list in a gate. → { ok, names, reason } */
function workspacePackages(root, report) {
  const tree = git(['ls-tree', '-r', '--name-only', 'HEAD', '--', 'packages', 'apps'], { cwd: root });
  if (tree.code !== 0)
    return { ok: false, names: [], reason: `git ls-tree HEAD -- packages apps exited ${tree.code}: ${tree.stderr.trim()}` };
  const names = [];
  for (const line of tree.stdout.split('\n')) {
    const p = line.trim();
    if (!/^(packages|apps)\/[^/]+\/package\.json$/.test(p)) continue;
    const text = showAtHead(p, { cwd: root });
    if (!text.ok) {
      report.cannotVerify(p, `unreadable at HEAD (${text.reason}) — a package whose manifest cannot be read cannot be a legal \`home:\``);
      continue;
    }
    try {
      const name = JSON.parse(text.text)?.name;
      if (typeof name === 'string' && name) names.push(name);
      else report.cannotVerify(p, 'the manifest declares no `name` — nothing can name it as a `home:`');
    } catch (e) {
      report.cannotVerify(p, `not JSON at HEAD (${String(e.message)}) — fix the manifest; \`home:\` names are read from it`);
    }
  }
  return { ok: true, names: names.toSorted(byString), reason: null };
}

/** Tech-debt ids that have a file at HEAD, so `deferred: TD-nnnn` cannot point at nothing. */
function techDebtIds(root) {
  const tree = git(['ls-tree', '-r', '--name-only', 'HEAD', '--', 'docs/tech-debt'], { cwd: root });
  const ids = new Set();
  if (tree.code !== 0) return { ok: false, ids, reason: tree.stderr.trim() || `git ls-tree exited ${tree.code}` };
  for (const line of tree.stdout.split('\n')) {
    const m = line.trim().match(/^docs\/tech-debt\/(TD-\d{4})[-.]/);
    if (m) ids.add(m[1]);
  }
  return { ok: true, ids, reason: null };
}

// ------------------------------------------------------------- rule 4: home

/**
 * One ` + `-joined `home:` value → one verdict per part.
 * → [{ raw, ok, form, path, reason }]
 *
 * The three PATH forms are read by `parseHome` (the library is the one reader of
 * that shape); the escapes are judged here, because the library's dictionary
 * does not hold them.
 */
function validateHome(raw, ctx) {
  const parts = String(raw ?? '')
    .split(' + ')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (!parts.length) return [{ raw: String(raw ?? ''), ok: false, form: null, path: null, reason: 'empty `home:`' }];

  return parts.map((part) => {
    const bad = (reason, form = null) => ({ raw: part, ok: false, form, path: null, reason });
    const good = (form, path = null) => ({ raw: part, ok: true, form, path, reason: null });

    const h = parseHome(part);

    if (h.form === 'module' || h.form === 'screen') {
      if (!h.path) return bad(`\`${h.form}:\` names no path`, h.form);
      if (!existsAtHead(h.path, { cwd: ctx.root }))
        return bad(
          `\`${h.form}: ${h.path}\` does not exist at HEAD — name a committed file, or write \`new: @cheq/<name>\` / \`deferred: TD-nnnn\` instead`,
          h.form,
        );
      return good(h.form, h.path);
    }
    if (h.form === 'route') {
      // The escape form: a route may not exist yet, so existence is NOT checked
      // here. What is required instead is a paired AC-map row (checked by the
      // caller), so the § that needs the route is never silently absent.
      if (!h.path) return bad('`route:` names no route — write `route: <METHOD /path>`', 'route');
      return good('route', h.path);
    }
    if (h.unknownForm) {
      const form = h.unknownForm;
      const value = part.slice(part.indexOf(':') + 1).trim();
      if (form === 'new') {
        if (!NEW_PACKAGE_RE.test(value)) return bad(`\`new: ${value}\` is not a package name — write \`new: @cheq/<name>\``, 'new');
        return good('new', null);
      }
      if (form === 'deferred') {
        if (!TD_RE.test(value)) return bad(`\`deferred: ${value}\` is not a tech-debt id — write \`deferred: TD-nnnn\``, 'deferred');
        if (ctx.techDebt.ok && !ctx.techDebt.ids.has(value))
          return bad(
            `\`deferred: ${value}\` names no entry at HEAD — add docs/tech-debt/${value}-<slug>.md in this commit, or defer to an entry that exists`,
            'deferred',
          );
        return good('deferred', null);
      }
      if (form === 'blocked') {
        if (!QUESTION_RE.test(value)) return bad(`\`blocked: ${value}\` is not a question id — write \`blocked: Qn\``, 'blocked');
        return good('blocked', null);
      }
      return bad(
        `\`${form}:\` is not a home form — the forms are ${[...HOME_FORMS, ...HOME_ESCAPE_FORMS].map((f) => `${f}:`).join(' · ')} or a workspace package name`,
        null,
      );
    }
    // No `<word>:` prefix the library recognised: either `out of scope: <why>`
    // (its spaces keep it out of the library's form regex) or a bare name.
    const oos = part.match(/^out of scope:\s*(.*)$/i);
    if (oos) {
      if (!oos[1].trim()) return bad('`out of scope:` carries no reason — say why in the same line', 'out of scope');
      return good('out of scope', null);
    }
    if (ctx.packages.includes(part)) return good('package', null);
    return bad(
      `${JSON.stringify(part)} is not a workspace package at HEAD (${ctx.packages.length ? ctx.packages.join(', ') : 'no package manifest found at HEAD'})` +
        ` and not one of ${[...HOME_FORMS, ...HOME_ESCAPE_FORMS].map((f) => `${f}:`).join(' · ')}`,
      null,
    );
  });
}

const homeForms = (raw, ctx) => validateHome(raw, ctx).filter((r) => r.ok).map((r) => r.form);

// -------------------------------------------------- rule 7: Vision coverage

/**
 * The Vision's sentences, numbered deterministically: split on newlines first,
 * then on `.`, `!`, `?`. The numbering is a CONTRACT with the AC map, so it has
 * to be reproducible rather than clever — `e.g.` splits a sentence in two here,
 * and that is accepted, because the alternative is a numbering that changes when
 * someone improves the splitter. The AC map numbers what this function returns.
 */
export function visionSentences(text) {
  const out = [];
  for (const rawLine of String(text ?? '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    for (const piece of line.match(/[^.!?]+[.!?]*/g) ?? []) {
      const t = piece.trim();
      if (t) out.push({ n: out.length + 1, text: t });
    }
  }
  return out;
}

/** `§1`, `§2, §3`, `§2-4`, `§2–4` in one AC cell → the section numbers it claims. */
export function sectionRefs(cell) {
  const refs = new Set();
  for (const m of String(cell ?? '').matchAll(/§\s*(\d+)(?:\s*[-–—]\s*(\d+))?/g)) {
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (to >= from) for (let n = from; n <= to; n++) refs.add(n);
    else refs.add(from);
  }
  return refs;
}

// ------------------------------------------------------- approval (rule 14)

/**
 * Every `spec-approved:` line in the WHOLE history of HEAD, plus the indented
 * ones that declare nothing. History, not the range: the question "is this spec
 * approved as it stands" does not depend on which range the caller asked about,
 * and a trailer signed before the range would otherwise read as absent.
 * → { ok, approvals, indented, reason }
 */
function approvalsInHistory(root) {
  const r = git(['log', '-z', '--format=%H%n%B', 'HEAD'], { cwd: root });
  if (r.code !== 0) return { ok: false, approvals: [], indented: [], reason: r.stderr.trim() || `git log exited ${r.code}` };
  const approvals = [];
  const indented = [];
  for (const record of r.stdout.split('\0')) {
    if (!record.trim()) continue;
    const nl = record.indexOf('\n');
    const commit = (nl === -1 ? record : record.slice(0, nl)).trim();
    const body = nl === -1 ? '' : record.slice(nl + 1);
    approvals.push(...parseApprovals(body, { commit }));
    indented.push(...indentedApprovals(body, { commit }));
  }
  return { ok: true, approvals, indented, reason: null };
}

/** Commits that touched one path, newest first. */
function commitsTouching(root, path, range = 'HEAD') {
  const r = git(['log', '-z', '--format=%H', '--end-of-options', range, '--', path], { cwd: root });
  if (r.code !== 0) return { ok: false, commits: [], reason: r.stderr.trim() || `git log exited ${r.code}` };
  return { ok: true, commits: r.stdout.split('\0').map((s) => s.trim()).filter(Boolean), reason: null };
}

/**
 * The approval verdict for one spec. The library decides (`approvalStatus`);
 * this function brings it the git facts, including the commits that changed the
 * spec AFTER the newest matching approval — which is what makes an approval go
 * stale loudly instead of surviving an edit.
 */
function approvalOf(root, id, history) {
  if (!history.ok)
    return { verdict: 'cannot-verify', approved: null, stale: false, reasons: [`cannot read the commit history: ${history.reason}`], editedAfter: [] };
  const matching = history.approvals.filter((a) => a.specId === id);
  let editedAfter = [];
  if (matching.length && matching[0].commit) {
    const after = commitsTouching(root, specPath(id), `${matching[0].commit}..HEAD`);
    if (!after.ok)
      return {
        verdict: 'cannot-verify',
        approved: null,
        stale: false,
        reasons: [`cannot tell whether ${id} changed after ${short(matching[0].commit)}: ${after.reason}`],
        editedAfter: [],
      };
    editedAfter = after.commits;
  }
  const status = approvalStatus({ specId: id, approvals: history.approvals, editedAfter, indented: history.indented });
  return { ...status, editedAfter };
}

// ------------------------------------------------- the blockers the lib found

/**
 * `blockers(spec)` is the library's own list of reasons the test phase is
 * blocked. Each kind is routed here, and an UNKNOWN kind is a failure: when
 * `spec-parse.mjs` grows a blocker this file has no case for, the gate must say
 * so rather than drop it (rule 13 — a gate change is a declared decision).
 *
 * Two kinds are deliberately NOT failed here:
 *   `open-question`      — rule 1 decides, from whether the range touched a test
 *   `blocked-on-question`— rule 2 decides, per question
 *   `assertion-home-unknown-form` — re-judged by rule 4, because the library's
 *                          HOME_FORMS does not hold the escape forms
 */
function routeBlockers(spec, report) {
  const openQuestions = [];
  for (const b of blockers(spec)) {
    switch (b.kind) {
      case 'open-question':
        openQuestions.push(b);
        break;
      case 'blocked-on-question':
        break; // rule 2
      case 'assertion-home-unknown-form':
        break; // rule 4
      case 'unparsable':
      case 'lights-severity-drift':
        report.fail(b.where, b.text);
        break;
      case 'lights-missing':
        report.fail(b.where, `${b.text} — every standing light id rides in \`## Lights\` (copy the rows from docs/templates/SPEC.md)`);
        break;
      case 'lights-unknown-id':
        // A TICKET light below the standing rows is legal (the template says so).
        // A cell that is not an id at all — a leftover placeholder, a typo'd
        // column — is not: and a MISSPELLED standing id still fails, through the
        // missing-id finding above.
        if (TICKET_LIGHT_RE.test(b.text.split(' ')[0])) report.warn(b.where, `${b.text} — read as a ticket light`);
        else report.fail(b.where, `${b.text} and is not of the form L-<kebab> — delete the placeholder row or give it an id`);
        break;
      case 'questions-missing':
        report.cannotVerify(b.where, `${b.text} — add the heading with \`- none\` under it`);
        break;
      default:
        if (b.kind.startsWith('assertion-')) report.fail(b.where, b.text);
        else
          report.fail(
            b.where,
            `${b.text} (blocker kind ${JSON.stringify(b.kind)} has no case in spec-gate — a gate change is a declared decision, rule 13)`,
          );
    }
  }
  return openQuestions;
}

// ------------------------------------------------------------ one spec, all rules

/**
 * Every structural rule for one spec, in the order of the list in the header.
 * Rule 1 is not here — it needs the range as a whole — so this returns what
 * rule 1 needs: the open questions it found.
 */
function checkSpec({ id, spec, report, ctx }) {
  const at = (line) => `${spec.path ?? specPath(id)}:${line ?? 1}`;
  const live = spec.assertions.filter((a) => !a.withdrawn);
  const liveIds = new Set(live.map((a) => a.id));

  // Library blockers: unparsable shapes, missing sections, lights, assertion fields.
  const openQuestions = routeBlockers(spec, report);

  // An approval written INTO the file approves itself in the same edit (rule 14).
  for (const a of spec.approvalInFile)
    report.fail(at(a.line), 'a `spec-approved:` line inside the spec approves nothing — the trailer belongs in a COMMIT message after the spec\'s last content change');

  // --- rule 2: a park on a question that is no longer open
  const openIds = new Set(spec.openQuestions.map((q) => q.id).filter(Boolean));
  const anonymousQuestions = spec.openQuestions.filter((q) => !q.id);
  for (const b of spec.stillBlocked) {
    const m = b.text.match(/\bblocked:\s*(Q\d+)/i);
    const qid = m ? m[1].toUpperCase() : null;
    if (!qid) continue;
    if (openIds.has(qid)) continue;
    if (anonymousQuestions.length) {
      report.cannotVerify(
        at(b.line),
        `parked on ${qid}, and ${anonymousQuestions.length} item(s) under \`## Open questions\` carry no \`Qn:\` prefix (first at line ${anonymousQuestions[0].line}) — a question with no id cannot be matched against a park`,
      );
      continue;
    }
    report.fail(
      at(b.line),
      `parked on ${qid}, which is not open any more${openIds.size ? ` (open: ${[...openIds].toSorted(byString).join(', ')})` : ' (no question is open)'} — re-home this row now that it has an answer`,
    );
  }

  // --- rule 3: inputs on a live assertion (kind and verify are library problems)
  for (const a of live) {
    if (a.kind === 'core' && a.inputsRaw === null)
      report.fail(
        at(a.line),
        `${a.id}: \`inputs:\` is mandatory on a live \`kind: core\` assertion — declare at least one \`<name>=differs\` or \`<name>=invariant\``,
      );
    const pairs = a.inputs?.pairs ?? [];
    if (a.inputsRaw !== null && pairs.length === 0 && !(a.inputs?.unparsable.length))
      report.fail(at(a.line), `${a.id}: \`inputs:\` is empty — write \`<name>=differs, <name>=invariant\` or remove the field`);
    for (const p of pairs) {
      if (!INPUT_NAME_RE.test(p.name))
        report.fail(at(a.line), `${a.id}: input name ${JSON.stringify(p.name)} is not [a-z_]+ — the test phase writes one case per name, so the name is a contract`);
      if (!INPUT_VALUES.includes(p.value))
        report.fail(
          at(a.line),
          `${a.id}: input ${p.name}=${JSON.stringify(p.value)} is not one of ${INPUT_VALUES.join('|')} — \`differs\` means changing it alone changes the observable, \`invariant\` means it must not`,
        );
    }
    // `verify:` itself is compared character for character against
    // `deriveVerify(kind)` by `parseAssertions`, and that problem reaches the
    // report through `routeBlockers`, whose message prints the value to write.
    // It is NOT re-checked here: one fact, one reader, one message.
  }

  // --- rule 4: home
  for (const a of live) {
    if (a.homeRaw === null) {
      report.fail(at(a.line), `${a.id}: no \`home:\` — name the owner (a workspace package, \`module:\`/\`route:\`/\`screen:\` at HEAD, or an escape)`);
      continue;
    }
    const parts = validateHome(a.homeRaw, ctx);
    for (const p of parts) if (!p.ok) report.fail(at(a.line), `${a.id}: home ${p.reason}`);
    // A `route:` is not checked for existence, so its § must be visible in the
    // AC map: that paired row is the only thing keeping a route from being a wish.
    if (parts.some((p) => p.ok && p.form === 'route')) {
      const paired = spec.acRows.some((r) => r.assertions.includes(a.id));
      if (!paired)
        report.fail(
          at(a.line),
          `${a.id}: \`route:\` is an escape form — existence is not checked at HEAD, so the AC map must carry a row naming ${a.id}`,
        );
    }
  }

  // --- rule 5: the lights table, row by row (the id set is a library blocker)
  for (const row of spec.lights) {
    if (!row.id) {
      report.fail(at(row.line), 'a `## Lights` row with no id — the first column is the light id');
      continue;
    }
    if (!LIGHT_KINDS.includes(row.kind))
      report.fail(at(row.line), `${row.id}: kind ${JSON.stringify(row.kind)} is not one of ${LIGHT_KINDS.join('|')} (rule = a static read · test = runs a runner · perf = a budget)`);
    if (!SEVERITIES.includes((row.severity ?? '').toLowerCase()))
      report.fail(at(row.line), `${row.id}: severity ${JSON.stringify(row.severity)} is not one of ${SEVERITIES.join('|')}`);
    if (!row.check) report.fail(at(row.line), `${row.id}: the \`check\` cell is empty — a light with no command is a wish`);
  }

  // --- rule 6
  if (!live.length)
    report.fail(
      at(spec.sections?.assertions?.start ?? 1),
      'a spec with no live assertion contracts nothing — write at least one `- **S1** …`, or withdraw the spec itself',
    );

  // --- rule 7: Vision coverage
  const sentences = visionSentences(spec.vision);
  if (!spec.vision || !sentences.length) {
    report.fail(
      at(spec.sections?.vision?.start ?? 1),
      '`## Vision (verbatim)` is empty — this section IS the ticket; there is no ticket system behind the id',
    );
  } else {
    const covered = new Set();
    for (const row of spec.acRows) for (const n of sectionRefs(row.ac)) covered.add(n);
    const uncovered = sentences.filter((s) => !covered.has(s.n));
    if (uncovered.length)
      report.fail(
        at(spec.sections?.acMap?.start ?? 1),
        `the AC map covers ${sentences.length - uncovered.length} of ${sentences.length} Vision sentence(s); no row names ` +
          uncovered.map((s) => `§${s.n} (${JSON.stringify(clip(s.text, 40))})`).join(', ') +
          ' — no silent absences: give each § a row, with an escape home if it has no assertion',
      );
    const beyond = [...new Set(spec.acRows.flatMap((r) => [...sectionRefs(r.ac)]))].filter((n) => n > sentences.length).toSorted((a, b) => a - b);
    if (beyond.length)
      report.fail(
        at(spec.sections?.acMap?.start ?? 1),
        `the AC map names §${beyond.join(', §')} but the Vision has ${sentences.length} sentence(s) — the numbering is the split of \`## Vision (verbatim)\` on newlines and on .!?`,
      );
  }

  // --- rule 8: syrup is quoted, never reworded
  for (const y of spec.syrup) {
    if (y.text === null) continue; // withdrawn: it carries a reason, not a quote
    const v = y.verbatim ?? { exact: false, collapsed: false, reason: 'no comparison was made' };
    if (!v.collapsed)
      report.fail(
        at(y.line),
        `${y.id}: ${v.reason} — a Yn is quoted from \`## Vision (verbatim)\`, never written; copy the sentence or drop the item`,
      );
    else if (!v.exact)
      report.warn(at(y.line), `${y.id}: ${v.reason}`);
    if (!y.quoted) report.warn(at(y.line), `${y.id}: the quote carries no quotation marks — write \`- **${y.id}** "<sentence>" · carrier: <noun>\``);
  }

  // --- rule 9: every AC row has an assertion or an escape
  for (const row of spec.acRows) {
    const named = row.assertions;
    const unknown = named.filter((s) => !liveIds.has(s));
    const homeCell = row.home.replace(/^[—–-]$/, '').trim();
    const forms = homeCell ? homeForms(homeCell, ctx) : [];
    const escaped = forms.some((f) => AC_ESCAPE_FORMS.includes(f));
    if (unknown.length)
      report.fail(at(row.line), `the AC row names ${unknown.join(', ')}, which ${unknown.length > 1 ? 'are' : 'is'} not a live assertion of this spec`);
    if (!named.length && !escaped)
      report.fail(
        at(row.line),
        `the AC row for ${row.ac ? clip(row.ac, 40) : 'this §'} names no assertion and carries no escape home (${AC_ESCAPE_FORMS.map((f) => `${f}:`).join(' · ')}) — a § with neither is a silent absence`,
      );
    if (homeCell)
      for (const p of validateHome(homeCell, ctx)) if (!p.ok) report.fail(at(row.line), `planned home ${p.reason}`);
  }

  return { live, openQuestions, sentences };
}

/** Rules 11 and 12 — both triggered by the approval, not by a section. */
function checkApproved({ id, spec, live, approval, report, ctx }) {
  const at = (line) => `${spec.path ?? specPath(id)}:${line ?? 1}`;
  const approvedAtAll = Boolean(approval.approved);
  const fresh = approval.verdict === 'green';

  // --- rule 11: `check:` is rebound to approval
  if (fresh) {
    const byFile = new Map();
    for (const a of live) {
      const value = a.check;
      if (value === null) continue; // the library already reported check-missing
      if (/^todo$/i.test(value)) {
        report.fail(
          at(a.line),
          `${a.id}: \`check: TODO\` survives only while the spec is unapproved — ${id} is approved, so name the file that holds the cases`,
        );
        continue;
      }
      const c = classify(value);
      if (c.form !== 'spec-test' && c.form !== 'e2e-test') {
        report.fail(
          at(a.line),
          `${a.id}: \`check: ${value}\` is not a spec test (${c.form}${c.reason ? `: ${c.reason}` : ''}) — the shape is <test dir>/${id}/S<n>_<kebab-slug>`,
        );
        continue;
      }
      if (c.kind !== a.kind)
        report.fail(at(a.line), `${a.id}: \`check: ${value}\` lives in the ${c.kind} tree but the assertion is \`kind: ${a.kind}\` — a kind names its own directory and its own runner`);
      const dir = dirOfKind(a.kind);
      if (dir && !value.startsWith(`${dir}/${id}/`))
        report.fail(at(a.line), `${a.id}: \`check: ${value}\` is outside ${dir}/${id}/ — a spec's tests live under its own id`);
      if (!existsAtHead(value, { cwd: ctx.root }))
        report.fail(at(a.line), `${a.id}: \`check: ${value}\` does not exist at HEAD — commit the test file, or write \`check: TODO\` and re-sign the spec`);
      if (byFile.has(value))
        report.fail(at(a.line), `${a.id}: \`check: ${value}\` is already ${byFile.get(value)}'s file — one file per assertion, so a red case has one owner`);
      else byFile.set(value, a.id);
    }
  }

  // --- rule 12: ids are append-only from approval
  if (!approvedAtAll) return;
  const history = commitsTouching(ctx.root, spec.path ?? specPath(id));
  if (!history.ok) {
    report.cannotVerify(spec.path ?? specPath(id), `cannot read this spec's own history (${history.reason}) — append-only ids cannot be checked`);
    return;
  }
  const previous = history.commits[1] ?? null;
  if (!previous) return; // first appearance: nothing to be append-only against
  const before = readSpecAtRev(ctx.root, id, previous);
  if (!before.ok) {
    report.cannotVerify(`${spec.path ?? specPath(id)}@${short(previous)}`, `cannot read the previous revision (${before.error}) — append-only ids cannot be checked`);
    return;
  }
  const old = parseSpec(before.text, { path: spec.path ?? specPath(id) });
  const nowById = new Map(spec.assertions.map((a) => [a.id, a]));
  for (const a of old.assertions.filter((x) => !x.withdrawn)) {
    const current = nowById.get(a.id);
    if (!current) {
      report.fail(
        spec.path ?? specPath(id),
        `${a.id} was live in ${short(previous)} and is gone — ids are append-only once approved; withdraw it with \`- ~~${a.id}~~ withdrawn: <why>\` and never reuse the number`,
      );
      continue;
    }
    if (!current.withdrawn && current.text !== a.text)
      report.fail(
        at(current.line),
        `${a.id} was reworded after approval (${short(previous)} said ${JSON.stringify(clip(a.text, 48))}) — bump \`Revision:\`, re-sign with a new \`spec-approved:\` trailer, or restore the text`,
      );
  }
}

// ------------------------------------------------------------------- the gate

/** The whole gate. → exit code. Nothing here calls `process.exit`. */
export function run(argv = []) {
  const parsed = parseArgv(argv);
  if (!parsed.ok) {
    err(`FAIL: ${parsed.reason}`);
    console.error(USAGE);
    return 1;
  }
  const opts = parsed.opts;
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }

  // --- pin the cwd to the repository root: from a subdirectory a relative
  // pathspec silently matches nothing, and a gate that checks nothing is green.
  const rr = repoRoot();
  if (!rr.ok) {
    err(`CANNOT VERIFY: not a git repository (${rr.reason}).`);
    err('  Every rule here reads git — the range, the spec text, the approval trailer. Run it inside the repository.');
    return 2;
  }
  const root = rr.root;
  process.chdir(root);

  // --- rule 15: the one subcommand that works without a HEAD
  if (opts.nextId) {
    const next = nextIdOf(root);
    console.log(next.id);
    log(`next free id, from ${next.sources.join(' ∪ ') || 'nothing (no HEAD, no docs/specs/)'}; ids in use: ${next.known.join(', ') || 'none'}`);
    return 0;
  }

  if (!hasCommits()) {
    err('CANNOT VERIFY: this repository has no commits yet.');
    err('  A spec is read with `git show HEAD:docs/specs/CHQ-nnn.md`, never from the work tree: reading the tree');
    err('  would make the pre-commit hook green on an edit the commit it guards does not contain.');
    err('  Cure: git add -A && CHEQ_SKIP_HOOKS=1 git commit -m "chore: scaffold, gates and doctrine", then run this again.');
    err('  `--next-id` is the only subcommand that answers without a HEAD.');
    return 2;
  }

  const range = resolveRange(opts);
  if (!range.ok) {
    err(`FAIL: ${range.reason}`);
    const r = newReport();
    r.fail(null, range.reason);
    writeSummary({ root, verdict: 'fail', report: r, argv, range: { base: null, kind: null }, ids: [], exitCode: 1 });
    return 1;
  }
  const head = headSha();
  log(`range ${short(range.base)}..${short(head.sha)} (${range.kind}${range.reason ? `: ${range.reason}` : ''})`);

  const report = newReport();
  const ctx = { root, packages: [], techDebt: { ok: false, ids: new Set(), reason: null } };

  // --- rule 10: nothing in a test directory may hide, and this runs FIRST
  // because rule 1 asks "did this range enter the test phase" and an
  // unclassifiable test file makes that question unanswerable.
  const allTouched = touchedPaths(range.base, []);
  if (!allTouched.ok) {
    err(`CANNOT VERIFY: cannot read the range (${allTouched.reason})`);
    report.cannotVerify(null, `cannot read the range ${short(range.base)}..HEAD: ${allTouched.reason}`);
    writeSummary({ root, verdict: 'cannot-verify', report, argv, range, ids: [], exitCode: 1 });
    return 1;
  }
  const touchedTests = [];
  for (const path of allTouched.files) {
    const c = classify(path);
    if (c.form === 'unclassified-test' || c.form === 'invalid')
      report.cannotVerify(path, `no legal test shape matches this path${c.reason ? ` — ${c.reason}` : ''}`);
    if (isTestFile(path) || isTestSupport(path)) touchedTests.push(path);
  }

  // --- which specs: the ones the range touched, plus the one asked about.
  const touchedSpecs = touchedPaths(range.base, ['docs/specs']);
  if (!touchedSpecs.ok) {
    err(`CANNOT VERIFY: cannot read the spec range (${touchedSpecs.reason})`);
    report.cannotVerify('docs/specs', `cannot read the range ${short(range.base)}..HEAD: ${touchedSpecs.reason}`);
    writeSummary({ root, verdict: 'cannot-verify', report, argv, range, ids: [], exitCode: 1 });
    return 1;
  }
  const specIds = [];
  for (const p of touchedSpecs.files) {
    const id = specIdOfPath(p);
    if (id) specIds.push(id);
    else if (p !== 'docs/specs/README.md') report.warn(p, 'under docs/specs/ and not a `CHQ-<nnn>.md` spec — no gate reads it');
  }
  // A type GUARD, not an assertion: `opts` is read out of a union the linter
  // cannot narrow, so this is the honest way to say "a spec id or nothing".
  const requested = typeof opts.requireApproved === 'string' ? opts.requireApproved : null;
  if (requested && !specIds.includes(requested)) specIds.push(requested);
  const ids = [...new Set(specIds)].toSorted(byString);

  if (!ids.length) {
    log(`✓ no spec touched in ${short(range.base)}..${short(head.sha)} and no --require-approved; nothing for this gate to judge`);
    writeSummary({ root, verdict: 'n/a', report, argv, range, ids, exitCode: 0 });
    return 0;
  }

  const packages = workspacePackages(root, report);
  ctx.packages = packages.names;
  if (!packages.ok) report.cannotVerify('packages/, apps/', `${packages.reason} — \`home:\` names cannot be checked against the workspace`);
  ctx.techDebt = techDebtIds(root);
  if (!ctx.techDebt.ok) report.warn('docs/tech-debt/', `${ctx.techDebt.reason} — \`deferred: TD-nnnn\` is checked for shape only`);

  const history = approvalsInHistory(root);
  if (!history.ok) report.cannotVerify('git log', `${history.reason} — no approval can be read`);
  const probe = readProbe({ root });

  // --- per spec
  const seen = [];
  for (const id of ids) {
    const path = specPath(id);
    const read = readSpecAtRev(root, id, 'HEAD');
    if (!read.ok) {
      report.cannotVerify(
        path,
        `not readable at HEAD (${read.error}) — ${
          requested === id
            ? 'the test phase asked for this spec; commit it before asking whether it is approved'
            : 'the range names it, so it should be there'
        }`,
      );
      continue;
    }
    const spec = parseSpec(read.text, { path });
    if (spec.id && spec.id !== id) report.fail(path, `the heading says ${spec.id} — a spec file and its heading name one spec`);

    const { live, openQuestions } = checkSpec({ id, spec, report, ctx });
    const approval = approvalOf(root, id, history);
    checkApproved({ id, spec, live, approval, report, ctx });

    // --- rule 13: the ONE line of machine state this gate reports. It is never
    // compared with the spec: `verify:` carries no probe state (that is why the
    // retired `(pending-calibration)` suffix exists as a warning in history).
    if (live.some((a) => a.kind === 'e2e')) {
      const browser = premise(probe, 'browser_probe');
      if (browser.verdict !== 'pass')
        report.warn(
          path,
          `${id} carries a live \`kind: e2e\` assertion and the browser route is UNVERIFIED (TD-0001): ${browser.reason} — no e2e S may carry a green: trailer; this gate does not fail on it`,
        );
    }

    seen.push({ id, spec, live, openQuestions, approval });
  }

  // --- rule 1: the test-phase block
  const blocking = seen.filter((s) => s.openQuestions.length);
  if (blocking.length && touchedTests.length) {
    for (const s of blocking)
      report.fail(
        s.spec.path,
        `${s.id} still lists ${s.openQuestions.length} open question(s) and this range adds or modifies ${touchedTests.length} test file(s) ` +
          `(${touchedTests.slice(0, 3).join(', ')}${touchedTests.length > 3 ? `, …` : ''}) — the test phase is blocked until each is answered: ` +
          s.openQuestions.map((q) => `${q.where} ${clip(q.text, 48)}`).join(' · '),
      );
  } else if (blocking.length) {
    for (const s of blocking)
      report.warn(
        s.spec.path,
        `${s.id} has ${s.openQuestions.length} open question(s) and no test file was touched — spec drafting may continue: ` +
          s.openQuestions.map((q) => `${q.where} ${clip(q.text, 40)}`).join(' · '),
      );
  }

  // --- rule 14: ADDITIVE. The structural findings above are already collected;
  // the approval is judged last, so `--require-approved` never short-circuits
  // the shape checks the way the gate this one is ported from did.
  if (requested) {
    const row = seen.find((s) => s.id === requested);
    if (row) {
      // `requested` is a spec id here, but it is typed `string | null`, and a
      // nullable value in a template literal is exactly what the lint rule is
      // for. One conversion, named, instead of seven silenced warnings.
      const want = String(requested);
      const a = row.approval;
      if (a.verdict === 'green') {
        log(`${want} is approved by ${String(a.approved.name)} on ${String(a.approved.date)} (${short(a.approved.commit)})`);
      } else {
        for (const reason of a.reasons) report.fail(specPath(requested), reason);
        if (a.stale)
          report.fail(
            specPath(requested),
            `re-sign the text as it stands: git commit --allow-empty -m "docs(spec): ${want} approved" -m "spec-approved: ${want} <name> <YYYY-MM-DD>"`,
          );
        else if (!a.approved)
          report.fail(
            specPath(requested),
            `${want} is not approved — a trailer inside prose, quoted or indented, is not one. Every commit reachable from HEAD was searched, not only the range: ` +
              `git commit --allow-empty -m "docs(spec): ${want} approved" -m "spec-approved: ${want} <name> <YYYY-MM-DD>"`,
          );
      }
      // Starting the test phase on a spec whose questions are still live is the
      // one thing rule 1 cannot see from the range: the tests do not exist yet,
      // which is precisely why this mode was asked for.
      if (row.openQuestions.length)
        report.fail(
          row.spec.path,
          `${want} still lists ${String(row.openQuestions.length)} open question(s), and --require-approved is the test phase's step 0 — answer them and record the answers under \`## Answered questions\``,
        );
    }
  }

  // ------------------------------------------------------------------ report
  for (const f of report.findings.filter((x) => x.severity === 'fail')) err(`FAIL ${show(f)}`);
  for (const f of report.findings.filter((x) => x.severity === 'cannot-verify')) err(`CANNOT VERIFY ${show(f)}`);
  for (const w of report.warnings) log(`WARNING ${show(w)}`);

  const fails = report.fails.length;
  const cvs = report.cannotVerifies.length;
  const verdict = fails ? 'fail' : cvs ? 'cannot-verify' : 'pass';
  const exitCode = fails || cvs ? 1 : 0;

  const described = seen
    .map((s) => `${s.id} r${s.spec.revision ?? '?'} (${s.live.length} live S, ${s.approval.verdict === 'green' ? 'approved' : 'unapproved'})`)
    .join(', ');
  if (exitCode === 0) log(`✓ ${seen.length} spec(s) checked: ${described || 'none readable'}${report.warnings.length ? ` — ${report.warnings.length} warning(s)` : ''}`);
  else err(`FAIL: ${fails} blocker(s), ${cvs} cannot verify, ${report.warnings.length} warning(s) over ${seen.length} spec(s): ${described || 'none readable'}`);

  writeSummary({ root, verdict, report, argv, range, ids, exitCode });
  return exitCode;
}

// --------------------------------------------------------------- the summary

/**
 * `.ci/runs/<ts>-spec-gate/summary.json` — the machine-readable verdict
 * `ready.mjs` reads instead of this gate's prose, plus `run.json`, where the
 * exit code is written down and stays ADVISORY.
 *
 * A summary that could not be written is a WARNING, not a verdict: nothing about
 * the spec changed because `.ci/` was unwritable. The invariant on the other
 * side still holds — `ready` treats a non-zero exit as FAILED whatever the JSON
 * says, and a missing summary as cannot-verify.
 */
function writeSummary({ root, verdict, report, argv, range, ids, exitCode }) {
  let dir = null;
  try {
    dir = makeRunDir({ label: 'spec-gate', kind: 'spec', root }).dir;
    const clean = isTreeClean([], { cwd: root });
    const head = headSha({ cwd: root });
    writeRunJson(dir, {
      gate: 'spec-gate',
      kind: 'spec',
      argv: ['node', 'tools/gates/spec-gate.mjs', ...argv],
      exitCode,
      head: head.ok ? head.sha : null,
      base: range.base,
      rangeKind: range.kind,
      treeClean: clean.clean,
      startedAt: new Date().toISOString(),
      specs: ids,
    });
    writeFileSync(
      artifactPath(dir, 'summary.json'),
      `${JSON.stringify(
        {
          gate: 'spec-gate',
          verdict,
          counts: {
            red: report.fails.length,
            greenOnBase: 0,
            cannotVerify: report.cannotVerifies.length,
            specs: ids.length,
            warnings: report.warnings.length,
          },
          warnings: report.warnings.map(show),
          details: report.findings.map((f) => ({ severity: f.severity, where: f.where, what: f.what })),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  } catch (e) {
    log(`WARNING could not write the run summary${dir ? ` in ${dir}` : ''}: ${String(e.message)} — the verdict above stands; ready.mjs reads a missing summary as cannot-verify`);
  }
}

// A gate must not run on import: three of this repository's gates did, and an
// accidental `import()` then executed them (measured 2026-11-01). argv[1] is
// undefined under `node -e`, so an import never trips this.
const invoked = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invoked) process.exit(run(process.argv.slice(2)));
