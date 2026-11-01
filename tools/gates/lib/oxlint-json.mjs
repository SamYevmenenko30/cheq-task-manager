/**
 * The reader of the lint artefact: `oxlint --format=json`.
 *
 * Zero dependencies, `node:` builtins only.
 *
 * THE COMMAND THIS READS (oxlint 1.90.0 + oxlint-tsgolint 7.0.2005, the
 * type-aware engine on the same TypeScript 7 line as the compiler):
 *
 *     pnpm exec oxlint --type-aware --format=json  > oxlint.json
 *
 * `--type-aware` IS NOT OPTIONAL AND ITS ABSENCE IS SILENT. Without the flag
 * the type-aware rules simply do not run and nothing says so — the output looks
 * like a clean pass. The flag therefore belongs in `run.json`'s argv, and a
 * gate should assert it was there; this reader cannot see the argv and says so
 * rather than implying the lane was type-aware. Lint wall time with the flag:
 * 1091-1127 ms on this tree.
 *
 * THE MEASURED SHAPE (rerun: plant a floating promise and an `any` leak in
 * packages/core/src, then run the command above):
 *
 *     { "diagnostics": [ { "message": "…", "code": "typescript(no-floating-promises)",
 *         "severity": "error", "url": "…", "help": "…",
 *         "filename": "packages/core/src/x.ts",
 *         "labels": [ { "label": "…", "span": { "offset": 72, "length": 3,
 *                                               "line": 2, "column": 29 } } ] } ],
 *       "number_of_files": 15, "number_of_rules": 243,
 *       "threads_count": 16, "start_time": 0.278 }
 *
 * Four details that each cost a wrong reader:
 *  - `code` is `plugin(rule-name)`, with PARENTHESES, not `plugin/rule-name`.
 *    `eslint(...)` is the core plugin: measured `eslint(no-debugger)`.
 *  - `severity` is `"error"` or `"warning"` (singular), both measured. There is
 *    NO summary count field anywhere — the totals are the length of
 *    `diagnostics`, which is why they are computed here and not read.
 *  - line and column live in `labels[].span`, not on the diagnostic.
 *  - `number_of_files` is the count of files actually linted. Zero means the
 *    run reached no file, which is CANNOT VERIFY: a linter that linted nothing
 *    reports no findings, and that is not the same as no findings existing.
 *
 * AND THE ONE THAT IS NOT JSON AT ALL. Measured: when the config fails to
 * parse, oxlint writes PLAIN TEXT to stdout even under `--format=json`, and
 * exits 1:
 *
 *     Failed to parse oxlint configuration file.
 *       x Rule 'no-such-rule-at-all' not found in plugin 'typescript'
 *
 * So the artefact can be a well-named file holding no JSON. `readOxlint`
 * reports that as CANNOT VERIFY with the tool's own first line as the reason —
 * never a crash, and never an empty `diagnostics` read as a clean tree. The
 * good news in that measurement: a typo'd rule id cannot masquerade as a
 * configured rule, because the tool itself refuses to start.
 *
 * What this reader deliberately does NOT do: decide whether the configuration
 * names the rules it should. A family of rules outside oxlint's default
 * categories (the `no-unsafe-*` / `no-explicit-any` family) must be named
 * individually under `rules`, and a config that relies on categories alone
 * checks less than it appears to. That is an assertion about `.oxlintrc.jsonc`
 * (its `rules` block begins at .oxlintrc.jsonc:39), which a light makes against
 * the config file — not something any run's output can show.
 */

import { existsSync, readFileSync } from 'node:fs';

/** `plugin(rule-name)` — the measured form of `code`. */
export const OXLINT_CODE_RE = /^([a-z-]+)\(([^)]+)\)$/;

/** `"typescript(no-floating-promises)"` → `{ plugin, rule }`, or nulls when the
 * form is not the measured one. An unparsable code is kept verbatim by the
 * caller rather than dropped: an unreadable finding is still a finding. */
export function parseCode(code) {
  const m = String(code ?? '').match(OXLINT_CODE_RE);
  return m ? { plugin: m[1], rule: m[2] } : { plugin: null, rule: null };
}

/**
 * Read one oxlint JSON artefact by its EXPLICIT path (no glob — see
 * tools/gates/lib/run-dir.mjs).
 *
 * → { ok, verdict, reason, path, errors, warnings, byRule, filesLinted,
 *     rulesConfigured, diagnostics }
 *
 *   `errors` / `warnings` — counts, computed from `diagnostics` by `severity`,
 *       because the report carries no totals.
 *   `byRule` — `{ [code]: { plugin, rule, errors, warnings, files: [path] } }`,
 *       so a light can name the rule that fired and where.
 *   `filesLinted` — `number_of_files`.
 *   `rulesConfigured` — `number_of_rules`; evidence about the config, not about
 *       the tree. Reported, never used as a verdict here.
 *   `diagnostics` — `[{ code, plugin, rule, severity, filename, line, column,
 *       message, help, url }]`, line and column lifted out of `labels[0].span`.
 *
 * `verdict`: `green` when the run linted at least one file and produced no
 * diagnostic; `red` when any diagnostic is present, of either severity, because
 * this lane is run with warnings fatal; `cannot-verify` for every reason listed
 * in the header, each one named.
 */
export function readOxlint(path) {
  if (!path) return { ok: false, verdict: 'cannot-verify', reason: 'readOxlint: no path given', path: null };
  if (!existsSync(path))
    return { ok: false, verdict: 'cannot-verify', reason: `no such file: ${path} — a missing artefact is CANNOT VERIFY, never green`, path };

  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    return { ok: false, verdict: 'cannot-verify', reason: `unreadable: ${path}: ${String(e.message)}`, path };
  }

  let j;
  try {
    j = JSON.parse(text);
  } catch {
    // Measured: a config that does not parse makes oxlint print plain text to
    // stdout under --format=json. Hand the tool's own words back.
    const first = text.split('\n').find((l) => l.trim().length > 0) ?? '(empty file)';
    return {
      ok: false,
      verdict: 'cannot-verify',
      reason: `${path} is not JSON — oxlint wrote plain text under --format=json, which is what it does when the configuration fails to parse: ${first.trim()}`,
      path,
      rawFirstLine: first.trim(),
    };
  }

  if (!Array.isArray(j?.diagnostics))
    return { ok: false, verdict: 'cannot-verify', reason: `${path}: no diagnostics array — not an oxlint JSON report`, path };

  const filesLinted = typeof j.number_of_files === 'number' ? j.number_of_files : null;
  const rulesConfigured = typeof j.number_of_rules === 'number' ? j.number_of_rules : null;

  const diagnostics = j.diagnostics.map((d) => {
    const { plugin, rule } = parseCode(d?.code);
    const span = Array.isArray(d?.labels) ? d.labels.find((l) => l?.span)?.span ?? null : null;
    return {
      code: String(d?.code ?? ''),
      plugin,
      rule,
      severity: String(d?.severity ?? ''),
      filename: String(d?.filename ?? ''),
      line: typeof span?.line === 'number' ? span.line : null,
      column: typeof span?.column === 'number' ? span.column : null,
      message: String(d?.message ?? ''),
      help: d?.help === undefined || d?.help === null ? null : String(d.help),
      url: d?.url === undefined || d?.url === null ? null : String(d.url),
    };
  });

  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length;
  const other = diagnostics.filter((d) => d.severity !== 'error' && d.severity !== 'warning');

  const byRule = {};
  for (const d of diagnostics) {
    const k = d.code || '(no code)';
    byRule[k] ??= { plugin: d.plugin, rule: d.rule, errors: 0, warnings: 0, files: [] };
    if (d.severity === 'error') byRule[k].errors += 1;
    else if (d.severity === 'warning') byRule[k].warnings += 1;
    if (d.filename && !byRule[k].files.includes(d.filename)) byRule[k].files.push(d.filename);
  }

  const base = { ok: true, path, errors, warnings, byRule, filesLinted, rulesConfigured, diagnostics };

  if (filesLinted === null)
    return { ...base, ok: false, verdict: 'cannot-verify', reason: `${path}: no number_of_files field — the report does not say how many files it linted` };

  if (filesLinted === 0)
    return {
      ...base,
      ok: false,
      verdict: 'cannot-verify',
      reason: `${path}: number_of_files=0 — the run reached no file, and a linter that linted nothing reports no findings`,
    };

  if (other.length)
    return {
      ...base,
      ok: false,
      verdict: 'cannot-verify',
      reason: `${path}: ${other.length} diagnostic(s) with an unmeasured severity ${[...new Set(other.map((d) => JSON.stringify(d.severity)))].join(', ')} — only "error" and "warning" were measured, so this run cannot be counted`,
    };

  if (diagnostics.length)
    return {
      ...base,
      verdict: 'red',
      reason: `${errors} error(s) and ${warnings} warning(s) over ${filesLinted} file(s): ${Object.keys(byRule).toSorted().join(', ')}`,
    };

  return { ...base, verdict: 'green', reason: `clean over ${filesLinted} file(s) with ${rulesConfigured ?? '?'} rule(s) configured` };
}

/** Diagnostics for one rule id, in the measured `plugin(rule)` form. */
export function diagnosticsOfRule(read, code) {
  return (read?.diagnostics ?? []).filter((d) => d.code === code);
}

/** Diagnostics inside one path prefix — `packages/core/`, say. `filename` is
 * repo-relative in the measured output, so the prefix is too. */
export function diagnosticsUnder(read, prefix) {
  return (read?.diagnostics ?? []).filter((d) => d.filename.startsWith(prefix));
}
