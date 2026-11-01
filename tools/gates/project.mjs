#!/usr/bin/env node
/**
 * project.mjs — THE TEXT INSPECTOR, and the carrier of AGENTS.md rule 4: a claim
 * about this project cites `path:line` from here or from git, or it is written
 * as UNVERIFIED.
 *
 *     node tools/gates/project.mjs packages
 *     node tools/gates/project.mjs config  <pkg>
 *     node tools/gates/project.mjs files   <pkg>
 *     node tools/gates/project.mjs exports <pkg>
 *     node tools/gates/project.mjs imports <file>
 *     node tools/gates/project.mjs routes
 *     node tools/gates/project.mjs deps [--why <package>]
 *
 * IT IS A TOOL, NOT A GATE. It renders no verdict: no `pass`, no `fail`, no
 * green and no red appears in its output, and nothing here is a light. It
 * ANSWERS QUESTIONS, with a line number on every answer, so that the sentence an
 * agent then writes in a spec is a citation rather than a recollection. Whoever
 * judges — `spec-gate`, `test-guard`, `red-check`, the sixteen lights, `ready` —
 * reads artifacts; this file reads text and tells you where the text is.
 *
 * Its exit code says ONE thing and it is not a verdict: 0 the question was
 * answered, 2 it could not be answered at all (no repository, no such
 * subcommand, no such package, a premise absent). An answer that contains
 * `UNVERIFIED` lines is still an answer and still exits 0 — the honest form of
 * "the tool does not know this" is a line saying so, never a non-zero exit that
 * a caller would read as a failed check.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * ONE READER PER FACT — WHAT THIS FILE DELIBERATELY DOES NOT OWN
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Every fact below already has exactly one reader in this repository, and this
 * file calls it rather than growing a second one. A second reader of the same
 * fact is how an inspector starts contradicting the gate an agent is about to
 * run, and the agent then cites the inspector.
 *
 *   the workspace, its manifests, who owns a path   `lights/_shared.mjs`
 *                                                   (`readPackages`, `ownerOf`)
 *   the directory walk and its ONE declared blind    `lights/_shared.mjs`
 *     spot (`tools/gates/visible.json`)              (`walk`, `readVisible`)
 *   what the compiler actually READ, partitioned     `lights/_shared.mjs`
 *     (and the TS 7 platform-lib trap with it)       (`resolveClosure`)
 *   the `extends` chain with each file's text, WHO   `lights/tsc.mjs`
 *     sets a compiler option, `tsc --showConfig`     (`tsconfigChain`,
 *                                                    `setterOf`, `showConfig`;
 *                                                    the JSONC reader under
 *                                                    them is `readJsoncFile`)
 *   the module specifiers of one source file         `lights/graph.mjs`
 *                                                   (`specifiersOf`)
 *   the `importers:` block of the pnpm lockfile      `status.mjs`
 *                                                   (`parseLockImporters`)
 *   git, in argv form, locale-pinned                 `lib/git.mjs`
 *   the first line a quoted JSON key appears on      `lights/_shared.mjs`
 *                                                   (`jsonLine`)
 *
 * NO MODULE HERE PARSES TYPESCRIPT. A question about types goes to `tsc` and
 * comes back as text (`config`, `files`). What this file does scan is TOKENS over
 * source masked by `scanSource` — comments, strings, template substitutions and
 * regex literals blanked with every offset and line preserved — which is the
 * same masked text every other scanning light reads, re-exported rather than
 * reimplemented. A token scan can see a declaration and cite its line; it cannot
 * resolve a type, and where that difference matters the line says UNVERIFIED and
 * names the tool that CAN answer.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT IT COSTS TO BE WRONG HERE — the measured traps this file is shaped by
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * 1. A `tsconfig.json` MAY NOT BE QUOTED AS TEXT (rule 4, AGENTS.md:394). Every
 *    one of them `extends` (`packages/core/tsconfig.json:2`), so the file an
 *    agent just read is not the configuration in force. `config` therefore
 *    prints what `tsc --showConfig` resolved and, beside each option, the file
 *    and line that SET it.
 *
 * 2. `--showConfig` PRINTS OPTIONS NOBODY WROTE. Measured on this tree:
 *    `preserveConstEnums: true` comes back for `packages/core` although no file
 *    on the chain mentions it. Such an option is marked UNVERIFIED with that
 *    reason, so nobody cites a `tsc` default as a project decision.
 *
 * 3. `--showConfig` NORMALISES VALUES. Measured: a file that wrote `"ES2023"`
 *    reads back as `"es2023"`, and `"module": "ESNext"` as `"esnext"`. `config`
 *    prints the resolved value and, when the setter's own spelling differs, that
 *    spelling too — the two are different facts and conflating them is how a pin
 *    gets written against a value nobody typed.
 *
 * 4. THE TYPESCRIPT 7 LIB FILES ARE NOT IN `node_modules/typescript/lib/`. They
 *    live in `@typescript/typescript-<platform>/lib/`, so a path filter on the
 *    TS<=6 location matches nothing and every lib file then reads as a path
 *    outside the package. `files` does not own that rule: `resolveClosure`
 *    partitions the listing and reports the platform segment it derived.
 *
 * 5. A DECLARED WORKSPACE EDGE AND AN ILLEGAL RELATIVE ESCAPE LOOK IDENTICAL IN
 *    `--listFiles` (pnpm's symlink is reported at its real path). So `files`
 *    never calls an in-repo path from outside the package "an edge": it prints
 *    the owner and then the IMPORT SITE, found by the specifier scan, as
 *    `path:line` — which is the only thing that tells the two apart.
 *
 * 6. AN EXIT CODE IS CAPTURED SEPARATELY AND STAYS ADVISORY. There is no pipe at
 *    any call site in this file: `cmd | head` reports `$?` of `head`, which is
 *    how two runs in the session that designed these gates reported `exit=0` for
 *    a crashed linter and for four `error TS6059`. Where this file prints an
 *    exit code it labels it advisory and prints the text it read beside it.
 *
 * 7. IT MUST RUN BEFORE AN INSTALL FINISHES. `packages`, `exports`, `imports`,
 *    `routes` and `deps` are pure text and work in a fresh worktree with no
 *    `node_modules`. `config` and `files` need the `tsc` premise and say so by
 *    name, with the cure, rather than printing a thinner answer that looks
 *    complete (`requirePremise`).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * IMPORTABLE WITHOUT SIDE EFFECTS
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Nothing runs on `import()`: `main()` is called only when this file IS the
 * process entry point. Every subcommand is exported and returns
 * `{ ok, reason, lines }` — data, not a terminal — so a probe in
 * `gate-probes.mjs` can assert a FUNCTION's answer on a planted fixture instead
 * of grepping help text. `exportsIn`, `routesIn` and `resolveSpecifier` are
 * exported for the same reason: they are pure, they take text, and they are
 * where a probe can plant a defect.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { existsAtHead, headSha, repoRoot, showAtHead } from './lib/git.mjs';
import { KINDS, KIND_ROOT, classify, kindOf } from './lib/test-file-patterns.mjs';
import {
  byCodepoint,
  jsonLine,
  normRel,
  ownerOf,
  readPackages,
  readPremises,
  readVisible,
  requirePremise,
  resolveClosure,
  scanSource,
  under,
  walk,
} from './lights/_shared.mjs';
import { cite, sameValue, setterOf, showConfig, tsconfigChain, tsconfigRelOf } from './lights/tsc.mjs';
import { specifiersOf } from './lights/graph.mjs';
import { parseLockImporters } from './status.mjs';

// ------------------------------------------------------------------ vocabulary

/** The subcommands, with what each one takes. `takes` is the whole argument
 * contract: `none` refuses a positional, `pkg` and `file` require one. */
export const SUBCOMMANDS = Object.freeze({
  packages: { takes: 'none', what: 'the workspace as DECLARED: every package.json, its dependencies and its exports, each with its line' },
  config: { takes: 'pkg', what: 'the EFFECTIVE compiler options (tsc --showConfig) and, per option, the file:line that set it' },
  files: { takes: 'pkg', what: 'what the compiler actually READ for this package (tsc --listFiles), partitioned, with the import site of every escape' },
  exports: { takes: 'pkg', what: 'the public surface: the package.json "exports" map, then every export declaration behind it, with its line' },
  imports: { takes: 'file', what: 'every module specifier of one file, with its line and what it resolves to' },
  routes: { takes: 'none', what: 'the HTTP surface of the api app, as a token scan over its sources can see it' },
  deps: { takes: 'none', what: 'every declared dependency with its line; --why <package> answers who declares, locks, digests and imports one' },
});

export const SUBCOMMAND_NAMES = Object.keys(SUBCOMMANDS);

/** Source extensions a token scan reads. The same list `lights/graph.mjs:135`
 * scans, spelled here because it is not exported there; a file type one of the
 * two reads and the other does not would make the inspector and the light
 * disagree about what source exists. */
export const SRC_EXTS = Object.freeze(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx']);

/** The lockfile of record — the one a base checkout installs from (ADR-0003). */
const LOCK = 'pnpm-lock.yaml';

/** Where rule 15 keeps a runtime dependency's API digest. */
const VENDOR_DIR = 'docs/vendor';

/** How many items a line prints before it says how many are left. */
const SHOW = 8;

/** The four dependency groups, as ONE word each: `readPackages` reports the
 * manifest key, and printing `devDependencies@^1.2.3` beside
 * `dependencies@^1.2.3` makes the one distinction that matters hardest to see. */
const GROUP_WORD = Object.freeze({ dependencies: 'runtime', devDependencies: 'dev', peerDependencies: 'peer', optionalDependencies: 'optional' });

/** Node's own modules, as a prefix rule rather than a list: `node:fs` is a
 * builtin whatever the version, and this file does not claim to know which
 * builtins exist — only that a `node:` specifier is one. */
const NODE_PREFIX = 'node:';

const pad = (s, n) => String(s).padEnd(n, ' ');

/** The 1-based line a `path:line:` message carries, for sorting a problem list
 * into file order. Zero when the message has none, so such a line sorts first
 * rather than disappearing. */
const lineOfMessage = (message) => Number(/:(\d+):/.exec(String(message))?.[1] ?? 0);

/** 1-based line of an offset. Local on purpose, as in `lights/graph.mjs:152` and
 * `lights/core-purity.mjs:178`: it is arithmetic over a string, not a fact about
 * the project, and a shared copy would be a module boundary for three lines. */
export function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/** The raw source line an offset falls on, trimmed and capped — the QUOTE that
 * makes a `path:line` checkable without opening the file. */
export function quoteAt(text, offset, max = 120) {
  const from = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  const to = text.indexOf('\n', offset);
  const raw = text.slice(from, to === -1 ? text.length : to).trim();
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}

/** `{ ok: false, reason }` — the shape every subcommand returns when it could
 * not answer. `lines` is always present so a caller never guards for it. */
const unanswered = (reason) => ({ ok: false, reason, lines: [] });

/** The suffixes an extensionless specifier may pick up, in the order a reader
 * should try them, plus the `<dir>/index.*` form. */
const RESOLVE_SUFFIXES = Object.freeze(['', '.ts', '.tsx', '.d.ts', '.mts', '.cts', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']);

/**
 * Does a relative target exist on disk, and under which spelling?
 * → { found, path, how }
 *
 * THIS FUNCTION IS A CORRECTION OF A LIE THIS FILE TOLD. The first version
 * checked `existsSync(join(root, target))` and nothing else, so
 * `apps/web/src/main.tsx:4`'s `'./App'` — which resolves perfectly well to
 * `apps/web/src/App.tsx` — was printed as "MISSING on disk". An inspector whose
 * whole purpose is to be citable may not invent an absence: an extensionless
 * specifier is the normal form in a bundler project, and `allowImportingTsExtensions`
 * (tsconfig.base.json:17) means BOTH spellings are legal in this repository.
 *
 * `how` says which spelling matched, because that is a fact in itself. What this
 * never claims is module RESOLUTION: the compiler's answer is `files <pkg>`,
 * read from `tsc --listFiles`, and a disagreement between the two is for L-graph
 * to judge.
 */
export function resolveRelativeFile(root, target) {
  if (target === null) return { found: false, path: null, how: null };
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${target}${suffix}`;
    if (existsSync(join(root, candidate))) return { found: true, path: candidate, how: suffix === '' ? 'as written' : `as written + ${suffix}` };
  }
  return { found: false, path: null, how: null };
}

// ---------------------------------------------------------------- the argument

/**
 * Parse the argv AFTER `node project.mjs`. → one of
 *   { help: true }
 *   { error: '<what was wrong, and what to pass instead>' }
 *   { cmd, target, why }
 *
 * No flag is accepted that this file does not implement: a flag silently
 * ignored is an answer to a question nobody asked.
 */
export function parseArgs(argv) {
  const a = argv.filter((x) => typeof x === 'string');
  if (a.length === 0) return { error: `no subcommand — one of ${SUBCOMMAND_NAMES.join(', ')}` };
  const cmd = a[0];
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') return { help: true };
  if (!Object.hasOwn(SUBCOMMANDS, cmd))
    return { error: `unknown subcommand ${JSON.stringify(cmd)} — one of ${SUBCOMMAND_NAMES.join(', ')}` };

  const spec = SUBCOMMANDS[cmd];
  const out = { cmd, target: null, why: null };
  for (let i = 1; i < a.length; i += 1) {
    const arg = a[i];
    const eq = arg.indexOf('=');
    const name = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg;
    const inline = arg.startsWith('--') && eq > 0 ? arg.slice(eq + 1) : null;
    if (name === '--why') {
      if (cmd !== 'deps') return { error: `--why belongs to the deps subcommand only; ${cmd} takes ${spec.takes === 'none' ? 'no argument' : `a ${spec.takes}`}` };
      const v = inline ?? a[i + 1];
      if (inline === null) i += 1;
      if (typeof v !== 'string' || v.startsWith('-') || v === '') return { error: '--why needs a package name, e.g. --why fastify' };
      out.why = v;
      continue;
    }
    if (arg.startsWith('-')) return { error: `unknown flag ${JSON.stringify(arg)} — see node tools/gates/project.mjs --help` };
    if (spec.takes === 'none') return { error: `${cmd} takes no positional argument (got ${JSON.stringify(arg)}) — ${spec.what}` };
    if (out.target !== null) return { error: `${cmd} takes ONE ${spec.takes} (got ${JSON.stringify(out.target)} and ${JSON.stringify(arg)})` };
    out.target = arg;
  }
  if (spec.takes !== 'none' && out.target === null)
    return {
      error:
        spec.takes === 'pkg'
          ? `${cmd} needs a package — a kind (${KINDS.join('|')}), a directory (packages/core) or a name (@cheq/core)`
          : `${cmd} needs a repo-relative file path, e.g. apps/web/src/main.tsx`,
    };
  return out;
}

export const HELP = `node tools/gates/project.mjs <subcommand> — the text inspector (AGENTS.md rule 4)

${SUBCOMMAND_NAMES.map((n) => `  ${pad(n + (SUBCOMMANDS[n].takes === 'pkg' ? ' <pkg>' : SUBCOMMANDS[n].takes === 'file' ? ' <file>' : ''), 16)}${SUBCOMMANDS[n].what}`).join('\n')}
  deps --why <pkg>  who declares it, what the lock at HEAD resolved, whether rule 15's digest exists, who imports it

<pkg> is a kind (${KINDS.join('|')}), a directory (packages/core) or a package name (@cheq/core).

It renders no verdict: every answer is a fact with a line number, and what it cannot
resolve is printed as UNVERIFIED naming the tool that can. Exit code: 0 the question was
answered, 2 it could not be answered at all. config and files need node_modules/.bin/tsc;
packages, exports, imports, routes and deps are pure text and run before an install.`;

// ------------------------------------------------------------------ the target

/**
 * Resolve a `<pkg>` token to a workspace package or at least a directory.
 * → { ok, reason, rel, pkg, how }
 *
 * Three spellings are accepted because three are in use in this repository's own
 * prose: a KIND (`core`, which `docs/knowledge/loop.md:47` uses), a DIRECTORY
 * (`packages/core`, which `.claude/skills/spec-harden/SKILL.md:36` uses) and a
 * package NAME (`@cheq/core`, which the same skill uses one line later). A tool
 * that accepted one of the three would make two thirds of the documented
 * citations fail at the moment somebody tried to check one.
 */
export function resolveTarget(pkgs, token) {
  const raw = String(token ?? '');
  if (pkgs.byName?.has(raw)) {
    const pkg = pkgs.byName.get(raw);
    return { ok: true, reason: null, rel: pkg.rel, pkg, how: 'package name' };
  }
  const kindRel = Object.hasOwn(KIND_ROOT, raw) ? KIND_ROOT[raw] : null;
  const rel = normRel(kindRel ?? raw);
  if (rel === null)
    return { ok: false, reason: `${JSON.stringify(raw)} is not a repo-relative path, a kind (${KINDS.join('|')}) or a package name`, rel: null, pkg: null, how: null };
  const pkg = pkgs.byDir?.get(rel) ?? null;
  if (pkg !== null) return { ok: true, reason: null, rel, pkg, how: kindRel === null ? 'directory' : `kind ${raw}` };
  return {
    ok: true,
    reason: `${rel} is not a workspace package (no ${rel}/package.json) — the answer below is about the DIRECTORY`,
    rel,
    pkg: null,
    how: kindRel === null ? 'directory' : `kind ${raw}`,
  };
}

/** The context every subcommand gets: the root, the workspace, the blind-spot
 * manifest and the premise probe — each read ONCE per process, by its one
 * reader, exactly as `lights/run.mjs` does for the lights. */
export function context(root = process.cwd()) {
  return { root, pkgs: readPackages(root), visible: readVisible(root), premises: readPremises(root) };
}

const headLine = (root) => {
  const h = headSha({ cwd: root });
  return h.ok ? h.sha.slice(0, 7) : `none (${String(h.reason)})`;
};

/** Read one tracked text file. → { ok, text, reason } — never throws. */
function readText(root, rel) {
  const path = join(root, rel);
  if (!existsSync(path)) return { ok: false, text: null, reason: `${rel}: does not exist` };
  try {
    return { ok: true, text: readFileSync(path, 'utf8'), reason: null };
  } catch (e) {
    return { ok: false, text: null, reason: `${rel}: unreadable: ${String(e?.message ?? e)}` };
  }
}

// ----------------------------------------------------------------- 1. packages

/**
 * The workspace as DECLARED — never as installed. Every dependency, every
 * `exports` entry and every manifest field is printed with the line it is
 * written on, because this listing is what a spec's `home:` and a reviewer's
 * edge claim are quoted from.
 */
export function cmdPackages({ root, pkgs }) {
  const lines = [];
  lines.push(`# project packages   root=${root}   head=${headLine(root)}`);
  lines.push(`reader: readPackages (tools/gates/lights/_shared.mjs:732) — the same one every light asks`);

  const wsText = readText(root, 'pnpm-workspace.yaml');
  const globLine = (g) => (wsText.ok ? lineAt(wsText.text, Math.max(0, wsText.text.indexOf(g))) : null);
  for (const g of pkgs.globs) {
    const members = pkgs.packages.filter((p) => under(p.rel, g.slice(0, g.lastIndexOf('/'))));
    const empty = pkgs.emptyGlobs.includes(g);
    lines.push(
      `workspace glob ${pad(g, 12)} ${cite('pnpm-workspace.yaml', globLine(g))}   ${
        empty
          ? 'matches NO package.json — deliberate for tools/*: a manifest there would give the gates dependencies and they would stop running exactly when they are needed (package.json:5, the "description" field; tools/gates/lights/_shared.mjs:726 cites the same sentence as package.json:4, which is one line off today)'
          : `${String(members.length)} member(s): ${members.map((p) => String(p.name)).join(', ')}`
      }`,
    );
  }
  if (!pkgs.globs.length) lines.push('workspace globs: NONE — pnpm-workspace.yaml declares no "packages" list, so no member can be enumerated');

  for (const m of pkgs.allManifests) {
    lines.push('');
    const title = m.isRoot ? `(repository manifest)   ${m.manifestRel}` : `${String(m.name)}   dir=${m.rel}   ${m.manifestRel}`;
    lines.push(title);
    if (m.isRoot) lines.push(`  it is never the owner of a path (readPackages keeps it separate), so a dependency declared here belongs to the TOOLCHAIN, not to shipped code`);
    const fields = [];
    for (const key of ['version', 'private', 'type', 'packageManager']) {
      const v = m.raw?.[key];
      if (v === undefined) continue;
      fields.push(`${key}=${JSON.stringify(v)} ${cite(m.manifestRel, jsonLine(m.text, key))}`);
    }
    if (fields.length) lines.push(`  ${fields.join('   ')}`);
    lines.push(`  tsconfig: ${m.tsconfigRel === null ? 'NONE — this package has no type project, so `config` and `files` have nothing to read for it' : `${m.tsconfigRel} (read it with \`config\`, never as text — rule 4)`}`);

    for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const entries = Object.entries(m[group] ?? {});
      const declaredEmpty = m.raw?.[group] !== undefined && entries.length === 0;
      if (!entries.length) {
        if (declaredEmpty)
          lines.push(
            `  ${group}: {} — DECLARED EMPTY at ${cite(m.manifestRel, jsonLine(m.text, group))}${
              m.name === '@cheq/core' ? '; that emptiness is the carrier of rule 1, not a comment about it (ADR-0001)' : ''
            }`,
          );
        continue;
      }
      lines.push(`  ${group} (${String(entries.length)})`);
      for (const [name, spec] of entries.toSorted((x, y) => byCodepoint(x[0], y[0]))) {
        const ws = pkgs.byName?.has(name) === true;
        lines.push(`    ${pad(name, 26)} ${pad(String(spec), 16)} ${cite(m.manifestRel, jsonLine(m.text, name))}${ws ? '   workspace member (an edge, judged by L-graph against ADR-0001)' : ''}`);
      }
    }

    const exp = m.exports;
    if (exp === null || exp === undefined)
      lines.push(
        m.isRoot
          ? '  exports: NONE, and none is wanted — the repository manifest is private and nothing depends on it'
          : '  exports: NONE declared — with no "exports" map a dependant may import any internal path of this package',
      );
    else if (typeof exp === 'string') lines.push(`  exports: ${JSON.stringify(exp)} ${cite(m.manifestRel, jsonLine(m.text, 'exports'))}`);
    else {
      lines.push(`  exports (${String(Object.keys(exp).length)}) ${cite(m.manifestRel, jsonLine(m.text, 'exports'))}`);
      for (const [key, value] of Object.entries(exp)) {
        const shown = typeof value === 'string' ? value : `${JSON.stringify(value)}  (conditional exports — UNVERIFIED here: which condition a dependant hits is the bundler's answer, not this file's)`;
        lines.push(`    ${pad(JSON.stringify(key), 14)} -> ${pad(shown, 30)} ${cite(m.manifestRel, jsonLine(m.text, key))}`);
      }
    }
  }

  if (pkgs.problems.length) {
    lines.push('');
    lines.push(`PROBLEMS the workspace reader reports (${String(pkgs.problems.length)}) — they are facts about the manifests, and L-graph / L-deps are what judge them`);
    for (const p of pkgs.problems) lines.push(`  ${p}`);
  }
  return { ok: true, reason: null, lines };
}

// ------------------------------------------------------------------- 2. config

/**
 * The EFFECTIVE compiler options, plus the provenance of each one.
 *
 * This subcommand exists because rule 4 forbids quoting a `tsconfig.json` as
 * text: every one of them `extends`, so the file is not the configuration. The
 * two facts are printed side by side — what tsc RESOLVED, and which file:line
 * SET it — and an option no file on the chain sets is marked UNVERIFIED with
 * that reason, because `--showConfig` prints tsc's own defaults too (measured:
 * `preserveConstEnums`).
 */
export function cmdConfig({ root, pkgs, premises }, token) {
  const t = resolveTarget(pkgs, token);
  if (!t.ok) return unanswered(t.reason);
  const cfgRel = tsconfigRelOf(t.rel);
  if (cfgRel === null || !existsSync(join(root, cfgRel)))
    return unanswered(
      `${String(cfgRel)}: no such file — ${t.rel} has no type project${
        t.rel === 'e2e' ? ' (e2e is the known case: it is judged by Playwright, not by tsc)' : ''
      }; \`packages\` lists which directories have one`,
    );

  const prem = requirePremise(premises, 'tsc');
  if (!prem.ok) return unanswered(`${prem.reason} — the effective config is tsc's answer, and this file does not guess it from the text (rule 4)`);

  const chain = tsconfigChain(root, cfgRel);
  const sc = showConfig(root, cfgRel, premises);
  if (!sc.ok) return unanswered(`${cfgRel}: ${String(sc.reason)}`);

  const lines = [];
  lines.push(`# project config ${t.rel}   (${t.how})   head=${headLine(root)}`);
  if (t.reason !== null) lines.push(`note: ${t.reason}`);
  lines.push(`artifact: ${sc.argv.join(' ')}   exit ${String(sc.exitCode)} (ADVISORY — the answer is the JSON it printed)`);
  lines.push(`extends chain, nearest first: ${chain.files.map((f) => f.rel).join(' -> ')}`);
  for (const p of chain.problems) lines.push(`  chain PROBLEM: ${p}`);
  if (!chain.ok) lines.push('  a chain that stopped early makes every "no file sets this" below UNRELIABLE — fix the chain first');

  const co = sc.data?.compilerOptions;
  if (co === null || co === undefined || typeof co !== 'object')
    return unanswered(`${cfgRel}: --showConfig printed no compilerOptions object, so there are no effective options to report`);

  const keys = Object.keys(co).toSorted(byCodepoint);
  lines.push('');
  lines.push(`EFFECTIVE compilerOptions (${String(keys.length)}) — resolved by tsc; values are tsc-normalised (MEASURED: a file that wrote "ES2023" reads back "es2023")`);
  for (const key of keys) {
    const setter = setterOf(chain, key);
    const value = JSON.stringify(co[key]);
    if (setter === null) {
      lines.push(`  ${pad(key, 32)} ${pad(value, 22)} UNVERIFIED — no file on the chain sets it: this is tsc's own default (MEASURED: preserveConstEnums arrives this way), so it is not a project decision and must not be cited as one`);
      continue;
    }
    // THREE cases, and the first version of this line collapsed two of them.
    // `sameValue` lowercases both sides (tools/gates/lights/tsc.mjs:336), which
    // is right for a PIN and wrong here: the whole point of measured trap 3 is
    // that `"ES2023"` reads back `"es2023"`, and a tool that hides that
    // difference leaves an agent citing a spelling nobody typed. So the textual
    // difference is printed as a normalisation, and a difference that survives
    // normalisation is printed as a DISAGREEMENT, which is a different fact.
    const written = JSON.stringify(setter.value);
    const note =
      written === value
        ? ''
        : sameValue(setter.value, co[key])
          ? `  (written ${written} — tsc normalised it; the resolved form is what is in force)`
          : `  (DISAGREES: the nearest setter writes ${written}; tsc resolved ${value} — cite the resolved value and find out why, because nothing on the chain explains it)`;
    lines.push(`  ${pad(key, 32)} ${pad(value, 22)} set at ${cite(setter.rel, setter.line)}${note}`);
  }

  for (const field of ['files', 'include', 'exclude', 'references']) {
    const v = sc.data?.[field];
    if (v === undefined) continue;
    const nearest = chain.files.find((f) => Object.hasOwn(f.data ?? {}, field)) ?? null;
    // NOT "UNVERIFIED": a `files` array tsc expanded from `include` is tsc's own
    // authoritative answer, and marking it UNVERIFIED would spend the word that
    // is supposed to mean "this tool does not know" on something it does know.
    const where = nearest === null ? `derived by tsc (no file on the chain writes a "${field}" array)` : `written at ${cite(nearest.rel, jsonLine(nearest.text, field))}`;
    const items = Array.isArray(v) ? v : [v];
    lines.push('');
    lines.push(`${field} (${String(items.length)}) — ${field === 'files' ? `tsc's own expansion, relative to ${t.rel}` : 'as written'}; ${where}`);
    for (const item of items) lines.push(`  ${typeof item === 'string' ? item : JSON.stringify(item)}`);
  }
  lines.push('');
  lines.push(`this output — not ${cfgRel} — is what rule 4 lets a spec cite (AGENTS.md:394)`);
  return { ok: true, reason: null, lines };
}

// -------------------------------------------------------------------- 3. files

/** The registry package a `node_modules` path belongs to: the segment(s) after
 * the LAST `node_modules/`, scope included. → null when there is none. */
export function externalPackageOf(rel) {
  const parts = String(rel ?? '').split('/');
  const i = parts.lastIndexOf('node_modules');
  if (i === -1 || i + 1 >= parts.length) return null;
  const first = parts[i + 1];
  if (first.startsWith('@') && i + 2 < parts.length) return `${first}/${parts[i + 2]}`;
  return first;
}

/**
 * Where, in this package's own sources, a path outside it is imported from.
 * → Map<target path, [{ rel, line, spec }]>
 *
 * This is the half `--listFiles` cannot supply: a declared workspace edge
 * reached through pnpm's symlink and an illegal relative escape are the SAME
 * line in the listing (measured), and only the import site tells them apart.
 */
export function importSites(root, pkgRel, visible) {
  const sites = new Map();
  const found = walk(root, { roots: [pkgRel], exts: SRC_EXTS, visible });
  for (const rel of found.files) {
    const r = readText(root, rel);
    if (!r.ok) continue;
    const s = specifiersOf(r.text, rel);
    if (!s.ok) continue;
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    for (const { spec, line } of s.specifiers) {
      const key = spec.startsWith('.') ? normRel(posix.normalize(posix.join(dir, spec))) : spec;
      if (key === null) continue;
      if (!sites.has(key)) sites.set(key, []);
      sites.get(key).push({ rel, line, spec });
    }
  }
  return { sites, problems: found.problems };
}

/**
 * What the compiler READ for this package, partitioned, with the import site of
 * every in-repo input from outside it.
 */
export function cmdFiles({ root, pkgs, premises, visible }, token) {
  const t = resolveTarget(pkgs, token);
  if (!t.ok) return unanswered(t.reason);
  const c = resolveClosure(t.rel, { root, premises });
  if (!c.ok) return unanswered(`${t.rel}: ${String(c.reason)}`);

  const lines = [];
  lines.push(`# project files ${t.rel}   (${t.how})   head=${headLine(root)}`);
  if (t.reason !== null) lines.push(`note: ${t.reason}`);
  lines.push(`artifact: ${c.argv.join(' ')}   exit ${String(c.exitCode)} (ADVISORY — the answer is the listing it printed)`);
  lines.push(`reader: resolveClosure (tools/gates/lights/_shared.mjs:945) — it also owns the TypeScript 7 platform-lib rule`);
  lines.push(
    `${String(c.filesChecked)} input(s): ${String(c.inside.length)} inside ${t.rel} · ${String(c.workspace.length)} elsewhere in the repository · ${String(c.external.length)} external · ${String(c.foreign.length)} outside the repository · ${String(c.libs.length)} lib`,
  );
  // `positioned`, not `diagnostics`: `parseDiagnostics` (which is what
  // `resolveClosure` stores here) names the array `positioned`, and only
  // `readTsc` renames it to `diagnostics` (tools/gates/lib/tsc-log.mjs:93,151).
  // The first version of this line read `.diagnostics.length` and threw.
  const diag = c.diagnostics;
  lines.push(
    `diagnostics: ${String(diag.positioned.length)} positional, ${String(diag.global.length)} global${
      diag.positioned.length || diag.global.length ? ' — a listing taken from a run with diagnostics describes what tsc read BEFORE it gave up on them' : ''
    }`,
  );
  for (const d of diag.positioned.slice(0, SHOW)) lines.push(`  ${d.path}:${String(d.line)}:${String(d.col)} ${d.code}: ${d.msg}`);
  for (const g of diag.global) lines.push(`  ${g.code}: ${g.msg}`);

  const { sites, problems } = importSites(root, t.rel, visible);

  lines.push('');
  lines.push(`inside ${t.rel} (${String(c.inside.length)})`);
  for (const rel of c.inside) lines.push(`  ${rel}`);

  lines.push('');
  lines.push(`elsewhere in the repository (${String(c.workspace.length)}) — MEASURED: a declared edge through pnpm's symlink and an illegal relative escape look IDENTICAL here, so the import site below is what tells them apart`);
  for (const w of c.workspace) {
    const owner = w.owner === null ? 'NO workspace package owns it' : w.owner;
    const declared = w.owner !== null && t.pkg !== null && t.pkg.declared?.has(w.owner) === true;
    const where = sites.get(w.rel) ?? sites.get(w.owner) ?? [];
    lines.push(
      `  ${pad(w.rel, 44)} owner=${pad(owner, 12)} ${
        t.pkg === null ? 'no manifest here to declare an edge' : declared ? `declared at ${cite(t.pkg.manifestRel, jsonLine(t.pkg.text, String(w.owner)))}` : `NOT declared by ${t.pkg.manifestRel}`
      }`,
    );
    if (where.length) for (const s of where.slice(0, SHOW)) lines.push(`      imported at ${cite(s.rel, s.line)} as ${JSON.stringify(s.spec)}`);
    else lines.push(`      import site UNVERIFIED — no literal specifier in ${t.rel} resolves to it; it may arrive through a declared package name, a tsconfig "paths" alias or a bundler alias (L-graph judges those)`);
  }

  const grouped = new Map();
  for (const rel of c.external) {
    const name = externalPackageOf(rel) ?? '(no package segment)';
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push(rel);
  }
  lines.push('');
  lines.push(`external (${String(c.external.length)} file(s) in ${String(grouped.size)} package(s)) — grouped; one path each, which is the citable one (it carries the version)`);
  for (const name of [...grouped.keys()].toSorted(byCodepoint)) {
    const files = grouped.get(name);
    const declaredBy = pkgs.allManifests.filter((m) => m.declared?.has(name) === true).map((m) => cite(m.manifestRel, jsonLine(m.text, name)));
    lines.push(`  ${pad(name, 28)} ${pad(`${String(files.length)} file(s)`, 12)} ${files[0]}`);
    lines.push(`      declared by: ${declaredBy.length ? declaredBy.join(', ') : 'NO manifest — it is reached as a transitive package, so no manifest in this repository pins it'}`);
  }

  if (c.foreign.length) {
    lines.push('');
    lines.push(`outside the repository (${String(c.foreign.length)}) — NOT a defect by itself: MEASURED, a checkout whose node_modules is a symlink to another tree reports its externals here, because tsc prints realpaths`);
    for (const abs of c.foreign.slice(0, SHOW)) lines.push(`  ${abs}`);
  }

  lines.push('');
  lines.push(
    `lib (${String(c.libs.length)}) layout=${c.libLayouts.join(',') || 'none'} platform=${c.libPlatforms.join(',') || 'none'} — TypeScript 7 ships them in @typescript/typescript-<platform>/lib/, NOT node_modules/typescript/lib/ (measured)`,
  );
  if (problems.length) {
    lines.push('');
    lines.push(`walk problems (${String(problems.length)}) — a file the import scan could not read is not a file with no imports in it`);
    for (const p of problems) lines.push(`  ${p}`);
  }
  return { ok: true, reason: null, lines };
}

// ------------------------------------------------------------------ 4. exports

/** Declaration keywords a token scan can see after `export`. */
const DECL_WORDS = new Set(['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum', 'namespace', 'module', 'abstract', 'async', 'declare', 'default', 'readonly']);
const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/;

/**
 * Every export declaration of one source text. → { ok, exports, problems }
 *   exports: [{ name, kind, line, quote, spec }]
 *     kind: 'declaration' | 'named' | 'default' | 'star' | 'star-as'
 *     spec: the module a re-export comes from, or null
 *
 * A TOKEN SCAN over `scanSource`-masked code, which is the honest limit of a
 * gate that never parses TypeScript: it reports the NAME, the KIND and the LINE,
 * and quotes the source line so the citation is checkable. It does NOT report a
 * type or a signature — that is `tsc`'s answer, and a signature-level projection
 * is what `docs/digests/` is generated for (package.json:20-21).
 */
export function exportsIn(text, rel) {
  const problems = [];
  const out = [];
  const s = scanSource(text);
  for (const p of s.problems) problems.push(`${rel}: the mask itself may be wrong (${p}) — this file cannot be scanned, so its export surface is UNVERIFIED`);
  if (s.problems.length) return { ok: false, exports: out, problems };

  const code = s.code;
  const literalAt = (from) => {
    for (const lit of s.literals.values()) if (lit.start >= from) return lit;
    return null;
  };
  const re = /\bexport\b/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const start = m.index;
    // `export` inside a longer identifier, or a property named export, is not a
    // declaration: the masked char before it decides.
    const before = start > 0 ? code[start - 1] : '';
    if (/[A-Za-z0-9_$.]/.test(before)) continue;
    const line = lineAt(text, start);
    const quote = quoteAt(text, start);
    let i = start + 'export'.length;
    const skip = () => {
      while (i < code.length && /\s/.test(code[i])) i += 1;
    };
    skip();
    // `{ export: 1 }` — a property whose KEY is the reserved word. Measured on a
    // fixture: the first version reported it as "export followed by something
    // this scan does not recognise", which is a false alarm in an inspector
    // whose alarms are supposed to be worth reading. A `:` after `export` is
    // never a declaration. `export =` is TypeScript's export assignment and IS
    // one, so the two are told apart here rather than lumped together.
    if (code[i] === ':') continue;
    if (code[i] === '=' && code[i + 1] !== '=') {
      out.push({ name: '(export assignment)', kind: 'export-assignment', line, quote, spec: null });
      continue;
    }
    if (code[i] === '*') {
      i += 1;
      skip();
      let name = '*';
      let kind = 'star';
      if (code.slice(i, i + 2) === 'as') {
        i += 2;
        skip();
        const id = IDENT_RE.exec(code.slice(i));
        name = id === null ? '*' : id[0];
        kind = 'star-as';
        i += id === null ? 0 : id.index + id[0].length;
      }
      skip();
      const from = code.slice(i, i + 4) === 'from' ? literalAt(i) : null;
      out.push({ name, kind, line, quote, spec: from?.value ?? null });
      continue;
    }
    let typeOnly = false;
    if (code.slice(i, i + 4) === 'type') {
      const after = i + 4;
      let j = after;
      while (j < code.length && /\s/.test(code[j])) j += 1;
      if (code[j] === '{') {
        typeOnly = true;
        i = j;
      }
    }
    if (code[i] === '{') {
      const close = code.indexOf('}', i);
      if (close === -1) {
        problems.push(`${rel}:${String(line)}: an export list that never closes — the scan stops here, so this file's surface is UNVERIFIED`);
        continue;
      }
      const inner = code.slice(i + 1, close);
      let after = close + 1;
      while (after < code.length && /\s/.test(code[after])) after += 1;
      const from = code.slice(after, after + 4) === 'from' ? literalAt(after) : null;
      for (const piece of inner.split(',')) {
        const words = piece.match(/[A-Za-z_$][A-Za-z0-9_$]*/g);
        if (words === null || !words.length) continue;
        const asAt = words.indexOf('as');
        const name = asAt >= 0 && words[asAt + 1] !== undefined ? words[asAt + 1] : words.at(-1);
        if (name === 'as' || name === undefined) continue;
        out.push({ name, kind: typeOnly ? 'named-type' : 'named', line: lineAt(text, i + 1 + inner.indexOf(name)), quote, spec: from?.value ?? null });
      }
      continue;
    }
    const words = [];
    while (true) {
      const id = IDENT_RE.exec(code.slice(i));
      if (id === null || id.index > 2) break;
      const word = id[0];
      i += id.index + word.length;
      if (word === 'default') {
        words.push(word);
        break;
      }
      if (!DECL_WORDS.has(word)) {
        words.push(word);
        break;
      }
      words.push(word);
      skip();
    }
    if (!words.length) {
      problems.push(`${rel}:${String(line)}: \`export\` followed by something this token scan does not recognise (${JSON.stringify(quote)}) — UNVERIFIED rather than skipped silently`);
      continue;
    }
    const last = words.at(-1);
    if (last === 'default') {
      out.push({ name: 'default', kind: 'default', line, quote, spec: null });
      continue;
    }
    const keywords = words.slice(0, -1).filter((w) => DECL_WORDS.has(w));
    out.push({ name: last, kind: 'declaration', keywords, line, quote, spec: null });
  }
  return { ok: true, exports: out, problems };
}

/** The repo-relative file an `exports` map value points at, or null. */
function exportTargetOf(pkgRel, value) {
  if (typeof value !== 'string') return null;
  if (!value.startsWith('.')) return null;
  return normRel(posix.normalize(posix.join(pkgRel, value)));
}

/**
 * The public surface of a package: the `exports` map first (that is what a
 * dependant may reach), then the declarations behind each entry, then the
 * declarations in files the map does NOT reach — which is a fact worth having,
 * because an exported symbol nobody can import is not part of the surface.
 */
export function cmdExports({ root, pkgs, visible }, token) {
  const t = resolveTarget(pkgs, token);
  if (!t.ok) return unanswered(t.reason);
  if (t.pkg === null) return unanswered(`${t.rel} is not a workspace package — an export surface is a package's, and \`packages\` lists the ones that exist`);
  const pkg = t.pkg;

  const lines = [];
  lines.push(`# project exports ${String(pkg.name)}   dir=${pkg.rel}   (${t.how})   head=${headLine(root)}`);
  lines.push(`scan: token scan over masked source (scanSource) — it reports the NAME, the KIND and the LINE and quotes the source. A SIGNATURE is tsc's answer, never this file's`);

  const entryTargets = new Map();
  const exp = pkg.exports;
  if (exp === null || exp === undefined) {
    lines.push('');
    lines.push(`"exports": NONE declared in ${pkg.manifestRel} — with no map, a dependant may import ANY internal path, so every file below is reachable`);
  } else {
    lines.push('');
    const map = typeof exp === 'string' ? { '.': exp } : exp;
    lines.push(`"exports" map (${String(Object.keys(map).length)} entr(y/ies)) ${cite(pkg.manifestRel, jsonLine(pkg.text, 'exports'))} — this, and only this, is what a dependant may import`);
    for (const [key, value] of Object.entries(map)) {
      const target = exportTargetOf(pkg.rel, value);
      if (target !== null) entryTargets.set(target, key);
      const file = resolveRelativeFile(root, target);
      const state =
        target === null
          ? 'UNVERIFIED — not a relative string; a conditional-exports object is resolved by the bundler, not here'
          : file.found
            ? `${file.path}${file.how === 'as written' ? '' : ` [extensionless: matched ${file.how}]`}`
            : `${target} — NO file there under any source extension: a dependant importing this entry gets nothing`;
      lines.push(`  ${pad(JSON.stringify(key), 14)} -> ${pad(typeof value === 'string' ? value : JSON.stringify(value), 26)} ${state}   ${cite(pkg.manifestRel, jsonLine(pkg.text, key))}`);
    }
  }

  const found = walk(root, { roots: [`${pkg.rel}/src`], exts: SRC_EXTS, visible });
  for (const p of found.problems) lines.push(`walk PROBLEM: ${p}`);
  if (found.missing.length) lines.push(`no ${pkg.rel}/src — the scan below covers ${pkg.rel} instead`);
  const files = found.missing.length ? walk(root, { roots: [pkg.rel], exts: SRC_EXTS, visible }).files : found.files;

  let total = 0;
  const problems = [];
  for (const rel of files.toSorted(byCodepoint)) {
    const r = readText(root, rel);
    if (!r.ok) {
      problems.push(`${r.reason} — a file that could not be read is not a file with no exports`);
      continue;
    }
    const e = exportsIn(r.text, rel);
    problems.push(...e.problems);
    const entry = entryTargets.get(rel);
    lines.push('');
    lines.push(
      `${rel}   ${
        entry === undefined
          ? exp === null || exp === undefined
            ? 'reachable (no "exports" map)'
            : 'NOT an "exports" entry — a dependant cannot import this path directly; what it declares is reachable only through a file that is'
          : `"exports" entry ${JSON.stringify(entry)}`
      }`,
    );
    if (!e.exports.length) {
      lines.push('  (no export declaration found)');
      continue;
    }
    for (const x of e.exports.toSorted((a, b) => a.line - b.line)) {
      total += 1;
      const what = x.kind === 'declaration' ? (x.keywords ?? []).join(' ') || 'declaration' : x.kind;
      lines.push(`  ${pad(x.name, 22)} ${pad(what, 16)} ${cite(rel, x.line)}${x.spec === null ? '' : `   re-export from ${JSON.stringify(x.spec)}`}`);
      lines.push(`      ${x.quote}`);
    }
  }

  lines.push('');
  lines.push(`${String(total)} export declaration(s) across ${String(files.length)} file(s)`);
  if (problems.length) {
    lines.push(`PROBLEMS (${String(problems.length)})`);
    for (const p of problems) lines.push(`  ${p}`);
  }
  return { ok: true, reason: null, lines };
}

// ------------------------------------------------------------------ 5. imports

/**
 * What one module specifier resolves to, as text.
 * → { form, target, owner, note }
 *   form: 'relative' | 'absolute' | 'node-builtin' | 'workspace' | 'external'
 *
 * The relative case uses the SAME arithmetic `lights/graph.mjs:314` uses
 * (`posix.normalize(posix.join(dir, spec))`), and the bare case the same head
 * rule (`@scope/name` keeps two segments). Resolution of a bare specifier to a
 * FILE is not attempted: that is the module resolver's answer, and `files` reads
 * it from tsc instead of guessing it here.
 */
export function resolveSpecifier(spec, fileRel, pkgs) {
  const dir = fileRel.includes('/') ? fileRel.slice(0, fileRel.lastIndexOf('/')) : '';
  if (spec.startsWith('.')) {
    const target = normRel(posix.normalize(posix.join(dir, spec)));
    return { form: 'relative', target, owner: target === null ? null : (ownerOf(target, pkgs)?.name ?? null), note: null };
  }
  if (spec.startsWith('/')) return { form: 'absolute', target: null, owner: null, note: 'an absolute specifier names a path outside any package' };
  if (spec.startsWith(NODE_PREFIX))
    return { form: 'node-builtin', target: null, owner: null, note: 'a node builtin — it does not typecheck inside @cheq/core at all, because that project resolves no ambient types (rule 1)' };
  const head = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : (spec.split('/')[0] ?? spec);
  if (pkgs.byName?.has(head)) return { form: 'workspace', target: pkgs.byName.get(head).rel, owner: head, note: null };
  return { form: 'external', target: null, owner: head, note: null };
}

/** Every module specifier of one file, with its line and what it resolves to. */
export function cmdImports({ root, pkgs }, token) {
  const rel = normRel(token);
  if (rel === null) return unanswered(`${JSON.stringify(String(token))} is not a repo-relative path — pass one, e.g. apps/web/src/main.tsx`);
  const r = readText(root, rel);
  if (!r.ok) return unanswered(`${r.reason} — pass a path that exists in the work tree (use git show HEAD:<path> for a committed version)`);

  const owner = ownerOf(rel, pkgs);
  const cls = classify(rel);
  const lines = [];
  lines.push(`# project imports ${rel}   head=${headLine(root)}`);
  lines.push(`owner=${owner === null ? 'NONE — this path is in no workspace package' : `${String(owner.name)} (${owner.rel})`}   kind=${String(kindOf(rel))}   form=${cls.form}${cls.specId === null ? '' : `   spec=${cls.specId}`}`);
  lines.push(`reader: specifiersOf (tools/gates/lights/graph.mjs:192) — the literals scanSource recorded, kept when a specifier token precedes them`);

  const s = specifiersOf(r.text, rel);
  for (const p of s.problems) lines.push(`PROBLEM: ${p}`);
  if (!s.ok) return { ok: true, reason: null, lines };

  lines.push('');
  lines.push(`${String(s.specifiers.length)} specifier(s)`);
  for (const { spec, line } of s.specifiers) {
    const res = resolveSpecifier(spec, rel, pkgs);
    let where = '';
    if (res.form === 'relative') {
      if (res.target === null) where = 'UNVERIFIED — it does not normalise to a repo-relative path (it climbs above the repository root)';
      else {
        const file = resolveRelativeFile(root, res.target);
        const place = owner === null ? '' : under(res.target, owner.rel) ? ` (inside ${owner.rel})` : ` (OUTSIDE ${owner.rel}, owner=${String(res.owner)})`;
        where = file.found
          ? `${file.path}${file.how === 'as written' ? '' : ` [extensionless: matched ${file.how}]`}${place}`
          : `${res.target} — NO file there under any source extension or /index.*; what the compiler resolved is \`files <pkg>\``;
      }
    } else if (res.form === 'workspace') {
      const declaredAt = owner === null || owner.declared?.has(String(res.owner)) !== true ? null : cite(owner.manifestRel, jsonLine(owner.text, String(res.owner)));
      where = `workspace package ${String(res.owner)} (${String(res.target)}) — ${declaredAt === null ? `NOT declared by ${owner === null ? 'any manifest here' : owner.manifestRel}` : `declared at ${declaredAt}`}`;
    } else if (res.form === 'external') {
      const declaredBy = pkgs.allManifests.filter((m) => m.declared?.has(String(res.owner)) === true).map((m) => cite(m.manifestRel, jsonLine(m.text, String(res.owner))));
      where = `registry package ${String(res.owner)} — ${declaredBy.length ? `declared at ${declaredBy.join(', ')}` : 'declared by NO manifest in this repository'}`;
    } else {
      where = String(res.note);
    }
    lines.push(`  ${cite(rel, line)}   ${pad(JSON.stringify(spec), 34)} ${pad(res.form, 13)} ${where}`);
  }
  lines.push('');
  lines.push('this is the LEXICAL half. What the compiler actually read is `files <pkg>`, and the two disagreeing is itself a fact (L-graph judges that)');
  return { ok: true, reason: null, lines };
}

// ------------------------------------------------------------------- 6. routes

/** The Fastify registration members a route can be written with. */
const ROUTE_METHODS = Object.freeze(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);

/**
 * Candidate HTTP registrations in one source text.
 * → { ok, routes: [{ method, url, line, quote, member, receiver }], problems }
 *
 * A TOKEN SCAN, and conservative on purpose. It keeps `<receiver>.<member>(` and
 * requires the first argument to be a STRING LITERAL, which is what makes
 * `map.get(key)` and `headers.get('x')` not look like routes; the receiver is
 * printed so a reader can see what was matched. Two things it cannot see, and
 * says so instead of guessing: a url or method that is not a literal, and a
 * route registered by a plugin this scan did not open. Fastify's own member
 * names come from its documentation (https://fastify.dev/docs/latest/Reference/Routes/);
 * no member of it is cited here from a `.d.ts`, because rule 15's digest for
 * fastify does not exist yet (TD-0009).
 */
export function routesIn(text, rel) {
  const problems = [];
  const routes = [];
  const s = scanSource(text);
  for (const p of s.problems) problems.push(`${rel}: the mask itself may be wrong (${p}) — this file cannot be scanned, so its route surface is UNVERIFIED`);
  if (s.problems.length) return { ok: false, routes, problems };

  const code = s.code;
  const literals = [...s.literals.values()];
  const firstLiteralIn = (from, to) => literals.find((l) => l.start >= from && l.start < to) ?? null;
  const members = [...ROUTE_METHODS, 'route', 'register'];
  for (const member of members) {
    const re = new RegExp(`\\.${member}\\s*\\(`, 'g');
    let m;
    while ((m = re.exec(code)) !== null) {
      const open = m.index + m[0].length - 1;
      let close = -1;
      let depth = 0;
      for (let i = open; i < code.length; i += 1) {
        if (code[i] === '(') depth += 1;
        else if (code[i] === ')') {
          depth -= 1;
          if (depth === 0) {
            close = i;
            break;
          }
        }
      }
      if (close === -1) {
        problems.push(`${rel}:${String(lineAt(text, open))}: a .${member}( call whose parentheses never close — the scan cannot read its arguments, so this registration is UNVERIFIED`);
        continue;
      }
      // The receiver: the identifier chain before the dot.
      let j = m.index - 1;
      while (j >= 0 && /[A-Za-z0-9_$.\]]/.test(code[j])) j -= 1;
      const receiver = code.slice(j + 1, m.index);
      const line = lineAt(text, m.index);
      const quote = quoteAt(text, m.index);
      const inner = code.slice(open + 1, close);
      const hasSecondArg = /,/.test(inner) || /\{/.test(inner);
      if (member === 'route' || member === 'register') {
        const urlKey = inner.indexOf('url');
        const methodKey = inner.indexOf('method');
        const prefixKey = inner.indexOf('prefix');
        const url = urlKey === -1 ? null : firstLiteralIn(open + 1 + urlKey, close);
        const method = methodKey === -1 ? null : firstLiteralIn(open + 1 + methodKey, close);
        const prefix = prefixKey === -1 ? null : firstLiteralIn(open + 1 + prefixKey, close);
        routes.push({
          member,
          receiver,
          method: method?.value ?? (member === 'register' ? 'plugin' : null),
          url: url?.value ?? prefix?.value ?? null,
          line,
          quote,
          literal: url !== null || prefix !== null,
        });
        continue;
      }
      const lit = firstLiteralIn(open + 1, close);
      if (lit === null || lit.isLiteral !== true) {
        problems.push(
          `${rel}:${String(line)}: ${receiver}.${member}( with no string-literal first argument — either it is not a route (a Map or a Headers has .get too) or its url is computed; a computed url is UNVERIFIED here and belongs in the spec as a question`,
        );
        continue;
      }
      if (!hasSecondArg) {
        problems.push(
          `${rel}:${String(line)}: ${receiver}.${member}(${JSON.stringify(lit.value)}) takes a single argument, so it is NOT counted as a route — a Fastify route takes a handler too, and a one-argument .get( is almost always a Map or a Headers read. Named rather than dropped, so the scan's blind spot is readable`,
        );
        continue;
      }
      routes.push({ member, receiver, method: member.toUpperCase(), url: lit.value, line, quote, literal: true });
    }
  }
  // Both lists in LINE order. The scan walks member by member, so without this
  // a reader gets every `.get(` before every `.post(` and cannot follow the file.
  return { ok: true, routes: routes.toSorted((a, b) => a.line - b.line), problems: problems.toSorted((a, b) => lineOfMessage(a) - lineOfMessage(b)) };
}

/** The HTTP surface of the api app, as far as a token scan can see it. */
export function cmdRoutes({ root, pkgs, visible }) {
  const apiRel = KIND_ROOT.api;
  const pkg = pkgs.byDir?.get(apiRel) ?? null;
  const lines = [];
  lines.push(`# project routes   ${apiRel}   head=${headLine(root)}`);
  lines.push(
    `scan: token scan over ${apiRel}/src for <receiver>.{${ROUTE_METHODS.join(',')},route,register}( with a string-literal url. A computed url, and a route registered inside a plugin this scan did not open, are UNVERIFIED and named, never guessed`,
  );
  if (pkg === null) lines.push(`note: ${apiRel} is not a workspace package — the scan below is about the directory`);

  const found = walk(root, { roots: [`${apiRel}/src`], exts: SRC_EXTS, visible });
  for (const p of found.problems) lines.push(`walk PROBLEM: ${p}`);
  if (found.missing.length) return unanswered(`${apiRel}/src: does not exist — there is no api source tree to scan`);

  const rows = [];
  const problems = [];
  let importsFastify = 0;
  for (const rel of found.files.toSorted(byCodepoint)) {
    const r = readText(root, rel);
    if (!r.ok) {
      problems.push(`${r.reason} — a file that could not be read is not a file with no routes`);
      continue;
    }
    const spec = specifiersOf(r.text, rel);
    if (spec.ok && spec.specifiers.some((x) => x.spec === 'fastify' || x.spec.startsWith('fastify/'))) importsFastify += 1;
    const found2 = routesIn(r.text, rel);
    problems.push(...found2.problems);
    for (const x of found2.routes) rows.push({ ...x, rel });
  }

  lines.push('');
  lines.push(`${String(found.files.length)} source file(s) scanned, ${String(importsFastify)} of them import fastify (declared at ${pkg === null ? 'no manifest' : cite(pkg.manifestRel, jsonLine(pkg.text, 'fastify'))})`);
  if (!rows.length) {
    lines.push(`0 route registration(s) — the HTTP surface of ${pkg === null ? apiRel : String(pkg.name)} is EMPTY today`);
    lines.push(`a spec that needs a route names its home with \`home: route: <path>\` and the route arrives with that spec; an adapter with no spec behind it would be invented behaviour (${apiRel}/src/index.ts:1)`);
  } else {
    lines.push(`${String(rows.length)} registration(s)`);
    lines.push(`  ${pad('METHOD', 8)} ${pad('URL', 30)} ${pad('WRITTEN AS', 18)} WHERE`);
    for (const x of rows)
      lines.push(
        `  ${pad(x.method ?? 'UNVERIFIED', 8)} ${pad(x.url ?? 'UNVERIFIED — no literal url in the call', 30)} ${pad(`${x.receiver}.${x.member}(`, 18)} ${cite(x.rel, x.line)}`,
      );
    for (const x of rows) lines.push(`      ${cite(x.rel, x.line)}   ${x.quote}`);
  }
  if (problems.length) {
    lines.push('');
    lines.push(`UNVERIFIED / not counted (${String(problems.length)})`);
    for (const p of problems) lines.push(`  ${p}`);
  }
  return { ok: true, reason: null, lines };
}

// --------------------------------------------------------------------- 7. deps

/**
 * The state of rule 15's API digest for one dependency.
 * → { rel, state }
 *
 * The work tree and HEAD are DIFFERENT facts and both are reported: rule 15
 * requires the digest in the same COMMIT as the `package:` trailer, so a digest
 * that exists only as an untracked file satisfies a reader and not the rule.
 * L-deps is what judges it; this line is what tells an agent which of the two
 * situations it is looking at.
 */
export function digestState(root, name, { workspace = false, runtime = false } = {}) {
  const rel = `${VENDOR_DIR}/${String(name).replace(/\//g, '-')}.md`;
  if (workspace) return { rel, state: `none owed: ${name} is this repository's own code, and its surface is \`exports ${name}\`` };
  const onDisk = existsSync(join(root, rel));
  const atHead = existsAtHead(rel, { cwd: root });
  if (onDisk && atHead) return { rel, state: `${rel} — cite its members from there and nowhere else; a member nobody can cite is UNVERIFIED (a question in the spec, never a call)` };
  if (onDisk) return { rel, state: `${rel} exists in the work tree but is NOT tracked at HEAD — rule 15 wants it in the same commit as the \`package:\` trailer, so it is not yet declared` };
  if (runtime) return { rel, state: `${rel}: ABSENT, and ${name} is a RUNTIME dependency — write it before the first call; L-deps fails on this and TD-0009 records the debt` };
  return { rel, state: `none owed — ${name} is a devDependency, a TOOL whose artifacts the gates read (docs/vendor/README.md:17)` };
}

/** Lines of the lockfile on which `name` appears as a key, 1-based. A LINE
 * LOCATOR, not a second lock reader: it claims only "the name is written here",
 * and the structure is `parseLockImporters`'s answer. */
export function lockKeyLines(text, name) {
  const want = `${name}:`;
  const out = [];
  String(text ?? '')
    .split('\n')
    .forEach((l, i) => {
      const t = l.trim();
      if (t === want || t === `'${name}':` || t === `"${name}":`) out.push(i + 1);
    });
  return out;
}

/** Who imports `name`, as `path:line`, across every workspace package. */
function importersOf(root, pkgs, visible, name) {
  const hits = [];
  for (const pkg of pkgs.packages) {
    const { sites } = importSites(root, pkg.rel, visible);
    for (const [key, where] of sites) {
      const head = key.startsWith('@') ? key.split('/').slice(0, 2).join('/') : (key.split('/')[0] ?? key);
      if (key !== name && head !== name) continue;
      for (const s of where) hits.push({ ...s, pkg: pkg.name });
    }
  }
  return hits.toSorted((a, b) => byCodepoint(`${a.rel}:${String(a.line)}`, `${b.rel}:${String(b.line)}`));
}

/**
 * `deps` — every declared dependency with its line, plus the reverse index.
 * `deps --why <name>` — the four facts about one: who declares it, what the lock
 * AT HEAD resolved, whether rule 15's digest exists, and who imports it.
 */
export function cmdDeps({ root, pkgs, visible }, why) {
  const lines = [];
  const lockAtHead = showAtHead(LOCK, { cwd: root });
  const importers = lockAtHead.ok ? parseLockImporters(lockAtHead.text) : null;

  if (why === null || why === undefined) {
    lines.push(`# project deps   head=${headLine(root)}`);
    lines.push(`declared sets come from the MANIFESTS; resolved versions come from ${LOCK} AT HEAD (git show HEAD:${LOCK}), which is the lock a base checkout installs from (ADR-0003)`);
    if (!lockAtHead.ok) lines.push(`lock at HEAD: UNVERIFIED — ${String(lockAtHead.reason)}`);
    const index = new Map();
    for (const m of pkgs.allManifests) {
      for (const [name, d] of m.declared ?? new Map()) {
        if (!index.has(name)) index.set(name, []);
        index.get(name).push({ m, ...d });
      }
    }
    lines.push('');
    lines.push(
      `${String(index.size)} distinct dependency name(s) across ${String(pkgs.allManifests.length)} manifest(s). A digest line appears only where rule 15 owes one: a devDependency owes none, and that asymmetry is deliberate (docs/vendor/README.md:17)`,
    );
    for (const name of [...index.keys()].toSorted(byCodepoint)) {
      const rows = index.get(name);
      const workspace = pkgs.byName?.has(name) === true;
      const runtime = rows.some((r) => r.kind === 'dependencies');
      lines.push(`  ${pad(name, 26)} ${rows.map((r) => `${pad(GROUP_WORD[r.kind] ?? r.kind, 8)}${r.spec} ${cite(r.m.manifestRel, jsonLine(r.m.text, name))}`).join('   ')}`);
      if (runtime && !workspace) lines.push(`      digest: ${digestState(root, name, { workspace, runtime }).state}`);
    }
    lines.push('');
    lines.push(`ask about one of them with: node tools/gates/project.mjs deps --why <name>`);
    return { ok: true, reason: null, lines };
  }

  const name = String(why);
  lines.push(`# project deps --why ${name}   head=${headLine(root)}`);
  const ws = pkgs.byName?.get(name) ?? null;
  if (ws !== null) lines.push(`${name} is a WORKSPACE package (${ws.rel}, ${ws.manifestRel}) — an edge, judged by L-graph against ADR-0001, not a registry dependency`);

  const declaring = pkgs.allManifests.filter((m) => m.declared?.has(name) === true);
  lines.push('');
  lines.push(`declared by (${String(declaring.length)})`);
  if (!declaring.length) lines.push(`  NO manifest in this repository declares ${name}. If it is imported anyway it arrives transitively, and nothing here pins its version`);
  for (const m of declaring) {
    const d = m.declared.get(name);
    lines.push(`  ${pad(cite(m.manifestRel, jsonLine(m.text, name)), 36)} ${pad(`${GROUP_WORD[d.kind] ?? d.kind} ("${d.kind}")`, 26)} ${d.spec}`);
  }

  lines.push('');
  lines.push(`lock AT HEAD (git show HEAD:${LOCK}; reader: parseLockImporters, tools/gates/status.mjs:127)`);
  if (importers === null) lines.push(`  UNVERIFIED — ${String(lockAtHead.reason)}`);
  else {
    let seen = 0;
    for (const [importer, deps] of Object.entries(importers).toSorted((a, b) => byCodepoint(a[0], b[0]))) {
      const d = deps[name];
      if (d === undefined) continue;
      seen += 1;
      lines.push(`  importer ${pad(importer, 16)} specifier ${pad(String(d.specifier), 16)} version ${pad(String(d.version), 14)} ${d.dev ? 'devDependencies' : 'dependencies'}`);
    }
    if (seen === 0) lines.push(`  no importer in the lock at HEAD lists ${name} — so a base checkout installs it only as a transitive package, if at all`);
    const atHead = lockAtHead.ok ? lockKeyLines(lockAtHead.text, name) : [];
    lines.push(
      `  the name is written as a key at ${
        atHead.length
          ? `${LOCK} line(s) ${atHead.slice(0, SHOW).join(', ')}${atHead.length > SHOW ? ` (+${String(atHead.length - SHOW)} more)` : ''}`
          : `no line of ${LOCK} — it is not written there at all`
      } (a LINE LOCATOR, which claims only that the name is there; the structure above is parseLockImporters' answer)`,
    );
  }

  const runtime = declaring.some((m) => m.declared.get(name).kind === 'dependencies');
  lines.push('');
  lines.push(`API digest (rule 15, docs/vendor/README.md:13)`);
  lines.push(`  ${digestState(root, name, { workspace: ws !== null, runtime }).state}`);

  const hits = importersOf(root, pkgs, visible, name);
  lines.push('');
  lines.push(`import sites (${String(hits.length)}) — token scan over every workspace package's sources`);
  if (!hits.length) lines.push(`  nothing in the workspace imports ${name} by a literal specifier today`);
  for (const h of hits) lines.push(`  ${pad(cite(h.rel, h.line), 44)} in ${pad(String(h.pkg), 12)} as ${JSON.stringify(h.spec)}`);
  return { ok: true, reason: null, lines };
}

// ----------------------------------------------------------------- the process

/** Route one parsed argument vector to its subcommand. → { ok, reason, lines } */
export function run(args, ctx) {
  switch (args.cmd) {
    case 'packages':
      return cmdPackages(ctx);
    case 'config':
      return cmdConfig(ctx, args.target);
    case 'files':
      return cmdFiles(ctx, args.target);
    case 'exports':
      return cmdExports(ctx, args.target);
    case 'imports':
      return cmdImports(ctx, args.target);
    case 'routes':
      return cmdRoutes(ctx);
    case 'deps':
      return cmdDeps(ctx, args.why);
    default:
      return unanswered(`no implementation for subcommand ${JSON.stringify(String(args.cmd))} — SUBCOMMANDS lists it, so one of the two is wrong (tools/gates/project.mjs)`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help === true) {
    process.stdout.write(`${HELP}\n`);
    process.exit(0);
  }
  if (args.error !== undefined) {
    process.stdout.write(`UNANSWERED: ${args.error}\n\n${HELP}\n`);
    process.exit(2);
  }
  const rr = repoRoot();
  if (!rr.ok) {
    process.stdout.write(`UNANSWERED: not a git repository (${String(rr.reason)}) — every path this inspector prints is repo-relative, so without a root there is nothing to cite\n`);
    process.exit(2);
  }
  process.chdir(rr.root);
  const r = run(args, context(resolve(rr.root)));
  if (!r.ok) {
    process.stdout.write(`UNANSWERED: ${String(r.reason)}\n`);
    process.exit(2);
  }
  for (const line of r.lines) process.stdout.write(`${line}\n`);
  process.exit(0);
}

// Importable without side effects, so a probe can call a subcommand on a planted
// fixture and assert the ANSWER rather than parse a terminal (rule 5 of the
// gate contract; `status.mjs:584` does the same).
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
