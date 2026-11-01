# TD-0003: The enabled lint rule set is a hand-written list — `require-await` exists and is simply not enabled

**Status:** Open · a config gap, measured, not a capability gap; the type verdict is `tsc`'s and never the linter's
**Area:** `.oxlintrc.jsonc` · `tools/gates/lights/lint.mjs` · `tools/gates/gate-probes.mjs`
**Raised:** 2026-11-01

## What is unproven

That the rules enabled in `.oxlintrc.jsonc:39-58` cover the bug classes the lint lane is there for.
Nothing asserts the list; it is a list somebody wrote.

Two measurements show why that is not a theoretical worry.

**The `any`-leak family was missing until it was named.** Those rules are in no default category, so a
first comparison of oxlint against eslint came out wrong: oxlint looked incapable when it was merely
unconfigured. They are now named one by one (`.oxlintrc.jsonc:48-54`) and the config says why
(`.oxlintrc.jsonc:13-15`).

**`require-await` is the same trap, still open.** It was recorded as the one rule oxlint lacks. It
does not lack it. Observed 2026-11-01 on a planted `export async function f(): Promise<number> { return 1; }`:

```
$ oxlint -c <cfg with "require-await": "error"> …
a.ts:1:23: error eslint(require-await): Async function has no `await` expression.   exit=1
$ oxlint --type-aware -c <cfg with "typescript/require-await": "error"> …
a.ts:1:1: error typescript(require-await): Function has no 'await' expression.      exit=1
```

Neither id appears in `.oxlintrc.jsonc:39-58`, so neither runs. And the typed one is silent without
`--type-aware` — same config, same file, `exit=0` and no output — which is a fresh demonstration that
the flag is load-bearing (ADR-0004).

What is unproven is therefore the general claim, not this one rule: **the list is not checked against
anything**, and the next missing family will look like a capability gap too.

## Why it is safe right now

- The lint lane is never the verdict about types. `tsc --noEmit` is (ADR-0004), and a `green:` trailer
  never cites a lint artifact.
- The tool refuses its own typos: an unknown rule or plugin is a hard parse failure with exit 1, not a
  warning (measured 2026-11-01), so the trap "the config looks configured and checks nothing" is
  closed by oxlint itself for *misspelled* ids. It is open only for *absent* ones.
- `L-lint` reads `number_of_files` from the JSON artifact and answers CANNOT VERIFY on `0`, so a run
  that linted nothing cannot pass; and it records whether `--type-aware` was in `argv` (ADR-0002).
- The determinism half of core purity does **not** depend on the linter at all: it is a token scan in
  `L-core-purity` (ADR-0005), precisely because a lint rule was the wrong shape for it.

## What closing it involves

Two separate pieces of work, and only the first is cheap:

1. **The named rule.** Add `typescript/require-await` to `.oxlintrc.jsonc` `rules` with severity
   `error`, and add a `gate-probes` fixture: a planted `async` function with no `await` must be caught
   WITH `--type-aware` and must come out green WITHOUT it. One line plus a probe. It is a `gate:`
   commit because the enabled rule set is part of what the lint lane means.
2. **The general claim.** `L-lint` asserts NUMERICALLY that a declared list of mandatory rule ids is
   present in `.oxlintrc.jsonc` → `rules` with severity `error`, so that removing one is a failure
   rather than a quiet relaxation. That still does not prove the list is complete — completeness is
   closed only by planted-defect probes, one fixture per bug class, which is the same instrument that
   found the `any`-leak gap and this one.

Until piece 2 exists, "the linter covers X" is UNVERIFIED for every X that no fixture plants.
