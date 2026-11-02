# TD-0017: the image's entry point is checked; the Dockerfile's agreement with itself is not

**Status:** Open · `L-orphans` reads the esbuild entry and refuses a path the repository does not hold; the `COPY` ↔ `CMD` link behind it is checked by nothing
**Area:** `tools/gates/lights/orphans.mjs` (`containerEntries`) · `Dockerfile`
**Raised:** 2026-11-02

## What is checked, and why it had to be

`apps/api/src/server.ts` binds the port, so nothing in this repository imports it. To `L-orphans`
that made it dead code: "nothing imports this module — no entry point of `apps/api`
(`apps/api/src/index.ts`) and no test reaches it", measured 2026-11-02 on the commit that added it.

The module is not dead — it is the OUTERMOST caller, and the Dockerfile is where that is declared.
So the light reads the Dockerfile: the first positional argument of `RUN … esbuild <path>`, with
backslash continuations joined, becomes an entry-point seed for whichever package holds it. Putting a
second declaration in `apps/api/package.json` was the alternative and was rejected — two
declarations of one fact can disagree, and the one a `docker build` obeys is the Dockerfile.

That buys a check in the other direction for free, and it is the reason this is worth doing rather
than suppressing the row: **a path the Dockerfile names and this repository does not hold is now a
problem of this light.** Measured by planting it — `apps/api/src/renamed-by-nobody.ts` →
`Dockerfile:50: names "apps/api/src/renamed-by-nobody.ts" as an entry point of the image and this
repository holds no such file`, plus the orphan row for the real `server.ts`; and with the Dockerfile
removed entirely, the orphan row returns alone with a note saying no container entry is declared.

## What is NOT checked

The entry point is one of three paths the Dockerfile spells, and the other two it only spells to
itself. Both links were measured on 2026-11-02, with the real image:

| link | planted how | what happened |
|---|---|---|
| `--outfile=/build/server.cjs` ↔ `COPY --from=builder /build/server.cjs` | the builder's outfile renamed to `/build/renamed.cjs` | **`docker build` fails**, exit 1: `failed to compute cache key … "/build/server.cjs": not found`. Docker itself refuses a `COPY` of a file no stage produced, so nothing here needs to |
| `COPY … ./server.cjs` ↔ `CMD ["node", "server.cjs"]` | `node app.cjs` in place of the CMD's argument | **the build succeeds and the container starts**, then exits 1 with `Error: Cannot find module '/app/app.cjs'`. Nothing in this repository notices — not a light, not a type verdict, not a test |

So the silent one is the last link, between what the runtime stage COPIES and what its CMD runs. A
rename there ships an image that builds, passes every gate, pushes to a registry and dies on the
first start, and the first thing that would say so is a deployment.

## Why it is bounded

The parse is narrow on purpose: `RUN` lines mentioning `esbuild`, non-flag tokens only. A Dockerfile
that bundles with something else, or does not bundle at all, produces a NOTE and no seed — and that
note is in the light's detail on a pass too, so a green row cannot be confused with a Dockerfile this
reader silently failed to understand. The seed is also filtered to the package's own `src/`, so a
Dockerfile cannot make a module of some other package look reached.

The residual exposure is one image with one entry file. It grows the moment a second service, a
second stage or a non-trivial `CMD` arrives.

## What would discharge it

The same parse already has the tokens: `--outfile`'s value, the `COPY` destinations of the final
stage, and the `CMD` array's argument. Checking that the CMD's script is a path some `COPY` of its
own stage placed is a handful of lines on top of `containerEntries`, and it is deliberately not
written yet — the function is being added to clear one red row, and widening it into a general
Dockerfile checker in the same commit would make the change no reviewer could judge.

The wider alternative is to stop reading the Dockerfile as text at all and read the BUILT IMAGE
instead — `docker inspect` reports the real `Cmd` and the layers hold the real files, so the
agreement becomes an observation rather than a parse. That needs a container lane with a docker
premise, which this repository does not have (`BROWSER_PROBE` is the only premise of that shape
today, TD-0001), and it cannot run where docker is absent.
