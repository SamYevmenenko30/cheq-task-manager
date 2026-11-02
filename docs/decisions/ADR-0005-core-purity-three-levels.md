# ADR-0005: Core purity is checked at three levels, and the linter is never one of the authoritative two

**Status:** Accepted · **Date:** 2026-11-01

## Context

`@cheq/core` is the layer every `kind: core` assertion is falsified in: rules, the task model,
scheduling, the persistence shape, determinism (`packages/core/package.json:6`). It is worth that only
while it stays free of the DOM, of `node:*`, of the network and of a hidden clock. The question is what
reports a breach, and the answer turned out to be three different mechanisms with three different
failure modes.

**Level 1 bites at the compiler, which is stronger than any rule.** `packages/core/tsconfig.json:7-8`
sets `"lib": ["ES2023"]` and `"types": []`. Measured during setup: `document.title` in that package is
`error TS2584: Cannot find name 'document'.` and `import { readFileSync } from 'node:fs'` is
`error TS2591`. This is not a rule that a comment can switch off — it is the absence of the type.

**A linter has a published bypass, and it works.** Measured 2026-11-01: the file-level
`// oxlint-disable <rule>` DOES suppress a type-aware rule (`-disable-next-line` does not). Three more
doors narrow the lint lane without any diagnostic: `ignorePatterns` (`.oxlintrc.jsonc:60-68`),
`overrides` (`.oxlintrc.jsonc:70-76`), and configuring by category alone, which silently checks less
than it appears to (ADR-0004). A boundary whose only carrier is a linter is a boundary one comment
wide.

**The determinism guard cannot be a lint rule here at all.** Measured: oxlint has no
`no-restricted-syntax` (`Rule 'no-restricted-syntax' not found in plugin 'eslint'`), so the precise AST
selector for "reads the clock" cannot be expressed; and a blanket `no-restricted-globals` on
`Date`/`Math` was the wrong shape — it refused `x instanceof Date` (a type), `new Date(0)` (a fixed
value) and `Math.floor` (arithmetic), none of which is a hidden clock. It was removed from the config
for that reason, and the config records why (`.oxlintrc.jsonc:18-23`).

**The hole that neither the compiler, the dependency graph nor the linter closes.** Recorded
2026-11-01 during setup: `packages/core/src/__esc.ts` with
`import { API_PACKAGE } from '../../../apps/api/src/index.ts'` produced `exit=0` and no diagnostics from
`tsc --noEmit -p packages/core/tsconfig.json`. A relative path is not a package, so the isolated
linker never sees it (ADR-0001). **Not re-observed by this ADR** — the probe file is gone — so it is
UNVERIFIED as of today and the probe below re-proves it.

**Two measurements that decide how level 2 may be written.** Observed 2026-11-01:
`pnpm exec tsc --noEmit --listFiles -p packages/core/tsconfig.json` exits 0 and prints 93 paths (that
run's count — it tracks whatever is in the project, and another session held a probe file in
`packages/core/src` at the time). A handful are the package's own sources and tests; the rest are
**not** at the classic
`typescript/lib/lib.es*.d.ts` path but under
`node_modules/.pnpm/@typescript+typescript-darwin-x64@7.0.2/node_modules/@typescript/typescript-darwin-x64/lib/lib.*.d.ts`
— the native compiler ships its library per platform and version, so an allowlist written from the
classic path would reject every run on this machine. And the closure legitimately contains the test
runner's declarations, because `test/**` is part of the project
(`packages/core/tsconfig.json:11`) and the tests import the runner by bare specifier
(`packages/core/test/skeleton/marker.test.ts:4`). On the day this was measured those declarations
were `vitest/dist/index.d.ts`, `@vitest/mocker`, `expect-type`, `assertion-error`, `@types/chai`,
`tinybench` and `vite/dist/node/module-runner.d.ts` — kept with their date, because that list is
what showed the allowlist needs a class of its own. The import on that line is `@jest/globals`
today, so the NAMES in class 3 are different ones and have not been re-listed: which paths the
closure now carries is UNVERIFIED, while the reason class 3 exists is not. The allowlist is
therefore three classes, not two, one of them machine-shaped and one of them runner-shaped.

## Decision

**Three levels. Each one answers a question the others cannot, and the third never stands alone.**

**Level 1 — the compiler (authoritative; cannot be disabled by a comment).**
`packages/core/tsconfig.json` keeps `"lib": ["ES2023"]`, `"types": []`, `"noEmit": true`, and no
`rootDir`/`outDir` (a measured defect: `rootDir: "src"` with `include: ["test/**/*.ts"]` gives
`error TS6059` for every test file). `L-core-purity` pins those fields from `tsc --showConfig`, which
reports what the compiler actually used rather than what the file appears to say.

**Level 2 — the closure the compiler reports (authoritative; it is the compiler's own answer about
which files it read).** `tsc --noEmit --listFiles -p packages/core/tsconfig.json`, and every path must
fall in one of exactly three classes:

1. under `packages/core/`;
2. the compiler's own library — matched by SHAPE (`…/@typescript/typescript-<platform>/lib/lib.*.d.ts`),
   never by a literal path, because that path carries the platform and the version (measured above);
3. a declared test-runner allowlist, reachable only from `packages/core/test/**`.

Anything else fails, naming the path. This is the level that catches the relative-path escape, a
`paths` alias, a bundler alias and a re-export chain — none of which level 1 or the manifests see. It
carries a **numeric** half as well: the count of files in class 1 under `packages/core/src` equals the
count of tracked `.ts` there (`git ls-files packages/core`), so "I narrowed `include` and everything
went green" shows up as a failure rather than as a speed-up.

**Level 3 — a token scan over `codeOnly` text (the only guard against a hidden clock).** Over
`packages/core/**`, **including `test/**`**, on text with comments, string literals and template
substitutions cut out. Forbidden: `Date.now(`, `new Date()` with an EMPTY argument list,
`Math.random(`, `performance.now(`. Allowed: `new Date(<argument>)`, `instanceof Date`, `Date` as a
type, and every other member of `Math`. The probe is required in BOTH directions — `new Date()` must
fail and `new Date(0)` must pass — because a scan that only ever fires has not been shown to
discriminate.

Two refusals belong to the same light, because each would make a level blind: a nested `package.json`
or `tsconfig.json` under `packages/core/src` is REFUSED (it would split the project the gate reads from
the files that actually compile), and a non-literal `import(expr)` in the core is REFUSED (no static
closure can see where it goes).

**Lint is a fourth, non-authoritative channel.** It is kept because it gives a readable message earlier
than a type error does, and it is never the only thing standing between the core and an import it
should not have. `L-lint` fails on a file-level `oxlint-disable` naming a boundary rule and on
`number_of_files === 0` (ADR-0002, ADR-0004).

**Why not the linter alone:** its bypass is documented, measured and one line long; its ignore list,
its overrides and its category-only configuration each narrow it silently; and the one rule family that
would express determinism does not exist in it. Level 1 cannot be bypassed because there is no type to
bypass, and level 2 is the compiler reporting on itself.

## Consequences

- Gains: the boundary that matters most in this repository is carried by the two mechanisms that cannot
  be talked out of it, and the relative-path hole — the one thing nothing else sees — has an owner.
  Determinism is guarded precisely instead of by a rule that refused arithmetic.
- Costs: level 2 must DERIVE its library allowlist from the compiler rather than hard-code it, so the
  light has to tolerate the path shape changing with platform, architecture and version. Level 3 is a
  token scan, which means it can be fooled by text the scan is not shaped for; it is a third channel,
  not a proof.
- The numeric half of level 2 was CANNOT VERIFY for a measured reason, and the reason has expired:
  `git ls-files packages/core` returned **zero** on 2026-11-01 because the repository had no commits,
  so the comparison had nothing to compare against. It became meaningful at the first commit, and the
  count it yields is read from that command rather than written here (ADR-0003). The light still
  reports `cannot-verify (no commit yet)` and not pass in a repository that has none — a fresh
  worktree before its first commit is that state.
- What stays UNVERIFIED: the relative-path escape itself, re-proved by the `gate-probes` fixture that
  plants it and must see `L-core-purity` fail; and the membership of class 3, which is no longer a
  question about a version bump. The runner was REPLACED on 2026-11-02, so every name class 3 held
  was replaced with it, and nothing has re-listed the closure since. That is the silent-widening
  failure mode this bullet predicted, arriving as a swap rather than as a bump: class 3 is read from
  the closure, so it admits whatever the new runner drags in until the numeric half or an explicit
  allowlist names the change.
- Changing any of the three levels, or the allowlist classes, is a `gate:` commit amending this ADR.
  Adding a fourth authoritative level is not the same thing as making the linter one.
