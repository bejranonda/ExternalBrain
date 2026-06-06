# Production deploy — bare VM with a public IP

Reference doc for the deployment topology. **For a step-by-step first-pilot walkthrough, use [`docs/DEPLOY_CHECKLIST.md`](../docs/DEPLOY_CHECKLIST.md) instead — it's the chronological checklist (prerequisites → clone → `.env` → deploy → voucher issuance → pre-invite audit).** This doc is the reference you read once and grep later.

This is the minimum-viable path to putting Brain Platform on the open internet. Assumes a single Linux VM you control; you can resize vertically up to a handful of concurrent users without changing architecture.

## Prerequisites

1. **VM with a public IP.** Any Linux distro with Docker Engine 24+ and Compose v2. Tested on Debian 12 / Ubuntu 22.04.
2. **Two DNS A records** pointing at the VM:
   - `brain.example.com` → VM (webapp)
   - `mcp.brain.example` → VM (MCP HTTP)
   You can use the same hostname for both if you only want one — Caddy routes by Host.
3. **Firewall: ports 80/443 open** inbound. 80 is required for Let's Encrypt HTTP-01 challenge; 443 is your traffic. Keep 5432 and anything else closed.
4. **Docker + Compose v2** installed (`curl -fsSL https://get.docker.com | sh`).

## Environment checklist

Copy `.env.example` to `.env` and set at minimum:

```env
# --- DNS / TLS ---
BRAIN_PUBLIC_HOSTNAME="brain.example.com"
BRAIN_MCP_PUBLIC_HOSTNAME="mcp.brain.example"
CADDY_EMAIL="ops@example.com"

# --- Production flag ---
NODE_ENV="production"
AUTH_URL="https://brain.example.com"

# --- Database (stays internal; no public port) ---
DATABASE_URL="postgresql://brain:<strong-random-password>@db:5432/brain"
POSTGRES_PASSWORD="<strong-random-password>"      # match DATABASE_URL

# --- Auth (REQUIRED in production) ---
AUTH_GITHUB_ID="<from github.com/settings/developers>"
AUTH_GITHUB_SECRET="<same>"
AUTH_SECRET="$(openssl rand -base64 32)"

# --- LLM providers (pick one combo — see deploy/DEPLOY.md §"Provider ecology") ---
ANTHROPIC_BASE_URL="https://api.z.ai/api/anthropic"
ANTHROPIC_API_KEY="<z.ai key>"
ORACLE_MODEL="glm-5.1"
EMBEDDING_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
GOOGLE_GEMINI_API_KEY="<gemini key>"
EMBEDDING_MODEL="gemini-embedding-001"
EMBEDDING_DIMENSIONS="1536"

# --- Rate + cost caps ---
RATE_LIMIT_ORACLE_PER_DAY="100"
RATE_LIMIT_MCP_PER_MINUTE="200"
MAX_ORACLE_COST_USD_PER_DAY="10.00"

# --- Optional: skip the Alex-persona seed on a real-user install ---
# SKIP_SEED="true"

# --- Optional, discouraged: allow the dev-auth shim in production ---
# ALLOW_DEV_AUTH_IN_PRODUCTION="true"     # only if this VM is behind a VPN
```

`AUTH_SECRET` is mandatory — NextAuth v5 refuses to boot without it. Generate once and store securely; rotating it signs out every user.

## Deploy

```bash
git clone <repo> brain && cd brain
cp .env.example .env
$EDITOR .env                                     # fill in values from the checklist
./scripts/deploy.sh                              # ~2-3 min on a fresh VM
```

`deploy.sh` is idempotent. Safe to re-run after `git pull` / `git checkout <tag>`. Tail logs with:

```bash
docker compose -f deploy/docker-compose.yml --env-file .env logs -f
```

## How the server deploy differs from a bare local `up`

`scripts/deploy.sh` runs the single Compose file with `--profile edge` (Caddy, Redis, nightly backup) and adds the server-grade preflight + post-deploy checks. A bare local `docker compose -f deploy/docker-compose.yml up` brings up only the core stack with dev-friendly defaults.

| Concern | Local `up` | Server (`./scripts/deploy.sh`, `--profile edge`) |
|---|---|---|
| TLS | none (HTTP on :3000) | Caddy sidecar, auto Let's Encrypt on :443 |
| Host ports | 3000/3100/5432 bound (loopback) | Caddy fronts :80/:443; app ports stay loopback-only |
| Auth | dev-shim works without config | Fails closed: deploy refuses `ALLOW_DEV_AUTH=true` and requires `AUTH_*` |
| Seed | run `prisma db seed` manually | never seeds (`SEED_ON_DEPLOY=false`) |
| Health checks | — | `/api/healthz` + `/health` wired into compose `healthcheck:`; cert-wait + lockdown + smoke |

## Backups

The `backup` service (edge profile) runs `pg_dump` nightly at 03:00 UTC and writes compressed archives into the `brain_backups` Docker volume mounted at `/backups` inside the container. Retention: 7 daily, 4 weekly, 6 monthly copies.

### Where backups live

On the host the volume lives under Docker's managed storage (typically `/var/lib/docker/volumes/brain_backups/_data/`). Use `docker volume inspect brain_backups` to find the exact path.

### Copying backups off-host

```bash
# One-shot copy of a single file via docker cp (container must be running)
docker compose -f deploy/docker-compose.yml --profile edge exec backup \
  sh -c 'ls /backups/brain/'
docker cp "$(docker compose ps -q backup)":/backups/brain/<file.sql.gz> ./local-backup.sql.gz

# rsync the whole volume over SSH from a remote machine
rsync -avz -e ssh root@<vm-ip>:/var/lib/docker/volumes/brain_backups/_data/ ./brain-backups/
```

### Restoring

```bash
./scripts/backup-restore.sh
```

The script lists available archives, prompts you to pick one, shows the exact commands it will run, requires you to type `yes`, then pipes the dump through `pg_restore` into the running `db` container. Supports both `.sql.gz` and `.sql.bz2` formats.

If the `Knowledge` table is non-empty the script refuses unless `FORCE=1` is set — a guard against accidentally clobbering a live database.

```bash
FORCE=1 ./scripts/backup-restore.sh   # overwrite a non-empty DB
```

### Important: backups are on-host only

The `brain_backups` volume lives on the same physical disk as the database. A disk failure, VM deletion, or `docker volume rm brain_backups` destroys both the DB and its backups simultaneously. **These backups protect against logical errors (bad migrations, accidental deletes), not against hardware failure.**

For anything beyond a personal install, pipe the backup volume to off-site storage: mount an S3 bucket (e.g. via `rclone`), configure Cloudflare R2 as a sync target, or stream nightly dumps directly to object storage. Wiring off-host replication is a Wave 2 follow-up — see `docs/KNOWN_ISSUES.md`.

## Smoke test after first deploy

```bash
# TLS + webapp reachable
curl -sSf https://brain.example.com/api/healthz | jq .
# {"ok":true}

# DB connectivity through the web process
curl -sSf https://brain.example.com/api/readyz | jq .
# {"ok":true,"db":"up"}

# MCP health
curl -sSf https://mcp.brain.example/health | jq .
# {"ok":true,"transport":"http"}
```

Then sign in at `https://brain.example.com/signin`, create an MCP token under Settings → MCP tokens, and wire Claude Code per `docs/CLIENTS.md`.

## Honest limits of this production deploy

- **Single-host.** No redundancy; a VM reboot = minutes of downtime. Load-balanced multi-host is out of scope for Wave 1; comes with real demand.
- **Rate-limit state defaults to in-memory.** Survives container restarts only because the proxy is long-lived. Set `REDIS_URL=redis://...` in `.env` to share counters across replicas (the `Store` interface is Redis-ready as of Wave 2).
- **Backups are on-host only.** Nightly `pg_dump` lands in the `brain_backups` Docker volume on the same disk as the DB. A VM delete = both gone. See §"Backups" above for the `rsync` / S3 pattern.
- **Error reporting is opt-in.** Set `SENTRY_DSN` in `.env` to wire it; otherwise errors only go to `docker compose logs`.
- **Admin role bootstrap is via env.** `ADMIN_EMAILS` auto-promotes on first sign-in; demotion is a SQL `UPDATE`. A self-service role UI is a known gap (see `docs/KNOWN_ISSUES.md`).
- **JWTs cannot be revoked mid-session.** A compromised token lives until expiry. Future work: `Session` table with `revokedAt`.

What HAS shipped as of 2026-04-23:
- Append-only `AuditLog` with recursive secret redaction — every admin-visible mutation.
- Admin surface at `/admin/{vouchers,users,audit}` gated by `requireAdmin()`.
- Voucher-gated registration (atomic `SELECT … FOR UPDATE` claim, per-IP brute-force rate-limit).
- Secure-by-default auth — an unconfigured deployment serves 503, not the first User row.
- `scripts/verify-lockdown.sh` runs at the end of every deploy; `deploy.sh` refuses the deploy on a lockdown failure.
- `scripts/nav-smoke.sh` verifies every nav surface 2xx/3xx.

Deploy behind Cloudflare or a similar DDoS-absorbing CDN if the VM gets significant public traffic — Caddy handles legitimate load fine, but a single VM can't out-absorb a botnet.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `HTTPS on https://... not yet reachable` | Caddy can't reach `:80` for ACME challenge | Firewall blocks port 80, or DNS hasn't propagated. Check with `dig +short <hostname>` — must match the VM's public IP. |
| `dev-auth shim is refused in production` | `NODE_ENV=production` without `AUTH_*` or `ALLOW_DEV_AUTH_IN_PRODUCTION=true` | Set the three `AUTH_GITHUB_*`+`AUTH_SECRET` envs, or opt in to the shim if behind a VPN. |
| `/api/readyz` returns 503 | DB unreachable or slow | Check `docker compose logs db`. If healthy, check `DATABASE_URL` hostname (`db` inside compose, not `localhost`). |
| Caddy pulls a staging cert | ACME rate-limited you while debugging | Let's Encrypt caps 5 duplicate certs per week. Edit Caddyfile to `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` while iterating; switch back when stable. |

See `deploy/DEPLOY.md` §Troubleshooting for the dev-level issues that also apply here.
