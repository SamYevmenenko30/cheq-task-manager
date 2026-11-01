#!/usr/bin/env node
/**
 * lights/run.mjs — the standing lights pack as ONE table: the registry, the
 * three modes, and the aggregation.
 *
 *   node tools/gates/lights/run.mjs [--fast | --thin | --all]
 *                                   [--base <ref> | --since <sha>]
 *                                   [--allow a,b] [--pending-implementation-tolerance]
 *
 * Zero dependencies, Node 22 ESM. Output is one markdown row per light:
 *
 *     | id | severity | status | detail |
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE REGISTRY IS THE FILENAME
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * The sixteen ids come from `STANDING_LIGHT_IDS` in `../lib/spec-parse.mjs` —
 * the one home of that dictionary — and a light's module is its id without the
 * `L-` prefix: `L-core-purity` is `lights/core-purity.mjs`. There is no second
 * list to keep in step, and adding a light is one row in that dictionary plus
 * one file here.
 *
 * Each module is imported INDEPENDENTLY, inside its own try. A missing or broken
 * module is one row reading `not run (module missing: …)` or
 * `cannot-verify · import threw: …`; THE OTHER FIFTEEN STILL REPORT. A run that
 * collapses on the first absent file tells you about one light and hides the
 * rest, which is the opposite of what a table is for. Both of those states still
 * BLOCK when the light is hard: a light nobody wrote has not verified anything.
 *
 * The module contract and the result shape live in `./_shared.mjs` — read its
 * header before writing a light. `normalizeResult` there is the shape check, and
 * it is imported rather than repeated so a light can validate its own return
 * value with the same code that judges it.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * AGGREGATION: CANNOT VERIFY BLOCKS EXACTLY AS FAIL DOES
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `severity === 'hard' && status !== 'pass'` ⇒ exit 1. There is no third
 * outcome and no threshold to relax: "it did not run" is never green. A thrown
 * exception is caught and becomes `cannot-verify · threw: <first line>`, so
 * throwing is not a way to say red either.
 *
 * TWO KINDS OF `not run`, and the difference is the whole honesty of the modes:
 *
 *   - NOT CLAIMED BY THIS MODE. `--thin` declares in advance that it does not
 *     claim `L-tsc` and `L-lint`; those rows print `not run (--thin: …)` and do
 *     NOT block, because the mode never promised them and names the lane that
 *     does. The row is printed either way — a light that disappears from the
 *     table is a light nobody misses.
 *   - COULD NOT RUN. A missing module, a missing premise, a throw. Printed as
 *     `not run (<reason>)` or `CANNOT VERIFY`, and it BLOCKS when hard. The same
 *     light in `--fast`, where the mode does claim it, is this case.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE RANGE — AND THE EMPTY RANGE THAT READ AS A CLEAN ONE (MEASURED)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * A range-based light diffs `ctx.mb..HEAD` and never reads the work tree or the
 * index, so WHICH commit `mb` is decides what those lights can see at all. This
 * file is the one place that answers it (`resolveRange`), and the answer is
 * printed in the header line of every run, because it is the one input a reader
 * cannot recover from the table.
 *
 * MEASURED on a fixture of this very tree (2026-11-01), and the reason this
 * function is not a one-liner: `baseRev('main')` answers
 * `merge-base(main, HEAD)`, and when HEAD is ON `main` — the only branch this
 * repository has — that merge base IS HEAD. The range is then `HEAD..HEAD`,
 * i.e. EMPTY, and the lights do not fail: they report what an empty range
 * honestly contains. One commit of the whole scaffold, judged twice:
 *
 *     default range on main   L-deps: 0 manifest(s) changed, 0 addition(s)
 *     --since HEAD^           L-deps: 4 manifest(s) changed, 21 addition(s),
 *                                     4 undeclared dependencies
 *
 * Same tree, same commit, same light — one reading green and blind, the other
 * finding four violations. A root commit has the same shape (`merge-base` is
 * HEAD there too), so the FIRST commit of a repository, the one that introduces
 * every dependency, was the worst case.
 *
 * So `merge-base === HEAD` is not a range; it is the statement "HEAD is at the
 * base ref". The honest base is then the one `.githooks/pre-commit:2` already
 * describes in prose — "the range-based gates read HEAD, the PREVIOUS commit" —
 * so `mb` becomes `HEAD^` with `rangeKind: 'previous-commit'`, or the empty tree
 * when HEAD has no parent, in which case every file in it IS an addition. Both
 * are NAMED in `rangeKind` and in the header; neither is silent, because a
 * fallback nobody can see is how the next reader inherits this bug.
 *
 * `--since HEAD` is REFUSED outright for the same reason: it asks for an empty
 * range in so many words, and an empty range is the one input that makes every
 * range-based light pass without looking at anything.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * PREMISES INSTEAD OF A CALIBRATION RECORD
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * There is no budget lane in this repository (TD-0002), so the precondition for
 * a lane is not the freshness of a measurement but the presence of a NAMED
 * runtime premise: `node_modules`, the `tsc` binary, the `oxlint` binary. They
 * are probed ONCE here (`readPremises`) and handed to every light in
 * `ctx.premises`, so sixteen rows cannot word the same absence sixteen ways. A
 * light may declare `export const premises = ['tsc']` and then this file refuses
 * it with the premise's own name before `run` is ever called.
 *
 * A light that can do PART of its job without a premise must NOT declare it at
 * module level: it asks `requirePremise` itself and says in its detail which
 * level it skipped. `L-core-purity` is exactly that case — its level 3 token
 * scan needs nothing installed, and `--thin` therefore still runs it while
 * levels 1–2 report their missing premise by name.
 *
 * This is the part of the dropped calibration gate that had to survive: delete
 * the check instead, and a lane that said "refuses until measured" quietly
 * becomes "always works".
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE ONE TOLERANCE, AND WHY IT IS DECLARED RATHER THAN POSITIONAL
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `--pending-implementation-tolerance` is the pre-commit path only (the hook
 * passes it; a full `ready` never does, and `--all` IGNORES it with a warning).
 * The test phase commits red spec tests whose types the implementation has not
 * written yet, and that is the normal state between two phases.
 *
 * It applies to `L-tsc` AND NOTHING ELSE. This file does not decide the world
 * state behind it: `L-tsc` establishes that condition with `classifyPending`
 * from `../lib/tsc-log.mjs` (core compiles, every error is a missing symbol in a
 * placed spec test) and SAYS SO by prefixing its detail with
 * `PENDING_IMPLEMENTATION_PREFIX`. This file recognises exactly that prefix from
 * exactly that id. The flag alone changes nothing, which is what keeps the
 * tolerance from becoming a switch.
 *
 * A light downstream of `L-tsc` inherits the tolerance only by DECLARING
 * `dependsOn: ['L-tsc']`. That declaration also orders execution — the
 * dependency has reported before the dependent runs. In the Resonance original
 * the same relationship was implicit in the order of a literal (`csc` first,
 * `monoParity` last), which is a fact nobody can read off the code and that
 * breaks the moment somebody sorts the array.
 *
 * Proven on a fixture, all three ways: the flag plus the prefix tolerates the
 * dependency AND a dependent declaring the edge (exit 0); the same tree without
 * the flag blocks; the flag with a cannot-verify whose detail does NOT carry the
 * prefix blocks. The flag alone changes nothing.
 *
 * AND THE GAP THAT FOLLOWS, which is written down because it is not visible from
 * either end: propagation can only fire in a mode that BOTH holds the dependent
 * AND honours the flag. Today no mode does for `L-env-parity` — it is in `--all`
 * only, and `--all` ignores the flag — so the `dependsOn: ['L-tsc']` the port
 * plan asks that light to declare buys it NOTHING on any current path. The
 * declaration is still right (it orders execution and it is the fact), but a
 * light that lands it and expects a hook tolerance would be wrong. `reportDead`
 * below prints exactly which declarations are inert on the path being run, so
 * this stays a line of output rather than a surprise. What would change it is
 * `L-env-parity` entering `--fast`, which is a decision for the commit that
 * lands it, not something this file should pre-empt.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  FAST_LIGHT_IDS,
  PENDING_IMPLEMENTATION_PREFIX,
  STANDING_LIGHTS,
  STANDING_LIGHT_IDS,
  severityOf,
} from '../lib/spec-parse.mjs';
import { EMPTY_TREE, baseRev, hasCommits, headSha, repoRoot, revParse } from '../lib/git.mjs';
import { normalizeResult, readPremises, requirePremise } from './_shared.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The modes, as SETS of ids — never as thresholds on one set. */
const MODES = Object.freeze({
  fast: { ids: FAST_LIGHT_IDS, title: 'the pre-commit path: offline, no worktree, no browser' },
  thin: { ids: FAST_LIGHT_IDS, title: 'a checkout with no node_modules — --fast minus what needs one' },
  all: { ids: STANDING_LIGHT_IDS, title: 'every standing light' },
});

/**
 * What `--thin` does NOT claim, with the reason printed in its row. `L-tsc` and
 * `L-lint` need an install to say anything at all; `L-core-purity` is absent
 * from this list on purpose — its token scan runs with nothing installed and it
 * reports its own skipped levels by name.
 *
 * The status cell of such a row reads `not run (no node_modules)`, which is what
 * the mode is FOR, and the detail names the lane that does hold the light. The
 * row never passes. `--thin` is a declared SET, not a probe, so asking for it on
 * an installed tree still yields these rows — and this file then says so in a
 * warning, because "not run (no node_modules)" printed next to a node_modules
 * that exists is the kind of sentence a reader stops believing.
 */
const THIN_NOT_CLAIMED = Object.freeze({
  'L-tsc': 'the compile verdict is tsc on an installed tree — `--fast`, the full run and the verifier role hold it',
  'L-lint': 'oxlint --type-aware needs the linter and its type engine installed — `--fast`, the full run and the verifier role hold it',
});

/** `L-core-purity` → `lights/core-purity.mjs`. The filename IS the registry. */
const moduleOf = (id) => `${id.replace(/^L-/, '')}.mjs`;

// --------------------------------------------------------------------- argv

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d = null) => {
  const i = argv.indexOf(n);
  return i === -1 ? d : (argv[i + 1] ?? d);
};

if (flag('--help') || flag('-h')) {
  console.log(
    [
      'node tools/gates/lights/run.mjs [--fast | --thin | --all] [--base <ref> | --since <sha>]',
      '                                [--allow a,b] [--pending-implementation-tolerance]',
      '',
      ...Object.entries(MODES).map(([m, v]) => {
        const skips = m === 'thin' ? ` (${Object.keys(THIN_NOT_CLAIMED).length} of them not claimed: ${Object.keys(THIN_NOT_CLAIMED).join(', ')})` : '';
        return `  --${m.padEnd(5)} ${v.ids.length} light(s)${skips}: ${v.title}`;
      }),
      '',
      '  --base <ref>    the range is <merge-base of ref and HEAD>..HEAD (default: main); when that',
      '                  merge base IS HEAD the range would be empty, so the base becomes HEAD^ —',
      '                  the previous commit, which is what the hook judges — or the empty tree at a root',
      '  --since <sha>   the range starts at this commit instead (--since HEAD is refused: an empty range)',
      '  --allow a,b     packages a spec\'s wave allowed; passed through to every light',
      '  --pending-implementation-tolerance   hook path only; recognised on L-tsc alone',
      '',
      'Exit 1 when a hard light is not pass — CANNOT VERIFY included.',
    ].join('\n'),
  );
  process.exit(0);
}

const modeNames = Object.keys(MODES).filter((m) => flag(`--${m}`));
if (modeNames.length > 1) {
  console.error(`[lights] REFUSED: ${modeNames.map((m) => `--${m}`).join(' and ')} are different SETS of lights, not thresholds — pick one.`);
  process.exit(1);
}
const mode = modeNames[0] ?? 'fast';
const thin = mode === 'thin';
const allow = (opt('--allow', '') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// --------------------------------------------------- the registry's self-check

/** A mode is only a set if its members exist. A drift here would silently drop
 * a light out of every run, which is the one failure no light can report. */
const registryProblems = [];
for (const [name, m] of Object.entries(MODES)) {
  for (const id of m.ids) if (!STANDING_LIGHT_IDS.includes(id)) registryProblems.push(`--${name} names "${id}", which is not in STANDING_LIGHT_IDS`);
}
for (const id of MODES.fast.ids) if (!MODES.all.ids.includes(id)) registryProblems.push(`--fast names "${id}" and --all does not — --all must be a superset`);
for (const id of Object.keys(THIN_NOT_CLAIMED)) if (!MODES.fast.ids.includes(id)) registryProblems.push(`THIN_NOT_CLAIMED names "${id}", which --fast does not run — there is nothing for --thin to subtract`);
if (registryProblems.length) {
  console.error(`[lights] REFUSED: the registry disagrees with ../lib/spec-parse.mjs:\n  ${registryProblems.join('\n  ')}`);
  process.exit(1);
}

// ------------------------------------------------------------- root and range

const rr = repoRoot();
if (!rr.ok) {
  console.error(`[lights] REFUSED: not a git work tree (${rr.reason}) — every range-based light reads HEAD through git.`);
  process.exit(1);
}
const root = rr.root;

/**
 * No HEAD, no judgement. The range-based lights read `git show HEAD:<file>` on
 * purpose — reading the work tree instead would turn an uncommitted edit into a
 * green hook — so a repository with no commit has nothing for them to read. This
 * is an honest refusal naming the cure, not a stack trace, and it is exactly the
 * state of this repository until the scaffold is committed.
 */
if (!hasCommits({ cwd: root })) {
  const ids = MODES[mode].ids;
  console.error('[lights] REFUSED: this repository has no commits yet.');
  console.error('  The range-based lights read HEAD (git show HEAD:<file>), never the work tree: a gate that read');
  console.error('  the work tree would go green on the very edit the commit it guards does not contain.');
  console.error('  Cure: git add -A && CHEQ_SKIP_HOOKS=1 git commit -m "scaffold: …"  (the escape is .githooks/pre-commit:10), then run this again.');
  console.error(`  --${mode} would have run ${ids.length} light(s): ${ids.join(', ')}`);
  process.exit(1);
}

/**
 * The four bases this file can hand a light, each a WORD the light prints in its
 * own row (`ctx.rangeKind`), so what was compared is readable off the table
 * instead of inferred from a sha. There is no fifth, and a kind nobody declared
 * never reaches a light.
 */
const RANGE_KINDS = Object.freeze({
  since: 'the commit --since named',
  'merge-base': 'the fork point from the base ref — HEAD is ahead of it',
  'previous-commit': 'HEAD^, because HEAD is AT the base ref and <base>..HEAD would be empty',
  'empty-tree': 'the empty tree: HEAD is a root commit, or the branch shares no history with the base ref, so every file IS an addition',
});

/**
 * → { ok, reason } | { ok, rev, kind, note }
 *
 * `baseRev` in `../lib/git.mjs` stays the one reader of "where does main fork
 * from here"; what this function adds is the case that reader cannot decide on
 * its own — `merge-base === HEAD`, which is not a range but the statement that
 * HEAD is at the base ref. See the header for the measurement: left as a range,
 * it makes every range-based light report "0 changed" and pass.
 */
const short = (sha) => String(sha).slice(0, 7);

function resolveRange({ cwd, since, base }) {
  const head = headSha({ cwd });
  if (!head.ok) return { ok: false, reason: `HEAD does not resolve to a commit (${head.reason})` };

  if (since !== null) {
    const r = revParse(since, { cwd });
    if (!r.ok) return { ok: false, reason: `--since ${since} does not resolve to a commit (${r.reason})` };
    if (r.sha === head.sha)
      return {
        ok: false,
        reason: `--since ${since} IS HEAD (${short(head.sha)}), so the range is EMPTY — and an empty range does not fail a range-based light, it makes every one of them report "0 changed" and pass. Name an earlier commit (--since ${short(head.sha)}^ is the last commit).`,
      };
    return { ok: true, rev: r.sha, kind: 'since', note: `${short(r.sha)}..HEAD (--since)` };
  }

  const b = baseRev(base, { cwd });
  if (!b.ok) return { ok: false, reason: b.reason };
  if (b.kind === 'empty-tree') return { ok: true, rev: b.rev, kind: 'empty-tree', note: `empty tree..HEAD (${b.reason})` };
  if (b.rev !== head.sha) return { ok: true, rev: b.rev, kind: 'merge-base', note: `${short(b.rev)}..HEAD (merge-base with ${base})` };

  // merge-base === HEAD. `<base>..HEAD` is empty; the honest base is the one the
  // hook describes in prose — the previous commit — or the empty tree at a root.
  const parent = revParse(`${head.sha}^`, { cwd });
  if (parent.ok)
    return {
      ok: true,
      rev: parent.sha,
      kind: 'previous-commit',
      note: `${short(parent.sha)}..HEAD — HEAD is AT ${base}, so ${base}..HEAD is EMPTY and the range is the last commit instead`,
    };
  return {
    ok: true,
    rev: EMPTY_TREE,
    kind: 'empty-tree',
    note: `empty tree..HEAD — HEAD is AT ${base} and has no parent (${parent.reason}), so every file in it IS an addition`,
  };
}

const range = resolveRange({ cwd: root, since: opt('--since'), base: opt('--base', 'main') });
if (!range.ok) {
  console.error(`[lights] REFUSED: ${range.reason}`);
  process.exit(1);
}
const base = opt('--base', 'main');
const { rev: mb, kind: rangeKind, note: rangeNote } = range;
if (!Object.hasOwn(RANGE_KINDS, rangeKind)) {
  console.error(`[lights] REFUSED: resolveRange answered kind "${rangeKind}", which is not one of ${Object.keys(RANGE_KINDS).join(' | ')} — a light prints this word, so an undeclared one would describe a comparison nobody can name.`);
  process.exit(1);
}

// ------------------------------------------------------------------ tolerance

let tolerate = flag('--pending-implementation-tolerance');
const warnings = [];
if (tolerate && mode === 'all') {
  warnings.push(
    '--pending-implementation-tolerance is the pre-commit path only and --all IGNORES it: every strict run fails on a tree whose spec tests do not typecheck yet — so every dependsOn L-tsc in this set orders execution and propagates nothing',
  );
  tolerate = false;
}

// -------------------------------------------------------------- load the set

const premises = readPremises(root);
const selected = MODES[mode].ids;

/** `--thin` is a declared SET, not a probe, so it reports its rows "not run (no
 * node_modules)" even where one exists. Said out loud rather than left to read
 * as a false statement about the tree. */
if (thin && premises.node_modules.present)
  warnings.push(
    `--thin is the set for a checkout with NO node_modules, and this tree HAS one (${premises.node_modules.rel}): ${Object.keys(THIN_NOT_CLAIMED).join(', ')} report "not run" although they could have run here — use --fast to let them`,
  );

/**
 * Every module is imported in ONE batch, and each mapper catches its OWN
 * failure, so nothing rejects and one broken module cannot take the other
 * fifteen rows with it. Loading is the only asynchronous step in this file and
 * its order does not matter. RUNNING is the opposite — strictly sequential, in
 * the declared topological order — which is why `run` is synchronous by
 * contract: every reader in `tools/gates/lib` is synchronous (`spawnSync`,
 * `readFileSync`), so async buys a light nothing and would only invite a
 * parallel run whose artifacts interleave.
 */
const loaded = new Map(
  await Promise.all(
    selected.map(async (id) => {
        const file = moduleOf(id);
        const abs = join(HERE, file);
        if (thin && Object.hasOwn(THIN_NOT_CLAIMED, id))
          return [id, { id, state: 'unclaimed', label: 'no node_modules', reason: `--thin does not claim this light: ${THIN_NOT_CLAIMED[id]}` }];
        if (!existsSync(abs))
          return [id, { id, state: 'missing', reason: `module missing: tools/gates/lights/${file} — the light that owns "${id}" is not written yet` }];
        try {
          const mod = await import(pathToFileURL(abs).href);
          if (typeof mod.run !== 'function')
            return [
              id,
              { id, state: 'broken', reason: `tools/gates/lights/${file} exports no run() — the module contract is { id, severity, dependsOn?, premises?, run(ctx) } (see lights/_shared.mjs)` },
            ];
          return [
            id,
            {
              id,
              state: 'ready',
              mod,
              severity: mod.severity,
              dependsOn: Array.isArray(mod.dependsOn) ? mod.dependsOn : [],
              needs: Array.isArray(mod.premises) ? mod.premises : [],
              file: `tools/gates/lights/${file}`,
            },
          ];
        } catch (e) {
          return [id, { id, state: 'broken', reason: `import threw: ${String(e?.message ?? e).split('\n')[0]}` }];
        }
    }),
  ),
);

// --------------------------------------------- execution order, declared

/**
 * Topological order over `dependsOn`, restricted to the selected set. Ordering
 * is one of the two things `dependsOn` buys (the other is tolerance
 * propagation); it is deliberately NOT the order of a literal in this file.
 * A dependency outside the selected set is simply absent — `L-env-parity`
 * depends on `L-tsc`, and `--fast` runs neither.
 */
function executionOrder() {
  const order = [];
  const state = new Map();
  const cycles = new Map();
  const unknown = new Map();

  const visit = (id, stack) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'open') {
      const loop = [...stack.slice(stack.indexOf(id)), id].join(' → ');
      for (const m of stack.slice(stack.indexOf(id))) cycles.set(m, loop);
      return;
    }
    state.set(id, 'open');
    for (const dep of loaded.get(id)?.dependsOn ?? []) {
      if (!STANDING_LIGHT_IDS.includes(dep)) {
        unknown.set(id, [...(unknown.get(id) ?? []), dep]);
        continue;
      }
      if (loaded.has(dep)) visit(dep, [...stack, id]);
    }
    state.set(id, 'done');
    order.push(id);
  };

  for (const id of selected) visit(id, []);
  return { order, cycles, unknown };
}

const { order, cycles, unknown } = executionOrder();

// ------------------------------------------------------------------ run them

const results = new Map();
const tolerated = new Set();
/** For a row whose module does not exist: "the module declares no severity" is
 * no news about a file nobody wrote. The gap is printed once under the table. */
const QUIET = { quietSeverityProvenance: true };

for (const id of order) {
  const light = loaded.get(id);

  if (light.state === 'unclaimed') {
    const row = normalizeResult({ id, severity: null }, { status: 'cannot-verify', detail: light.reason, notRun: true }, QUIET);
    row.unclaimed = true;
    row.unclaimedLabel = light.label;
    results.set(id, row);
    continue;
  }
  if (light.state === 'missing' || light.state === 'broken') {
    results.set(id, normalizeResult({ id, severity: null }, { status: 'cannot-verify', detail: light.reason, notRun: true }, QUIET));
    continue;
  }
  if (cycles.has(id)) {
    results.set(id, normalizeResult(light, { status: 'cannot-verify', detail: `dependsOn cycle: ${cycles.get(id)} — a cycle makes the declared order meaningless, so no light in it is run`, notRun: true }));
    continue;
  }

  const extra = [];
  for (const dep of unknown.get(id) ?? []) extra.push(`dependsOn names "${dep}", which is not a standing light id`);

  let premiseStop = null;
  for (const name of light.needs) {
    const p = requirePremise(premises, name);
    if (!p.ok) {
      premiseStop = p.reason;
      break;
    }
  }
  if (premiseStop !== null) {
    results.set(id, normalizeResult(light, { status: 'cannot-verify', detail: [premiseStop, ...extra].join('; '), notRun: true }));
    continue;
  }

  let returned;
  try {
    returned = light.mod.run({ root, mb, allow, mode, thin, premises, base, rangeKind, tolerate });
    if (typeof returned?.then === 'function')
      returned = {
        status: 'cannot-verify',
        detail: `${light.file} run() returned a Promise — a light is SYNCHRONOUS: every reader in tools/gates/lib is (spawnSync, readFileSync), and sequencing is this file's job, not the light's`,
      };
  } catch (e) {
    returned = { status: 'cannot-verify', detail: `threw: ${String(e?.message ?? e).split('\n')[0]}` };
  }
  const row = normalizeResult(light, returned);
  if (extra.length) row.detail = `${row.detail} [${extra.join('; ')}]`;
  results.set(id, row);

  // The ONE tolerance. Recognised from the prefix L-tsc writes, never from the
  // flag alone, and inherited only through a declared dependsOn.
  if (tolerate && row.status === 'cannot-verify') {
    if (id === 'L-tsc' && row.detail.startsWith(PENDING_IMPLEMENTATION_PREFIX)) tolerated.add(id);
    else if (light.dependsOn.some((d) => tolerated.has(d))) tolerated.add(id);
  }
}

// -------------------------------------------------------------------- report

/**
 * The status cell, and the one thing it must never be ambiguous about: whether
 * this row BLOCKS. There are two kinds of `not run` and they have opposite
 * consequences — a light the mode never claimed does not block, a light that
 * could not run does — so a bare `not run` in both cells would make the column
 * unreadable. Anything that blocks carries the words CANNOT VERIFY; a plain
 * `not run (<what the mode is>)` never does.
 */
const shown = (id, r, blocks) => {
  if (r.unclaimed === true) return `not run (${r.unclaimedLabel ?? `--${mode}`})`;
  if (tolerated.has(id)) return 'CANNOT VERIFY (pending implementation — a warning on the hook path only)';
  if (r.notRun === true) return blocks ? 'CANNOT VERIFY (not run)' : 'not run';
  return r.status === 'cannot-verify' ? 'CANNOT VERIFY' : r.status;
};

/** A `|` inside a detail would split the row into columns that are not there. */
const cell = (s) => String(s ?? '').replaceAll('|', '¦');

let failed = false;
const rows = [];
// Printed in the order STANDING_LIGHTS declares — the order `ready` prints them —
// which is NOT the order they ran in. Execution order is topological; reading
// order is the one a human learned.
for (const { id } of STANDING_LIGHTS) {
  const r = results.get(id);
  if (r === undefined) continue;
  const hardBad = r.severity === 'hard' && r.status !== 'pass';
  const blocks = hardBad && r.unclaimed !== true && !tolerated.has(id);
  if (blocks) failed = true;
  rows.push(`| ${id} | ${r.severity ?? 'hard'} | ${cell(shown(id, r, blocks))} | ${cell(r.detail)} |`);
}

const claimed = selected.length - [...results.values()].filter((r) => r.unclaimed === true).length;
console.log(
  `[lights] --${mode} (${selected.length} light(s)${claimed === selected.length ? '' : `, ${claimed} claimed`}) · range ${rangeNote} · base ${rangeKind}: ${RANGE_KINDS[rangeKind]}${allow.length ? ` · allow ${allow.join(',')}` : ''}`,
);
console.log('| id | severity | status | detail |');
console.log('|---|---|---|---|');
for (const r of rows) console.log(r);

const unclaimed = [...results].filter(([, r]) => r.unclaimed === true).map(([id]) => id);
if (unclaimed.length) console.log(`[lights] --${mode} does not claim ${unclaimed.join(', ')}: those rows are not run, never pass, and another lane holds them.`);

/**
 * A `dependsOn` that can never propagate a tolerance on THIS path — because the
 * flag was not passed, or because this mode ignores it. The declaration still
 * orders execution, so it is not wrong; it just buys no tolerance here, and a
 * light whose author expected one would be the kind of wrong nothing reports.
 * See the header: with today's sets this is `L-env-parity`'s permanent state.
 */
const reportDead = order.filter((id) => (loaded.get(id)?.dependsOn ?? []).includes('L-tsc') && !tolerated.has(id));
if (reportDead.length && !tolerate)
  console.log(
    `[lights] ${reportDead.join(', ')} declare(s) dependsOn L-tsc, which on this path orders execution and nothing else: ${
      flag('--pending-implementation-tolerance') ? `--${mode} ignores --pending-implementation-tolerance` : '--pending-implementation-tolerance was not passed'
    }, so no tolerance could propagate.`,
  );

const undeclared = selected.filter((id) => !severityOf(id).declared);
if (undeclared.length)
  console.log(`[lights] severity is undeclared in ../lib/spec-parse.mjs STANDING_LIGHTS for ${undeclared.join(', ')} — read as hard, which is the fail-closed reading; the commit that lands each light fills its row.`);

for (const w of warnings) console.log(`[lights] warning: ${w}`);

if (failed) {
  console.error('[lights] FAIL: a hard light is red or CANNOT VERIFY — a light that cannot run is not green.');
  process.exit(1);
}
console.log(tolerated.size ? `[lights] pass (with pending-implementation warnings on ${[...tolerated].join(', ')}) ✓` : '[lights] all hard lights pass ✓');
