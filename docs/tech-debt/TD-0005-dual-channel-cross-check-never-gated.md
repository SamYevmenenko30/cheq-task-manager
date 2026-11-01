# TD-0005: Both channels of a run are measured and reconciled — and no gate has ever read them

**Status:** Open · the shapes ARE measured (`tools/gates/lib/vitest-json.mjs:24-59`, `:165-170`) and `crossCheck` reconciles them; what is unproven is the cross-check **as a gate** — nothing reads it yet — and the enumerator-vs-collection comparison still needs an unescaping step nobody has written
**Area:** `tools/gates/lib/vitest-json.mjs` · `tools/gates/lib/junit-xml.mjs` · `tools/gates/lib/test-cases.mjs` · `tools/gates/gate-probes.mjs`
**Raised:** 2026-11-01 · rewritten 2026-11-01, after the measurement this entry asked for was taken

## What this entry claimed, and what the measurement did to it

~~The Vitest JSON reporter's output on a COLLECTION failure is not measured. It is not known whether
it emits a record per file, a record per suite, an error at the top level, or nothing at all.~~
**Measured 2026-11-01** — and the reader was then written against the observation instead of against
an assumption:

- A file that never collected appears in `testResults` with `status: "failed"`, an empty
  `assertionResults` and the resolution error in `message`, and it contributes **nothing** to
  `numTotalTests` (`tools/gates/lib/vitest-json.mjs:38-40`; the detection is `:126-129`). So the two
  channels disagree by construction on exactly the number of collection failures, and a naive
  equality cross-check would have answered CANNOT VERIFY on every legitimately pending red run.
- The arithmetic that closes instead is three identities, recorded with the digits of the run that
  measured them at `tools/gates/lib/vitest-json.mjs:165-170`: XML `tests` equals JSON
  `numTotalTests` plus the collection failures; XML `failures` equals `numFailedTests` plus the same;
  XML `skipped` equals `numPendingTests` plus `numTodoTests`. The third identity is the only place
  the `.skip` / `.todo` distinction survives at all — the XML writes `<skipped/>` for both.
  Re-observed 2026-11-01 on a second run of a different shape, also carrying one collection failure:
  the identities closed again, and `crossCheck` answered `agree: true` on both a green run and a red
  one (`:189-227`).
- ~~Also not measured on this toolchain: `vitest list --json`.~~ Measured the same day: it exits 0
  and prints an array of `{ name, file (ABSOLUTE path), projectName, location }`, where `name` is the
  same `"<describe> > <test>"` form the JUnit `testcase name` carries
  (`tools/gates/lib/test-cases.mjs:17-36` holds the measured name shapes for the artifact side).

Two things that were right for a different reason are kept. A collection-failed file still has no
`assertionResults`, so the JSON channel knows nothing about any case in it and `jsonCaseStatus`
answers `cannot-verify` naming the file (`tools/gates/lib/vitest-json.mjs:244-252`) — that was never
ignorance about the format, it is ignorance the format faithfully reports. And two counters must not
be compared across channels: `numTotalTestSuites` counts `describe` blocks where the XML counts
files, and a file whose every case is skipped reports `status: "passed"`
(`tools/gates/lib/vitest-json.mjs:55-59`).

## What is unproven

**The cross-check has never run as a gate, because no gate exists to run it.** `tools/gates/` holds
`lib/` and nothing else today: the readers are written, the gates that would consume them are not.
So every sentence about what a disagreement *does* — blocks, prints CANNOT VERIFY, names which
channel is unusable — describes a function's return value and not an observed verdict. By the second
rule of this repository a gate nobody has seen fail is a gate nobody has seen; here there is not yet
a gate at all, and `crossCheck` has never been handed two artifacts that genuinely disagree. The
identities were measured on runs where they closed; a run where they do NOT close has never existed
on this machine.

**And the enumerator-vs-collection comparison needs a step nobody has written.** `vitest list --json`
**double**-escapes a quotation mark inside a case name (`hashes \\"abc\\"`) while the XML carries the
same character as `&quot;` — measured 2026-11-01. The XML is the artifact of record and already has
its decoder (`tools/gates/lib/junit-xml.mjs:75`, written because `&apos; &gt; &lt; &amp; &quot;` all
appear in real output, `:20-25`); the **list** is the side that must be unescaped before the two can
be compared, and there is no counterpart to `decodeXml` for it anywhere in `tools/gates/lib/`. The
comparison itself was done by hand that day — the textual enumerator agreed with the runner's
collection on every case of the skeleton tree, after unescaping — which proves the enumerator and
makes the missing step a small one, not an absent one.

## Why it is safe right now

- The verdict of record is the JUnit XML, whose signatures are measured (ADR-0002 item 5). The JSON
  artifact has exactly **one** job, counter reconciliation, and a failure to reconcile is CANNOT
  VERIFY — never a tie-break in favour of either channel (ADR-0002 item 2).
- The naming inside the reader is defensive on purpose: `crossCheck` returns
  `{ ok, agree, verdict: 'agree' | 'cannot-verify' }` and never the word green, because a run where
  both channels agree that cases failed is a RED run with agreeing channels, and a field named
  `verdict` holding `'green'` for it would be a label waiting to be misread
  (`tools/gates/lib/vitest-json.mjs:179-188`).
- `vitest list --json` stays advisory, now for a measured reason rather than a cautious one: on a
  base revision the implementation does not exist, collection throws and the listing comes back
  empty, so an enumerator built on it would turn "a test was added" into "there is nothing to make
  red" (`tools/gates/lib/test-cases.mjs:3-7`). The gates' own enumerator is textual and says
  `expected: null` where a count cannot be derived instead of guessing one.
- `passWithNoTests` is never set, and its absence is documented in the config as part of the verdict
  (`vitest.config.ts:9-11`), so a run that matched nothing fails loudly rather than reporting success
  over an empty suite — the worst outcome a mis-read collection failure could have produced.

## What closing it involves

1. **A gate reads `crossCheck`.** Whichever gate owns a test run of record calls it on the pair of
   artifacts it just wrote and refuses to print a verdict without it. Until one does, this entry
   stays open with that as its whole reason.
2. **A disagreement fixture in `tools/gates/gate-probes.mjs --real`**: make the two channels describe
   different runs on purpose — the documented way is a stale JSON beside a fresh XML — and observe
   CANNOT VERIFY naming the identity that failed to close, not a quiet pass. That probe is what
   turns "the arithmetic closes on the runs we have" into "the arithmetic is checked".
3. **The unescaping step.** A `decodeVitestList` beside `decodeXml`, with the double-escape case as
   its fixture, after which the enumerator-vs-collection comparison can run unattended instead of by
   hand. Cheap, and it is the one piece of this entry nobody needs a decision for.

If step 1 lands and step 2 observes the expected CANNOT VERIFY, this entry closes. If step 2 observes
anything else — a disagreement that passes, or an identity that does not close on a shape nobody
planted — it stays open with a different reason, and that reason belongs in the reader's header
beside the measurements it contradicts.
