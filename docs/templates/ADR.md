# ADR-XXXX: <decision title>

<!-- One file per decision: docs/decisions/ADR-XXXX-<kebab-title>.md, numbered in order and never
renumbered. A change to a gate is a DECLARED decision: commit subject `gate: …` plus a line naming an
ADR or a tech-debt entry, and a probe in tools/gates/gate-probes.mjs that FAILS against the gate as it
was before the change (rule 13). `tools/gates/` does not exist yet — verified 2026-11-01: `tools/` is an
empty directory and `git ls-files` prints nothing — so the probe named in an ADR written today is a
commitment, and the ADR says so in its own Consequences. Delete these comments. -->

## Context

(What choice was at hand and which constraints applied. A fact cited here carries its proof: `path:line`
from `node tools/gates/project.mjs` or from git, a documentation URL, or the measured run that produced
it — a figure or a behaviour with none of those is written UNVERIFIED, in that word. A version comes
from `pnpm-lock.yaml`, never from memory.)

## Decision

(What we decided, present tense, one or two paragraphs: "we use…". Name the file the decision lives in,
so the next reader changes the decision and the file together.)

## Consequences

(What this gains and what it costs: what becomes harder, what is fixed forever, what can be revisited
and on what signal. What stays UNVERIFIED on this machine, and which probe in
tools/gates/gate-probes.mjs closes it — a consequence nobody can falsify is a wish, not a consequence.)

## Status

Proposed | Accepted | Superseded by ADR-YYYY · **Date:** YYYY-MM-DD · **Author:** <human/agent>
