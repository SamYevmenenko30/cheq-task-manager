# TD-0021: a `Yn`'s `carrier:` is documented, written, parsed to `null`, and read by nobody

**Status:** Open · costs nothing today because no gate reads the field; it will cost the first thing that does
**Area:** `tools/gates/lib/spec-parse.mjs` (`parseSyrup`) · `docs/templates/SPEC.md` · `tools/gates/probes/gates.mjs:972,979,985`
**Raised:** 2026-11-02

## What is unproven

`docs/templates/SPEC.md` documents a syrup item as

    - **Y1** "<verbatim sentence from the Vision>" · carrier: <module|route|screen|action noun | none>

and three probes write exactly that form (`tools/gates/probes/gates.mjs:972,979,985`). Measured on
2026-11-02 while writing CHQ-003 — the first spec in this repository with a live `## Syrup` list:

| written as | `carrier` reads |
|---|---|
| `"…" · carrier: module` (the documented form) | `null` |
| `"…" carrier: module` | `"module"` |
| `"…"  ·  carrier: module` | `null` |
| `"…" — carrier: module` | `null` |

The cause is in `parseSyrup`: the quote is matched with `/^["“«](.*?)["”»]\s*(.*)$/`, whose `\s*`
consumes the space before the `·`, so `parsePairs` is handed a string that BEGINS with the separator
and finds no `key: value` in it. The template and the probes are right about the intended form; the
reader is wrong.

## Why it costs nothing yet

Nothing reads the field. `spec-gate` names `carrier` only inside the text of a warning about missing
quotation marks (`tools/gates/spec-gate.mjs:740`); rule 8 judges `verbatim` and `quoted` and never
the carrier. So CHQ-003's three `Yn` items carry `carrier: null` and the gate passes, correctly.

The debt is that the field exists, the template asks authors to fill it, authors do, and the value is
discarded in silence. The purpose of a carrier is to tell a human WHERE to look to judge a sentence
no runner can falsify — which is exactly the kind of thing that is noticed only when somebody tries
to use it and finds every spec has none.

## Why CHQ-003 did not fix it

Fixing `parseSyrum` is one line, and a gate change is a declared decision: a `gate:` subject, an ADR
or TD line, and a probe that fails on the code as it was (`docs/knowledge/process.md:152`). The
spec-harden phase writes a spec; it does not change the gates that judge it, and a parser change
folded into a `docs(spec):` commit would be a gate change nobody declared.

CHQ-003 therefore keeps the DOCUMENTED form rather than the one that happens to parse, so that the
repository stays self-consistent with its own template and its own probes and the fix is a one-line
change to the reader rather than an edit of every spec.

## What would discharge it

In `parseSyrup`, strip a leading separator before parsing the pairs — `parsePairs(rest.replace(/^·\s*/, ''))`
— and add a probe asserting `carrier` reads `"screen"` from the template's own form, which fails on
the reader as it is. The alternative, changing the template and the three probes to the separator-less
form, is worse: it would make the syrup line the only `key: value` list in the format that does not
use ` · `.
