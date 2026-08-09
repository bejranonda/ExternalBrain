# syntax=docker/dockerfile:1.7
#
# One Dockerfile for all three apps. Select with `--target`:
#   docker build -f deploy/Dockerfile --target web        -t brain/web .
#   docker build -f deploy/Dockerfile --target mcp-server -t brain/mcp-server .
#   docker build -f deploy/Dockerfile --target worker     -t brain/worker .
#
# Each final stage is a lean `node:20-slim` with only the files needed
# to run the given app. Prisma client is generated once in the build stage.

# ---------- Base: dependencies and prisma generate ----------
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# Keep pnpm's content-addressable store in a fixed location so BuildKit's
# cache mount can preserve it across builds. The store holds unpacked
# tarballs, so a fresh build only re-hardlinks rather than re-downloading.
ENV PNPM_STORE_DIR=/pnpm/store
# node:20-slim strips openssl; Prisma's engine detection needs libssl.so
# to pick the right binary target, so install the package explicitly.
# python3 is added so the bootstrap image can run the installer-reconcile
# regression test (PR #226 / #225). The python3 itself ships ~50MB but
# only into the bootstrap target — production web/mcp/worker images
# stay slim because they re-FROM node:20-slim independently below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates python3 \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# Copy lockfile and manifests first for layer caching.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json turbo.json ./
COPY apps/web/package.json            apps/web/package.json
COPY apps/mcp-server/package.json     apps/mcp-server/package.json
COPY apps/worker/package.json         apps/worker/package.json
COPY packages/core/package.json       packages/core/package.json
COPY packages/db/package.json         packages/db/package.json
COPY packages/types/package.json      packages/types/package.json

# Cache-mounted pnpm store — first build populates, subsequent builds
# hardlink from cache instead of re-downloading. `sharing=locked` keeps
# parallel stage builds (web/worker/mcp-server) from racing.
RUN --mount=type=cache,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

# Now copy source and generate Prisma client.
COPY packages        packages
COPY apps            apps
# Build-time only: /docs/tutorials/*.md is read during `next build`'s static
# generation (apps/web/lib/brain/tutorial-content.ts) so the in-app tutorial
# pages render from the same source the repo's GitHub tutorials do — one
# tutorial, not two divergent copies. Deliberately not copied into the final
# runtime stage below: content is baked into .next/ output by SSG, so the
# running container never touches these files and doesn't ship them.
COPY docs             docs
RUN pnpm --filter @brain/db exec prisma generate

# ---------- Builder: produce per-app build artifacts ----------
FROM base AS builder
# Dummy env so env validation at top-level doesn't crash the build.
ENV DATABASE_URL=postgresql://ci:ci@localhost:5432/ci
ENV NODE_ENV=production
# `SKIP_DB_INIT=1` makes `@brain/db` export a throwing Proxy instead of
# calling `new PrismaClient()`. Next.js's page-data collection imports
# every API route handler at build time; eager client construction on
# Alpine trips "did not initialize yet" because the standalone trace
# doesn't include the generated client path. The stub is never hit at
# runtime — the final containers don't set this env var.
ENV SKIP_DB_INIT=1
# App version, surfaced in the web UI (rail footer). Fed by the `APP_VERSION`
# compose build-arg (deploy scripts pass `git describe --tags`); defaults to
# "dev" for a plain local build. NEXT_PUBLIC_* is inlined into the bundle at
# build time, so it must be set here in the builder, not the runtime stage.
ARG APP_VERSION=dev
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION
# Only the webapp needs compilation — worker and mcp-server run from `src/`
# via `tsx` at runtime (see their Dockerfile stages below), so their `tsc`
# build step would only produce throw-away artifacts. Skipping it also
# sidesteps an Alpine-specific Prisma type-resolution divergence we don't
# otherwise need to fight.
#
# Cache mounts:
#   /repo/apps/web/.next/cache  — webpack module cache; the single biggest
#     win for incremental rebuilds (30 min → ~5 min on unchanged routes).
#   /repo/node_modules/.cache   — swc / next-babel intermediates.
# Both are safe to share across stage builds because they're keyed by
# content hash, not path.
RUN --mount=type=cache,target=/repo/apps/web/.next/cache,sharing=locked \
    --mount=type=cache,target=/repo/node_modules/.cache,sharing=locked \
    pnpm --filter @brain/db exec prisma generate \
 && pnpm --filter @brain/web build

# ---------- Web ----------
FROM node:20-slim AS web
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone bundle has all workspace deps already inlined.
# `public/` is optional in Next.js — we don't ship one, so the copy step
# is omitted to avoid buildkit's "not found" checksum error.
# Audit C15 (#110): drop root for the runtime — node:20-slim ships a
# `node` user (uid 1000). Use `--chown` on each COPY so files land
# already owned correctly, avoiding a recursive chown step that would
# duplicate every file in a new layer.
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
# Proxy (rate-limit middleware) ships as an app-directory sibling file.
COPY --from=builder --chown=node:node /repo/packages/db/prisma ./packages/db/prisma
COPY --from=builder --chown=node:node /repo/packages/db/sql ./packages/db/sql
# Prisma runtime looks for engine binaries at a short list of paths relative
# to the running bundle. Place them where it looks first.
COPY --from=builder --chown=node:node /repo/packages/db/src/generated ./apps/web/src/generated

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# ---------- MCP server ----------
# Runs from `src/` via tsx, not `dist/node`. The workspace packages
# (`@brain/core`, `@brain/db`) publish `main: "./src/index.ts"` so Node
# without a TS loader would fail. Switching to tsx keeps the production
# runtime aligned with the dev runtime — fine for the MVP, revisit if
# cold-start becomes a concern.
FROM node:20-slim AS mcp-server
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV MCP_SERVER_HTTP_PORT=3100

# Audit C15 (#110): drop root for the runtime; ownership tracked via --chown.
COPY --from=base --chown=node:node /repo/node_modules                         node_modules
COPY --from=base --chown=node:node /repo/packages                             packages
COPY --from=base --chown=node:node /repo/apps/mcp-server/src                  apps/mcp-server/src
COPY --from=base --chown=node:node /repo/apps/mcp-server/package.json         apps/mcp-server/package.json
COPY --from=base --chown=node:node /repo/apps/mcp-server/tsconfig.json        apps/mcp-server/tsconfig.json
COPY --from=base --chown=node:node /repo/apps/mcp-server/node_modules         apps/mcp-server/node_modules
COPY --from=base --chown=node:node /repo/tsconfig.base.json                   tsconfig.base.json

USER node
EXPOSE 3100
WORKDIR /app/apps/mcp-server
CMD ["/app/node_modules/.pnpm/node_modules/.bin/tsx", "src/index.ts"]

# ---------- Worker ----------
FROM node:20-slim AS worker
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app
ENV NODE_ENV=production

# Audit C15 (#110): drop root for the runtime; ownership tracked via --chown.
COPY --from=base --chown=node:node /repo/node_modules                      node_modules
COPY --from=base --chown=node:node /repo/packages                          packages
COPY --from=base --chown=node:node /repo/apps/worker/src                   apps/worker/src
COPY --from=base --chown=node:node /repo/apps/worker/package.json          apps/worker/package.json
COPY --from=base --chown=node:node /repo/apps/worker/tsconfig.json         apps/worker/tsconfig.json
COPY --from=base --chown=node:node /repo/apps/worker/node_modules          apps/worker/node_modules
COPY --from=base --chown=node:node /repo/tsconfig.base.json                tsconfig.base.json

USER node
WORKDIR /app/apps/worker
CMD ["/app/node_modules/.pnpm/node_modules/.bin/tsx", "src/index.ts"]
