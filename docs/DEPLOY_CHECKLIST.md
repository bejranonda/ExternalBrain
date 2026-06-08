# Production deploy checklist

Single-page walkthrough for putting External Brain on a public-internet VM. Follow top-to-bottom the first time. ~20 minutes end to end once the prerequisites are in hand.

Deeper references: [`deploy/PRODUCTION.md`](../deploy/PRODUCTION.md), [`docs/SECURITY.md`](./SECURITY.md).

---

## A. Things to prepare BEFORE touching the server

### A1. A VM

- Any Linux with **Docker Engine 24+ and Compose v2**. Tested: Debian 12, Ubuntu 22.04.
- Recommended for first pilot: 2 vCPU, 4 GB RAM, 40 GB disk. Scales to a few dozen users before needing more.
- **Public IP**.

### A2. DNS

Point at least one A record at the VM's public IP. Two is cleaner; Caddy routes by Host:

| Record | Target | Used for |
|---|---|---|
| `brain.yourteam.com` | VM IP | webapp |
| `mcp.brain.yourteam.com` | VM IP | MCP HTTP transport |

Wait until `dig +short brain.yourteam.com` returns the VM IP from your local machine before proceeding. ACME certificate issuance fails hard if DNS hasn't propagated.

### A3. Firewall

Inbound open:

- **80** — required for Let's Encrypt HTTP-01 challenge.
- **443** — your production traffic.

Everything else closed. Postgres stays on the Docker internal network; no host binding.

### A4. Sign-in method — pick ONE (both can coexist later)

**A4a. Credentials (phase-1 pilot default).** Single admin account, no OAuth App required. After cloning the repo in step B, generate a bcrypt hash of your chosen admin password:

```bash
# Prepend a space if your shell honours HISTCONTROL=ignorespace, so the
# plaintext doesn't end up in .bash_history.
 pnpm hash-admin-password 'PickASensibleStrongPassword12+chars'
# → outputs: $2b$12$...
```

Save the plaintext (you'll use it to sign in) and the hash (you'll paste it into `.env`). This is the fastest path to a working demo — no DNS, no GitHub, no callback URLs.

**A4b. GitHub OAuth App (phase-2 invitee path).** Only needed when the pilot opens to multiple users. Create at <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**:

- Application name: `External Brain` (or whatever)
- Homepage URL: `https://brain.yourteam.com`
- Authorization callback URL: `https://brain.yourteam.com/api/auth/callback/github`

Copy the **Client ID** and generate a **Client Secret**. You'll paste both into `.env`. Both A4a and A4b can be active at the same time — the `/signin` page renders both options.

### A5. An LLM provider key

At least one of:

- **Google Gemini** (has a free tier; easiest first-time setup) — create at <https://aistudio.google.com/apikey>.
- **OpenAI** — <https://platform.openai.com/api-keys>.
- **Anthropic** / **Z.ai GLM** — the latter via `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`.

Gemini works for BOTH embeddings and the Oracle; the simplest "one key" setup.

### A6. Secrets to generate locally

On your laptop (not the server), generate these once and save somewhere safe:

```bash
AUTH_SECRET=$(openssl rand -base64 32)
POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d /+=)
echo "AUTH_SECRET=$AUTH_SECRET"
echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
```

You'll paste these into the server's `.env`.

---

## B. Clone and configure

SSH to the VM.

```bash
# 1. Clone
git clone https://github.com/bejranonda/ExternalBrain.git external-brain
cd external-brain

# 2. Use the PILOT template (not .env.example — that one is for local dev)
cp .env.pilot.example .env

# 3. Edit .env
nano .env        # or $EDITOR .env
```

Fill in, at minimum, each line marked `REPLACE` plus the secrets from A6:

```env
# DNS / TLS
BRAIN_PUBLIC_HOSTNAME="brain.yourteam.com"
BRAIN_MCP_PUBLIC_HOSTNAME="mcp.brain.yourteam.com"
CADDY_EMAIL="ops@yourteam.com"
AUTH_URL="https://brain.yourteam.com"

# Database
POSTGRES_PASSWORD="<from A6>"
DATABASE_URL="postgresql://brain:<same password>@db:5432/brain"

# Auth — OAuth mode (REQUIRED for pilot)
AUTH_SECRET="<from A6>"
AUTH_GITHUB_ID="<from A4>"
AUTH_GITHUB_SECRET="<from A4>"
AUTH_TRUST_HOST="true"

# Leave the dev shim EXPLICITLY off
ALLOW_DEV_AUTH="false"
ALLOW_DEV_AUTH_IN_PRODUCTION="false"

# First admin(s) — comma-separated emails. These get role='admin' on
# first sign-in and bypass the voucher gate for their own bootstrap.
ADMIN_EMAILS="you@yourteam.com"

# Voucher gate for new signups
REGISTRATION_REQUIRES_VOUCHER="true"

# Don't seed the Alex demo persona on a real-user deploy
SKIP_SEED="true"

# LLM provider — pick ONE combo, uncomment in the template
GOOGLE_GEMINI_API_KEY="<from A5>"
```

Save. Double-check there are no remaining `REPLACE-me` strings:

```bash
grep REPLACE .env && echo "⚠️  still unfilled" || echo "✓ no REPLACE tokens left"
```

### `.env` keys per deploy shape

`.env.example` defines a superset of every possible key. Which ones actually matter depends on the deploy shape you're running. Audit with:

```bash
comm -23 \
  <(awk -F= '/^[A-Z]/ {print $1}' .env.example | sort -u) \
  <(awk -F= '/^[A-Z]/ {print $1}' .env | sort -u)
```

| Key | Needed when | Safe to omit when |
|---|---|---|
| `BRAIN_PUBLIC_HOSTNAME` / `BRAIN_MCP_PUBLIC_HOSTNAME` | Server deploy via `scripts/deploy.sh` (Caddy + DNS + TLS, `--profile edge`) | Bare local `docker compose up` (no TLS) |
| `CADDY_EMAIL` | Caddy is in front of the stack (ACME HTTP-01 registration) | No reverse proxy; direct port exposure |
| `AUTH_TRUST_HOST` | **Any** reverse proxy in front of the webapp (NextAuth needs to trust the forwarded host header) | Direct exposure of port 3000 |
| `REDIS_URL` | Multi-replica deploy OR you want per-cluster rate-limit instead of per-replica | Single replica — in-memory rate limit is correct |
| `SENTRY_DSN` + `SENTRY_TRACES_SAMPLE_RATE` | Shipping errors to Sentry | Local-only operation |
| `SKIP_SEED` | Pilot deploy — you don't want the Alex demo persona in production data | First-time dev setup where the seed is the point |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` / `AUTH_SECRET` | OAuth mode (pilot / public) | Local dev with `ALLOW_DEV_AUTH=true` |
| `ALLOW_DEV_AUTH` | Local dev where you want the first-user shim | Any real-user deploy |
| `ANTHROPIC_BASE_URL` / `EMBEDDING_BASE_URL` | Routing to a non-OpenAI/Anthropic provider (Z.ai GLM, DashScope Qwen3, self-hosted) | Using OpenAI or native Anthropic |

**A missing key is only a bug if your deploy shape actually needs it.** A single-replica VPN-only dev stack with Gemini as the provider can legitimately be missing 12 of the 35+ keys in `.env.example` without any functional impact. Don't cargo-cult the full list — audit against the row above.

---

## C. Deploy

```bash
./scripts/deploy.sh
```

This script:

1. Preflight-validates the env (DNS hostnames set, OAuth configured, `ALLOW_DEV_AUTH != true`).
2. Builds web · mcp-server · worker · bootstrap · caddy images.
3. Brings up Postgres; waits for it; installs pgvector; runs `prisma migrate deploy`; applies FTS indexes.
4. Skips the seed because `SKIP_SEED=true`.
5. Starts all services including the Caddy sidecar.
6. Waits for Caddy to pull the first Let's Encrypt certificate (~30–60 s).
7. Runs `./scripts/verify-lockdown.sh` against the public HTTPS URLs. **Refuses the deploy on failure.**

Expected final lines:

```
✓ HTTPS reachable on https://brain.yourteam.com/
✓ MCP HTTPS reachable on https://mcp.brain.yourteam.com/mcp
Auth mode (from .env): OAUTH
✓ / → 307 (bounces unauth to /signin)
✓ /api/knowledge → 401 (auth required)
✓ MCP without Authorization → 4xx (fail-closed)
PASS — no anonymous-leak vectors detected.

External Brain (production) is up.
```

If you see any `✗ … ANONYMOUS READ ACCESS. Leak.` — do **not** invite users. Fix the flagged issue and re-run. The deploy script refuses to print the success banner in that case.

---

## D. First sign-in and voucher issuance

1. Browse to `https://brain.yourteam.com/signin`.
2. **Leave the voucher field empty** — your email is in `ADMIN_EMAILS`, so the voucher gate is bypassed for your first sign-in.
3. Continue with GitHub → land on the dashboard.
4. Go to `https://brain.yourteam.com/admin/vouchers`.
5. **Invite additional admins** (optional) — either add their email to `ADMIN_EMAILS` and restart (`./scripts/reload.sh web`), OR have them sign in once as a regular user then go to `/admin/users` and click **Promote to admin** on their row. The last-admin guard prevents you from accidentally locking yourself out while experimenting.
6. Issue one voucher per pilot tester:
   - Kind: **personal** (unless it's an org-wide code)
   - Max uses: 1 (personal) or ~N (organization)
   - Expires in: 30 days is a reasonable default
   - Note: who you gave it to — helps audit later
7. Send each tester their code + the end-user guide: [`docs/END_USER.md`](./END_USER.md).

---

## E. Ongoing operations

### Daily / on-release

```bash
./scripts/verify-lockdown.sh     # auth still gated as expected?
./scripts/nav-smoke.sh            # every surface reachable?
```

Non-zero = incident. Both run automatically at the end of `reload.sh` and both deploy scripts, so in the normal flow you never remember to call them manually.

### After editing code + `git pull`

Refer to [README "Which script to run when"](../README.md#which-script-to-run-when). Short version:

- Code change → `./scripts/reload.sh web` (or `worker`, `mcp-server`)
- Schema change → `./scripts/deploy.sh`
- Env change → `./scripts/reload.sh web` (force-recreate is what picks up env)
- Unsure → `./scripts/deploy.sh` (idempotent, always safe, slower)

### Backups

Nightly `pg_dump` runs in the `backup` compose service; archives land in the `brain_backups` Docker volume. **On-host only** — if the VM dies, so do the backups. Pipe to S3/R2/rclone for real durability. See `deploy/PRODUCTION.md §"Backups"`.

Manual snapshot: `./scripts/backup-restore.sh backup`
Restore: `./scripts/backup-restore.sh restore <timestamp>`

### Monitoring

- `/api/healthz` — liveness. Hit from your uptime monitor.
- `/api/readyz` — readiness including DB. Fires 503 when the DB is down.
- Sentry: set `SENTRY_DSN` in `.env` to receive error reports. Off by default.

### Admin watchdog

Weekly, check:

- `/admin` — user count drifting? Oracle spend trending toward cap?
- `/admin/audit` — any unexpected actor IDs? Voucher-delete spree?
- `docker compose logs -f web | grep -E "error|fatal"` — five-minute scan.

### Security posture — what to re-verify every time

The [zero-error loop](./SECURITY.md#zero-error-iteration-loop) — 8 steps. Don't ship a security-relevant change without running it. The verify-lockdown + nav-smoke pair covers steps 3/4/7 in seconds; the rest needs the live stack.

---

## F. Before you invite pilot users

Final checklist — the "I'm about to share the URL" audit:

- [ ] `./scripts/verify-lockdown.sh` — PASS, mode = OAUTH
- [ ] `./scripts/nav-smoke.sh` — every surface ≤ 4xx
- [ ] HTTPS green (browser lock icon; `curl -sSf https://brain.yourteam.com/api/healthz`)
- [ ] GitHub OAuth round-trip works (you signed in end to end)
- [ ] You are role=admin (admin surface visible under your avatar)
- [ ] Voucher issued for each pilot tester
- [ ] `ADMIN_EMAILS` correctly set (check `/admin/users`)
- [ ] Oracle cost cap set to a sane value (`MAX_ORACLE_COST_USD_PER_DAY`)
- [ ] `.env` has no `REPLACE-me` leftovers, no dev-shim flags, no committed secrets
- [ ] Backup cron active (check `docker compose ps backup`)
- [ ] DNS + TLS both resolve from a machine OUTSIDE your network

When all ten boxes are checked, send the invites.

---

## G. Common failures and fixes

| Symptom | Fix |
|---|---|
| `HTTPS not yet reachable` after `deploy.sh` | DNS not propagated, or port 80 blocked. `dig +short <host>` + `nc -vz <ip> 80` |
| `There was a problem with the server configuration` on sign-in | `AUTH_SECRET` empty, `AUTH_URL` mismatched, or `AUTH_TRUST_HOST` unset. Diagnostic: `docker compose exec web env \| grep ^AUTH_` |
| Sign-out redirects to `/undefined` | Old code. `git pull && ./scripts/reload.sh web` — fixed in d5cfb5c. |
| `voucher_rate_limited` on legitimate sign-in | Someone's been mistyping voucher codes from the same IP. 10/hr per IP; either wait an hour or ask for a fresh code (admin bypasses via `ADMIN_EMAILS`). |
| `auth_not_configured` (503) | Both OAuth and `ALLOW_DEV_AUTH` are off. Set the three `AUTH_GITHUB_*` + `AUTH_SECRET` and redeploy. |
| Oracle returns 429 for users | Per-IP proxy rate limit. Bump `RATE_LIMIT_ORACLE_PER_DAY` or wire Redis (`REDIS_URL=redis://...`) for shared state. |

For anything not in the table: [`docs/KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) lists tracked risks and gotchas.
