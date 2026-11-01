<!-- GENERATED — do not edit (node tools/gates/digest.mjs --fix) -->

# @cheq/api — HTTP routes

**GENERATED — do not edit (node tools/gates/digest.mjs --fix)**

- format: `1` — bumped whenever the rendering changes, which makes every projection stale until one `--fix`
- sources sha256: `6cbcb4025cc552793bac59404cd6e4902a6cd74d079a4560019e0b6813d0cb72`
- derived from: `apps/api/src/` plus `apps/api/package.json` — 2 input files, each one listed at the end

Every route of @cheq/api: method, path, schema names, handler, file:line — the HTTP surface, which is otherwise spread across registration calls nobody can diff.

## Routes

**No route is declared.** 1 file under `apps/api/src` was read and every one of the call shapes below was looked for in all of them. This is a reading, not an empty file: @cheq/api is a marker module until a spec puts a route in it, and a route that appeared without a spec behind it would be invented behaviour.

What was looked for, by shape:

- `<receiver>.all(…)`, `<receiver>.delete(…)`, `<receiver>.get(…)`, `<receiver>.head(…)`, `<receiver>.options(…)`, `<receiver>.patch(…)`, `<receiver>.post(…)`, `<receiver>.put(…)` — the method shorthands, the URL taken from the first string-literal argument
- `<receiver>.route({ method, url, schema, handler })` — the object form
- `<receiver>.register(…, { prefix })` — reported separately, because a prefix changes the URL of routes this scan cannot see

The receiver name is not pinned to `app` or `fastify`: any identifier counts, so renaming the instance cannot hide a route from this projection.

## Sources this projection was derived from

The third column is what the scan found in the file, so a file that contributes nothing says so rather than being absent.

| file | sha256 | found |
|---|---|---|
| `apps/api/package.json` | `4976160d9ad3569e9770f0d9ffde07ce794231fc0217c6ef5bb6b759287162eb` | not scanned (not .ts/.tsx) |
| `apps/api/src/index.ts` | `3475ef82eb6acc22503054249b6a9d1be68412cf2a49dc73fa95218100d30f49` | 0 routes, 0 prefixes |

The `sources sha256` in the header is the sha256 of this table as DATA: one `<path> <sha256>` line per row, in the order shown (sorted by code point), each ending in a newline, concatenated and hashed. The key is CONTENT, never mtime — `git checkout` and a restored cache rewrite mtime to "now" and change nothing here.

## What this projection cannot see

- The scan is a TOKEN SCAN over masked source (`tools/gates/lib/test-cases.mjs` → `scanSource`), not an AST: a question about types goes to `tsc`, and a projection that depended on `tsc` would depend on whether `node_modules` is installed, which would make `L-generated` blink on a tree nobody touched.
- Only a STRING LITERAL is read. A value assembled at runtime, or a template literal with a `${…}` substitution, is NAMED as unresolved above rather than guessed at.
- Only STATIC relative edges are followed. A dynamic `import(expr)` is invisible to a token scan, which is why `L-core-purity` refuses one inside the core.
- A route registered inside a plugin module that `register` pulls in is counted at ITS OWN call site, with no prefix applied. Every `prefix` found is listed as a note above.
- A schema named by an identifier is reported by that name; the projection does not follow the identifier to the object it refers to, so the FIELDS of a schema are not listed here.
- A method the Fastify instance registers through `addHook`, a custom wrapper or a decorator is not one of the shapes above and is not seen.
