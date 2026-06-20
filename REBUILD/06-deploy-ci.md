# Phase 6 — Deploy & CI

> **Before starting:** Phase 5 checkpoint must be green (web app builds + browser tests pass).
> This is Phase 6 of 6. After this phase you have a production-ready Docker Compose stack
> and a CI pipeline that enforces every quality gate.

---

## Agent prompt (copy this verbatim to start Phase 6)

```
Phase 5 is complete (web app builds and browser tests pass). Now build Phase 6: deploy
infrastructure and CI.

Implement:
1. deploy/docker-compose.yml — core services (db/web/mcp/worker) + edge profile (caddy/redis/backup)
2. deploy/Dockerfile — multi-stage build for web, mcp-server, worker
3. scripts/ — dev-up.sh, deploy.sh, reload.sh, verify-lockdown.sh, smoke.sh,
              release.sh, hash-admin-password.ts
4. .github/workflows/ — ci.yml, onboarding-e2e.yml, authed-e2e.yml, prod-drift.yml

INVARIANT: All host-bound ports must use 127.0.0.1 as the bind IP — NEVER 0.0.0.0.
The lockdown audit (verify-lockdown.sh) checks this and fails the deploy if it finds
a 0.0.0.0 binding.

Stop at the Phase 6 checkpoint (dev-up.sh brings up the stack and lockdown audit passes).

Spec: REBUILD/06-deploy-ci.md
```

---

## 6.1 Docker Compose (`deploy/docker-compose.yml`)

### Core services (always active)

```yaml
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER:     ${POSTGRES_USER:-brain}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-brain}
      POSTGRES_DB:       ${POSTGRES_DB:-brain}
    ports:
      - "${POSTGRES_BIND:-127.0.0.1}:${POSTGRES_HOST_PORT:-5432}:5432"
    volumes:
      - brain_db:/var/lib/postgresql/data
    healthcheck:
      test:     ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-brain}"]
      interval: 5s
      timeout:  5s
      retries:  10

  web:
    build:
      context:    ..
      dockerfile: deploy/Dockerfile
      target:     web
      args:
        APP_VERSION: ${APP_VERSION:-dev}
    env_file: ../.env
    ports:
      - "${WEB_BIND:-127.0.0.1}:${WEB_HOST_PORT:-3000}:3000"
    depends_on:
      db: { condition: service_healthy }
    healthcheck:
      test:     ["CMD-SHELL", "curl -sf http://localhost:3000/api/healthz || exit 1"]
      interval: 10s
      timeout:  5s
      retries:  6

  mcp-server:
    build:
      context:    ..
      dockerfile: deploy/Dockerfile
      target:     mcp-server
    env_file: ../.env
    environment:
      MCP_TRANSPORT:        http
      MCP_SERVER_HTTP_PORT: 3100
    ports:
      - "${MCP_BIND:-127.0.0.1}:${MCP_HOST_PORT:-3100}:3100"
    depends_on:
      db: { condition: service_healthy }
    healthcheck:
      test:     ["CMD-SHELL", "curl -sf http://localhost:3100/health || exit 1"]
      interval: 10s
      timeout:  5s
      retries:  6

  worker:
    build:
      context:    ..
      dockerfile: deploy/Dockerfile
      target:     worker
    env_file: ../.env
    depends_on:
      db:  { condition: service_healthy }
      web: { condition: service_healthy }
    restart: unless-stopped

volumes:
  brain_db:

```

### Edge profile services (`--profile edge`)

```yaml
  redis:
    image:   redis:7-alpine
    profiles: [edge]
    ports:
      - "127.0.0.1:6379:6379"
    restart: unless-stopped

  backup:
    image:   prodrigestivill/postgres-backup-local
    profiles: [edge]
    environment:
      POSTGRES_HOST:     db
      POSTGRES_USER:     ${POSTGRES_USER:-brain}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-brain}
      POSTGRES_DB:       ${POSTGRES_DB:-brain}
      SCHEDULE:          "0 3 * * *"
      BACKUP_KEEP_DAYS:  7
    volumes:
      - brain_backups:/backups
    depends_on:
      db: { condition: service_healthy }

  caddy:
    image: brain-caddy:latest    # built with xcaddy + mholt/caddy-ratelimit
    profiles: [edge]
    ports:
      - "0.0.0.0:80:80"          # Caddy terminates TLS — it's OK for Caddy to bind 0.0.0.0
      - "0.0.0.0:443:443"        # The upstream services still bind 127.0.0.1
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      web:        { condition: service_healthy }
      mcp-server: { condition: service_healthy }
    environment:
      BRAIN_PUBLIC_HOSTNAME:     ${BRAIN_PUBLIC_HOSTNAME}
      BRAIN_MCP_PUBLIC_HOSTNAME: ${BRAIN_MCP_PUBLIC_HOSTNAME}
      CADDY_EMAIL:               ${CADDY_EMAIL}

volumes:
  brain_backups:
  caddy_data:
  caddy_config:
```

### `deploy/Caddyfile`

```caddyfile
{
  email {$CADDY_EMAIL}
}

{$BRAIN_PUBLIC_HOSTNAME} {
  reverse_proxy web:3000
}

{$BRAIN_MCP_PUBLIC_HOSTNAME} {
  reverse_proxy mcp-server:3100
}
```

---

## 6.2 Dockerfile (`deploy/Dockerfile`)

Multi-stage build. Key design decisions:
- BuildKit cache-mounts for `pnpm store` and `.next/cache` — fast rebuilds
- `SKIP_DB_INIT=1` during `next build` (no Prisma engine init)
- All final stages run as non-root `node` user
- `mcp-server` and `worker` run TypeScript directly via `tsx` (no separate compile step)

```dockerfile
# ── base ──────────────────────────────────────────────────────────────────────
FROM node:20-slim AS base

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Install pnpm deps with BuildKit cache mount
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json             apps/web/
COPY apps/mcp-server/package.json      apps/mcp-server/
COPY apps/worker/package.json          apps/worker/
COPY packages/core/package.json        packages/core/
COPY packages/db/package.json          packages/db/
COPY packages/types/package.json       packages/types/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @brain/db exec prisma generate

# ── builder (Next.js standalone) ──────────────────────────────────────────────
FROM base AS builder

ARG APP_VERSION=dev
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION
ENV SKIP_DB_INIT=1

RUN --mount=type=cache,id=next,target=/app/apps/web/.next/cache \
    pnpm turbo run build --filter=web

# ── web ───────────────────────────────────────────────────────────────────────
FROM node:20-slim AS web

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app
USER node

COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static      apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public             apps/web/public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# ── mcp-server ────────────────────────────────────────────────────────────────
FROM base AS mcp-server

WORKDIR /app
USER node

ENV NODE_ENV=production
EXPOSE 3100
CMD ["pnpm", "--filter=mcp-server", "exec", "tsx", "src/index.ts"]

# ── worker ────────────────────────────────────────────────────────────────────
FROM base AS worker

WORKDIR /app
USER node

ENV NODE_ENV=production
CMD ["pnpm", "--filter=worker", "exec", "tsx", "src/index.ts"]
```

---

## 6.3 Scripts

### `scripts/dev-up.sh`

Purpose: idempotent local bring-up (no TLS, seeds demo fixture).

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Preflight: check docker, env file
[ -f .env ] || { echo "Copy .env.example to .env and fill in the required vars"; exit 1; }
source .env

# 2. Build images
docker compose build

# 3. Start db only, wait for healthy
docker compose up -d db
until docker compose exec db pg_isready -U "${POSTGRES_USER:-brain}"; do sleep 1; done

# 4. Create pgvector extension (idempotent)
docker compose exec db psql -U "${POSTGRES_USER:-brain}" "${POSTGRES_DB:-brain}" \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 5. Run Prisma migrations
docker compose run --rm -e SKIP_DB_INIT= web \
  pnpm --filter @brain/db exec prisma migrate deploy

# 6. Apply FTS indexes
docker compose exec db psql -U "${POSTGRES_USER:-brain}" "${POSTGRES_DB:-brain}" \
  < packages/db/sql/session-fts-index.sql

# 7. Seed demo fixture (if SEED_ON_DEPLOY=true or not set)
if [ "${SEED_ON_DEPLOY:-true}" = "true" ]; then
  docker compose run --rm web pnpm --filter @brain/db exec prisma db seed
fi

# 8. Backfill embeddings (if a provider key is set)
if [ -n "${GOOGLE_GEMINI_API_KEY:-}${OPENAI_API_KEY:-}" ]; then
  docker compose run --rm worker tsx scripts/backfill-embeddings.ts || true
fi

# 9. Start remaining services
docker compose up -d web mcp-server worker

# 10. Wait for web healthcheck
until curl -sf http://localhost:3000/api/healthz; do sleep 2; done

# 11. Run lockdown audit (soft — dev mode)
./scripts/verify-lockdown.sh || true

echo ""
echo "External Brain is running:"
echo "  Web app: http://localhost:3000"
echo "  MCP:     http://localhost:3100/mcp"
```

### `scripts/deploy.sh`

Production deploy (requires `--profile edge`, real auth configured, public hostnames set).

```bash
#!/usr/bin/env bash
set -euo pipefail

source .env

# Pre-flight checks
[ -z "${ALLOW_DEV_AUTH:-}" ] || [ "${ALLOW_DEV_AUTH}" = "false" ] || {
  echo "ERROR: ALLOW_DEV_AUTH must not be set in production"; exit 1
}
[ -n "${BRAIN_PUBLIC_HOSTNAME:-}" ]     || { echo "Set BRAIN_PUBLIC_HOSTNAME"; exit 1; }
[ -n "${BRAIN_MCP_PUBLIC_HOSTNAME:-}" ] || { echo "Set BRAIN_MCP_PUBLIC_HOSTNAME"; exit 1; }
[ -n "${CADDY_EMAIL:-}" ]               || { echo "Set CADDY_EMAIL"; exit 1; }

# Check worktree is clean
git diff --quiet && git diff --cached --quiet || {
  echo "ERROR: Uncommitted changes. Commit or stash before deploying."; exit 1
}

# Build
APP_VERSION=$(git describe --tags --always) docker compose --profile edge build

# Migrate (NOT seed — never seed in production)
docker compose run --rm -e SKIP_DB_INIT= web \
  pnpm --filter @brain/db exec prisma migrate deploy

# Apply FTS indexes
docker compose exec db psql -U "${POSTGRES_USER:-brain}" "${POSTGRES_DB:-brain}" \
  < packages/db/sql/session-fts-index.sql

# Start stack with edge profile
docker compose --profile edge up -d

# Wait for TLS + healthcheck
MAX_WAIT=120
for i in $(seq 1 $MAX_WAIT); do
  curl -sf "https://${BRAIN_PUBLIC_HOSTNAME}/api/healthz" && break || sleep 1
done

# Hard lockdown audit (fails deploy on any violation)
./scripts/verify-lockdown.sh
echo "Lockdown audit PASSED"

# Smoke tests
./scripts/smoke.sh
echo "Deploy complete"
```

### `scripts/reload.sh`

```bash
#!/usr/bin/env bash
# Fast iteration: rebuild one service without DB wait
set -euo pipefail
SERVICE=${1:?Usage: reload.sh <service>}

docker compose build "$SERVICE"
docker compose up -d --force-recreate "$SERVICE"

if [ "$SERVICE" = "web" ]; then
  ./scripts/verify-lockdown.sh || true
fi
echo "Reloaded $SERVICE"
```

### `scripts/verify-lockdown.sh`

This is the auth-posture audit. Exit 0 = locked, 1 = leak, 2 = unreachable.

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BRAIN_PUBLIC_URL:-http://localhost:3000}"
MCP_URL="${BRAIN_MCP_URL:-http://localhost:3100}"

FAIL=0

# 1. Healthz must be reachable
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE_URL/api/healthz") || {
  echo "FAIL: /api/healthz unreachable"; exit 2
}
[ "$STATUS" = "200" ] || { echo "FAIL: /api/healthz returned $STATUS"; FAIL=1; }

# 2. Root redirects to signin (never serves content without auth)
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -L --max-redirs 0 "$BASE_URL/") || true
[[ "$STATUS" = "307" || "$STATUS" = "302" ]] || {
  echo "FAIL: root returned $STATUS (expected redirect)"; FAIL=1
}

# 3. Protected API must not return 200 without auth
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE_URL/api/knowledge")
if [ "$STATUS" = "200" ]; then
  echo "FAIL: /api/knowledge returned 200 without auth — data leak!"; FAIL=1
fi

# 4. MCP initialize without Bearer must be 4xx
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" \
  -X POST "$MCP_URL/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}')
if [[ "$STATUS" = "200" ]]; then
  echo "FAIL: MCP /mcp returned 200 without Bearer auth — MCP leak!"; FAIL=1
fi

# 5. Check for 0.0.0.0 bindings (should never appear in prod)
if docker compose ps --format json 2>/dev/null | grep -q '"0.0.0.0"'; then
  echo "FAIL: Found 0.0.0.0 port binding — use 127.0.0.1 for all services"; FAIL=1
fi

if [ "$FAIL" = "0" ]; then
  echo "PASS: Lockdown audit passed"
else
  echo "FAIL: Lockdown audit failed with $FAIL violation(s)"
  exit 1
fi
```

### `scripts/smoke.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BRAIN_PUBLIC_URL:-http://localhost:3000}"
MCP_URL="${BRAIN_MCP_URL:-http://localhost:3100}"

# Public tier
curl -sf "$BASE_URL/api/healthz" | grep -q '"ok":true' || { echo "FAIL: healthz"; exit 1; }
curl -sf "$MCP_URL/health"      | grep -q '"ok":true' || { echo "FAIL: mcp health"; exit 1; }

# Authed tier (only if token is set)
if [ -n "${BRAIN_MCP_TOKEN:-}" ]; then
  # initialize
  curl -sf -X POST "$MCP_URL/mcp" \
    -H "Authorization: Bearer $BRAIN_MCP_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Mcp-Session-Id: smoke-01" \
    -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{}},"id":1}' \
    | grep -q '"serverInfo"' || { echo "FAIL: MCP initialize"; exit 1; }

  # tools/list
  curl -sf -X POST "$MCP_URL/mcp" \
    -H "Authorization: Bearer $BRAIN_MCP_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Mcp-Session-Id: smoke-01" \
    -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}' \
    | grep -q '"brain_start_session"' || { echo "FAIL: tools/list"; exit 1; }
fi

echo "PASS: smoke tests passed"
```

### `scripts/release.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

VERSION=${1:?Usage: release.sh vX.Y.Z [--publish]}
PUBLISH=${2:-}

# Validate semver format
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "ERROR: Version must be vX.Y.Z format"; exit 1
}

# Tag
git tag -a "$VERSION" -m "Release $VERSION"
git push origin "$VERSION"

# Create GitHub release
gh release create "$VERSION" \
  --title "External Brain $VERSION" \
  --generate-notes \
  ${PUBLISH:+--draft=false} \
  ${PUBLISH:---draft}

if [ -n "$PUBLISH" ]; then
  echo "Released $VERSION — https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/releases/tag/$VERSION"
fi
```

### `scripts/hash-admin-password.ts`

```typescript
#!/usr/bin/env tsx
import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error("Usage: tsx scripts/hash-admin-password.ts '<password>'");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
console.log(hash);
console.log("\nAdd to .env:");
console.log(`ADMIN_PASSWORD_HASH="${hash}"`);
```

---

## 6.4 GitHub Actions CI

### `.github/workflows/ci.yml` (required gate)

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER:     brain
          POSTGRES_PASSWORD: brain
          POSTGRES_DB:       brain
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v3
        with: { version: "9.15.0" }

      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "pnpm" }

      - run: pnpm install --frozen-lockfile

      - name: Generate Prisma client
        run: pnpm --filter @brain/db exec prisma generate

      - name: Migrate fresh DB (day-zero migration gate)
        run: pnpm --filter @brain/db exec prisma migrate deploy
        env:
          DATABASE_URL: postgresql://brain:brain@localhost:5432/brain

      - name: Apply FTS indexes
        run: psql $DATABASE_URL -f packages/db/sql/session-fts-index.sql
        env:
          DATABASE_URL: postgresql://brain:brain@localhost:5432/brain

      - name: Typecheck
        run: pnpm turbo run typecheck

      - name: Test (includes cross-tenant isolation tests)
        run: pnpm turbo run test
        env:
          DATABASE_URL: postgresql://brain:brain@localhost:5432/brain

      - name: Build
        run: pnpm turbo run build
        env:
          SKIP_DB_INIT: "1"
```

### `.github/workflows/onboarding-e2e.yml` (required, path-gated)

```yaml
name: Onboarding E2E
on:
  push:
    branches: [main]
  pull_request:
    paths:
      - "apps/web/src/app/(auth)/**"
      - "apps/web/src/app/welcome/**"
      - "apps/web/src/app/api/healthz/**"
      - "apps/web/src/components/**"
      - ".github/workflows/onboarding-e2e.yml"

jobs:
  e2e-anon:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: "9.15.0" }
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "pnpm" }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install chromium
      - name: Build web
        run: pnpm turbo run build --filter=web
        env: { SKIP_DB_INIT: "1" }
      - name: Run anonymous E2E tests
        run: pnpm exec playwright test --project=chromium tests/e2e/anon/
        env:
          PLAYWRIGHT_BASE_URL: http://localhost:3000
```

### `.github/workflows/authed-e2e.yml` (required, path-gated)

```yaml
name: Authed E2E
on:
  push:
    branches: [main]
  pull_request:
    paths:
      - "apps/web/src/**"
      - "apps/mcp-server/src/**"
      - ".github/workflows/authed-e2e.yml"

jobs:
  e2e-authed:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER:     brain
          POSTGRES_PASSWORD: brain
          POSTGRES_DB:       brain
        ports: ["5432:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: "9.15.0" }
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "pnpm" }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install chromium
      - run: pnpm --filter @brain/db exec prisma generate
      - run: pnpm --filter @brain/db exec prisma migrate deploy
        env: { DATABASE_URL: postgresql://brain:brain@localhost:5432/brain }
      - run: psql $DATABASE_URL -f packages/db/sql/session-fts-index.sql
        env: { DATABASE_URL: postgresql://brain:brain@localhost:5432/brain }
      - run: pnpm --filter @brain/db exec prisma db seed
        env: { DATABASE_URL: postgresql://brain:brain@localhost:5432/brain }
      - run: pnpm turbo run build --filter=web
        env: { SKIP_DB_INIT: "1" }
      - name: Run authed E2E tests
        run: pnpm exec playwright test --project=chromium tests/e2e/authed/
        env:
          DATABASE_URL:        postgresql://brain:brain@localhost:5432/brain
          ADMIN_USERNAME:      alex@brain.local
          ADMIN_PASSWORD_HASH: ${{ secrets.CI_ADMIN_PASSWORD_HASH }}
          AUTH_SECRET:         ci-test-secret
```

### `.github/workflows/prod-drift.yml` (daily watchdog)

```yaml
name: Production Drift
on:
  schedule:
    - cron: "0 9 * * *"    # daily at 09:00 UTC

jobs:
  drift-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - name: Get deployed version
        id: deployed
        run: |
          VERSION=$(curl -sf "https://${BRAIN_HOST}/api/healthz" | jq -r '.version')
          echo "version=$VERSION" >> $GITHUB_OUTPUT
        env: { BRAIN_HOST: ${{ secrets.BRAIN_PUBLIC_HOSTNAME }} }

      - name: Get main version
        id: main
        run: echo "version=$(git describe --tags --always)" >> $GITHUB_OUTPUT

      - name: Compare and open/close issue
        run: |
          DEPLOYED="${{ steps.deployed.outputs.version }}"
          MAIN="${{ steps.main.outputs.version }}"
          if [ "$DEPLOYED" != "$MAIN" ]; then
            echo "Drift detected: deployed=$DEPLOYED main=$MAIN"
            gh issue create --label prod-drift \
              --title "prod-drift: deployed=$DEPLOYED, main=$MAIN" \
              --body "Deployed version ($DEPLOYED) is behind main ($MAIN). Run deploy.sh."
          else
            # Close any open drift issue
            gh issue list --label prod-drift --state open --json number -q '.[].number' | \
              xargs -I{} gh issue close {}
            echo "No drift: deployed=$MAIN"
          fi
        env: { GH_TOKEN: ${{ github.token }} }
```

---

## 6.5 E2E test structure

```
tests/
  e2e/
    anon/
      welcome.spec.ts      — /welcome flow, signup link, healthz check
      signin.spec.ts       — signin page renders, form validation
    authed/
      dashboard.spec.ts    — sign in, dashboard loads
      sessions.spec.ts     — session list with at least 1 closed session
      skills.spec.ts       — Skills screen has ≥16 items (seed fixture)
      nav.spec.ts          — all nav links reachable without 404
      mobile.spec.ts       — viewport 375×812, bottom-nav visible
    playwright.config.ts
```

Key assertion in `skills.spec.ts`:
```typescript
await expect(page.locator('[data-testid="skill-card"]')).toHaveCount({ min: 16 });
```

---

## Phase 6 checkpoint (Final)

```bash
# 1. Start the dev stack
cp .env.example .env    # fill in DATABASE_URL + at least one LLM provider key
./scripts/dev-up.sh

# 2. Lockdown audit must pass
./scripts/verify-lockdown.sh
# Expected output: "PASS: Lockdown audit passed"

# 3. Smoke test
./scripts/smoke.sh
# Expected: "PASS: smoke tests passed"

# 4. Full CI run (simulate locally)
pnpm turbo run typecheck
pnpm turbo run test
pnpm turbo run build
```

**Pass criteria:**
- [ ] `dev-up.sh` completes without errors; web at `:3000`, MCP at `:3100`
- [ ] `verify-lockdown.sh` exits 0 (PASS)
- [ ] `smoke.sh` exits 0 (PASS) for both public and authed tiers
- [ ] `pnpm turbo run typecheck` exits 0 across all packages
- [ ] `pnpm turbo run test` exits 0 (all unit tests including cross-tenant isolation)
- [ ] `pnpm turbo run build` exits 0 (web standalone + mcp + worker)
- [ ] No service is bound to `0.0.0.0` except Caddy (in the edge profile)
- [ ] `./scripts/reload.sh web` rebuilds and restarts the web service without downtime
- [ ] `./scripts/release.sh v0.1.0` creates a git tag (but does NOT push without `--publish`)

**Phase 6 complete = the project is buildable, deployable, and auditable.**

---

## Next step

Open `08-acceptance-criteria.md` to run the full definition-of-done checklist.
