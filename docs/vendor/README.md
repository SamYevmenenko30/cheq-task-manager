# docs/vendor — API digests of third-party runtime dependencies

An agent does not know a third-party package's API. Without a written surface it guesses member names,
and a guess compiles only by luck — or, worse, typechecks against a `.d.ts` nobody read and fails at
runtime where no lane is looking (`skipLibCheck: true`, `tsconfig.base.json:26`,
[TD-0004](../tech-debt/TD-0004-runner-does-not-typecheck.md)). This folder
holds one digest per **runtime** dependency, written BEFORE any code calls it.

The folder name is lowercase on purpose: this APFS volume is case-insensitive, so `Docs/Vendor` and
`docs/vendor` would be the same directory.

## The rule

- **Every package declared under `dependencies` in any manifest gets `docs/vendor/<package>.md`, in the
  same commit that adds it** — the same commit that carries the `package: <name> — <why>` trailer the
  dependency rule requires. `L-deps` fails a runtime dependency with no digest, and fails a digest
  whose `version:` line disagrees with `pnpm-lock.yaml`.
- **`devDependencies` get no digest, and that asymmetry is deliberate.** A dev dependency here is a
  TOOL whose output is an artifact the gates read — `tsc`, `jest`, `oxlint`, `playwright` — so its
  behaviour is pinned by probes and by the measured artifact shapes (ADR-0002), not by a prose
  description of its API. A runtime dependency is different: our own code calls its members, and a
  wrong member name is a bug a probe will never find for us. A dev dependency that starts being
  imported by shipped code has become a runtime dependency and needs both the manifest move and the
  digest.
- **Code, specs and skills cite a package's members ONLY from its digest**, and the digest cites each
  one from a path on this machine or from an official documentation URL. A member nobody can cite is
  UNVERIFIED: it becomes a question in the spec, never a call in code.
- **A citation path is the real resolved path, not the symlink.** With `node-linker=isolated`
  (`.npmrc:4`) a package in an app's `node_modules` is a symlink into the store — observed 2026-11-01,
  `apps/web/node_modules/react` → `node_modules/.pnpm/react@19.3.1/node_modules/react` — so the honest
  citation is the `.pnpm/<name>@<version>/node_modules/<name>/…:line` form, which carries the version
  in the path and therefore goes stale visibly. Types usually live in a separate package
  (`node_modules/.pnpm/@types+react@19.3.0/node_modules/@types/react/index.d.ts`), and a digest cites
  whichever file actually declares the member.
- **A runtime dependency lives behind an adapter in the app that needs it**, never in `@cheq/core`
  (ADR-0001, ADR-0005). The digest names that adapter file, so "who is allowed to call this package" is
  answerable from one place.
- **A digest is updated in the same commit that bumps its package.** The `version:` line is what makes
  a stale digest visible; the rest of the digest going stale silently is the failure mode this line
  exists to prevent.
- A version number appears in a digest in exactly two places — the `version:` header and inside a
  citation path — and nowhere in prose (ADR-0003).

## The digest template (copy to `docs/vendor/<package>.md`)

```markdown
# <display name> — `<package name as declared>`

- **Version:** <as in pnpm-lock.yaml> · **Declared in:** <manifest path:line> · **Added:** <YYYY-MM-DD, commit sha7> · **Licence:** <name, URL>
- **Adapter:** <the one file that imports it> — nothing else in the repository may
- **Why it is here:** <the spec that needs it: CHQ-<nnn>>
- **Typechecks on this toolchain:** <verified <date>: `tsc.<kind>.log` path | UNVERIFIED>

## Public surface the repository may cite

| member | signature | cited from | notes |
|---|---|---|---|
| `createRoot` | `(container: Element \| DocumentFragment, options?: RootOptions) => Root` | `node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/<file>.d.ts:<line>` | sync vs async, allocation, whether it may run twice |

Only the members this repository actually calls. A digest is not a copy of the upstream docs: a long
digest nobody reads is the same failure as no digest.

## Behaviour facts, each with a citation

- <lifecycle, cleanup, idempotence, error shape — whatever a caller must know and the types do not say>

## UNVERIFIED

- <everything the package's docs promise that nobody has observed on this machine>
```

## Runtime dependencies today — status

Three, none with a digest. Two are already imported, so the rule is in debt the moment it lands; that
is recorded as [TD-0009](../tech-debt/TD-0009-vendor-digests-owed.md) rather than excused.

| package | declared | used | digest |
|---|---|---|---|
| `react` | `apps/web/package.json:9` | `apps/web/src/main.tsx:1` — `StrictMode` | **owed, overdue** (TD-0009) |
| `react-dom` | `apps/web/package.json:10` | `apps/web/src/main.tsx:2` — `createRoot` from `react-dom/client` | **owed, overdue** (TD-0009) |
| `fastify` | `apps/api/package.json:9` | not imported (searched `apps/api/src`, 2026-11-01) | owed before first use |

`@cheq/core` is a workspace package, not a vendor one (`apps/api/package.json:8`,
`apps/web/package.json:8`): its surface is covered by the generated export digest under
`docs/digests/`, which a gate regenerates and byte-compares, and never by a hand-written file here.
