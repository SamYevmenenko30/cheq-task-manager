# TD-0005: The two-channel cross-check reconciles a run with arithmetic measured on the previous runner

**Status:** Open · the shapes ARE measured and `crossCheck` reconciles them, refusing rather than tie-breaking (`readJestJson` at `tools/gates/lib/jest-json.mjs:94`, the identities at `:198-203`, `crossCheck` at `:222`). Four call sites now import it, so "no gate reads it" is no longer the debt. What is unproven is the ARITHMETIC against the current producer — one identity counted a `.todo` in both channels and this producer does not — plus the fact that no run of record has ever been seen refusing a real disagreement
**Area:** `tools/gates/lib/jest-json.mjs` · `tools/gates/lib/junit-xml.mjs` · `tools/gates/lib/test-cases.mjs` · `tools/gates/fixtures/jest/` · `tools/gates/probes/readers.mjs` · `tools/gates/gate-probes.mjs`
**Raised:** 2026-11-01 · rewritten 2026-11-01, after the measurement this entry asked for was taken · re-scoped 2026-11-02, when the runner changed and the gates landed. The slug still says `never-gated`; the entry no longer does

## What this entry claimed, and what the measurement did to it

~~The Vitest JSON reporter's output on a COLLECTION failure is not measured. It is not known whether
it emits a record per file, a record per suite, an error at the top level, or nothing at all.~~
**Measured 2026-11-01** — and the reader was then written against the observation instead of against
an assumption:

- A file that never collected appears in `testResults` with `status: "failed"`, an empty
  `assertionResults` and the resolution error in `message`, and it contributes **nothing** to
  `numTotalTests` (recorded in the reader's header; the detection is the `collectionFailures` filter
  inside `readJestJson`, `tools/gates/lib/jest-json.mjs`). So the two channels disagree by
  construction on exactly the number of collection failures, and a naive equality cross-check would have answered CANNOT VERIFY
  on every legitimately pending red run.
- The arithmetic that closes instead is three identities, recorded with the digits of the run that
  measured them at `tools/gates/lib/jest-json.mjs:198-203`: XML `tests` equals JSON
  `numTotalTests` plus the collection failures; XML `failures` equals `numFailedTests` plus the same;
  XML `skipped` equals `numPendingTests` plus `numTodoTests`. The third identity was the only place
  the `.skip` / `.todo` distinction survived at all, because the XML of the day wrote `<skipped/>` for
  both. Re-observed 2026-11-01 on a second run of a different shape, also carrying one collection
  failure: the identities closed again, and `crossCheck` answered `agree: true` on both a green run
  and a red one (`crossCheck` is at `:222`).
- **And that is the identity the runner change put in question.** Those three equations were measured
  against a producer that counted a `.todo` in both channels. Whether each of them still closes on the
  current one is **UNVERIFIED in this ledger** — the measurement of record behind this entry does not
  carry the answer, the probe that exercises the arithmetic says in its own cure message that the
  identities belong to the previous runner (`tools/gates/probes/readers.mjs:304-306`), and the
  captured artifacts a re-derivation would read are committed under `tools/gates/fixtures/jest/`. An
  identity that no longer closes does not lie: it answers CANNOT VERIFY, which is loud and in the safe
  direction — but it answers it on every run until somebody re-derives the arithmetic.
- ~~Also not measured on this toolchain: the runner's own listing.~~ Measured 2026-11-01 on the
  previous runner: it exited 0 and printed an array of
  `{ name, file (ABSOLUTE path), projectName, location }`, where `name` was the same
  `"<describe> > <test>"` form the JUnit `testcase name` carries. **That is no longer what a listing
  is.** Measured 2026-11-02: `jest --selectProjects <kind> --listTests --json` prints an array of
  absolute FILE PATHS and not one record per case, and there is no `jest list` subcommand at all. So
  the runner can no longer be asked what cases it would collect — only which files — and the case-level
  enumerator is the textual one in this repository and nothing else
  (`tools/gates/lib/test-cases.mjs:17-36` holds the measured name shapes for the artifact side).

Two things that were right for a different reason are kept. A collection-failed file still has no
`assertionResults`, so the JSON channel knows nothing about any case in it and `jsonCaseStatus`
answers `cannot-verify` naming the file (`tools/gates/lib/jest-json.mjs:277`) — that was never
ignorance about the format, it is ignorance the format faithfully reports. And two counters must not
be compared across channels: `numTotalTestSuites` counts `describe` blocks where the XML counts
files, and a file whose every case is skipped reports `status: "passed"` (both recorded in the
reader's header, `tools/gates/lib/jest-json.mjs:56-59`).

One addition from the current producer belongs in the same list, because it decides what a
cross-check may compare at all: measured 2026-11-02, the JSON's `fullName` joins its ancestor titles
with a SPACE while the XML's `name` joins them with `' > '`. A case name read from one channel is
therefore not a key in the other. `crossCheck` compares COUNTS and is unaffected; anything written
later that matches the two channels by NAME has to normalise first, and the field names themselves
are unchanged (`numTotalTests` / `numPassedTests` / `numFailedTests` / `numPendingTests` /
`numTodoTests`, and per file `{ name, status, message, assertionResults }`), so the reader needed no
edit for any of it.

## What is unproven

**The cross-check is wired in now, and has still never refused a real disagreement.** What changed
since this entry was written is the first half: `crossCheck` is imported and called by the wrapper of
every run of record (`tools/gates/run.mjs:107`), by `red-check` (`tools/gates/red-check.mjs:193`) and
by the parity light (`tools/gates/lights/env-parity.mjs:130`), and a probe group exercises it
(`tools/gates/probes/readers.mjs:81`). "No gate exists to call it" is no longer true and this entry no
longer says so.

What is unproven is narrower and harder. Every disagreement `crossCheck` has ever been handed was
MANUFACTURED: a derived fixture pair whose counters were edited to describe different runs
(`tools/gates/fixtures/jest/counter-mismatch.*`, marked derived in that directory's index, because no
run produces that shape). A real run whose two channels fail to reconcile — one artifact stale beside
a fresh one, a reporter that dropped a file — has never been staged here. And the two kinds of
failure must not be confused: an identity that does not hold on THIS producer is not two channels
describing different runs, it is arithmetic describing a producer it was not measured on, and it is
step 2 below rather than this paragraph. So the identities are still "measured on the runs we have",
and by the second rule of this repository a check nobody has seen fire on a defect it was meant for
is a check nobody has seen.

**And the enumerator-vs-collection comparison lost its subject.** This entry used to owe an
unescaping step: the previous runner's listing **double**-escaped a quotation mark inside a case name
while the XML carries the same character as `&quot;` (measured 2026-11-01), so the list had to be
decoded before the two could be compared. The XML side always had its decoder
(`decodeXml`, `tools/gates/lib/junit-xml.mjs:76`, written because `&apos; &gt; &lt; &amp; &quot;` all
appear in real output, `:22-24`). The list side no longer needs one, because there is no list of
cases: this runner's collection listing names FILES (above), so nothing it prints carries a case name
to escape. The comparison that step was for cannot be done at the case level at all now, and the
textual enumerator is the only thing that knows what cases a file declares. Its agreement with a
runner's own collection was checked by hand once, on 2026-11-01, against a producer that no longer
exists; nothing has checked it since, and nothing can check it the same way.

## Why it is safe right now

- The verdict of record is the JUnit XML, and the JSON artifact has exactly **one** job, counter
  reconciliation; a failure to reconcile is CANNOT VERIFY — never a tie-break in favour of either
  channel (ADR-0002 item 2). The XML's own red signatures carry their own caveat on the current
  producer, stated where it belongs rather than here (ADR-0002 item 5, TD-0004).
- The naming inside the reader is defensive on purpose: `crossCheck` returns
  `{ ok, agree, verdict: 'agree' | 'cannot-verify' }` and never the word green, because a run where
  both channels agree that cases failed is a RED run with agreeing channels, and a field named
  `verdict` holding `'green'` for it would be a label waiting to be misread (the reasoning is in the
  function's own doc comment, `tools/gates/lib/jest-json.mjs:210-221`).
- The runner's own listing stays advisory, now for a measured reason rather than a cautious one: on a
  base revision the implementation does not exist, collection is an import, it throws, and the
  listing comes back empty — so an enumerator built on it would turn "a test was added" into "there
  is nothing to make red" (`tools/gates/lib/test-cases.mjs:3-7`). The gates' own enumerator is
  textual and says `expected: null` where a count cannot be derived instead of guessing one.
- A run that executed nothing cannot read as a verdict, and that guard is in the READER rather than
  in a flag — which is the stronger place for it. Measured 2026-11-02: a `-t` filter matching no case
  exits 0 with `success: true` and every case reported pending, and `--passWithNoTests` does not
  catch it because it governs whether test FILES were found. `readJestJson` therefore refuses any
  report in which `passed + failed` is zero (`tools/gates/lib/jest-json.mjs:167-174`), so the worst
  outcome a mis-read collection failure or a mistyped filter could have produced — success over an
  empty run — is CANNOT VERIFY on both channels.

## What closing it involves

1. ~~**A gate reads `crossCheck`.**~~ Done: four call sites, named above. What is left of this step is
   the part nobody can do by writing code — somebody has to watch one of them refuse.
2. **The arithmetic, re-derived against the current producer.** Each of the three identities read off
   the committed captures rather than off a memory of the previous runner, and the one that counted a
   `.todo` in both channels fixed or explicitly re-stated. The probe that fails today says in its own
   cure message what it measured, which is the shortest path into this step; the entry stays open
   until the identities are the current producer's.
3. **A disagreement that was not manufactured.** A fixture in `tools/gates/gate-probes.mjs --real`
   that makes the two channels describe different runs the way a real one would — the documented way
   is a stale JSON beside a fresh XML — observed answering CANNOT VERIFY and naming the identity that
   failed to close, not a quiet pass. The derived counter-mismatch pair proves the comparison runs; it
   does not prove the comparison would catch a defect nobody staged.

If steps 2 and 3 land and the expected CANNOT VERIFY is observed, this entry closes. If step 3
observes anything else — a disagreement that passes, or an identity that does not close on a shape
nobody planted — it stays open with a different reason, and that reason belongs in the reader's
header beside the measurements it contradicts.
