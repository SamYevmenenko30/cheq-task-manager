#!/usr/bin/env node
/**
 * digest.mjs — the GENERATOR AND THE JUDGE of everything `tools/gates/generated.json`
 * declares. One body of code renders a projection; `--fix` writes it, `--check` reports,
 * `--render <dir>` hands a copy to `L-generated`. Nothing re-implements the rendering, so
 * "the digest is current" is a statement about the sources rather than a statement that two
 * hand-written renderers happen to agree.
 *
 *     node tools/gates/digest.mjs --check            # report; exit 1 when a file is stale
 *     node tools/gates/digest.mjs --fix              # rewrite docs/digests/
 *     node tools/gates/digest.mjs --render <dir>     # write under <dir>, touch nothing else
 *
 * Zero dependencies, Node 22 ESM: `node:` builtins plus relative imports, so this runs in a
 * fresh worktree before an install finishes — which is load-bearing, see DETERMINISM below.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * HOW THE EXPORTS ARE OBTAINED, AND WHY NOT WITH tsc
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Two routes were available. The choice, and the reason, belong here rather than in a
 * reviewer's head:
 *
 *  A. `tsc --noEmit --listFiles` plus a TOKEN SCAN over the masked source (`scanSource` from
 *     `lib/test-cases.mjs`, the one mask this repository has).
 *  B. importing the package through `tsx` and reading `Object.keys` of the namespace.
 *
 * THIS FILE TAKES THE TOKEN SCAN, AND TAKES IT WITHOUT tsc. Three reasons, in order of
 * weight:
 *
 *  1. DETERMINISM IS THE HARD REQUIREMENT (generated.json "_note"). A projection whose bytes
 *     depend on whether `node_modules` is installed, on which platform package `@typescript/
 *     typescript-<platform>` resolved, or on what a loader did at runtime, makes `L-generated`
 *     BLINK — and a blinking hard light gets switched off. The token scan reads committed text
 *     and nothing else, so the same tree renders the same bytes in a worktree with no install,
 *     on another machine, and inside `L-generated`'s tmpdir.
 *  2. ROUTE B CANNOT SEE A TYPE. `interface`, `type` and the signature of a function are gone
 *     by the time a module is a runtime namespace — and the signature is most of what a reader
 *     of a surface digest wants. It also EXECUTES the package to describe it, which is a
 *     different kind of act from reading it.
 *  3. A GATE NEVER PARSES TypeScript ITSELF (rule: questions about types go to `tsc`). A token
 *     scan over masked source is the one exception this repository already made and already
 *     relies on — `L-testshape`, `L-core-purity`, `L-stubkit` and `L-orphans` all stand on it.
 *     This file reuses that scanner rather than adding a second one, and it reuses
 *     `readSpecifiers` / `resolveRelative` / `importGraph` from `lights/orphans.mjs` for the
 *     same reason: one reader per fact. No AST is built here.
 *
 * WHAT THE CHOICE COSTS, said out loud in the rendered file as well as here — a projection
 * that quietly omitted these would be worse than no projection:
 *
 *  - NO TYPE INFERENCE. A `const` with no annotation is shown AS WRITTEN, not as the type
 *    `tsc` would infer for it. The signature is source text, not a resolved type.
 *  - `export * from '<package>'` (a non-relative star) cannot be expanded: the names live in
 *    another package's files. It is NAMED in the projection, never silently dropped.
 *  - A CONDITIONAL `exports` subpath is listed with every condition's target and resolved to
 *    none, because which one applies is the importer's question.
 *  - DECLARATION MERGING, overload sets and `namespace` are listed entry by entry as the text
 *    writes them, not merged into one symbol.
 *  - Reachability is reported from the STATIC relative import graph. A dynamic
 *    `import(expr)` is invisible to a token scan, and that is exactly why
 *    `L-core-purity` refuses one inside the core.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * DETERMINISM — the rules every renderer in this file obeys
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  - NO TIMESTAMP, no tool version, no machine name, no absolute path. `--render` is handed an
 *    absolute output directory and never writes one into a file.
 *  - ONE SORT ORDER: `byCodepoint` from `lights/_shared.mjs`. `localeCompare` is machine state
 *    (it differs by ICU data and locale) and is not used anywhere here.
 *  - The staleness key is CONTENT, never mtime: `sha256` per input file plus one `sha256` over
 *    the sorted `<path> <sha256>` lines. `git checkout` and a restored cache rewrite mtime to
 *    "now"; they do not change content.
 *  - `FORMAT` is bumped whenever the rendering changes. That makes every digest stale until one
 *    `--fix`, so a rendering change is ONE VISIBLE COMMIT across the tree instead of a quiet
 *    drift nobody reviews. It is in the rendered bytes for exactly that reason.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * TWO KINDS OF PROBLEM, AND WHY THEY DO NOT SHARE AN EXIT CODE
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  - A HARD problem means no bytes can be produced at all: the manifest does not parse, a
 *    declared source root is absent, a source file is unreadable, the walk met a symlink.
 *    Nothing is written, the exit code is `EXIT_REFUSED`, and `L-generated` then reads
 *    cannot-verify — which is the honest answer, since the projection could not be derived.
 *  - A SOFT note means something the scan could not resolve: an unexpanded star re-export, a
 *    route path that is not a literal, a signature the scanner would have to guess at. The file
 *    IS written and CARRIES the note, because a note inside the committed projection is louder
 *    than a note in a terminal nobody kept. `L-generated` stays green: the projection is
 *    current, and what it cannot see is part of what it says.
 *
 * `--check` compares against the WORK TREE (the developer's question: did I forget `--fix`?)
 * and additionally reports when HEAD disagrees with a work-tree file that is current.
 * `L-generated` is the one that compares against HEAD, and it says why in its own header.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasCommits, showAtHead } from './lib/git.mjs';
import { byCodepoint, jsonLine, normRel, ownerOf, readGenerated, readPackages, readVisible, scanSource, walk } from './lights/_shared.mjs';
import { importGraph, resolveRelative } from './lights/orphans.mjs';

// --------------------------------------------------------------------- constants

/**
 * The rendering version, IN THE RENDERED BYTES. Bump it in the same commit as any change to a
 * renderer below: every digest then differs from its committed copy, `L-generated` fails, and
 * one `--fix` brings the whole tree over in a single reviewable commit. A rendering change
 * without a bump is a silent drift — the digests of files nobody touched stay as they were and
 * the two halves of the tree disagree about what a projection looks like.
 *
 * A bump is owed only once a projection EXISTS AT HEAD: before the first commit there is no
 * committed copy to bring over, so the renderers and `FORMAT: 1` land together. `L-generated`
 * reads HEAD, which is the same boundary.
 */
export const FORMAT = 1;

/** The flag `L-generated` passes (`lights/generated.mjs` → `RENDER_FLAG`). Spelled here too
 * because this side has to accept it; the two are compared by a gate-probe, not by trust. */
export const RENDER_FLAG = '--render';

/** The repository this script belongs to, derived from the script's OWN location
 * (`<root>/tools/gates/digest.mjs`) and not from `process.cwd()`. `L-generated` spawns this
 * file with `cwd` at the root, but a projection that changed meaning with the caller's working
 * directory would be machine state. `--root <dir>` overrides it — that is how a fixture tree is
 * rendered without planting anything in the work tree. */
export const SELF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const EXIT_OK = 0;
/** A stale or missing file under `--check`: the tree is not what the sources say. */
export const EXIT_STALE = 1;
/** A hard problem: nothing was written and nothing is claimed. */
export const EXIT_REFUSED = 2;

/** How much of a one-line signature is kept. A fixed number, so the same declaration renders
 * the same width on every machine; the full text is in the file the row cites. */
export const SIGNATURE_WIDTH = 120;

/** How many symbol names an entry-point row names before it says `(+n more)`. The full list is
 * always in the surface table directly below, so the cap loses nothing. */
export const SYMBOLS_SHOWN = 12;

/** How far past a parameter list a return type may run before the scanner gives up and says so
 * rather than guessing where a declaration ends. */
const DECLARATION_WINDOW = 4000;

export const USAGE = `Usage: node tools/gates/digest.mjs (--check | --fix | ${RENDER_FLAG} <dir>) [--root <dir>]

  --check          render in memory and compare with the work tree; exit ${String(EXIT_STALE)} when a file is stale
  --fix            write every projection tools/gates/generated.json declares
  ${RENDER_FLAG} <dir>   write every projection under <dir> at its own repo-relative path and
                   touch nothing else — the contract L-generated calls (lights/generated.mjs)
  --root <dir>     the repository to read (default: the one this script lives in)

Exit codes: ${String(EXIT_OK)} done · ${String(EXIT_STALE)} a file is stale (--check only) · ${String(EXIT_REFUSED)} refused, nothing written`;

// ----------------------------------------------------------------------- basics

/** Lowercase hex sha256 of a Buffer or string. `node:crypto` is a builtin, so this adds no
 * dependency; `packages/core/src/testing/sha256.ts` is TypeScript and belongs to the product,
 * not to a gate. */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** The first 1-based line of `offset` in `text`. Every `path:line` in a projection is this. */
export function lineOf(text, offset) {
  return String(text).slice(0, Math.max(0, offset)).split('\n').length;
}

const collapse = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** One line of at most `width` characters, with an ellipsis when it was longer. */
export function clip(s, width = SIGNATURE_WIDTH) {
  const one = collapse(s);
  return one.length > width ? `${one.slice(0, width - 1)}…` : one;
}

/** A markdown table cell. A pipe inside a union type (`A | B`) would end the cell. */
export function cell(s) {
  return collapse(s).replaceAll('|', '\\|');
}

/** `` `x` `` or an em dash for nothing — so an empty cell is a statement, not a gap. */
const code = (s) => (s === null || s === undefined || String(s) === '' ? '—' : `\`${String(s)}\``);

const plural = (n, one, many) => `${String(n)} ${n === 1 ? one : many}`;

// -------------------------------------------------------------- the content key

/**
 * The staleness key of a projection: one `sha256` per input file, and one over all of them.
 *
 * → { combined, files: [{ rel, sha }], problems }
 *
 * `roots` are the declared `sourceRoots`; `extraFiles` are the inputs that are NOT under them
 * and that the projection still depends on (a package manifest, say). Both are hashed, because
 * a key that omitted an input would leave the projection able to go stale in silence — which is
 * the one failure mode this whole file exists to prevent.
 *
 * Every file under a root is hashed, whatever its extension: only `.ts`/`.tsx` are SCANNED, but
 * a `.json` appearing next to them changes what the directory is and must make the key move.
 */
export function contentKey(root, { roots = [], extraFiles = [], visible = null } = {}) {
  const problems = [];
  const w = walk(root, { roots, visible });
  problems.push(...w.problems);
  for (const m of w.missing)
    problems.push(`${m}: declared a source root and does not exist — a projection of an absent directory is not an empty projection`);

  const rels = new Set(w.files);
  for (const f of extraFiles) {
    const rel = normRel(f);
    if (rel === null) continue;
    if (!existsSync(join(root, rel))) {
      problems.push(`${rel}: an input of this projection and does not exist`);
      continue;
    }
    rels.add(rel);
  }

  const files = [];
  for (const rel of [...rels].toSorted(byCodepoint)) {
    try {
      files.push({ rel, sha: sha256(readFileSync(join(root, rel))) });
    } catch (e) {
      problems.push(`${rel}: unreadable (${String(e.message)}) — the content key cannot be computed without it`);
    }
  }
  const lines = files.map((f) => `${f.rel} ${f.sha}\n`).join('');
  return { combined: sha256(lines), files, problems };
}

// ------------------------------------------------------------- the token scanner

const IDENT_CHAR = /[\w$]/;
const WS = /\s/;
const CLOSERS = Object.freeze({ '(': ')', '[': ']', '{': '}' });

const skipWs = (src, i) => {
  let j = i;
  while (j < src.length && WS.test(src[j])) j += 1;
  return j;
};

/** The identifier at or after `i`, skipping whitespace. `word` is `''` when the next character
 * cannot start one, and `start` then points AT that character. */
export function wordAt(src, i) {
  const start = skipWs(src, i);
  let j = start;
  while (j < src.length && IDENT_CHAR.test(src[j])) j += 1;
  return { word: src.slice(start, j), start, end: j };
}

/** The offset of the bracket closing the one at `open`, or -1. Masked text only: a bracket
 * inside a string or a comment has already become a space. */
export function matchBracket(src, open) {
  const close = CLOSERS[src[open]];
  if (close === undefined) return -1;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === src[open]) depth += 1;
    else if (src[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The last non-whitespace character before `i`. */
const prevNonWs = (src, i) => {
  let j = i - 1;
  while (j >= 0 && WS.test(src[j])) j -= 1;
  return j < 0 ? '' : src[j];
};

/** A line break does not end a statement after one of these — the ASI shapes that matter for
 * reading a declaration off masked text. */
const CONTINUES = new Set(['=', ',', '.', '(', '[', '{', '+', '-', '*', '/', '|', '&', '?', ':', '<', '>']);

/**
 * Where the statement starting at `from` ends: the `;` at depth 0, the line break that is not a
 * continuation, or the closing bracket of the region it sits in.
 *
 * → { end, kind: 'semicolon' | 'line' | 'region' | 'eof' }
 */
export function statementEnd(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') {
      depth += 1;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth < 0) return { end: i, kind: 'region' };
      continue;
    }
    if (depth !== 0) continue;
    if (c === ';') return { end: i, kind: 'semicolon' };
    if (c === '\n' && !CONTINUES.has(prevNonWs(src, i))) return { end: i, kind: 'line' };
  }
  return { end: src.length, kind: 'eof' };
}

/** After a `{…}` at depth 0, these say the type expression is still going, so the braces were a
 * return type rather than the body. `{` is in the set: `(): {a: 1} {` has two of them. */
const TYPE_CONTINUES = new Set(['|', '&', '>', ',', ')', ']', '=', '?', ':', '[', '.', '{', '<']);

/**
 * Where a function declaration's SIGNATURE ends — the body brace, or the `;` of a bodiless
 * declaration (`declare`, an overload).
 *
 * → { end, kind: 'body' | 'semicolon' | 'unknown' }
 *
 * `unknown` is the honest answer when the window ran out or the braces did not balance: the
 * caller renders no signature and records a note. Guessing here would print a signature that is
 * wrong, which is worse than printing that it could not be derived.
 */
export function signatureEnd(src, afterParams) {
  const limit = Math.min(src.length, afterParams + DECLARATION_WINDOW);
  let depth = 0;
  let i = afterParams;
  while (i < limit) {
    const c = src[i];
    if (c === '(' || c === '[') {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === ')' || c === ']') {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth === 0 && c === ';') return { end: i, kind: 'semicolon' };
    if (depth === 0 && c === '{') {
      const close = matchBracket(src, i);
      if (close < 0) return { end: i, kind: 'unknown' };
      const next = skipWs(src, close + 1);
      const nc = src[next];
      if (nc === ';') return { end: next, kind: 'semicolon' };
      if (nc !== undefined && TYPE_CONTINUES.has(nc)) {
        i = close + 1;
        continue;
      }
      return { end: i, kind: 'body' };
    }
    i += 1;
  }
  return { end: limit, kind: 'unknown' };
}

/** The literal `scanSource` recorded at or after `from`, or null. The literals map is how a
 * token scan recovers a string it masked away. */
function literalAt(scan, from) {
  let best = null;
  for (const lit of scan.literals.values()) {
    if (lit.start < from) continue;
    if (best === null || lit.start < best.start) best = lit;
  }
  return best;
}

/** `{ a, b as c, type d }` → the names the block EXPORTS (`c`, not `b`). */
export function bindingNames(inner) {
  const out = [];
  for (const raw of inner.split(',')) {
    const item = collapse(raw).replace(/^type\s+/, '');
    if (item === '') continue;
    const as = /\bas\b/.exec(item);
    const name = as === null ? item : collapse(item.slice(as.index + as[0].length));
    if (name !== '') out.push({ name, local: as === null ? item : collapse(item.slice(0, as.index)) });
  }
  return out;
}

const DECLARATION_KEYWORDS = new Set(['function', 'class', 'interface', 'type', 'enum', 'const', 'let', 'var', 'namespace', 'module']);
const EXPORT_SITE = /(?:^|[^\w$.])export(?![\w$])/g;

/**
 * Every `export` in one source.
 *
 * → { ok, problems, declarations, reexports }
 *
 *   `declarations`  `[{ name, kind, signature, line, note }]` — declared here.
 *   `reexports`     `[{ names, spec, star, namespace, typeOnly, line, note }]` — forwarded from
 *                   another module. `star: true` with `namespace: null` is `export * from`,
 *                   whose names live in the other module and are resolved by the caller when
 *                   the specifier is relative.
 *
 * The scan runs on MASKED source (`scanSource`), so an `export` inside a comment or a string is
 * not one; every signature is sliced from the RAW text at the offsets the mask preserved, so
 * what a reader sees is what the file says.
 */
export function scanExports(text) {
  const raw = String(text);
  const scan = scanSource(raw);
  if (scan.problems.length > 0)
    return {
      ok: false,
      problems: scan.problems.map((p) => `the source mask may be wrong (${p}) — no export of this file is claimed`),
      declarations: [],
      reexports: [],
    };

  const src = scan.code;
  const problems = [];
  const declarations = [];
  const reexports = [];

  const sliceSig = (from, to) => clip(raw.slice(from, Math.max(from, to)));

  EXPORT_SITE.lastIndex = 0;
  let m;
  while ((m = EXPORT_SITE.exec(src)) !== null) {
    const after = m.index + m[0].length;
    const line = lineOf(raw, m.index + m[0].length - 'export'.length);
    const where = `line ${String(line)}`;

    // The modifiers that may stand between `export` and the thing exported.
    let cursor = after;
    let isDefault = false;
    const modifiers = [];
    for (;;) {
      const w = wordAt(src, cursor);
      if (w.word === 'declare' || w.word === 'abstract' || w.word === 'async') {
        modifiers.push(w.word);
        cursor = w.end;
        continue;
      }
      if (w.word === 'default') {
        isDefault = true;
        cursor = w.end;
      }
      break;
    }

    const kw = wordAt(src, cursor);
    const head = kw.start;
    const headChar = src[head];

    // ---- `export * …` and `export { … }`, with or without `from`.
    const isTypeOnlyBlock = kw.word === 'type' && ['{', '*'].includes(src[skipWs(src, kw.end)]);
    if (headChar === '*' || headChar === '{' || isTypeOnlyBlock) {
      const blockStart = isTypeOnlyBlock ? skipWs(src, kw.end) : head;
      let names = [];
      let star = false;
      let namespace = null;
      let tail = blockStart;
      if (src[blockStart] === '*') {
        star = true;
        const asWord = wordAt(src, blockStart + 1);
        if (asWord.word === 'as') {
          const ns = wordAt(src, asWord.end);
          namespace = ns.word === '' ? null : ns.word;
          tail = ns.end;
        } else {
          tail = blockStart + 1;
        }
      } else {
        const close = matchBracket(src, blockStart);
        if (close < 0) {
          problems.push(`${where}: an \`export { … }\` block whose brace never closes in the masked source — nothing is claimed about it`);
          continue;
        }
        names = bindingNames(src.slice(blockStart + 1, close));
        tail = close + 1;
      }
      const fromWord = wordAt(src, tail);
      if (fromWord.word !== 'from') {
        // `export { a, b }` with no `from`: the names are declared elsewhere in this file, so
        // they are recorded as declarations with the declaration site left to the reader. The
        // signature is the block itself, which is what the file actually says here.
        for (const n of names)
          declarations.push({
            name: n.name,
            kind: 'local re-export',
            signature: sliceSig(blockStart, tail),
            line,
            note:
              `exported by name here${n.local === n.name ? '' : ` from the local \`${n.local}\``}; the declaration is elsewhere in the same file and this scan does not link the two, ` +
              'so the signature column holds the export block rather than the declaration',
          });
        if (star) problems.push(`${where}: \`export *\` with no \`from\` is not a form this scanner reads`);
        continue;
      }
      const lit = literalAt(scan, fromWord.end);
      if (lit === null || lit.isLiteral !== true || typeof lit.value !== 'string') {
        problems.push(`${where}: the module specifier after \`from\` is not a string literal — a token scan cannot follow it`);
        continue;
      }
      reexports.push({ names, spec: lit.value, star, namespace, typeOnly: isTypeOnlyBlock, line, note: null });
      continue;
    }

    if (isDefault) {
      const end = statementEnd(src, cursor);
      declarations.push({ name: 'default', kind: 'default export', signature: sliceSig(cursor, end.end), line, note: null });
      continue;
    }

    if (!DECLARATION_KEYWORDS.has(kw.word)) {
      if (kw.word !== '') problems.push(`${where}: \`export ${kw.word}\` is not a form this scanner reads`);
      continue;
    }

    // ---- `export const enum E` reads as an enum, and its signature keeps the `const`.
    let keyword = kw.word;
    let pos = kw.end;
    if (keyword === 'const') {
      const next = wordAt(src, pos);
      if (next.word === 'enum') {
        keyword = 'enum';
        pos = next.end;
      }
    }

    if (keyword === 'function') {
      let name = wordAt(src, pos);
      if (src[name.start] === '*') name = wordAt(src, name.start + 1);
      if (name.word === '') {
        problems.push(`${where}: \`export function\` with no name is not a form this scanner reads`);
        continue;
      }
      const open = src.indexOf('(', name.end);
      if (open < 0) {
        problems.push(`${where}: \`export function ${name.word}\` with no parameter list in the masked source`);
        continue;
      }
      const closeParen = matchBracket(src, open);
      if (closeParen < 0) {
        problems.push(`${where}: the parameter list of \`${name.word}\` never closes in the masked source`);
        continue;
      }
      const sig = signatureEnd(src, closeParen + 1);
      declarations.push({
        name: name.word,
        kind: [...modifiers, 'function'].join(' '),
        signature: sig.kind === 'unknown' ? null : sliceSig(head, sig.end),
        line,
        note:
          sig.kind === 'unknown'
            ? `the end of this declaration could not be located in the masked source, so no signature is claimed — read ${String(line)} in the file`
            : null,
      });
      continue;
    }

    if (keyword === 'const' || keyword === 'let' || keyword === 'var') {
      const end = statementEnd(src, pos);
      // One `export const a = 1, b = 2;` is several declarators. Split at depth 0 only.
      const region = src.slice(pos, end.end);
      const parts = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < region.length; i += 1) {
        const c = region[i];
        if (c === '(' || c === '[' || c === '{') depth += 1;
        else if (c === ')' || c === ']' || c === '}') depth -= 1;
        else if (c === ',' && depth === 0) {
          parts.push([start, i]);
          start = i + 1;
        }
      }
      parts.push([start, region.length]);
      for (const [a, b] of parts) {
        const name = wordAt(src, pos + a);
        if (name.word === '') {
          problems.push(`${where}: \`export ${keyword}\` binds a destructuring pattern, which this scanner does not name — declare the symbols one by one`);
          continue;
        }
        // An arrow initialiser would drag its whole body into the row; cut at the arrow.
        const declText = raw.slice(pos + a, pos + b);
        const declCode = src.slice(pos + a, pos + b);
        let arrowDepth = 0;
        let arrow = -1;
        for (let i = 0; i < declCode.length - 1; i += 1) {
          const c = declCode[i];
          if (c === '(' || c === '[' || c === '{') arrowDepth += 1;
          else if (c === ')' || c === ']' || c === '}') arrowDepth -= 1;
          else if (arrowDepth === 0 && c === '=' && declCode[i + 1] === '>') {
            arrow = i + 2;
            break;
          }
        }
        const body = arrow < 0 ? declText : `${declText.slice(0, arrow)} …`;
        declarations.push({
          name: name.word,
          kind: [...modifiers, keyword].join(' '),
          signature: clip(`${keyword} ${collapse(body)}`),
          line: lineOf(raw, name.start),
          note: null,
        });
      }
      continue;
    }

    // ---- class, interface, type, enum, namespace, module
    const name = wordAt(src, pos);
    if (name.word === '') {
      problems.push(`${where}: \`export ${keyword}\` with no name is not a form this scanner reads`);
      continue;
    }
    const brace = src.indexOf('{', name.end);
    const semi = statementEnd(src, name.end);
    const stop = keyword === 'type' ? semi.end : brace < 0 || brace > semi.end ? semi.end : brace;
    declarations.push({
      name: name.word,
      kind: [...modifiers, keyword].join(' '),
      signature: sliceSig(head, stop),
      line,
      note: null,
    });
  }

  return { ok: problems.length === 0, problems, declarations, reexports };
}

// -------------------------------------------------------------- the exports map

/**
 * The entry points a package `exports` map declares.
 *
 * → { entries: [{ specifier, subpath, target, at, conditions, note }], problems }
 *
 * `target` is REPO-RELATIVE or null when nothing on disk answers to it. A conditional subpath
 * yields one entry per condition and says so: which condition applies is the importer's
 * question, and a projection that picked one would be asserting the importer's configuration.
 */
export function entryPoints(root, pkg) {
  const problems = [];
  const entries = [];
  const manifestRel = pkg?.manifestRel ?? 'package.json';
  const at = (key) => {
    const l = jsonLine(pkg?.text ?? '', key);
    return `${manifestRel}${l === null ? '' : `:${String(l)}`}`;
  };
  const name = pkg?.name ?? null;
  const exp = pkg?.exports ?? null;

  if (name === null) {
    problems.push(`${manifestRel}: no "name" — an entry point cannot be spelled without it`);
    return { entries, problems };
  }
  if (exp === null || exp === undefined) {
    return {
      entries,
      problems: [`${manifestRel}: declares no "exports", so nothing of this package is importable by subpath and it has no declared surface`],
    };
  }

  const push = (subpath, target, condition, where) => {
    const specifier = subpath === '.' ? name : `${name}${subpath.replace(/^\./, '')}`;
    if (target === null) {
      entries.push({ specifier, subpath, target: null, at: where, conditions: condition, note: 'declared `null`, which withdraws the subpath' });
      return;
    }
    const rel = normRel(`${pkg.rel === '' ? '' : `${pkg.rel}/`}${String(target).replace(/^\.\//, '')}`);
    if (rel === null) {
      problems.push(`${where}: the target of ${JSON.stringify(subpath)} is not a relative path inside the package`);
      return;
    }
    entries.push({ specifier, subpath, target: rel, at: where, conditions: condition, note: null });
  };

  const expand = (subpath, value, where) => {
    if (subpath.includes('*')) {
      problems.push(`${where}: the subpath pattern ${JSON.stringify(subpath)} is a wildcard — this projection does not enumerate the files it would match, so the symbols behind it are not listed`);
      return;
    }
    if (value === null) {
      push(subpath, null, null, where);
      return;
    }
    if (typeof value === 'string') {
      push(subpath, value, null, where);
      return;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value).toSorted(byCodepoint);
      if (keys.length === 0) {
        problems.push(`${where}: the subpath ${JSON.stringify(subpath)} declares an empty condition object, which exports nothing`);
        return;
      }
      for (const k of keys) {
        const v = value[k];
        if (typeof v === 'string' || v === null) push(subpath, v, k, where);
        else problems.push(`${where}: condition ${JSON.stringify(k)} of ${JSON.stringify(subpath)} nests further, which this projection does not flatten`);
      }
      return;
    }
    problems.push(`${where}: the value of ${JSON.stringify(subpath)} is neither a path, a condition object nor null`);
  };

  if (typeof exp === 'string') {
    expand('.', exp, at('exports'));
  } else if (typeof exp === 'object' && !Array.isArray(exp)) {
    const keys = Object.keys(exp);
    const subpaths = keys.filter((k) => k.startsWith('.'));
    if (subpaths.length === 0) {
      // The shorthand form: `"exports": { "import": "./x" }` is the `.` subpath with conditions.
      expand('.', exp, at('exports'));
    } else {
      for (const k of keys.toSorted(byCodepoint)) {
        if (!k.startsWith('.')) {
          problems.push(`${at(k)}: ${JSON.stringify(k)} sits among subpath keys, which mixes the two "exports" forms — node reads one or the other, not both`);
          continue;
        }
        expand(k, exp[k], at(k));
      }
    }
  } else {
    problems.push(`${at('exports')}: "exports" is neither a string nor an object`);
  }

  for (const e of entries) {
    if (e.target === null) continue;
    if (!existsSync(join(root, e.target)))
      problems.push(`${e.at}: ${JSON.stringify(e.subpath)} points at ${e.target}, which does not exist — the symbols behind this entry point cannot be listed`);
  }

  return { entries: entries.toSorted((a, b) => byCodepoint(a.subpath, b.subpath) || byCodepoint(String(a.conditions), String(b.conditions))), problems };
}

// ------------------------------------------------------------- the route scanner

/** The Fastify route shorthands. `all` registers every method at once and is reported as
 * written rather than expanded, because expanding it would invent rows. */
export const ROUTE_METHODS = Object.freeze(['all', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put']);

const ROUTE_SITE = new RegExp(`(?:^|[^\\w$])([A-Za-z_$][\\w$]*)\\s*\\.\\s*(${ROUTE_METHODS.join('|')}|route)\\s*\\(`, 'g');
const REGISTER_SITE = /(?:^|[^\w$])([A-Za-z_$][\w$]*)\s*\.\s*register\s*\(/g;

/**
 * The next VALUE token at `from`, where a masked literal counts as a token.
 *
 * → { kind: 'literal' | 'identifier' | 'inline' | 'array' | 'other', value, name, keys } or null
 *
 * THIS IS THE TRAP `lib/test-cases.mjs` ALREADY WROTE DOWN, and the first version of this file
 * walked straight into it: `scanSource` masks a literal into SPACES, so a plain whitespace skip
 * steps over the very string it was looking for and lands on the comma after it. A fixture with
 * `app.route({ method: 'DELETE', url: '/tasks/:id' })` reported the URL as the METHOD and the
 * URL as unresolved, and `register(…, { prefix: '/v1' })` reported no prefix at all. So the
 * literals map is consulted FIRST: a literal starting inside the whitespace run that follows
 * `from` IS the value, and only when there is none does an identifier or a brace get read.
 */
function tokenAt(scan, src, from, limit) {
  const nonWs = skipWs(src, from);
  let lit = null;
  for (const l of scan.literals.values()) {
    if (l.start < from || l.start >= nonWs) continue;
    if (lit === null || l.start < lit.start) lit = l;
  }
  if (lit !== null)
    return {
      kind: 'literal',
      start: lit.start,
      value: lit.isLiteral === true && typeof lit.value === 'string' ? lit.value : null,
      name: null,
      keys: [],
    };
  if (nonWs >= limit) return null;
  if (src[nonWs] === '{') return { kind: 'inline', start: nonWs, value: null, name: null, keys: objectKeys(src, nonWs) };
  if (src[nonWs] === '[') return { kind: 'array', start: nonWs, value: null, name: null, keys: [] };
  const w = wordAt(src, nonWs);
  if (w.word !== '') return { kind: 'identifier', start: nonWs, value: null, name: w.word, keys: [] };
  return { kind: 'other', start: nonWs, value: null, name: null, keys: [] };
}

/** The value of `key:` inside a masked object region, or null when the key is not there. */
function valueAfterKey(scan, src, region, key) {
  const re = new RegExp(`(?:^|[^\\w$.])${key}\\s*:`, 'g');
  re.lastIndex = 0;
  const m = re.exec(src.slice(region.start, region.end));
  if (m === null) return null;
  return tokenAt(scan, src, region.start + m.index + m[0].length, region.end);
}

/** The keys at depth 1 of the masked object literal opening at `open`. */
function objectKeys(src, open) {
  const close = matchBracket(src, open);
  if (close < 0) return [];
  const out = [];
  let depth = 0;
  for (let i = open + 1; i < close; i += 1) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (depth === 0 && IDENT_CHAR.test(c) && !IDENT_CHAR.test(src[i - 1] ?? '')) {
      const w = wordAt(src, i);
      const nxt = skipWs(src, w.end);
      if (src[nxt] === ':') out.push(w.word);
      i = w.end - 1;
    }
  }
  return [...new Set(out)].toSorted(byCodepoint);
}

/**
 * Every Fastify route registration in one source.
 *
 * → { ok, problems, routes, prefixes }
 *
 *   `routes`    `[{ method, path, schema, handler, line, note }]`
 *   `prefixes`  `[{ receiver, line }]` — a `.register(…, { prefix })` call. A prefix composes
 *               with the paths of the plugin it registers, and a token scan cannot follow a
 *               plugin into its own module, so each one is NAMED: a projection that printed
 *               `/tasks` while the real URL is `/v1/tasks` would be worse than one that says
 *               where it stopped.
 *
 * Both shapes are read: the shorthand `app.get('/p'[, opts], handler)` and the object form
 * `app.route({ method, url, schema, handler })`.
 */
export function scanRoutes(text) {
  const raw = String(text);
  const scan = scanSource(raw);
  if (scan.problems.length > 0)
    return {
      ok: false,
      problems: scan.problems.map((p) => `the source mask may be wrong (${p}) — no route of this file is claimed`),
      routes: [],
      prefixes: [],
    };

  const src = scan.code;
  const problems = [];
  const routes = [];
  const prefixes = [];

  const describeHandler = (region) => {
    // The LAST argument of the call. A bare identifier names a function somewhere else; a
    // function expression is `inline`. `tokenAt` rather than `wordAt`, for the masked-literal
    // reason above: a string in the handler position must not read as the identifier after it.
    let depth = 0;
    let lastComma = -1;
    for (let i = region.start + 1; i < region.end; i += 1) {
      const c = src[i];
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']' || c === '}') depth -= 1;
      else if (c === ',' && depth === 0) lastComma = i;
    }
    if (lastComma < 0) return null;
    const t = tokenAt(scan, src, lastComma + 1, region.end);
    if (t === null) return null;
    if (t.kind !== 'identifier') return `inline ${t.kind}`;
    if (t.name === 'async' || t.name === 'function') {
      const next = wordAt(src, t.start + t.name.length);
      return next.word === '' ? `inline ${t.name} function` : next.word;
    }
    const after = skipWs(src, t.start + t.name.length);
    return src[after] === ',' || src[after] === ')' ? t.name : 'inline function';
  };

  ROUTE_SITE.lastIndex = 0;
  let m;
  while ((m = ROUTE_SITE.exec(src)) !== null) {
    const receiver = m[1];
    const verb = m[2];
    const open = m.index + m[0].length - 1;
    const close = matchBracket(src, open);
    const line = lineOf(raw, m.index + m[0].indexOf(receiver));
    if (close < 0) {
      problems.push(`line ${String(line)}: the argument list of \`${receiver}.${verb}(\` never closes in the masked source`);
      continue;
    }
    const region = { start: open, end: close };
    const schemaValue = valueAfterKey(scan, src, region, 'schema');
    const schema =
      schemaValue === null
        ? null
        : schemaValue.kind === 'identifier'
          ? schemaValue.name
          : schemaValue.kind === 'inline'
            ? `inline { ${schemaValue.keys.join(', ')} }`
            : `schema: ${schemaValue.kind}`;

    if (verb === 'route') {
      const methodValue = valueAfterKey(scan, src, region, 'method');
      const urlValue = valueAfterKey(scan, src, region, 'url');
      const method = methodValue?.value ?? null;
      const path = urlValue?.value ?? null;
      const handlerValue = valueAfterKey(scan, src, region, 'handler');
      const missing = method === null ? 'method' : path === null ? 'url' : null;
      routes.push({
        method: method === null ? 'UNRESOLVED' : String(method).toUpperCase(),
        path,
        schema,
        handler: handlerValue === null ? null : handlerValue.kind === 'identifier' ? handlerValue.name : `inline ${handlerValue.kind}`,
        line,
        note:
          missing === null
            ? null
            : `\`${receiver}.route({…})\` whose ${missing} is ${valueAfterKey(scan, src, region, missing) === null ? 'absent' : 'not a string literal'} — a token scan cannot resolve it`,
      });
      continue;
    }

    const first = tokenAt(scan, src, open + 1, close);
    const path = first?.value ?? null;
    routes.push({
      method: verb.toUpperCase(),
      path,
      schema,
      handler: describeHandler(region),
      line,
      note: path === null ? `the first argument of \`${receiver}.${verb}(\` is not a string literal — a token scan cannot resolve the URL` : null,
    });
  }

  REGISTER_SITE.lastIndex = 0;
  while ((m = REGISTER_SITE.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchBracket(src, open);
    if (close < 0) continue;
    const prefixValue = valueAfterKey(scan, src, { start: open, end: close }, 'prefix');
    if (prefixValue === null) continue;
    prefixes.push({ receiver: m[1], prefix: prefixValue.value, line: lineOf(raw, m.index + 1) });
  }

  return {
    ok: problems.length === 0,
    problems,
    routes: routes.toSorted((a, b) => byCodepoint(String(a.path), String(b.path)) || byCodepoint(a.method, b.method)),
    prefixes: prefixes.toSorted((a, b) => a.line - b.line),
  };
}

// ------------------------------------------------------------------- rendering

/** The visible banner, identical in every projection. `L-generated` does not look for it; a
 * human opening the file does, and that is who it is for. */
export const BANNER = `GENERATED — do not edit (node tools/gates/digest.mjs --fix)`;

function header(title, { key, inputs, describes }) {
  return [
    `<!-- ${BANNER} -->`,
    '',
    `# ${title}`,
    '',
    `**${BANNER}**`,
    '',
    `- format: \`${String(FORMAT)}\` — bumped whenever the rendering changes, which makes every projection stale until one \`--fix\``,
    `- sources sha256: \`${key.combined}\``,
    `- derived from: ${inputs} — ${plural(key.files.length, 'input file', 'input files')}, each one listed at the end`,
    '',
    describes,
    '',
  ];
}

function sourceTable(key, counts) {
  const rows = key.files.map((f) => `| \`${f.rel}\` | \`${f.sha}\` | ${counts.get(f.rel) ?? '—'} |`);
  return [
    '## Sources this projection was derived from',
    '',
    'The third column is what the scan found in the file, so a file that contributes nothing says so rather than being absent.',
    '',
    '| file | sha256 | found |',
    '|---|---|---|',
    ...rows,
    '',
    'The `sources sha256` in the header is the sha256 of this table as DATA: one `<path> <sha256>` line per row, in the order shown (sorted by code point), each ending in a newline, concatenated and hashed. The key is CONTENT, never mtime — `git checkout` and a restored cache rewrite mtime to "now" and change nothing here.',
    '',
  ];
}

function notesSection(notes) {
  if (notes.length === 0) return [];
  return [
    '## What the scan could not resolve',
    '',
    'Each line is something the token scan met and refused to guess at. A note here is part of what this projection says; it is not a reason to disbelieve the rest of it.',
    '',
    ...notes.toSorted(byCodepoint).map((n) => `- ${n}`),
    '',
  ];
}

/** The limits of the METHOD, shared by every projection here because they follow from the token
 * scan itself rather than from what is being projected. Everything specific to one projection is
 * passed in by its renderer, so a reader is never handed a limit about something the file does
 * not contain. */
const SCAN_LIMITS = [
  'The scan is a TOKEN SCAN over masked source (`tools/gates/lib/test-cases.mjs` → `scanSource`), not an AST: a question about types goes to `tsc`, and a projection that depended on `tsc` would depend on whether `node_modules` is installed, which would make `L-generated` blink on a tree nobody touched.',
  'Only a STRING LITERAL is read. A value assembled at runtime, or a template literal with a `${…}` substitution, is NAMED as unresolved above rather than guessed at.',
  'Only STATIC relative edges are followed. A dynamic `import(expr)` is invisible to a token scan, which is why `L-core-purity` refuses one inside the core.',
];

function limitsSection(extra = []) {
  return ['## What this projection cannot see', '', ...[...SCAN_LIMITS, ...extra].map((l) => `- ${l}`), ''];
}

/** Symbol rows, in the one order this repository sorts in. A symbol can legitimately appear
 * twice — two declaration sites, two entry points — so the file and the line break the tie and
 * the order is total. */
const bySymbol = (a, b) => byCodepoint(a.name, b.name) || byCodepoint(a.file, b.file) || a.line - b.line;

/**
 * `docs/digests/core-exports.md` — the exported surface of the package that owns the declared
 * source root, split into what an `exports` subpath reaches and what it does not.
 *
 * The split is the point. `sha256Hex`, `sha256HexOfBytes` and `utf8Bytes` are `export`ed from
 * `packages/core/src/testing/sha256.ts` and are NOT part of the surface: no `exports` subpath
 * points at that file, so nothing outside the package can import them. A digest that listed
 * them beside `digest()` would invite a spec to cite a symbol no importer can reach.
 */
export function renderCoreExports(root, { entry, visible, packages }) {
  const problems = [];
  const notes = [];
  const roots = (entry.sourceRoots ?? []).map((r) => normRel(r)).filter((x) => x !== null);
  if (roots.length === 0) return { problems: [`${entry.path}: the manifest entry declares no sourceRoots, so there is nothing to project`] };

  const pkg = ownerOf(roots[0], packages);
  if (pkg === null) return { problems: [`${roots[0]}: no workspace package owns this source root — the projection cannot name the package whose surface it describes`] };

  const ep = entryPoints(root, pkg);
  notes.push(...ep.problems);

  const key = contentKey(root, { roots, extraFiles: [pkg.manifestRel], visible });
  problems.push(...key.problems);
  if (problems.length > 0) return { problems };

  // Every .ts/.tsx under the declared roots, scanned once.
  const scanned = new Map();
  const counts = new Map();
  for (const f of key.files) {
    if (!f.rel.endsWith('.ts') && !f.rel.endsWith('.tsx')) {
      counts.set(f.rel, 'not scanned (not .ts/.tsx)');
      continue;
    }
    let text;
    try {
      text = readFileSync(join(root, f.rel), 'utf8');
    } catch (e) {
      problems.push(`${f.rel}: unreadable (${String(e.message)})`);
      continue;
    }
    const s = scanExports(text);
    scanned.set(f.rel, s);
    notes.push(...s.problems.map((p) => `${f.rel}: ${p}`));
    counts.set(f.rel, `${plural(s.declarations.length, 'export', 'exports')}, ${plural(s.reexports.length, 're-export', 're-exports')}`);
  }
  if (problems.length > 0) return { problems };

  /** The symbols one entry point exposes, following relative `export … from` edges. */
  const surfaceOf = (targetRel, seen = new Set()) => {
    const out = [];
    if (targetRel === null || seen.has(targetRel)) return out;
    seen.add(targetRel);
    let s = scanned.get(targetRel);
    if (s === undefined) {
      try {
        s = scanExports(readFileSync(join(root, targetRel), 'utf8'));
      } catch {
        notes.push(`${targetRel}: an entry point target outside the declared source roots and unreadable — the symbols behind it are not listed`);
        return out;
      }
    }
    for (const d of s.declarations) out.push({ ...d, file: targetRel });
    for (const r of s.reexports) {
      const resolved = r.spec.startsWith('.') ? resolveRelative(root, targetRel, r.spec) : null;
      if (r.star && r.namespace === null) {
        if (resolved === null) {
          notes.push(`${targetRel}:${String(r.line)}: \`export * from ${JSON.stringify(r.spec)}\` — the names behind a non-relative star live in another package and are not expanded here`);
          continue;
        }
        out.push(...surfaceOf(resolved, seen));
        continue;
      }
      if (r.star && r.namespace !== null) {
        out.push({ name: r.namespace, kind: 'namespace re-export', signature: `export * as ${r.namespace} from ${JSON.stringify(r.spec)}`, line: r.line, note: null, file: targetRel });
        continue;
      }
      for (const n of r.names) {
        const from = resolved ?? r.spec;
        const decl = resolved === null ? undefined : (scanned.get(resolved) ?? scanExports(readFileSync(join(root, resolved), 'utf8'))).declarations.find((d) => d.name === n.local);
        out.push({
          name: n.name,
          kind: r.typeOnly ? 'type re-export' : 're-export',
          signature: decl?.signature ?? `export { ${n.local}${n.local === n.name ? '' : ` as ${n.name}`} } from ${JSON.stringify(r.spec)}`,
          line: decl?.line ?? r.line,
          note: decl === undefined ? `forwarded from ${from}` : null,
          file: decl === undefined ? targetRel : resolved,
        });
      }
    }
    return out;
  };

  // One row per (specifier, symbol, declaration site). A subpath with two conditions pointing at
  // the same file is ONE promise to an importer, not two, so the conditions are listed in the
  // entry-point table above and collapsed here.
  const bySurfaceKey = new Map();
  const onSurface = new Set();
  for (const e of ep.entries) {
    if (e.target === null) continue;
    for (const sym of surfaceOf(e.target)) {
      bySurfaceKey.set(`${e.specifier}\u0000${sym.name}\u0000${sym.file}\u0000${String(sym.line)}`, { ...sym, specifier: e.specifier });
      onSurface.add(`${sym.file}#${sym.name}`);
    }
  }
  const surfaceRows = [...bySurfaceKey.values()];

  const seeds = ep.entries.map((e) => e.target).filter((t) => t !== null);
  const graph = importGraph(root, seeds, { roles: ['import', 'reexport', 'bare'] });
  for (const u of graph.unresolved) notes.push(`${u.from}:${String(u.line)}: the relative specifier ${JSON.stringify(u.spec)} resolves to no file`);
  for (const u of graph.unreadable) notes.push(u);

  const internalRows = [];
  for (const [rel, s] of [...scanned.entries()].toSorted((a, b) => byCodepoint(a[0], b[0]))) {
    for (const d of s.declarations) {
      if (onSurface.has(`${rel}#${d.name}`)) continue;
      internalRows.push({
        ...d,
        file: rel,
        reach: graph.reached.has(rel)
          ? 'reached from an entry point by a relative import'
          : 'reached from NO entry point — nothing inside or outside this package imports it',
      });
    }
  }

  surfaceRows.sort(bySymbol);
  internalRows.sort(bySymbol);
  for (const s of [...surfaceRows, ...internalRows]) if (s.note !== null && s.note !== undefined) notes.push(`${s.file}:${String(s.line)}: \`${s.name}\` — ${s.note}`);

  const entryRows = ep.entries.map((e) => {
    const names = e.target === null ? [] : [...new Set(surfaceRows.filter((s) => s.specifier === e.specifier).map((s) => s.name))].toSorted(byCodepoint);
    const shown = names.slice(0, SYMBOLS_SHOWN).map((n) => `\`${n}\``).join(', ');
    const symbols = names.length === 0 ? '—' : names.length > SYMBOLS_SHOWN ? `${shown} (+${String(names.length - SYMBOLS_SHOWN)} more, all of them in the table below)` : shown;
    return `| ${code(e.specifier)} | ${code(e.target)} | ${code(e.conditions)} | ${symbols} | ${code(e.at)}${e.note === null ? '' : ` — ${cell(e.note)}`} |`;
  });

  const lines = [
    ...header(`${pkg.name} — exported surface`, {
      key,
      inputs: `\`${roots.map((r) => `${r}/`).join('`, `')}\` plus \`${pkg.manifestRel}\` (the \`exports\` map, which decides what is a surface at all)`,
      describes: String(entry.describes ?? ''),
    }),
    '## Entry points — what `exports` makes importable',
    '',
    `Read from \`${pkg.manifestRel}\`. An importer can reach a symbol of this package only through one of these specifiers; a file that no row points at is internal, whatever it exports.`,
    '',
    '| specifier | target | condition | symbols | declared at |',
    '|---|---|---|---|---|',
    ...(entryRows.length > 0 ? entryRows : ['| — | — | — | — | the `exports` map declares no subpath |']),
    '',
    '## The public surface — every symbol an importer can reach',
    '',
    ...(surfaceRows.length > 0
      ? [
          '| symbol | specifier | kind | signature | declared at |',
          '|---|---|---|---|---|',
          ...surfaceRows.map(
            (s) => `| \`${s.name}\` | ${code(s.specifier)} | ${s.kind} | ${s.signature === null ? '_not derived_' : `\`${cell(s.signature)}\``} | \`${s.file}:${String(s.line)}\` |`,
          ),
        ]
      : [`No symbol is reachable from outside ${pkg.name}. That is a statement about ${plural(key.files.length, 'input file', 'input files')}, not an empty file: the entry points above were read and the files behind them export nothing.`]),
    '',
    '## Exported, and NOT part of the surface',
    '',
    `An \`export\` keyword inside the package is not a promise to an importer: only the \`exports\` map makes one. A symbol here is reachable from a sibling module by a relative import and from nowhere else, so a spec may not cite it and \`${pkg.name}\` may change it without changing its surface.`,
    '',
    ...(internalRows.length > 0
      ? [
          '| symbol | kind | signature | declared at | reach |',
          '|---|---|---|---|---|',
          ...internalRows.map((s) => `| \`${s.name}\` | ${s.kind} | ${s.signature === null ? '_not derived_' : `\`${cell(s.signature)}\``} | \`${s.file}:${String(s.line)}\` | ${s.reach} |`),
        ]
      : ['Every `export` under the declared source roots is on the surface above.']),
    '',
    ...sourceTable(key, counts),
    ...notesSection(notes),
    ...limitsSection([
      'NO TYPE INFERENCE. A signature is the text the file writes: a `const` with no annotation is shown as written, not as the type `tsc` infers for it, and a signature longer than the fixed width is cut with an ellipsis.',
      'Declaration merging, overload sets and `namespace` are listed entry by entry as the text writes them, never merged into one symbol.',
      "A non-relative `export * from '<package>'` cannot be expanded: the names live in another package's files. It is listed as a note above, never dropped.",
      'A conditional `exports` subpath is listed with every condition and resolved to none — which condition applies is the importer\'s question. The map is read from the file, not from a resolver.',
      '"Reached from an entry point" is reachability, not use: it says an import chain exists, not that any call does.',
    ]),
  ];

  return { text: `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`, problems: [] };
}

/**
 * `docs/digests/api-routes.md` — method, path, schema names, handler and `file:line` for every
 * route the declared source root registers.
 *
 * THE EMPTY STATE IS THE POINT TODAY. There is no route in this repository yet, and a projection
 * that answered that with an empty file would be indistinguishable from a projection that
 * failed to look. This one says how many files it read, which call shapes it looked for, and
 * that it found none — so "no route" is a reading rather than a silence.
 */
export function renderApiRoutes(root, { entry, visible, packages }) {
  const problems = [];
  const notes = [];
  const roots = (entry.sourceRoots ?? []).map((r) => normRel(r)).filter((x) => x !== null);
  if (roots.length === 0) return { problems: [`${entry.path}: the manifest entry declares no sourceRoots, so there is nothing to project`] };

  const pkg = ownerOf(roots[0], packages);
  if (pkg === null) return { problems: [`${roots[0]}: no workspace package owns this source root — the projection cannot name the app whose routes it describes`] };

  const key = contentKey(root, { roots, extraFiles: [pkg.manifestRel], visible });
  problems.push(...key.problems);
  if (problems.length > 0) return { problems };

  const counts = new Map();
  const routes = [];
  const prefixes = [];
  for (const f of key.files) {
    if (!f.rel.endsWith('.ts') && !f.rel.endsWith('.tsx')) {
      counts.set(f.rel, 'not scanned (not .ts/.tsx)');
      continue;
    }
    let text;
    try {
      text = readFileSync(join(root, f.rel), 'utf8');
    } catch (e) {
      problems.push(`${f.rel}: unreadable (${String(e.message)})`);
      continue;
    }
    const s = scanRoutes(text);
    notes.push(...s.problems.map((p) => `${f.rel}: ${p}`));
    for (const r of s.routes) routes.push({ ...r, file: f.rel });
    for (const p of s.prefixes) prefixes.push({ ...p, file: f.rel });
    counts.set(f.rel, `${plural(s.routes.length, 'route', 'routes')}, ${plural(s.prefixes.length, 'prefix', 'prefixes')}`);
  }
  if (problems.length > 0) return { problems };

  routes.sort((a, b) => byCodepoint(String(a.path), String(b.path)) || byCodepoint(a.method, b.method) || byCodepoint(a.file, b.file));
  for (const r of routes) if (r.note !== null) notes.push(`${r.file}:${String(r.line)}: ${r.note}`);
  for (const p of prefixes)
    notes.push(
      `${p.file}:${String(p.line)}: \`${p.receiver}.register(…, { prefix: ${p.prefix === null ? 'not a string literal' : JSON.stringify(p.prefix)} })\` — a prefix composes with the paths of the plugin it registers, and a token scan does not follow a plugin into its own module, so the paths above are the paths AS WRITTEN at their own call site`,
    );

  const scannedFiles = [...counts.keys()].filter((k) => !String(counts.get(k)).startsWith('not scanned'));

  const lines = [
    ...header(`${pkg.name} — HTTP routes`, {
      key,
      inputs: `\`${roots.map((r) => `${r}/`).join('`, `')}\` plus \`${pkg.manifestRel}\``,
      describes: String(entry.describes ?? ''),
    }),
    '## Routes',
    '',
    ...(routes.length > 0
      ? [
          '| method | path | schema | handler | declared at |',
          '|---|---|---|---|---|',
          ...routes.map((r) => `| \`${r.method}\` | ${code(r.path)} | ${code(r.schema)} | ${code(r.handler)} | \`${r.file}:${String(r.line)}\` |`),
        ]
      : [
          `**No route is declared.** ${plural(scannedFiles.length, 'file', 'files')} under \`${roots.join('`, `')}\` ${scannedFiles.length === 1 ? 'was' : 'were'} read and every one of the call shapes below was looked for in all of them. This is a reading, not an empty file: ${pkg.name} is a marker module until a spec puts a route in it, and a route that appeared without a spec behind it would be invented behaviour.`,
          '',
          'What was looked for, by shape:',
          '',
          `- ${ROUTE_METHODS.map((v) => `\`<receiver>.${v}(…)\``).join(', ')} — the method shorthands, the URL taken from the first string-literal argument`,
          '- `<receiver>.route({ method, url, schema, handler })` — the object form',
          '- `<receiver>.register(…, { prefix })` — reported separately, because a prefix changes the URL of routes this scan cannot see',
          '',
          `The receiver name is not pinned to \`app\` or \`fastify\`: any identifier counts, so renaming the instance cannot hide a route from this projection.`,
        ]),
    '',
    ...sourceTable(key, counts),
    ...notesSection(notes),
    ...limitsSection([
      'A route registered inside a plugin module that `register` pulls in is counted at ITS OWN call site, with no prefix applied. Every `prefix` found is listed as a note above.',
      'A schema named by an identifier is reported by that name; the projection does not follow the identifier to the object it refers to, so the FIELDS of a schema are not listed here.',
      'A method the Fastify instance registers through `addHook`, a custom wrapper or a decorator is not one of the shapes above and is not seen.',
    ]),
  ];

  return { text: `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`, problems: [] };
}

/**
 * The renderer of each declared path. Keyed BY THE DECLARED PATH, so the manifest decides what
 * exists and this table decides how it is written. A manifest entry with no renderer and a
 * renderer with no manifest entry are both refusals, named in `renderAll` — the two sides are
 * checked against each other rather than one trusting the other.
 */
export const PROJECTIONS = Object.freeze({
  'docs/digests/core-exports.md': renderCoreExports,
  'docs/digests/api-routes.md': renderApiRoutes,
});

/**
 * Render every projection `generated.json` declares.
 *
 * → { ok, files: [{ path, text }], problems }
 *
 * `ok: false` with a non-empty `problems` is the HARD case: nothing is written and nothing is
 * claimed. A soft note never reaches `problems` — it is rendered INTO the file it belongs to.
 */
export function renderAll(root) {
  const man = readGenerated(root);
  if (!man.exists || man.data === null) return { ok: false, files: [], problems: man.problems };
  if (!man.ok) return { ok: false, files: [], problems: [`${man.rel} does not pass its shape check: ${man.problems.join('; ')}`] };

  const entries = Array.isArray(man.data.entries) ? man.data.entries : [];
  const problems = [];
  const declared = new Set();
  const visible = readVisible(root);
  if (!visible.ok && visible.exists) problems.push(...visible.problems.map((p) => `${p} — the walk's blind zone cannot be read, so no projection is derived`));
  const packages = readPackages(root);
  problems.push(...packages.problems);
  if (problems.length > 0) return { ok: false, files: [], problems };

  const files = [];
  for (const entry of entries) {
    const path = normRel(entry?.path);
    if (path === null) {
      problems.push(`${man.rel}: an entry with no usable "path"`);
      continue;
    }
    declared.add(path);
    const render = PROJECTIONS[path];
    if (render === undefined) {
      problems.push(
        `${path}: declared generated in ${man.rel} and this file has no renderer for it — add one to PROJECTIONS in tools/gates/digest.mjs (the manifest names \`${String(entry?.producer ?? '--fix')}\` as the cure, and a cure that cannot run is a cure nobody has)`,
      );
      continue;
    }
    const out = render(root, { entry, visible, packages });
    if (out.problems.length > 0 || typeof out.text !== 'string') {
      problems.push(...out.problems.map((p) => `${path}: ${p}`));
      continue;
    }
    files.push({ path, text: out.text });
  }

  for (const path of Object.keys(PROJECTIONS).toSorted(byCodepoint))
    if (!declared.has(path))
      problems.push(`${path}: tools/gates/digest.mjs renders it and ${man.rel} does not declare it — a projection no manifest declares is a file no light guards; declare it or delete the renderer`);

  files.sort((a, b) => byCodepoint(a.path, b.path));
  return { ok: problems.length === 0, files, problems };
}

// ------------------------------------------------------------------------- cli

/** `--root`, `--render <dir>` and exactly one mode. An unknown flag is refused rather than
 * ignored: a typo that silently selected a different mode is how a check stops checking. */
export function parseArgs(argv) {
  const out = { mode: null, renderDir: null, root: null, problems: [] };
  const rest = [...argv];
  while (rest.length > 0) {
    const a = rest.shift();
    if (a === '--check' || a === '--fix') {
      if (out.mode !== null) out.problems.push(`two modes given (${String(out.mode)} and ${a.slice(2)}) — pass exactly one`);
      out.mode = a.slice(2);
      continue;
    }
    if (a === RENDER_FLAG) {
      if (out.mode !== null) out.problems.push(`two modes given (${String(out.mode)} and render) — pass exactly one`);
      out.mode = 'render';
      const dir = rest.shift();
      if (dir === undefined || dir.startsWith('-')) out.problems.push(`${RENDER_FLAG} needs a directory`);
      else out.renderDir = dir;
      continue;
    }
    if (a === '--root') {
      const dir = rest.shift();
      if (dir === undefined || dir.startsWith('-')) out.problems.push('--root needs a directory');
      else out.root = dir;
      continue;
    }
    if (a === '--help' || a === '-h') {
      out.mode = 'help';
      continue;
    }
    out.problems.push(`unknown argument ${JSON.stringify(a)}`);
  }
  if (out.mode === null) out.problems.push(`no mode given — pass --check, --fix or ${RENDER_FLAG} <dir>`);
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.mode === 'help') {
    console.log(USAGE);
    return EXIT_OK;
  }
  if (args.problems.length > 0) {
    console.error(`[digest] REFUSED: ${args.problems.join('; ')}`);
    console.error(USAGE);
    return EXIT_REFUSED;
  }

  const root = resolve(args.root ?? SELF_ROOT);
  if (!existsSync(join(root, 'tools', 'gates', 'generated.json'))) {
    console.error(`[digest] REFUSED: ${root} holds no tools/gates/generated.json — that manifest is the only declaration of what is generated, so without it nothing is.`);
    return EXIT_REFUSED;
  }

  const rendered = renderAll(root);
  if (!rendered.ok) {
    console.error('[digest] REFUSED: nothing was written and nothing is claimed.');
    for (const p of rendered.problems) console.error(`  ${p}`);
    return EXIT_REFUSED;
  }

  if (args.mode === 'render') {
    const dir = resolve(args.renderDir);
    for (const f of rendered.files) {
      const abs = join(dir, f.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.text);
      console.log(`[digest] rendered ${f.path}`);
    }
    return EXIT_OK;
  }

  if (args.mode === 'fix') {
    let changed = 0;
    for (const f of rendered.files) {
      const abs = join(root, f.path);
      const before = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
      if (before === f.text) {
        console.log(`[digest] unchanged ${f.path}`);
        continue;
      }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.text);
      changed += 1;
      console.log(`[digest] ${before === null ? 'wrote' : 'rewrote'} ${f.path}`);
    }
    console.log(`[digest] --fix: ${plural(rendered.files.length, 'projection', 'projections')}, ${String(changed)} changed. Commit the result: L-generated compares HEAD, never the work tree.`);
    return EXIT_OK;
  }

  // --check
  const head = hasCommits({ cwd: root });
  const stale = [];
  for (const f of rendered.files) {
    const abs = join(root, f.path);
    const onDisk = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (onDisk === null) {
      stale.push(`${f.path}: declared generated and absent from the work tree`);
      continue;
    }
    if (onDisk !== f.text) {
      const a = onDisk.split('\n');
      const b = f.text.split('\n');
      let i = 0;
      while (i < Math.max(a.length, b.length) && a[i] === b[i]) i += 1;
      stale.push(`${f.path}:${String(i + 1)}: the work tree is not what this file renders — on disk "${clip(a[i] ?? '(end of file)', 60)}", a fresh render has "${clip(b[i] ?? '(end of file)', 60)}"`);
      continue;
    }
    console.log(`[digest] current ${f.path}`);
    if (head) {
      const committed = showAtHead(f.path, { cwd: root });
      if (!committed.ok) console.log(`[digest]   …and not at HEAD yet (${committed.reason}) — L-generated reads HEAD, so commit it`);
      else if (committed.text !== f.text) console.log('[digest]   …and HEAD differs from the work tree — the file is current, the commit is not');
    }
  }
  if (stale.length === 0) {
    console.log(`[digest] --check: ${plural(rendered.files.length, 'projection', 'projections')} current.`);
    return EXIT_OK;
  }
  console.error('[digest] STALE:');
  for (const s of stale) console.error(`  ${s}`);
  console.error('[digest] CURE: node tools/gates/digest.mjs --fix, then commit the result.');
  return EXIT_STALE;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
