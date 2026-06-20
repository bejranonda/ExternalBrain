# Environment Variable Catalog

> Complete reference for `.env` and `.env.example`. Copy `.env.example` to `.env`,
> fill in the required vars, then add one or more auth mode vars to unlock the instance.
>
> **Secure-by-default:** a fresh instance with only `DATABASE_URL` set will serve `503
> auth_not_configured` on every route. This is intentional — the operator must pick an
> auth mode. See the "Auth modes" section below.

---

## Required (always)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string (Postgres 16 + pgvector required) | `postgresql://brain:brain@localhost:5432/brain` |

---

## Database / jobs

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `brain` | Used by Docker Compose for the `db` service |
| `POSTGRES_PASSWORD` | `brain` | Docker Compose `db` service password |
| `POSTGRES_DB` | `brain` | Docker Compose `db` service database name |
| `PG_BOSS_SCHEMA` | `pgboss` | pg-boss schema name (do not change after first run) |
| `REDIS_URL` | — | Redis connection string for rate limiting in the edge profile. Leave empty to use in-process rate limiting (dev only) |

---

## LLM providers

Provide **at least one** of the following key groups. The system picks the right SDK
based on the model name prefix and which keys are set.

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key — enables GPT models |
| `ANTHROPIC_API_KEY` | Anthropic API key — enables Claude models |
| `ANTHROPIC_BASE_URL` | Optional: override Anthropic base URL (e.g. Z.ai gateway, Bedrock proxy) |
| `DASHSCOPE_API_KEY` | Alibaba DashScope key — enables Qwen and GLM models |
| `GOOGLE_GEMINI_API_KEY` | Google Gemini key — enables Gemini models AND the Gemini embedding provider |

**Model selection:**

| Variable | Default | Used for |
|----------|---------|---------|
| `ORACLE_MODEL` | `gemini-1.5-flash` | Oracle Q&A + cross-session KEA |
| `KEA_MODEL` | `gemini-1.5-flash` | Per-session knowledge extraction |
| `KEA_REFINE_MODEL` | → `KEA_MODEL` | KEA refinement judge (separate model if desired) |
| `CROSS_SESSION_KEA_MODEL` | → `ORACLE_MODEL` | Cross-session synthesis |
| `CROSS_SESSION_WINDOW` | `20` | Max sessions to include in cross-session extraction |

---

## Embeddings

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model name (OpenAI-compatible) |
| `EMBEDDING_DIMENSIONS` | `1536` | **Schema-locked — never change after first migration** |
| `EMBEDDING_BASE_URL` | — | Override base URL for embeddings (e.g. local Ollama, Azure) |
| `EMBEDDING_API_KEY` | — | API key for the embedding provider (if different from LLM key) |

**Provider priority at runtime:**
1. Gemini (`gemini-embedding-001`) — if `GOOGLE_GEMINI_API_KEY` is set
2. `EMBEDDING_MODEL` via `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` — fallback

> **Critical:** do NOT send a `dimensions` parameter to Gemini's OpenAI-compat endpoint.
> Gemini rejects unexpected dimension arguments and returns an opaque error.

---

## Auth modes (pick exactly one)

### Mode A: Credentials (recommended for self-hosted)

| Variable | Description |
|----------|-------------|
| `ADMIN_USERNAME` | Admin login email (e.g. `admin@brain.local`) |
| `ADMIN_PASSWORD_HASH` | bcrypt hash (cost 12) of the admin password. Generate: `pnpm hash-admin-password '<pw>'` |
| `ADMIN_EMAILS` | Comma-separated list of emails auto-promoted to admin role on sign-in |

### Mode B: GitHub OAuth

| Variable | Description |
|----------|-------------|
| `AUTH_GITHUB_ID` | GitHub OAuth App client ID |
| `AUTH_GITHUB_SECRET` | GitHub OAuth App client secret |
| `AUTH_SECRET` | Random secret for JWT signing. Generate: `openssl rand -base64 32` |

### Mode C: Dev shim (local only)

| Variable | Value | Description |
|----------|-------|-------------|
| `ALLOW_DEV_AUTH` | `true` | Enable dev auth bypass |
| `ALLOW_DEV_AUTH_IN_PRODUCTION` | `true` | (Dangerous) Also allow in prod — requires explicit opt-in |
| `DEV_USER_ID` | any | The user ID to impersonate in dev mode |

### Common auth vars

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_URL` | — | Full URL of the auth endpoint (e.g. `https://brain.example.com`). Required in production. |
| `NEXTAUTH_URL` | — | Alias for `AUTH_URL` (NextAuth v4 compat) |
| `AUTH_TRUST_HOST` | `true` | Trust the `Host` / `X-Forwarded-Host` headers (required behind a proxy) |
| `REGISTRATION_REQUIRES_VOUCHER` | `true` | Require a voucher code for new user registration. Set to `false` to open registration. |

---

## MCP server

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `http` | Transport mode: `http` or `stdio` |
| `MCP_SERVER_HTTP_PORT` | `3100` | Port for the HTTP MCP server |
| `MCP_TOKEN_SECRET` | — | Optional: additional signing secret for token generation |
| `BRAIN_MCP_TOKEN` | — | Set in smoke.sh / CI to run authed smoke tests |

---

## Public hostnames & ports

| Variable | Description |
|----------|-------------|
| `BRAIN_PUBLIC_HOSTNAME` | Public hostname for the web app (e.g. `brain.example.com`) |
| `BRAIN_MCP_PUBLIC_HOSTNAME` | Public hostname for the MCP server (e.g. `mcp.example.com`) |
| `CADDY_EMAIL` | Email for Let's Encrypt TLS certificate (edge profile only) |
| `WEB_HOST_PORT` | `3000` — host-side port for the web service |
| `WEB_BIND` | `127.0.0.1` — bind IP for web (never `0.0.0.0` in prod) |
| `MCP_HOST_PORT` | `3100` — host-side port for the MCP service |
| `MCP_BIND` | `127.0.0.1` — bind IP for MCP |
| `POSTGRES_HOST_PORT` | `5432` — host-side port for Postgres |
| `POSTGRES_BIND` | `127.0.0.1` — bind IP for Postgres |

---

## Kill-switches (feature flags)

| Variable | Default | Effect when `false` |
|----------|---------|---------------------|
| `KEA_ENABLED` | `true` | Disables KEA extraction jobs |
| `AUTOSKILL_ENABLED` | `true` | Disables autoskill proposal generation |
| `ORACLE_ENABLED` | `true` | `brain_ask_oracle` returns 503 `oracle_disabled` |
| `MCP_ENABLED` | `true` | `POST /mcp` returns 503; `/health` still 200 |

---

## Cost & rate limits

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_ORACLE_COST_USD_PER_DAY` | `10` | Hard cap on Oracle spend per user per day |
| `MAX_KEA_COST_USD_PER_SESSION` | `0.05` | Soft cap on KEA extraction per session |
| `RATE_LIMIT_ORACLE_PER_DAY` | (no limit) | Max Oracle calls per user per day |
| `RATE_LIMIT_KEA_PER_HOUR` | (no limit) | Max KEA extractions per user per hour |
| `RATE_LIMIT_MCP_PER_MINUTE` | (no limit) | Max MCP requests per token per minute |

---

## Email (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_PROVIDER` | `disabled` | Email provider: `resend` or `disabled` |
| `EMAIL_API_KEY` | — | API key for the email provider |
| `EMAIL_FROM` | — | From address for outgoing email (e.g. `brain@example.com`) |
| `EMAIL_REPLY_TO` | — | Reply-to address |

Password reset emails are sent via this provider. If `disabled`, the reset link is
logged to stdout (useful for development).

---

## Observability

| Variable | Default | Description |
|----------|---------|-------------|
| `SENTRY_DSN` | — | Sentry DSN for error tracking (worker + web) |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Sentry trace sample rate (0.0–1.0) |
| `LOG_LEVEL` | `info` | Structured log level: `debug`, `info`, `warn`, `error` |

---

## Deploy & build

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node environment |
| `SEED_ON_DEPLOY` | `true` | Seed the demo fixture on `dev-up.sh`. Set to `false` in prod. |
| `APP_VERSION` | (git describe) | Version label, set as build-arg in Dockerfile; exposed via `NEXT_PUBLIC_APP_VERSION` and `/api/healthz` |
| `DEPLOY_ALLOW_DIRTY` | `false` | Allow deploying with uncommitted changes (only for debugging) |
| `DEPLOY_SKIP_SMOKE` | `false` | Skip smoke tests after deploy (not recommended) |

---

## Backup (edge profile)

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_REMOTE` | — | rclone remote path for off-host backup (e.g. `s3:my-bucket/brain`) |
| `BACKUP_INTERVAL` | `0 3 * * *` | Cron schedule for the backup job |

---

## Minimal `.env.example`

```bash
# ─── Required ────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://brain:brain@localhost:5432/brain

# ─── LLM provider (pick at least one) ───────────────────────────────────────
GOOGLE_GEMINI_API_KEY=        # easiest start — free tier available
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=
# DASHSCOPE_API_KEY=

# ─── Auth mode (pick one — instance is locked without this) ─────────────────
ADMIN_USERNAME=admin@brain.local
ADMIN_PASSWORD_HASH=          # run: pnpm hash-admin-password 'your-password'
# AUTH_GITHUB_ID=
# AUTH_GITHUB_SECRET=
# AUTH_SECRET=                # openssl rand -base64 32

# ─── Registration ────────────────────────────────────────────────────────────
REGISTRATION_REQUIRES_VOUCHER=true

# ─── MCP ─────────────────────────────────────────────────────────────────────
MCP_TRANSPORT=http
MCP_SERVER_HTTP_PORT=3100

# ─── Public hostnames (required for production deploy) ───────────────────────
# BRAIN_PUBLIC_HOSTNAME=brain.example.com
# BRAIN_MCP_PUBLIC_HOSTNAME=mcp.brain.example.com
# CADDY_EMAIL=admin@example.com

# ─── Optional ────────────────────────────────────────────────────────────────
# SENTRY_DSN=
# EMAIL_PROVIDER=resend
# EMAIL_API_KEY=
# EMAIL_FROM=brain@example.com
```
