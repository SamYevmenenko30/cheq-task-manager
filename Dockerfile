# The API's production image. Two stages, and the runtime one carries no toolchain at all.
#
# WHY THERE IS A BUNDLE STEP, because it is the one decision here worth explaining. `@cheq/core`
# exports TypeScript SOURCE — `"exports": { ".": "./src/index.ts" }` (packages/core/package.json)
# — and every project is `noEmit` with `allowImportingTsExtensions`, so `apps/api` imports
# `./app.ts` by that spelling. Node cannot load either. MEASURED 2026-11-02:
#
#   - `tsc` refuses to emit at all under those options: `error TS5096: Option
#     'allowImportingTsExtensions' can only be used when one of 'noEmit', 'emitDeclarationOnly',
#     or 'rewriteRelativeImportExtensions' is set`. That third option rewrites `./app.ts` to
#     `./app.js` and would work for THIS package — but it does nothing for `@cheq/core`, which the
#     runtime would still have to resolve to a `.ts` file.
#   - `node --experimental-strip-types` would run the sources directly. It is experimental, it
#     prints a warning on every start, and "experimental flag in production" is a fair question to
#     be asked at a review.
#
# So the sources are bundled: esbuild follows `@cheq/core` and every relative `.ts` import,
# inlines them, and emits one CommonJS file with no import specifier left to resolve. Fastify is
# inlined too (measured: it bundles and serves), which is why the runtime stage installs NOTHING —
# no `node_modules`, no package manager, no lockfile, nothing to audit at run time.
#
# The cost, stated rather than hidden: a stack trace from the image points into the bundle, not
# into `apps/api/src`. `--sourcemap` would cure that and is deliberately not on here — it doubles
# the image's JavaScript for a deployment nobody debugs by hand. TD if that changes.

# ───────────────────────────────────────────────────────────────────────── builder
FROM node:22-alpine AS builder

WORKDIR /build

# corepack pins the package manager from package.json's `packageManager` field, so the install
# here uses the same pnpm the repository declares rather than whatever the base image ships.
RUN corepack enable

# The manifests first, on their own layer: they change far less often than the sources, so a
# source-only edit reuses the installed dependencies instead of resolving them again.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# --frozen-lockfile is the point of the step: it refuses a lockfile that disagrees with the
# manifests rather than quietly resolving something newer, so the image is built from the versions
# the repository committed. It is also CI's default, which is where this will run next.
RUN pnpm install --frozen-lockfile

COPY packages/core packages/core
COPY apps/api apps/api

RUN pnpm exec esbuild apps/api/src/server.ts \
      --bundle \
      --platform=node \
      --target=node22 \
      --format=cjs \
      --outfile=/build/server.cjs

# ───────────────────────────────────────────────────────────────────────── runtime
FROM node:22-alpine AS runtime

# `node` exists in this base image as uid/gid 1000 and owns nothing it could overwrite. Running as
# root inside a container is the default and is the thing a reviewer looks for first; there is no
# reason for this process to have it.
USER node

WORKDIR /app

COPY --from=builder --chown=node:node /build/server.cjs ./server.cjs

# Documentation only — publishing is the operator's choice (`docker run -p`), and the app reads
# PORT from the environment so a platform that assigns one is obeyed without an image change.
EXPOSE 3000
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# No shell form, so `node` is PID 1 and receives SIGTERM directly — which is what
# `apps/api/src/server.ts` installs a handler for. Wrapped in a shell, the signal would reach the
# shell instead and the container would be killed after the grace period with requests in flight.
#
# `server.cjs` here and in the COPY above are the one link in this file that nothing checks: a
# disagreement between them builds a clean image that exits 1 on start with `Cannot find module`
# (measured). The builder's `--outfile` is covered — `docker build` refuses a COPY of a file no
# stage produced — and the esbuild entry is covered by L-orphans. TD-0017.
CMD ["node", "server.cjs"]
