# TD-0009: Three runtime dependencies have no API digest, and two of them are already imported

**Status:** Open · `react` and `react-dom/client` are used with no digest; `fastify` is declared and not yet imported
**Area:** `docs/vendor/` · `apps/web/package.json:7-11` · `apps/api/package.json:7-10` · `tools/gates/lights/deps.mjs`
**Raised:** 2026-11-01

## What is wrong

The vendor rule says a runtime dependency gets `docs/vendor/<pkg>.md` BEFORE its first use, in the same
commit as the `package:` trailer that declares it ([docs/vendor/README.md](../vendor/README.md)). Three
runtime dependencies exist today and none has a digest:

| package | declared | imported | state |
|---|---|---|---|
| `react` | `apps/web/package.json:9` | `apps/web/src/main.tsx:1` (`StrictMode`) | **used with no digest** |
| `react-dom` | `apps/web/package.json:10` | `apps/web/src/main.tsx:2` (`react-dom/client`, `createRoot`) | **used with no digest** |
| `fastify` | `apps/api/package.json:9` | not imported anywhere (searched `apps/api/src`, 2026-11-01) | digest owed before first use, not overdue |

So the rule is in debt at the moment it lands, for two packages out of three. That is recorded rather
than papered over, because the alternative — carving out an exception for "obvious" packages — is how a
rule stops meaning anything. `@cheq/core` is a workspace package, not a vendor one: its surface is
covered by the generated export digest, not by this folder.

## Why it is safe right now

- The two undocumented imports are the Vite/React entry point and nothing else
  (`apps/web/src/main.tsx:1-4`): four lines, no API surface an agent has to guess at, and no spec
  assertion depends on either call.
- The rule's purpose is to stop an agent inventing method names on a surface it has not read. The
  `createRoot`/`StrictMode` pair is already written and typechecks, so there is nothing being guessed
  at today — the exposure begins at the first non-trivial React API (hooks, `Suspense`, concurrent
  features) and at the first Fastify route.
- `fastify` being declared-but-unused is the normal state the rule is designed for: the digest is due
  in the commit that first imports it, which is a commit nobody has written.
- No gate enforces this yet, which is the honest part of the entry: `L-deps` is specified to fail a
  runtime dependency without a digest in the same range, and it does not exist.

## What closing it involves

1. `docs/vendor/react.md` and `docs/vendor/react-dom.md`, each citing every member the repository
   actually calls from `node_modules/<pkg>/…:line` or from an official documentation URL, with a
   `version:` line that makes the digest visibly stale against `pnpm-lock.yaml`. Only the members in
   use — a digest is not a copy of the upstream docs.
2. `docs/vendor/fastify.md` in the commit that first imports it, not before and not after.
3. `L-deps`: a runtime dependency in any manifest with no `docs/vendor/<pkg>.md` is a failure, and a
   digest whose `version:` differs from the lock is a failure. That is what turns this entry from a
   promise into a check — and it is also what will refuse the next commit here until step 1 is done, so
   the two land in an order somebody chooses deliberately.
