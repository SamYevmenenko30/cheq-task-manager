#!/usr/bin/env node
/**
 * status.mjs — the PRE-FLIGHT. One call, flat `KEY=value` flags, and every
 * value that is not the good one NAMES THE FIRST CONDITION THAT WAS NOT MET.
 *
 *     node tools/gates/status.mjs        (pnpm run status)
 *
 * Zero dependencies: `node:` builtins plus tools/gates/lib. It must work in a
 * worktree before an install has finished and in a repository with no commit —
 * which is the state this file was written in, and the reason `GIT_HEAD=none`
 * is a first-class answer rather than a crash.
 *
 * WHAT IT IS FOR. Every line here permits or forbids a lane: a figure that was
 * read, not promised. Nothing in this file is a budget, nothing is compared
 * against a remembered number, and no seconds appear anywhere — there is no
 * calibration lane in this repository, so `BUDGETS` says exactly that
 * (TD-0002). Where a lane cannot be permitted, the line says what would permit
 * it, so the answer to "why is this CANNOT VERIFY" is read and never guessed.
 *
 * THE VERSION OF RECORD IS THE LOCK AT HEAD, not the working tree (ADR-0003).
 * `git show HEAD:pnpm-lock.yaml` is the lock a base checkout installs from, so
 * an UNCOMMITTED `pnpm add` must not change what the record says, and
 * committing one must. Each tool line therefore carries THREE numbers that are
 * three different facts:
 *   `<v>`        the version the lock at HEAD resolves — the record;
 *   `installed=` the version in `node_modules/<pkg>/package.json` — what would
 *                actually run here;
 *   `resolved=`  which binary would judge the lane: `node_modules/.bin/<name>`,
 *                or CANNOT VERIFY when that does not exist, because a bare
 *                `<name>` then falls through to whatever PATH offers. A first
 *                match on PATH that is something ELSE is reported beside it as
 *                `path-first=`, and does not change a verdict: every gate
 *                spawns the workspace binary by absolute path.
 * A disagreement between them is CANNOT VERIFY, not false: the lane could be
 * judged by a different engine than the one the repository declares, and
 * "a global tsc was picked up" is the measured shape of that.
 *
 * ONE TYPE ENGINE, AND THE LINE THAT WATCHES IT. There is no `ESLINT` line and
 * no second `TSC`: typescript-eslint refuses TypeScript 7 outright
 * (typescript-eslint/typescript-eslint#10940) and is the only TypeScript parser
 * for eslint, so the two-engine arrangement was built, measured and REVERSED
 * (ADR-0004). What replaced it is oxlint plus oxlint-tsgolint, whose engine is
 * typescript-go — the same line as `tsc`. `TSGOLINT` therefore prints its MAJOR
 * beside `tsc`'s: if the two ever diverge, the type-aware lint rules and the
 * compile verdict are about different type systems, and nothing else in the
 * repository would say so.
 *
 * WHAT IT DOES NOT DO:
 *  - it never spawns `pnpm install` in any form, not even `--dry-run`: a
 *    pre-flight that can rewrite the lockfile it is reporting on is not a
 *    pre-flight. `LOCKFILE_CLEAN` is computed offline, by comparing each
 *    manifest's specifiers AT HEAD against the lock's `importers` block AT HEAD
 *    — which is exactly the disagreement that made `--frozen-lockfile` refuse
 *    before a single gate ran on 2026-11-01 (TD-0007);
 *  - it never judges. This file reports; `ready` and the lights judge. Its own
 *    exit code is 0 whenever the report was produced and 2 when it could not be
 *    produced at all (no git repository). A pre-flight that failed on an absent
 *    browser would make `ready` permanently NOT READY for a debt that is
 *    already written down (TD-0001), so the blocking belongs to whoever reads
 *    the line, not to the line.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { git, headSha, isTreeClean, repoRoot, showAtHead } from './lib/git.mjs';
import { lockKey, premise, readProbe, sha256 } from './lib/probe.mjs';
import { inspectLock, liveWatchers } from './run.mjs';

/** The tools whose version is a fact about the verdict, in print order. */
const TOOLS = Object.freeze([
  { key: 'TSC', pkg: 'typescript', bin: 'tsc' },
  { key: 'OXLINT', pkg: 'oxlint', bin: 'oxlint' },
  { key: 'TSGOLINT', pkg: 'oxlint-tsgolint', bin: 'tsgolint' },
  { key: 'JEST', pkg: 'jest', bin: 'jest' },
]);

/** The worktree every base run of red-check uses, beside the repository. */
const CI_TREE_PARENT = '../cheq-task-manager-ci';

/** pnpm's own copy of the lockfile it installed from. Byte-identical to
 * `pnpm-lock.yaml` on a tree installed from it (measured 2026-11-01). */
const INSTALLED_LOCK = 'node_modules/.pnpm/lock.yaml';

const NO_CALIBRATION = 'unavailable (no calibration lane — TD-0002)';

// ------------------------------------------------------------------- the lock

/**
 * The `importers:` block of a pnpm lockfile — just enough of it to answer
 * "which version does the record resolve" and "do the manifests and the lock
 * agree". A NARROW line scan on purpose: `parseYamlSubset` in
 * tools/gates/lib/spec-parse.mjs is the front-matter parser and THROWS on this
 * file (`not a key: ".:"`, measured), and a lockfile is not a spec.
 *
 * → { [importer]: { [dep]: { specifier, version, dev } } }
 *
 * The shape, measured on pnpm-lock.yaml lockfileVersion 9.0:
 *
 *     importers:
 *       .:
 *         devDependencies:
 *           oxlint:
 *             specifier: ^1.90.0
 *             version: 1.90.0(oxlint-tsgolint@7.0.2005)
 *
 * The peer suffix in parentheses is stripped: `1.90.0(oxlint-tsgolint@7.0.2005)`
 * is version 1.90.0 of oxlint resolved against a peer, not a version string
 * anybody declared. Quoted keys (`'@types/node':`) lose their quotes.
 *
 * AND THE ONE-LINE FORM, measured 2026-11-01 and the reason this reader has two
 * branches at indent 2: an importer with NO dependencies is written as a FLOW
 * MAP on a single line —
 *
 *     packages/core: {}
 *
 * (pnpm-lock.yaml:76 for `@cheq/core`, whose `dependencies` is exactly `{}`
 * because that emptiness is what carries rule 1). A first version of this
 * reader only accepted a key ending in `:`, so `packages/core` was not an
 * importer at all, and LOCKFILE_CLEAN reported the live, correct, fully
 * installed tree as `false (packages/core/package.json is a workspace manifest
 * at HEAD with no importer in the lock)` — a gate confidently wrong about a
 * clean repository, which is worse than one that says it cannot tell.
 */
export function parseLockImporters(text) {
  const out = {};
  let inImporters = false;
  let importer = null;
  let block = null;
  let dep = null;

  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    if (indent === 0) {
      inImporters = line.startsWith('importers:');
      importer = null;
      block = null;
      dep = null;
      continue;
    }
    if (!inImporters) continue;

    const body = line.trim();
    if (indent === 2) {
      const empty = body.match(/^(.*?):\s*\{\s*\}$/); // `packages/core: {}` — see the header
      if (empty !== null) {
        importer = unquote(empty[1]);
        out[importer] ??= {};
        block = null;
        dep = null;
        continue;
      }
      if (body.endsWith(':')) {
        importer = unquote(body.slice(0, -1));
        out[importer] ??= {};
        block = null;
        dep = null;
        continue;
      }
    }
    if (indent === 4 && body.endsWith(':')) {
      const name = body.slice(0, -1);
      block = name === 'dependencies' || name === 'devDependencies' || name === 'optionalDependencies' ? name : null;
      dep = null;
      continue;
    }
    if (indent === 6 && body.endsWith(':') && block !== null && importer !== null) {
      dep = unquote(body.slice(0, -1));
      out[importer][dep] = { specifier: null, version: null, dev: block === 'devDependencies' };
      continue;
    }
    if (indent === 8 && dep !== null && importer !== null) {
      const m = body.match(/^(specifier|version):\s*(.*)$/);
      if (m) {
        const value = unquote(m[2].trim());
        out[importer][dep][m[1]] = m[1] === 'version' ? value.split('(')[0] : value;
      }
    }
  }
  return out;
}

/** A pnpm lock key without its quotes: `'@types/node'` -> `@types/node`. */
const unquote = (s) => s.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');

/** The dependency map one manifest declares, flattened the way the lock stores it. */
function manifestDeps(json) {
  const out = {};
  for (const block of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const o = json?.[block];
    if (o === undefined || o === null || typeof o !== 'object') continue;
    for (const [k, v] of Object.entries(o)) out[k] = String(v);
  }
  return out;
}

// ----------------------------------------------------------------- the report

const lines = [];
const flag = (key, value) => lines.push(`${key}=${value}`);

/** The version in `node_modules/<pkg>/package.json` — what would actually run. */
function installedVersion(root, pkg) {
  const path = resolve(root, 'node_modules', pkg, 'package.json');
  if (!existsSync(path)) return { ok: false, version: null, reason: `node_modules/${pkg} is absent — this worktree is not installed` };
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'))?.version;
    return typeof v === 'string'
      ? { ok: true, version: v, reason: null }
      : { ok: false, version: null, reason: `node_modules/${pkg}/package.json has no version field` };
  } catch (e) {
    return { ok: false, version: null, reason: `node_modules/${pkg}/package.json is unreadable: ${String(e?.message)}` };
  }
}

/**
 * Where a bare `<name>` would come from. Two answers, because they are two
 * facts: the workspace binary (what the gates spawn, by absolute path) and the
 * first match on PATH (what a hand-typed command gets). PATH is walked rather
 * than `which` spawned, so this works with no shell.
 */
function binState(root, name) {
  const workspace = resolve(root, 'node_modules/.bin', name);
  const inWorkspace = existsSync(workspace);
  const dirs = (process.env.PATH ?? '').split(':').filter((d) => d.length > 0);
  const first = dirs.map((d) => resolve(d, name)).find((p) => existsSync(p)) ?? null;
  return { workspace, inWorkspace, first, firstIsWorkspace: first !== null && first === workspace };
}

const major = (v) => {
  const m = String(v ?? '').match(/^(\d+)\./);
  return m === null ? null : m[1];
};

export function report({ root = process.cwd() } = {}) {
  lines.length = 0;
  const head = headSha({ cwd: root });
  // Short on the tool lines, in full on GIT_HEAD: a report whose every line
  // repeats the same paragraph is a report nobody reads to the end.
  const headNote = head.ok ? null : 'no HEAD — the version of record is git show HEAD:pnpm-lock.yaml (ADR-0003); see GIT_HEAD';

  // ---- NODE: the running interpreter against the declared one
  const nvmrc = head.ok ? showAtHead('.nvmrc', { cwd: root }) : { ok: false, text: null, reason: 'no HEAD' };
  const nvmrcFallback = !nvmrc.ok && existsSync(resolve(root, '.nvmrc')) ? readFileSync(resolve(root, '.nvmrc'), 'utf8') : null;
  const declaredNode = (nvmrc.ok ? nvmrc.text : nvmrcFallback)?.trim() ?? null;
  const runningNode = process.versions.node;
  if (declaredNode === null)
    flag('NODE', `${runningNode} declared=unavailable (no .nvmrc at HEAD and none in the working tree — nothing says which Node this repository is judged on)`);
  else if (major(`${declaredNode}.0`) === major(runningNode) || declaredNode === runningNode)
    flag('NODE', `${runningNode} declared=${declaredNode} source=${nvmrc.ok ? '.nvmrc@HEAD' : '.nvmrc@worktree (no commit yet)'} matches=true`);
  else
    flag(
      'NODE',
      `${runningNode} declared=${declaredNode} source=${nvmrc.ok ? '.nvmrc@HEAD' : '.nvmrc@worktree (no commit yet)'} matches=false (this process is not the Node version the repository declares; every gate's behaviour under another major is UNVERIFIED)`,
    );

  // ---- the manifest and the lock, both AT HEAD
  const rootManifestText = head.ok ? showAtHead('package.json', { cwd: root }) : { ok: false, text: null, reason: 'no HEAD' };
  let rootManifest = null;
  if (rootManifestText.ok) {
    try {
      rootManifest = JSON.parse(rootManifestText.text);
    } catch (e) {
      rootManifest = { parseError: String(e?.message) };
    }
  }
  const lockText = head.ok ? showAtHead('pnpm-lock.yaml', { cwd: root }) : { ok: false, text: null, reason: 'no HEAD' };
  const importers = lockText.ok ? parseLockImporters(lockText.text) : null;
  const rootLock = importers?.['.'] ?? null;

  // ---- PNPM: the runner against `packageManager`
  const pm = typeof rootManifest?.packageManager === 'string' ? rootManifest.packageManager : null;
  const declaredPnpm = pm !== null && pm.startsWith('pnpm@') ? pm.slice('pnpm@'.length) : null;
  const pnpmRun = spawnSync('pnpm', ['--version'], { encoding: 'utf8', env: { ...process.env, LANG: 'C', LC_ALL: 'C', NO_COLOR: '1' } });
  const runningPnpm = pnpmRun.error || pnpmRun.status !== 0 ? null : (pnpmRun.stdout ?? '').trim();
  if (runningPnpm === null)
    flag('PNPM', `unavailable (pnpm did not answer --version${pnpmRun.error ? `: ${pnpmRun.error.message}` : `: exit ${String(pnpmRun.status)}`}) declared=${declaredPnpm ?? 'unavailable'}`);
  else if (declaredPnpm === null)
    flag('PNPM', `${runningPnpm} declared=unavailable (${headNote ?? 'package.json at HEAD has no packageManager field'})`);
  else
    flag(
      'PNPM',
      `${runningPnpm} declared=${declaredPnpm} source=package.json@HEAD matches=${runningPnpm === declaredPnpm ? 'true' : `false (the runner is ${runningPnpm}, the repository declares ${declaredPnpm} — a different pnpm can resolve a different tree from the same lock)`}`,
    );

  // ---- the tools: record vs installed vs what PATH would pick
  const majors = {};
  for (const t of TOOLS) {
    const recorded = rootLock?.[t.pkg]?.version ?? null;
    const inst = installedVersion(root, t.pkg);
    const bin = binState(root, t.bin);
    // The MAJOR of record is the lock's (ADR-0003); the installed one is the
    // named fallback when HEAD has no lock to read, so a pre-flight before the
    // first commit still answers the engine-line question instead of going mute.
    majors[t.pkg] = { value: major(recorded ?? inst.version), source: recorded === null ? 'installed' : 'lock@HEAD' };

    const parts = [];
    parts.push(recorded ?? `unavailable (${headNote ?? `pnpm-lock.yaml at HEAD has no importer "." entry for ${t.pkg}`})`);
    parts.push(`installed=${inst.ok ? inst.version : `absent (${String(inst.reason)})`}`);
    // `resolved=` answers the plan's own question (§6.2): WHICH binary would
    // judge this lane. The workspace path when it exists — tools/gates/run.mjs
    // spawns exactly that, by absolute path — and CANNOT VERIFY when it does
    // not, because a bare `<bin>` then falls through to whatever PATH offers,
    // which is a different engine than the lock names. The cure is on
    // `matches=`, so the two fields do not print the same paragraph twice.
    parts.push(`resolved=${bin.inWorkspace ? `node_modules/.bin/${t.bin}` : `cannot-verify (node_modules/.bin/${t.bin} is absent — see matches=)`}`);

    // `matches=` is ONE question: does the version the record resolves equal the
    // version that would run here? A divergence is CANNOT VERIFY, because the
    // lane could then be judged by an engine the repository does not declare.
    let verdict;
    if (!bin.inWorkspace)
      verdict = `cannot-verify (node_modules/.bin/${t.bin} is absent, so a bare \`${t.bin}\` resolves to ${bin.first ?? 'nothing'} — a global ${t.bin} on PATH is a different engine; run pnpm install --frozen-lockfile)`;
    else if (!inst.ok) verdict = `cannot-verify (${String(inst.reason)})`;
    else if (recorded === null) verdict = 'cannot-verify (nothing to compare the installed version against)';
    else if (recorded !== inst.version)
      verdict = `false (the lock at HEAD resolves ${recorded}, the installed tree has ${inst.version} — "the install succeeded" is not "the tree matches the lock", TD-0007)`;
    else verdict = 'true';
    parts.push(`matches=${verdict}`);

    // A separate field, not folded into `matches=`: the gates always spawn the
    // ABSOLUTE workspace path (tools/gates/run.mjs refuses when it is missing),
    // so a different first match on PATH never changes a verdict here — it
    // changes what a hand-typed command in a terminal or a README does. Printed
    // only when it differs, so the usual case stays one short line. Observed on
    // this machine: a `tsc` from an unrelated Node install was first on PATH.
    if (bin.inWorkspace && bin.first !== null && !bin.firstIsWorkspace)
      parts.push(
        `path-first=${bin.first} (NOT the workspace binary — a hand-typed \`${t.bin}\` runs that one; the gates spawn node_modules/.bin/${t.bin} by absolute path, so no verdict here depends on it)`,
      );

    // The one cross-tool identity: the lint engine and the compiler must be the
    // same TypeScript line, or the type-aware rules and the compile verdict are
    // about different type systems and nothing else would say so (ADR-0004).
    if (t.key === 'TSGOLINT') {
      const ts = majors.typescript ?? { value: null, source: 'unknown' };
      const tg = majors['oxlint-tsgolint'] ?? { value: null, source: 'unknown' };
      parts.push(`major=${tg.value ?? 'unknown'} tsc-major=${ts.value ?? 'unknown'} major-source=${ts.source === tg.source ? ts.source : `${tg.source}/${ts.source}`}`);
      parts.push(
        tg.value === null || ts.value === null
          ? 'same-engine-line=cannot-verify (one of the two versions is unknown, so nothing can be said about the pair)'
          : tg.value === ts.value
            ? 'same-engine-line=true'
            : `same-engine-line=false (tsgolint is on the ${tg.value}.x line and tsc on ${ts.value}.x — the type-aware lint rules and the compile verdict would then be about different type systems, and nothing else in the repository would say so, ADR-0004)`,
      );
    }
    flag(t.key, parts.join(' '));
  }

  // ---- LOCKFILE_CLEAN: manifests vs lock, offline, both at HEAD
  flag('LOCKFILE_CLEAN', lockfileClean(root, head, importers, rootManifest));

  // ---- INSTALLED_LOCK: which lock this node_modules was built from
  const installedLockPath = resolve(root, INSTALLED_LOCK);
  if (!head.ok) flag('INSTALLED_LOCK', `cannot-verify (${headNote})`);
  else if (!existsSync(installedLockPath))
    flag('INSTALLED_LOCK', `cannot-verify (${INSTALLED_LOCK} is absent — nothing records which lock this node_modules was installed from; run pnpm install --frozen-lockfile)`);
  else {
    const recorded = lockKey({ root });
    let installed = null;
    try {
      installed = sha256(readFileSync(installedLockPath, 'utf8'));
    } catch (e) {
      installed = null;
      flag('INSTALLED_LOCK', `cannot-verify (${INSTALLED_LOCK} is unreadable: ${String(e?.message)})`);
    }
    if (installed !== null)
      flag(
        'INSTALLED_LOCK',
        !recorded.ok
          ? `cannot-verify (${String(recorded.reason)})`
          : recorded.sha256 === installed
            ? `matches (sha256 ${installed.slice(0, 12)}… — this node_modules was installed from the lock at HEAD)`
            : `differs (${INSTALLED_LOCK} is ${installed.slice(0, 12)}…, git show HEAD:pnpm-lock.yaml is ${recorded.sha256.slice(0, 12)}… — pnpm can report "Lockfile is up to date, resolution step is skipped" and keep a stale tree, so an install that succeeded is not a tree that matches, TD-0007; run pnpm install --frozen-lockfile)`,
      );
  }

  // ---- TREE_CLEAN: the whole tracked tree, and the part run.mjs refuses on
  const all = isTreeClean([], { cwd: root });
  const judged = isTreeClean(['packages', 'apps', 'e2e', 'tools'], { cwd: root });
  if (all.clean === null) flag('TREE_CLEAN', `cannot-verify (${String(all.reason)})`);
  else {
    const paths = (judged.entries ?? []).map((e) => e.path);
    flag(
      'TREE_CLEAN',
      `${String(all.entries.length)} tracked modified judged=${String(paths.length)}${paths.length ? ` (${paths.slice(0, 8).join(', ')}${paths.length > 8 ? ', …' : ''} — run.mjs refuses a run of record on these: the artefact would describe a tree no commit contains)` : ''}`,
    );
  }

  // ---- GIT_HEAD
  flag(
    'GIT_HEAD',
    head.ok
      ? head.sha
      : `none (HEAD does not resolve: ${String(head.reason)} — every range-based gate reads HEAD and none reads the index, so until the scaffold is committed there is no tree of record to judge)`,
  );

  // ---- WATCHERS: the same reader run.mjs refuses on
  const w = liveWatchers();
  flag(
    'WATCHERS',
    !w.ok
      ? `cannot-verify (${String(w.reason)})`
      : `${String(w.found.length)}${w.found.length ? ` (${w.found.map((p) => `${String(p.pid)} ${p.cmd}`).join('; ')} — run.mjs refuses while one is alive: a dev server re-transforming the same files mid-run is shared state, rule 2)` : ''}`,
  );

  // ---- CI_LOCK: reported, never removed silently (AGENTS.md rule 2)
  const lock = inspectLock(root);
  flag('CI_LOCK', `${lock.state}${lock.state === 'free' ? '' : ` (${lock.detail})`}`);

  // ---- CI_TREE_READY: the worktree red-check's base runs use
  flag('CI_TREE_READY', ciTreeReady(root));

  // ---- BROWSER_PROBE
  const p = premise(readProbe({ root }), 'browser_probe');
  flag('BROWSER_PROBE', p.verdict === 'pass' ? `pass (${p.reason})` : `absent (${p.reason} — the e2e lane reads CANNOT VERIFY until a probe records it, TD-0001)`);

  // ---- GENERATED_FRESH: asked of the generator, which is also the judge
  flag('GENERATED_FRESH', generatedFresh(root));

  // ---- BUDGETS
  flag('BUDGETS', NO_CALIBRATION);

  return lines.slice();
}

/**
 * Do the manifests and the lock agree, AT HEAD? Offline, by comparing
 * specifiers — never by spawning an install.
 *
 * This is the live defect of 2026-11-01 (TD-0007): the root `package.json` had
 * lost every `devDependencies` entry while `pnpm-lock.yaml` still listed twelve
 * for importer `.`. Nothing surfaced it, because `node_modules` and the lock
 * were both intact — until `pnpm install --frozen-lockfile`, which is the
 * DEFAULT in CI, refused with ERR_PNPM_OUTDATED_LOCKFILE before a single gate
 * could run. A manifest and a lock that disagree are not a slow CI, they are no
 * CI.
 */
function lockfileClean(root, head, importers, rootManifest) {
  if (!head.ok) return `cannot-verify (no commit in the repository — there is no committed lock and no committed manifest to compare)`;
  if (importers === null) return 'cannot-verify (pnpm-lock.yaml is absent at HEAD, or has no importers block — nothing says what a base checkout would install)';
  if (rootManifest?.parseError !== undefined) return `cannot-verify (package.json at HEAD is not JSON: ${String(rootManifest.parseError)})`;

  const problems = [];
  // Every package.json tracked at HEAD must be an importer the lock knows.
  const tracked = git(['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: root });
  if (tracked.code !== 0) problems.push(`cannot list the tree at HEAD: ${tracked.stderr.split('\n')[0]}`);
  else {
    for (const path of tracked.stdout.split('\n').filter((l) => l.endsWith('package.json'))) {
      const importer = path === 'package.json' ? '.' : path.slice(0, -'/package.json'.length);
      if (!/^(\.|packages\/[^/]+|apps\/[^/]+|tools\/[^/]+)$/.test(importer)) continue; // not a workspace member
      if (importers[importer] === undefined) {
        problems.push(`${path}:1 is a workspace manifest at HEAD with no "${importer}:" importer in the lock — a base checkout would not install it`);
        continue;
      }
      const text = showAtHead(path, { cwd: root });
      if (!text.ok) {
        problems.push(`${path}: unreadable at HEAD: ${String(text.reason)}`);
        continue;
      }
      let json;
      try {
        json = JSON.parse(text.text);
      } catch (e) {
        problems.push(`${path}:1 is not JSON at HEAD: ${String(e?.message)}`);
        continue;
      }
      const declared = manifestDeps(json);
      const locked = importers[importer];
      for (const [name, spec] of Object.entries(declared)) {
        if (locked[name] === undefined) problems.push(`${path}: declares ${name}@${spec}, the lock's "${importer}" importer does not list it`);
        else if (locked[name].specifier !== spec)
          problems.push(`${path}: declares ${name}@${spec}, the lock recorded specifier ${String(locked[name].specifier)}`);
      }
      for (const name of Object.keys(locked)) {
        if (declared[name] === undefined)
          problems.push(`the lock's "${importer}" importer lists ${name}@${String(locked[name].specifier)}, ${path} declares no such dependency`);
      }
    }
  }

  if (!problems.length) return 'true (every workspace manifest at HEAD and the lock at HEAD name the same specifiers — checked offline; pnpm install is never spawned by a pre-flight)';
  return `false (${String(problems.length)} disagreement(s); the first is: ${problems[0]} — pnpm install --frozen-lockfile is the CI default and refuses on this with ERR_PNPM_OUTDATED_LOCKFILE, TD-0007)`;
}

/**
 * Is there a usable base-run worktree? Three conditions, in order, and the
 * first unmet one is what the line names: it exists, its tracked tree is clean,
 * and what it installed from is the lock its own HEAD carries.
 */
function ciTreeReady(root) {
  const wt = git(['worktree', 'list', '--porcelain'], { cwd: root });
  if (wt.code !== 0) return `cannot-verify (git worktree list failed: ${wt.stderr.split('\n')[0]})`;
  const parent = resolve(root, CI_TREE_PARENT);
  const trees = [];
  let current = null;
  for (const line of wt.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), head: null };
      trees.push(current);
    } else if (line.startsWith('HEAD ') && current !== null) current.head = line.slice('HEAD '.length).trim();
  }
  const mine = trees.filter((t) => t.path.startsWith(`${parent}/`));
  if (!mine.length)
    return `false (no git worktree under ${CI_TREE_PARENT}/ — red-check creates one per label, and a base run in the developer's own tree would judge a tree somebody is editing)`;

  const reasons = [];
  for (const t of mine) {
    const clean = isTreeClean([], { cwd: t.path });
    if (clean.clean === null) {
      reasons.push(`${t.path}: cannot read the tracked tree (${String(clean.reason)})`);
      continue;
    }
    if (!clean.clean) {
      reasons.push(`${t.path}: ${String(clean.entries.length)} tracked file(s) modified`);
      continue;
    }
    const recorded = lockKey({ root: t.path });
    const installedPath = resolve(t.path, INSTALLED_LOCK);
    if (!recorded.ok) {
      reasons.push(`${t.path}: ${String(recorded.reason)}`);
      continue;
    }
    if (!existsSync(installedPath)) {
      reasons.push(`${t.path}: ${INSTALLED_LOCK} is absent — nothing says which lock it installed from (pnpm install --frozen-lockfile --offline)`);
      continue;
    }
    let installed = null;
    try {
      installed = sha256(readFileSync(installedPath, 'utf8'));
    } catch (e) {
      reasons.push(`${t.path}: ${INSTALLED_LOCK} is unreadable (${String(e?.message)})`);
      continue;
    }
    if (installed !== recorded.sha256) {
      reasons.push(`${t.path}: installed from ${installed.slice(0, 12)}…, its HEAD carries ${recorded.sha256.slice(0, 12)}…`);
      continue;
    }
    return `true (${t.path} stands on ${(t.head ?? 'an unreported commit').slice(0, 7)}, tracked tree clean, installed from the lock at its own HEAD)`;
  }
  return `false (${String(mine.length)} worktree(s) under ${CI_TREE_PARENT}/, none usable; the first reason is: ${reasons[0]})`;
}

/**
 * Freshness of the generated digests, asked of `digest.mjs --check` — the
 * generator and the judge are ONE program, so this file does not re-derive what
 * is stale. A second answer to "is this digest current" is a second answer
 * waiting to disagree with the generator that writes it.
 */
function generatedFresh(root) {
  const script = resolve(root, 'tools/gates/digest.mjs');
  if (!existsSync(script))
    return 'cannot-verify (tools/gates/digest.mjs is absent — it is both the generator and the judge of docs/digests/, so with it missing nothing can say whether a digest is stale)';
  const r = spawnSync(process.execPath, [script, '--check'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, TZ: 'UTC', LANG: 'C', LC_ALL: 'C', NO_COLOR: '1' },
  });
  if (r.error) return `cannot-verify (digest.mjs --check did not run: ${r.error.message})`;
  if (r.status === 0) return 'true (digest.mjs --check exits 0: every digest under docs/digests/ matches its source)';
  const first = `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').find((l) => l.trim().length > 0) ?? '(no output)';
  return `stale (digest.mjs --check exited ${String(r.status)}: ${first.trim()} — run node tools/gates/digest.mjs --fix)`;
}

export function main() {
  const rr = repoRoot();
  if (!rr.ok) {
    process.stdout.write(`STATUS=unavailable (not a git repository: ${String(rr.reason)} — every range-based gate reads HEAD, so there is nothing to report on)\n`);
    process.exit(2);
  }
  process.chdir(rr.root);
  for (const line of report({ root: rr.root })) process.stdout.write(`${line}\n`);
  process.exit(0);
}

// Importable without side effects, so a probe can call report({ root }) on a
// planted fixture and assert the LINES rather than parse a terminal.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
