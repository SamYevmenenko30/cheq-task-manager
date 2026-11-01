# ADR-0004: One type engine — `tsc` is the verdict of record, and the linter runs on the same engine line

**Status:** Accepted · **Date:** 2026-11-01

> Versions appear below for two reasons only: as a citation of `pnpm-lock.yaml`, and as the historical
> record of a comparison nobody can re-run because the arrangement it measured is gone. The versions
> that are installed right now are read with `node tools/gates/status.mjs`, never from this file
> (ADR-0003).

## Context

**ESLint cannot lint TypeScript in this repository at all.** `typescript-eslint` refuses TypeScript 7
outright. The error, observed verbatim during this repository's setup (2026-11-01):

```
Error: typescript-eslint does not support TS 7.0.
See https://github.com/typescript-eslint/typescript-eslint/issues/10940
```

No published version supports it: at the time of that check the registry's `latest` was 8.72.1, there
was no `next` tag, and the newest canary (8.72.2-alpha.4) carried the same peer range
`typescript >=4.8.4 <6.1.0`. `typescript-eslint` is the *only* TypeScript parser for ESLint, so with
TypeScript 7 in the tree ESLint has nothing to parse `.ts` with. (The registry state is a 2026-11-01
observation and is not re-checked by this ADR; the refusal itself is the project's own, at the issue
above.)

**The two-engine arrangement was built, verified working, and then reversed.** It is NOT in the
repository: nothing under `tools/` is a workspace package today (`pnpm-workspace.yaml:4` matches
nothing), and the lock declares neither `eslint` nor `typescript-eslint` nor `@typescript-eslint/*` —
zero matches across `pnpm-lock.yaml` (2026-11-01). Its shape was: `tsc` 7 at the root for the verdict,
plus a `tools/lint` package (`@cheq/lint`) carrying its own `typescript@6.0.3` so that
`typescript-eslint` could run inside it. It worked. It was removed for three reasons, in order of
weight:

1. **Fragility with a named trigger.** The arrangement broke the moment the ROOT declared
   `typescript-eslint`, because pnpm then reused the root-peered parser. Nothing in the repository
   could have refused that declaration; it would simply have stopped the typed rules from running, and
   a lint run that checks nothing looks exactly like a lint run that finds nothing.
2. **Two engines can disagree with the verdict.** A typed lint rule reasons about types with a
   different compiler from the one whose output is the verdict of record (ADR-0002). When they
   disagree, there is no honest tie-break: the lint rule is either ignored, which makes it decorative,
   or believed, which makes the verdict ambiguous.
3. **Cost, measured.** `tsc` 7.0.2 typechecked `packages/core` in 233–260 ms; `tsc` 6.0.3 on the same
   project took 666–1126 ms — about 2.8x, already at 25 files. **This is a historical measurement of a
   configuration that no longer exists** (ADR-0003's labelled exception): TypeScript 6 is not in the
   tree, so the figure cannot be re-read and is not a budget for anything.

**What replaced it runs on the same engine line.** `oxlint` brings its own parser and has no
dependency on the `typescript` package; its type-aware rules run on `oxlint-tsgolint`, which is
typescript-go — the TypeScript 7 line. So the repository has one type engine and the linter is not a
second one. Coverage was not assumed: six defects were planted in `packages/core` and both linters
run over them (2026-11-01). `oxlint --type-aware` caught the floating promise
(`typescript/no-floating-promises`), the misused promise (`typescript/no-misused-promises`), `await 42`
(`typescript/await-thenable` plus `unicorn/no-unnecessary-await`), the `any` leak
(`no-explicit-any` + `no-unsafe-return` + `no-unsafe-member-access`), `new Date()` in core and
`document.title` in core.

**The trap that made the first comparison wrong, and the one that remains.** The `any`-leak family
looked MISSING from oxlint. It was not a capability gap but a config gap: those rules are in no default
category and must be named in `rules`. A linter configured by category alone silently checks less than
it appears to — which is why `.oxlintrc.jsonc:48-54` lists that family by name and says so in its own
comment (`.oxlintrc.jsonc:13-15`). The remaining trap is the same shape and is measured in the
Consequences below.

**Two things the tool itself already guards, so no light needs to.** Measured 2026-11-01: an unknown
rule or plugin is a hard parse failure, not a warning —

```
Failed to parse oxlint configuration file.
  x Rule 'no-such-rule' not found in plugin 'typescript'      exit=1
```

— so a typo in the config cannot become a gate that checks nothing. And `.oxlintrc.json` together with
`.oxlintrc.jsonc` is refused by oxlint outright; the repository holds only `.oxlintrc.jsonc`, which is
also what permits the comments it is full of (a `"//"` key is rejected as an unknown field).

## Decision

**One type engine. `tsc` is the verdict of record about types; the linter never is.**

- The compilation verdict is `tsc --noEmit -p <package>/tsconfig.json` (TypeScript 7.0.2,
  `pnpm-lock.yaml:1277`), read from `tsc.<kind>.log` (ADR-0002). A typed lint rule is never cited as
  evidence that types are sound, and a `green:` trailer never points at a lint artifact.
- The lint lane is `oxlint` + `oxlint-tsgolint` (`pnpm-lock.yaml:32-37`), configured by
  `.oxlintrc.jsonc` at the repository root. It exists to catch what `tsc --noEmit` does *not* report:
  floating and misused promises, `await` on a non-thenable, the `any`-leak family
  (`.oxlintrc.jsonc:43-57`).
- **`--type-aware` is mandatory.** Every lint command in `package.json` and in every gate carries it;
  the flag is written into `run.json`; a run whose `argv` lacks it is CANNOT VERIFY, never pass
  (ADR-0002 item 4). `gate-probes` carries the probe that gives the flag its meaning: the same planted
  floating promise must come out GREEN without the flag.
- **`L-type-engines` guards the singleton.** It fails unless all three hold: `git show
  HEAD:pnpm-lock.yaml` contains exactly one version of the package `typescript`; no manifest in HEAD
  declares `eslint`, `typescript-eslint` or `@typescript-eslint/*`; and `oxlint-tsgolint`'s major
  equals `typescript`'s major (both on line 7 today). Any divergence fails with both versions in
  `detail`. This is the honest replacement for a parity light: with one engine there is no parity to
  check, but the *singleness* must be checked, or it quietly stops being true.
- **Lint suppression is a boundary matter, not a style matter.** Measured 2026-11-01: only the
  file-level `// oxlint-disable <rule>` suppresses a type-aware rule; `-disable-next-line` does not,
  with or without the plugin prefix, and an `eslint-disable` comment suppresses nothing here at all.
  `L-lint` fails on a file-level disable naming a boundary rule and reports an `eslint-disable`
  comment too — it changes nothing, but it means somebody tried. (The behaviour of
  `-disable-next-line` on NON-type-aware rules is UNVERIFIED; only a type-aware rule was probed.)

## Consequences

- Gains: one compiler reasons about types in this repository, so the lint lane and the verdict can
  never be about different type systems. No second `typescript` in the tree, no `eslint` plugin set to
  keep aligned, and the lint lane has no dependency on the `typescript` package at all. The lint
  artifact is machine-readable with a measured shape (ADR-0002).
- Costs: the ESLint ecosystem is unavailable — any rule that exists only as an ESLint plugin cannot be
  used, and the answer is a light with a probe, not a second engine.
- **Correction to the record, measured 2026-11-01.** `require-await` was reported as the one rule
  oxlint does not have. It has it, twice: `eslint(require-await)` fires without any flag, and
  `typescript(require-await)` fires under `--type-aware` (both observed on a planted
  `async function` with no `await`). The gap is therefore a CONFIG gap — neither id appears in
  `.oxlintrc.jsonc:39-58` — which is the very trap the `any`-leak family already demonstrated. Tracked
  as TD-0003, and the fix is one line plus a probe, not a new engine.
- What stays UNVERIFIED: that `oxlint-tsgolint` and `tsc` agree about types. They are the same line,
  not the same binary (7.0.2005 against 7.0.2), and no probe compares a diagnostic set across the two.
  `L-type-engines` pins the major and nothing finer (TD-0008).
- **Revisit when** `typescript-eslint` supports TypeScript ≥ 7.1 — ESLint then becomes usable *without*
  a second engine, and this ADR is re-argued on merit rather than on the refusal above. Revisit sooner
  if a planted-defect probe shows a rule family oxlint genuinely lacks; "genuinely" means the rule id
  does not exist, measured the way `require-await` was measured here — not that a run came back quiet.
