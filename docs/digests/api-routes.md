<!-- GENERATED — do not edit (node tools/gates/digest.mjs --fix) -->

# @cheq/api — HTTP routes

**GENERATED — do not edit (node tools/gates/digest.mjs --fix)**

- format: `1` — bumped whenever the rendering changes, which makes every projection stale until one `--fix`
- sources sha256: `2d52b141145c704947bdeabdae16de7520fbdcc963dabf64b102e51f3b341e63`
- derived from: `apps/api/src/` plus `apps/api/package.json` — 5 input files, each one listed at the end

Every route of @cheq/api: method, path, schema names, handler, file:line — the HTTP surface, which is otherwise spread across registration calls nobody can diff.

## Routes

| method | path | schema | handler | declared at |
|---|---|---|---|---|
| `GET` | `/health` | — | `inline async function` | `apps/api/src/app.ts:66` |
| `GET` | `/tasks` | — | `inline async function` | `apps/api/src/app.ts:69` |
| `POST` | `/tasks` | — | `inline async function` | `apps/api/src/app.ts:72` |

## Sources this projection was derived from

The third column is what the scan found in the file, so a file that contributes nothing says so rather than being absent.

| file | sha256 | found |
|---|---|---|
| `apps/api/package.json` | `4976160d9ad3569e9770f0d9ffde07ce794231fc0217c6ef5bb6b759287162eb` | not scanned (not .ts/.tsx) |
| `apps/api/src/app.ts` | `e7aabcbf8dd7ea8a73232935167b47e6e03bf1a63bdc7fd0319c4a611e6db1c6` | 3 routes, 0 prefixes |
| `apps/api/src/in-memory-task-store.ts` | `8a842ec1969f9fce55e07d55de145733ee74875fd0b440166a1839c9f8b8fb91` | 0 routes, 0 prefixes |
| `apps/api/src/index.ts` | `37e4c1200aafc36cda1bfa96ac905ce71a87e268e1b0936f39850b83c554efa5` | 0 routes, 0 prefixes |
| `apps/api/src/request-log.ts` | `0f9271b27d7ea97730e0077db9c0a6463a0d74707d2a2f86c8d0f3361a81c1ea` | 0 routes, 0 prefixes |

The `sources sha256` in the header is the sha256 of this table as DATA: one `<path> <sha256>` line per row, in the order shown (sorted by code point), each ending in a newline, concatenated and hashed. The key is CONTENT, never mtime — `git checkout` and a restored cache rewrite mtime to "now" and change nothing here.

## What this projection cannot see

- The scan is a TOKEN SCAN over masked source (`tools/gates/lib/test-cases.mjs` → `scanSource`), not an AST: a question about types goes to `tsc`, and a projection that depended on `tsc` would depend on whether `node_modules` is installed, which would make `L-generated` blink on a tree nobody touched.
- Only a STRING LITERAL is read. A value assembled at runtime, or a template literal with a `${…}` substitution, is NAMED as unresolved above rather than guessed at.
- Only STATIC relative edges are followed. A dynamic `import(expr)` is invisible to a token scan, which is why `L-core-purity` refuses one inside the core.
- A route registered inside a plugin module that `register` pulls in is counted at ITS OWN call site, with no prefix applied. Every `prefix` found is listed as a note above.
- A schema named by an identifier is reported by that name; the projection does not follow the identifier to the object it refers to, so the FIELDS of a schema are not listed here.
- A method the Fastify instance registers through `addHook`, a custom wrapper or a decorator is not one of the shapes above and is not seen.
