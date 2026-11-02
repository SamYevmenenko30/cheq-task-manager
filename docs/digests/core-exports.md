<!-- GENERATED — do not edit (node tools/gates/digest.mjs --fix) -->

# @cheq/core — exported surface

**GENERATED — do not edit (node tools/gates/digest.mjs --fix)**

- format: `1` — bumped whenever the rendering changes, which makes every projection stale until one `--fix`
- sources sha256: `65ec3c659aa0ec814d0456092569aff274fb1c4e26bee48dd83c99516ec58049`
- derived from: `packages/core/src/` plus `packages/core/package.json` (the `exports` map, which decides what is a surface at all) — 8 input files, each one listed at the end

Every export of @cheq/core with its signature and file:line, plus the sha256 of the sources it was derived from — the surface a spec may cite and an api/web role may call, readable without opening the package.

## Entry points — what `exports` makes importable

Read from `packages/core/package.json`. An importer can reach a symbol of this package only through one of these specifiers; a file that no row points at is internal, whatever it exports.

| specifier | target | condition | symbols | declared at |
|---|---|---|---|---|
| `@cheq/core` | `packages/core/src/index.ts` | — | `CORE_PACKAGE`, `CreateTask`, `CreateTaskInput`, `CreateTaskOutcome`, `INVALID_TITLE_REASON`, `ListTasks`, `Task`, `TaskStore`, `acceptTitle`, `createTask`, `listTasks` | `packages/core/package.json:9` |
| `@cheq/core/testing` | `packages/core/src/testing/digest.ts` | — | `digest`, `stableStringify` | `packages/core/package.json:10` |

## The public surface — every symbol an importer can reach

| symbol | specifier | kind | signature | declared at |
|---|---|---|---|---|
| `CORE_PACKAGE` | `@cheq/core` | const | `const CORE_PACKAGE = '@cheq/core' as const` | `packages/core/src/index.ts:10` |
| `CreateTask` | `@cheq/core` | type re-export | `type CreateTask = (store: TaskStore, input: CreateTaskInput) => Promise<CreateTaskOutcome>` | `packages/core/src/contracts/CHQ-001/task.ts:54` |
| `CreateTaskInput` | `@cheq/core` | type re-export | `interface CreateTaskInput` | `packages/core/src/contracts/CHQ-001/task.ts:38` |
| `CreateTaskOutcome` | `@cheq/core` | type re-export | `type CreateTaskOutcome = \| { readonly status: 'accepted'; readonly task: Task }` | `packages/core/src/contracts/CHQ-001/task.ts:49` |
| `INVALID_TITLE_REASON` | `@cheq/core` | re-export | `const INVALID_TITLE_REASON = 'title must be a non-empty string'` | `packages/core/src/tasks/title-rule.ts:12` |
| `ListTasks` | `@cheq/core` | type re-export | `type ListTasks = (store: TaskStore) => Promise<readonly Task[]>` | `packages/core/src/contracts/CHQ-001/task.ts:57` |
| `Task` | `@cheq/core` | type re-export | `interface Task` | `packages/core/src/contracts/CHQ-001/task.ts:15` |
| `TaskStore` | `@cheq/core` | type re-export | `interface TaskStore` | `packages/core/src/contracts/CHQ-001/task.ts:26` |
| `acceptTitle` | `@cheq/core` | re-export | `function acceptTitle(title: unknown): string \| undefined` | `packages/core/src/tasks/title-rule.ts:21` |
| `createTask` | `@cheq/core` | re-export | `const createTask: CreateTask = async (store, input) => …` | `packages/core/src/tasks/create-task.ts:11` |
| `digest` | `@cheq/core/testing` | function | `function digest(state: unknown): string` | `packages/core/src/testing/digest.ts:86` |
| `listTasks` | `@cheq/core` | re-export | `const listTasks: ListTasks = (store) => …` | `packages/core/src/tasks/list-tasks.ts:9` |
| `stableStringify` | `@cheq/core/testing` | function | `function stableStringify(state: unknown): string` | `packages/core/src/testing/digest.ts:81` |

## Exported, and NOT part of the surface

An `export` keyword inside the package is not a promise to an importer: only the `exports` map makes one. A symbol here is reachable from a sibling module by a relative import and from nowhere else, so a spec may not cite it and `@cheq/core` may change it without changing its surface.

| symbol | kind | signature | declared at | reach |
|---|---|---|---|---|
| `sha256Hex` | function | `function sha256Hex(text: string): string` | `packages/core/src/testing/sha256.ts:149` | reached from an entry point by a relative import |
| `sha256HexOfBytes` | function | `function sha256HexOfBytes(bytes: readonly number[]): string` | `packages/core/src/testing/sha256.ts:63` | reached from an entry point by a relative import |
| `utf8Bytes` | function | `function utf8Bytes(text: string): number[]` | `packages/core/src/testing/sha256.ts:33` | reached from an entry point by a relative import |

## Sources this projection was derived from

The third column is what the scan found in the file, so a file that contributes nothing says so rather than being absent.

| file | sha256 | found |
|---|---|---|
| `packages/core/package.json` | `d4064709a86e368e4ab32cbe5ce2e82e56e80694a9366379c94eed555b03cbb5` | not scanned (not .ts/.tsx) |
| `packages/core/src/contracts/CHQ-001/task.ts` | `2272311c1bb9dc7dc6ba129c528d1f09801579757be5a9064d5739522ec9e6e0` | 6 exports, 0 re-exports |
| `packages/core/src/index.ts` | `1340f0d759a473396bc84e32056d5ebb7868220b55dd2fc17be91c76276a3f37` | 1 export, 4 re-exports |
| `packages/core/src/tasks/create-task.ts` | `03c1557c6803da7cd4ba0206675804b394ccb19a5f65ab0a1dd4e99953523ac7` | 1 export, 0 re-exports |
| `packages/core/src/tasks/list-tasks.ts` | `c4106b9f50eb51e7f107dcf1bf32df2f73d7f6462ccfd98d6158d08983176da8` | 1 export, 0 re-exports |
| `packages/core/src/tasks/title-rule.ts` | `05cd2de7f789bff261c7ab98d1544e021410b5d86ca66ad938a901933b688e2f` | 2 exports, 0 re-exports |
| `packages/core/src/testing/digest.ts` | `12244e389d67fd1a7a0973d5681906ddab996c81c0c3deaf4d578cb31beb3243` | 2 exports, 0 re-exports |
| `packages/core/src/testing/sha256.ts` | `23477cbe275b767590543261438270b800c6c8068e25f1f541f58473601c0512` | 3 exports, 0 re-exports |

The `sources sha256` in the header is the sha256 of this table as DATA: one `<path> <sha256>` line per row, in the order shown (sorted by code point), each ending in a newline, concatenated and hashed. The key is CONTENT, never mtime — `git checkout` and a restored cache rewrite mtime to "now" and change nothing here.

## What this projection cannot see

- The scan is a TOKEN SCAN over masked source (`tools/gates/lib/test-cases.mjs` → `scanSource`), not an AST: a question about types goes to `tsc`, and a projection that depended on `tsc` would depend on whether `node_modules` is installed, which would make `L-generated` blink on a tree nobody touched.
- Only a STRING LITERAL is read. A value assembled at runtime, or a template literal with a `${…}` substitution, is NAMED as unresolved above rather than guessed at.
- Only STATIC relative edges are followed. A dynamic `import(expr)` is invisible to a token scan, which is why `L-core-purity` refuses one inside the core.
- NO TYPE INFERENCE. A signature is the text the file writes: a `const` with no annotation is shown as written, not as the type `tsc` infers for it, and a signature longer than the fixed width is cut with an ellipsis.
- Declaration merging, overload sets and `namespace` are listed entry by entry as the text writes them, never merged into one symbol.
- A non-relative `export * from '<package>'` cannot be expanded: the names live in another package's files. It is listed as a note above, never dropped.
- A conditional `exports` subpath is listed with every condition and resolved to none — which condition applies is the importer's question. The map is read from the file, not from a resolver.
- "Reached from an entry point" is reachability, not use: it says an import chain exists, not that any call does.
