# Security

How External Brain protects your data, the auth modes, the voucher gate, and the zero-error iteration loop we run before any release.

---

## Threat model

External Brain is a multi-tenant knowledge substrate. The data that must not leak:

- **Raw session events** — include full coding prompts that may carry pasted secrets, internal URLs, customer data.
- **Extracted Knowledge rows** — include business rules, internal framework choices, personnel-specific preferences.
- **MCP tokens** — grant full read/write access to a user's Brain.
- **Audit log** — by design contains *what* admins did, when, and to whom. Leaking it leaks privileged workflow.

The adversaries we defend against:
- An anonymous internet visitor reaching the webapp URL (highest likelihood).
- An authenticated user of tenant A reading tenant B's data (scope leakage).
- A compromised LLM provider key (rotate, rate-limit, cap cost).
- A disgruntled former admin (revocation must be immediate; audit of admin actions is append-only).

Out of scope (for now): nation-state APT, physical VM compromise, side-channel attacks on embedding inference.

## Posture changes since v0.11.1

The v0.11.2 audit sweep (catalog #103, closed 2026-05-07) materially improved the posture in five places. If you read older copies of this doc, here's what changed:

- **MCP HTTP session is bound to the bootstrap token** (audit C1, PR #124). Previously a leaked `Mcp-Session-Id` plus any valid Bearer = act-as-victim. Now the transport `timingSafeEqual`s the request's Bearer to the session's stored token; mismatch returns `401 -32001 "Session-token mismatch"`. Session UUIDs are also redacted from `mcp.session.open`/`close` log lines (W4).
- **Voucher codes are CSPRNG-generated** (audit C2, PR #116). Previously `Math.random()`; now `node:crypto.randomInt`. V8 PRNG state recovery from observed codes no longer applies.
- **Cross-user IDOR cluster closed** (audit C3-C6, PR #117). All MCP tools that take a caller-supplied `sessionId`/`projectId` (`brain_log_event`, `brain_report_session_outcome`, `brain_teach_knowledge`, `brain_start_session`) and the web `POST /api/knowledge` validate ownership against `auth.userId` and `userCanAccessProject(...)` before mutating. Knowledge counter bumps in `brain_report_session_outcome` are scoped to `ownerUserId` so a foreign Knowledge ID is silently skipped instead of flipping its counter.
- **Credentials sign-in timing flattened** (audits W1+W2, PR #137). Both the no-`UserCredential` and no-`User` branches now run a dummy bcrypt before returning null. Email enumeration via response-time delta no longer works.
- **Token-route audit writes are awaited** (audit W6, PR #142). `token.create`/`token.revoke` no longer use `void writeAudit(...)` — a process restart between the response and the async insert can no longer drop the audit row.

The full audit catalog with closed/open status lives in #103 (BrainPlatform, private).

---

## Auth modes

Three mutually-exclusive modes, chosen by env config:

| Mode | When | Required env | Who can reach the app |
|---|---|---|---|
| **OAuth** (pilot / production) | Always set for public deployments | `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_SECRET` | Only users who have successfully signed in via GitHub + hold a valid JWT. New signups require a voucher code by default. |
| **Dev shim** (local dev only) | Single-tenant demo, no OAuth app yet | `ALLOW_DEV_AUTH=true` | Whoever can reach the server — everyone shares one User row. Refused in `NODE_ENV=production` unless `ALLOW_DEV_AUTH_IN_PRODUCTION=true` is also set. |
| **Unconfigured** (default) | Neither of the above | (none) | **Nobody.** Every request returns 503 `auth_not_configured`. A freshly-deployed VM with neither AUTH_* nor ALLOW_DEV_AUTH set is locked shut until the operator picks a mode. This is the secure-by-default posture. |

### Why unconfigured → 503

Before 2026-04-23, an unconfigured deployment silently fell through to the dev shim and served everyone as the first User row in the DB. That meant any scanning IP could read the seeded Alex persona's Knowledge. The fix (`auth.ts::getCurrentUserId` throwing `auth_not_configured`) closes that hole at the default setting, so the operator's mistake is "the app doesn't work" rather than "the app works for anyone who finds it."

### Admin bootstrap

`ADMIN_EMAILS` is a comma-separated env var (one entry or many). On each sign-in, if the signing-in user's email matches (case-insensitive), their `User.role` is set to `admin` — either on creation (new user) or on update (existing non-admin). The list is read at sign-in only; removing an email from `ADMIN_EMAILS` does NOT demote the user.

### Role changes (promote + demote)

`/admin/users` provides per-user **Promote to admin** / **Demote** buttons backed by `PATCH /api/admin/users/[id]/role`. Every change writes an `admin.role_change` audit row with `{email, from, to, selfChange}` payload. A soft guard refuses to demote the last remaining admin (409 `last_admin_cannot_be_demoted`) so the deployment never becomes UI-unrecoverable — the operator must promote someone else first. `ADMIN_EMAILS` remains the chicken-and-egg bootstrap for a fresh deployment.

Admins listed in `ADMIN_EMAILS` bypass the voucher gate for their own first sign-in. This is the chicken-and-egg escape hatch — the first admin can always bootstrap themselves without needing another admin to hand them a voucher.

### Production guards

- `refuseDevShimInProduction()` refuses the dev shim when `NODE_ENV=production` unless `ALLOW_DEV_AUTH_IN_PRODUCTION=true`.
- `scripts/deploy.sh` refuses the deploy if `ALLOW_DEV_AUTH=true`, forcing real auth (OAuth or credentials) on the server.
- NextAuth's `/api/auth/*` route is exempt from the in-process rate limiter (`proxy.ts`) so the OAuth callback can't 429 on a cold deploy.

---

## Voucher-code registration

### Model

Two tables: `VoucherCode` and `VoucherRedemption`.

```
VoucherCode
  id                cuid
  code              unique TEXT (uppercase, normalized)
  kind              "personal" | "organization"
  organizationLabel TEXT?         -- display name for org codes
  maxUses           INT (>=1)
  usedCount         INT
  expiresAt         TIMESTAMP?
  disabled          BOOLEAN
  note              TEXT?         -- admin-facing free text
  createdByUserId   User.id?
  createdAt/updatedAt
  redemptions       VoucherRedemption[]

VoucherRedemption
  id          cuid
  voucherId   -> VoucherCode
  userId      -> User (unique — one redemption per user, ever)
  redeemedAt  TIMESTAMP
```

### Claim flow

1. New user lands on `/signin` (set as `REGISTRATION_REQUIRES_VOUCHER=true` default).
2. User types their voucher code, clicks "Continue with GitHub".
3. Server action sets a 10-minute httpOnly cookie `bp_voucher=<CODE>`, then initiates OAuth.
4. GitHub returns to `/api/auth/callback/github` with a verified email.
5. NextAuth `signIn` callback runs:
   - If the email already has a User row → refresh profile, maybe apply admin promotion, continue.
   - If new user AND `ADMIN_EMAILS` contains the email → create with `role='admin'`, bypass voucher.
   - If new user AND no `bp_voucher` cookie → redirect `/signin?error=voucher_required`.
   - If new user AND voucher cookie → call `claimVoucher({code, email, name, image})`.
6. `claimVoucher()` runs a Postgres transaction with `SELECT ... FOR UPDATE` on the voucher row, checks `disabled / expiresAt / usedCount < maxUses`, creates the User row, increments `usedCount`, writes the `VoucherRedemption` row. All four steps commit atomically, so two concurrent claims on the last seat of a multi-use code cannot both succeed.
7. On failure, redirects `/signin?error=voucher_<reason>` with one of: `invalid | disabled | expired | exhausted`.

### Email + password self-service registration

The same voucher gate also governs a no-OAuth signup path, so a deployment that
only runs Credentials mode (the pilot default) can still let new users onboard
themselves instead of waiting for an invite. Flow:

1. A visitor opens `/signin?mode=register` (linked from the "Don't have an
   account? Create one" affordance) and submits email + password (+ a voucher
   code, shown as required while `REGISTRATION_REQUIRES_VOUCHER=true`).
2. The page's server action POSTs to **`POST /api/auth/register`**.
3. The route refuses early with `403 registration_unavailable` if the
   Credentials provider isn't configured — without it the new account could
   never sign in, so we don't create a stranded row.
4. Rate-limit: **5 registrations / hour / IP**, plus the shared voucher
   brute-force limiter (10 / hour / IP) on the gated path.
5. **Enumeration guard:** on the gated path the voucher is validated *before*
   the email-exists check. An anonymous caller with no valid voucher therefore
   gets `voucher_*` regardless of whether the email is registered — they can't
   use this endpoint to enumerate accounts. Only a valid-voucher holder (rate-
   limited) can see `email_taken`. On the open path (operator set the flag to
   `false`) enumeration is inherent to open signup; the per-IP limiter is the
   mitigation.
6. The password is bcrypt-hashed (cost 12) **outside** the DB transaction, then
   `claimVoucher({ …, passwordHash })` creates the `User` + `UserCredential` +
   voucher redemption atomically (open path: a plain `User` + `UserCredential`
   transaction). The new user is then bootstrapped with their own personal org
   + default project, exactly like every other sign-in path.
7. Success returns `{ ok, redirectTo }`; the page signs the user in with the
   credentials they just set.

`REGISTRATION_REQUIRES_VOUCHER` is the **single knob** for "is open signup
allowed here" — it gates both this path and the OAuth path. Default `true`
keeps a freshly-deployed instance closed to the public (secure-by-default).

### Kinds

- **Personal** codes default to `maxUses=1`. Meant for a single pilot invitee.
- **Organization** codes carry `organizationLabel` (e.g. "Acme Inc.") and typically `maxUses=5..50`. Every redemption is its own User row; the label is purely for admin-facing grouping. (A full teams surface is a later phase.)

### TTL

- `expiresAt` is any future timestamp, or `null` for "never expires".
- Admin UI exposes a "days from today" input (0 = never) that converts to the absolute timestamp.
- Expired codes validate as `expired` and refuse new redemptions, but **existing redemptions keep working** — an expired code does not sign users out.

### Admin operations

All through `/api/admin/vouchers/*` (role-gated by `requireAdmin()`) or the `/admin/vouchers` page:

- Create — custom or auto-generated code, specify kind / label / maxUses / TTL / note.
- List — with status chips: active / disabled / expired / exhausted.
- Toggle disabled — reversible pause without deleting.
- Update `maxUses` — refused if below current `usedCount` (400 `maxUses_below_usedCount`).
- Delete — cascades to redemptions. Audit log retains the action record by contract.

Every mutation writes an `AuditLog` row via `writeAudit()` with `action: "voucher.create|update|delete"`. Recursive secret-redaction applies.

### Brute-force rate-limit on voucher submission

`checkVoucherRateLimit(clientIp)` in `apps/web/lib/brain/vouchers.ts` gates the `/signin` server action. Each `X-Forwarded-For` source IP gets **10 voucher submissions per rolling hour**; over the cap returns `/signin?error=voucher_rate_limited`. Backed by the same async `Store` interface as `proxy.ts` (Redis in production, in-memory otherwise), so a multi-replica deployment shares the counter — an attacker hopping replicas cannot reset their window.

The 8-char alphanumeric code space (~10^10 per prefix) plus the per-IP limit means a realistic brute-force needs >10^9 hours per IP. Honest mistypes still get 10 tries per hour before being asked to wait or contact an admin.

---

## Admin surface

Gated by `requireAdmin()` at the layout + API layer. Non-admin users get redirected to `/` — the page doesn't render a 403 because "admin page exists here" is itself a leak.

| Route | Purpose |
|---|---|
| `/admin` | Overview — user count, active vouchers, redemptions, Knowledge/session counts, audit entries, Oracle spend |
| `/admin/vouchers` | Issue + manage invite codes |
| `/admin/users` | Roster: email, role, knowledge/session counts, join date |
| `/admin/audit` | 200 most recent audit rows: when / actor / action / target / IP |

Future items (tracked in KNOWN_ISSUES): per-user role change UI, GDPR erase UI (endpoint exists; button doesn't yet), teams + tenant management.

---

## Self-hosting hardening — before you expose an instance to the internet

External Brain ships secure-by-default, but a public deployment must still get
these right. Every item below has bitten a real deployment, so the repo carries
the lesson:

1. **Never bind the data/app ports to a public interface.** `deploy/docker-compose.yml`
   binds Postgres (`5432`), web (`3000`), and MCP (`3100`) to `127.0.0.1` by
   default. Public traffic goes through Caddy over TLS (`:443`), never the
   plain-HTTP host ports. If you override `POSTGRES_HOST_BIND` / `WEB_HOST_BIND`
   / `MCP_HOST_BIND`, never use `0.0.0.0`. *(An earlier default published
   Postgres on `0.0.0.0:5432` with the default password; CERT-Bund/BSI flagged
   the open DB.)*
2. **Change the default database password.** `POSTGRES_PASSWORD` defaults to
   `brain` for local dev — set a strong value before any non-local deploy, and
   a strong `AUTH_SECRET` (`openssl rand -base64 32`).
3. **TLS for everything public.** Deploy with `./scripts/deploy.sh` (Caddy
   + auto-TLS via the `edge` profile). An MCP Bearer token sent over plain HTTP travels in cleartext.
4. **Enable a host firewall** allowing only SSH + 80/443. Note: Docker-published
   ports bypass `ufw` (Docker inserts its rules ahead of it), so **correct port
   binding (item 1) is the real control** — the firewall is defense-in-depth.
5. **Verify after every deploy.** `./scripts/verify-lockdown.sh` audits auth
   posture and **fails if `5432`/`3000`/`3100` are bound to a public interface**.
   Spot-check too: `ss -tlnp | grep -E ':5432|:3000|:3100'` should show
   `127.0.0.1` only.
6. **Rotate exposed secrets at the provider** and never commit `.env`.

---

## The one command every deploy should run

`scripts/verify-lockdown.sh` runs the full network-level audit against a live stack. It reads the auth mode from `.env` and expects different behaviour for each:

```bash
# Against the local dev stack:
./scripts/verify-lockdown.sh

# Against a remote/public deployment:
BASE_URL=https://brain.example.com MCP_URL=https://mcp.brain.example.com \
  ./scripts/verify-lockdown.sh
```

Exit codes: `0` locked correctly / `1` LEAK — fix before release / `2` stack unreachable.

`scripts/deploy.sh` (server) runs it automatically at the end and **refuses** the deploy if the audit fails. `scripts/dev-up.sh` (local) runs it too but only **warns** — dev-shim mode is allowed to be unlocked locally. (A bare `docker compose up` runs neither; invoke `verify-lockdown.sh` yourself if you expose a hand-rolled stack.)

The deploy script also enforces the one-way combination rule that caused the original VM leak: `ALLOW_DEV_AUTH=true` together with OAuth envs is a configuration error, and `deploy.sh` dies on that combination before bringing anything up.

### Credentials mode (phase-1 pilot default, 2026-04-24)

The phase-1 pilot uses username + bcrypt-hashed password stored in `.env` — no OAuth App required. The flow:

1. **Generate the password hash:**
   ```bash
   # Prepend a space to keep the plaintext out of shell history
   # (requires HISTCONTROL=ignorespace in your shell).
    pnpm hash-admin-password 'PickASensibleStrongPassword'
   # outputs: $2b$12$...
   ```
2. **Paste into `.env.local`** (single-quoted — bcrypt hashes contain `$` that bash would expand):
   ```env
   ADMIN_USERNAME="admin"
   ADMIN_PASSWORD_HASH='$2b$12$...'
   ADMIN_EMAIL="admin@brain-platform.local"   # optional; synthesized otherwise
   ALLOW_DEV_AUTH="false"
   ```
3. **Restart** so the container picks up the envs:
   ```bash
   docker compose -f deploy/docker-compose.yml --env-file .env restart web mcp-server
   ```
4. **Verify** the gate is live:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://<host>:3000/api/me
   # → 401 means Credentials mode is correctly enforcing auth
   # → 200 means dev-shim is still active somewhere; see troubleshooting below
   ./scripts/verify-lockdown.sh   # should report Mode: CREDENTIALS
   ```

**Security notes.**

- **`.env.local` must be mode 600.** Anyone with read access to the hash can brute-force it offline at ~200 ms/guess; anyone with write access owns the admin account. `stat -c '%a' .env.local` must show `600`; if it shows `644` or worse, `chmod 600 .env.local`. The `.env` symlink pattern is documented in `docs/RUNBOOK.md` — `chmod` follows the symlink so `chmod 600 .env` does the right thing.
- **Bcrypt cost 12 = ~200 ms/guess**, which caps offline brute-force rate at roughly 5 guesses/sec per CPU core. A 12-character random password takes trillions of years at that rate; a dictionary word takes minutes. The helper script refuses passwords shorter than 12 chars.
- **Rotation.** To rotate: generate a new hash, replace `ADMIN_PASSWORD_HASH` in `.env.local`, `docker compose restart web mcp-server`. Existing sessions survive (the JWT cookie is signed by `AUTH_SECRET`, not the password hash), so rotating the password doesn't kick the operator out — rotate `AUTH_SECRET` to invalidate existing sessions.
- **What credentials-mode does NOT give you:** per-user accounts, voucher-gated signup, team scopes, user-visible audit of who-signed-in-when (the admin account always shows as `admin@...` in the audit log). Those are the reasons OAuth mode exists for a real pilot with multiple users — credentials mode is the "one operator on one box" posture.

### The "declared-but-empty OAuth env" trap (2026-04-24, closed by credentials-mode default)

Observed before the phase-1 credentials pivot: `.env.local` had `AUTH_GITHUB_ID=""` and `AUTH_GITHUB_SECRET=""` (empty-string values), with `ALLOW_DEV_AUTH="true"` also set. Because `authConfigured()` in `apps/web/auth.ts` checks `!!process.env.AUTH_GITHUB_ID` (falsy on empty string), the server took the dev-shim path and served the first User row to every anonymous caller — while the operator thought they were in OAuth mode because the key names were present in the file.

Symptom: "after sign out I can still see the app." Because there's no real session in dev-shim mode, there's nothing to sign out from — the app kept serving Alex to every visitor.

Diagnose:
```bash
docker compose -f deploy/docker-compose.yml --env-file .env exec -T web printenv \
  | grep -E '^(ADMIN_USERNAME|ADMIN_PASSWORD_HASH|AUTH_GITHUB_ID|AUTH_GITHUB_SECRET|AUTH_SECRET|ALLOW_DEV_AUTH)=' \
  | awk -F= '{if ($1 ~ /SECRET|ID|HASH/ && length($2)>0) print $1"=<set>"; else print $0}'

curl -s -o /dev/null -w "/api/me unauth: HTTP %{http_code}\n" http://localhost:3000/api/me
```

**This trap is closed for phase-1 by defaulting to Credentials mode** — operators populate `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` at setup, set `ALLOW_DEV_AUTH=false`, and the empty-GitHub-envs case stops being a live hazard. When OAuth is re-enabled later, the trap's boot-time refusal (`AUTH_GITHUB_ID=""` + `ALLOW_DEV_AUTH=true` → explicit error, don't silently pick dev-shim) should still be added — tracked in KNOWN_ISSUES.

## Zero-error iteration loop

Before marking any security change as "done," run through this checklist. Every step produces an artifact so the result is reproducible — no "I ran it mentally."

1. **Typecheck the whole workspace.**
   ```bash
   pnpm turbo run typecheck
   ```
   Must end with `N successful, N total`. Zero errors.

2. **Unit tests.**
   ```bash
   pnpm --filter @brain/core test
   ```
   All green (71 tests as of 2026-04-23).

3. **Auth-guard audit on every API route.** Every file under `apps/web/app/api/**/route.ts` must either:
   - Call `getCurrentUserId()` or `requireAdmin()` before any DB read, OR
   - Be a NextAuth handler (`/api/auth/[...nextauth]`), OR
   - Be an explicit public probe (`/api/healthz`, `/api/readyz`).

   One-liner to catch new routes that forget:
   ```bash
   find apps/web/app/api -name route.ts | while read f; do
     if ! grep -qE "getCurrentUserId|requireAdmin|handlers|authErrorResponse" "$f" \
        && ! echo "$f" | grep -qE "(healthz|readyz|auth/\[)"; then
       echo "NEEDS AUTH REVIEW: $f"
     fi
   done
   ```
   Expected output: empty.

4. **Unauth lockdown probe.** With `ALLOW_DEV_AUTH=false` and no OAuth envs, the app must serve 503 on `/api/*` and 307→/signin on `/`:
   ```bash
   curl -o /dev/null -w "%{http_code}\n" http://localhost:3000/
   curl -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/knowledge
   ```
   Expected: `307` then `503`.

5. **E2E full suite.**
   ```bash
   E2E_BASE_URL=http://localhost:3000 pnpm --filter @brain/web e2e
   ```
   Expected: zero failures. Skips are OK if every skip has a `test.skip(true, "<reason>")` string.

6. **Security spec specifically.**
   ```bash
   E2E_BASE_URL=http://localhost:3000 pnpm --filter @brain/web e2e e2e/security.spec.ts
   ```
   All green.

7. **MCP bearer token fail-closed.** Hit `:3100/mcp` with no Authorization header and with a bogus one; both must be ≥ 400.

8. **Audit log append-only spot-check.** Any new admin action introduced in the change must write an `AuditLog` row. Open `/admin/audit` after exercising the new surface; the action should appear.

Or, in one command that runs steps 3, 4, 7 end-to-end against the running stack:

```bash
./scripts/verify-lockdown.sh
```

Iterate — any red step fails the release gate. Re-run the whole list after every fix, not just the one that failed; auth changes have a nasty habit of regressing unrelated paths.

---

## Troubleshooting

### "There was a problem with the server configuration" on `/api/auth/*`

NextAuth v5's generic error for three distinct misconfigurations:

| Cause | Fix |
|---|---|
| `AUTH_SECRET` is unset or empty | `openssl rand -base64 32` → set in `.env` → `./scripts/reload.sh web` |
| `AUTH_TRUST_HOST` unset on a non-localhost deployment | Set `AUTH_TRUST_HOST="true"` in `.env`. `auth.ts` now also sets `trustHost: true` in code as belt-and-braces, but the env var is what NextAuth reads at module load. |
| `AUTH_URL` mismatch | Must exactly match the URL the user types: protocol, host, port, no trailing slash. `http://203.0.113.10:3000` ≠ `http://203.0.113.10:3000/` ≠ `https://...`. |

A quick diagnostic:

```bash
docker compose -f deploy/docker-compose.yml --env-file .env exec -T web env \
  | grep -E "^AUTH_(SECRET|URL|TRUST_HOST|GITHUB_)" | sort
```

All four (`AUTH_SECRET`, `AUTH_URL`, `AUTH_TRUST_HOST`, `AUTH_GITHUB_ID`) should be populated in OAuth mode. The fix after editing `.env` is always `./scripts/reload.sh web` (force-recreate — a plain restart keeps the old env).

### Sign-out button produces the server-configuration error

Resolved 2026-04-23. The old user menu posted to `/api/auth/signout` without a CSRF token; NextAuth v5 refuses that and returns the generic server-config error. Now the user menu links to `/signout`, which renders a server-action form that calls `signOut()` via NextAuth's own action (CSRF handled internally).

If you still see the error, it's the `AUTH_TRUST_HOST` / `AUTH_URL` issue above — the `/signout` page renders, but the underlying `signOut()` server action still needs a trusted host.

### Sign-out redirects to `/undefined`

Resolved 2026-04-23. NextAuth v5's `signOut({ redirectTo: "..." })` in a server action can redirect to the literal string `"/undefined"` when a `callbackUrl` form field is absent — the redirect-construction code path reads the form value and stringifies `undefined` into the URL. This produced the 404 reported on the pilot VM.

**Fix:** `/signout` now uses a two-step pattern: `signOut({ redirect: false })` clears the session cookie without redirecting, then `redirect("/signin")` from `next/navigation` does the redirect explicitly to a path we control. Regression test: `apps/web/e2e/signout.spec.ts` asserts no response in the signout chain redirects to `/undefined`.

### Note: `trustHost: true` is a deliberate tradeoff

`auth.ts` hardcodes `trustHost: true` in the NextAuth config. That tells NextAuth to trust the incoming `Host` header without verifying it against `AUTH_URL`. Correct for 99% of deployments — behind Caddy (`deploy/PRODUCTION.md`) or Cloudflare, the reverse proxy sets `Host` reliably, and requiring an exact `AUTH_URL` match instead blocks legitimate callback paths when the proxy strips or rewrites headers.

**When to override it to `false`:** the Brain container is directly internet-exposed with no reverse proxy, AND the hostname/port must match `AUTH_URL` exactly. In that setup an attacker who can spoof the `Host` header could theoretically trick NextAuth's callback redirect logic. Production deployments that hit this edge case should set `AUTH_TRUST_HOST="false"` in the env AND pin `AUTH_URL` to the canonical URL — though if you're on a real internet IP without a proxy, you probably have bigger problems than the Host header.

### Legacy `/api/auth/signout` bookmarks

We cannot safely override `/api/auth/signout` with our own handler — it's captured by NextAuth's catch-all `[...nextauth]` route, and shadowing it would break the underlying signout mechanism our own `/signout` page relies on. If a user has bookmarked the old URL, they'll still land on NextAuth's default confirmation page (which 500's in the misconfigured case but works fine once `AUTH_TRUST_HOST` / `AUTH_SECRET` are set). Tell them to use `/signout` instead; or put a link to it in any operator-facing dashboard.

## Token wizard — "token never re-leaves the browser"

When a user creates or changes a token at `/settings/tokens`, the raw `bp_…` value is returned by the API exactly once. The post-mint wizard renders per-client/OS install snippets from that value entirely client-side — the token is interpolated into the snippet in the browser and never sent back outbound in an HTTP request. This is an implementation detail of the operator-facing UX, not a change to the underlying threat model: the raw token is still shown once at mint and lives only in the user's clipboard or config file after that.

The "Test connection" button in the wizard calls `POST /api/tokens/test` with the `tokenId` (a non-secret DB row ID) rather than the raw token. The endpoint validates token state — `active`, `revoked`, `expired`, or `scheduled-revoke` — from the DB row and returns the result without ever receiving or logging the raw value. Audit: `token.test` action with `{ tokenId }`.

## MCP token secret management

`POST /api/tokens/:id/change` replaces the hash **in-place** on the same `MCPToken` row — same `id`, `name`, `scope`, `expiresAt`, `createdAt` — and takes effect immediately with zero grace. Use this for routine refresh or after a suspected leak. Audit action: `token.change`.

**Operational guidance:**

| Situation | Recommended action |
|-----------|-------------------|
| Routine refresh | `POST /api/tokens/:id/change` — swap the secret, copy the new raw value, update client configs. |
| Suspected or confirmed leak | `DELETE /api/tokens/:id` — hard revoke, instant. Then create a new token. |
| No-disruption migration (keep old token alive while updating clients) | Create a new token, update clients to it, then revoke the old token manually once confirmed. |

**Schema note.** The `scheduledRevokeAt` and `rotatedFromId` columns remain on the `MCPToken` table and the auth gate in `apps/mcp-server/src/auth.ts` still rejects tokens where `scheduledRevokeAt <= NOW()`. No current path sets these columns (rotate-with-grace was removed 2026-04-27), but the gate is kept as defense-in-depth. Re-enabling rotate is a UI + endpoint change — no schema migration required.

### Token scoping reduces blast radius (Phase 3c)

A token may be **scoped to a specific project** by setting `projectId` on creation. When scoped:

- The auth gate surfaces `auth.projectId` in every tool call's `AuthContext`.
- Any MCP write that targets a different project is rejected with `BrainError{code:"FORBIDDEN_PROJECT"}`.
- **Blast radius of a leaked CI token** is limited to a single project — even if the attacker can authenticate, they cannot write Knowledge/Sessions to any other project in the org.

**Scoping is opt-in and backwards-compatible.** Unscoped tokens (`projectId = null`) behave exactly as before (any project the user has access to). The solo-user experience is unchanged — the project picker on `/settings/tokens` is hidden when the user has only one project.

**Scope is preserved on change.** `POST /api/tokens/:id/change` is in-place — all metadata including `organizationId` and `projectId` is unchanged.

**Recommended practice for CI/CD:** scope each CI token to the project it deploys. If the token is compromised, the attacker cannot pivot to other projects in the org.

## Org member roles + invite tokens (Phase 3a)

### Role matrix

| Role | Can invite | Can manage members | Can revoke invites | Max grantable role |
|---|---|---|---|---|
| owner | yes | yes | yes | owner |
| admin | yes | yes | yes | admin |
| member | no | no | no | — |

Privilege checks are enforced in `packages/core/src/org.ts` — not at the HTTP layer — so they apply regardless of the API caller shape.

### Last-owner protection

Every organization must have at least one `owner`. `setOrgMemberRole` and `removeOrgMember` count existing owners before proceeding and throw `BrainError{code:"LAST_OWNER", status:409}` if the operation would leave the org ownerless.

### Invite token security

- Tokens are generated with `crypto.randomBytes(32).toString("base64url")` — 256 bits of entropy, not guessable.
- Tokens are stored **plaintext** in `OrganizationInvite.token`. This is intentional: invite tokens are one-shot, low-value, and short-lived (7 days). They are not bearer credentials — accepting requires an authenticated session.
- Tokens are single-use (`acceptedAt` is set on first acceptance; re-use returns 409).
- Tokens can be revoked at any time by any org owner/admin.
- No email is sent in Phase 3a — the invite link is delivered out-of-band by the operator.

### Threat model for invite links

| Threat | Mitigation |
|---|---|
| Link intercepted in transit | HTTPS required in production (Caddy TLS) |
| Link forwarded to wrong person | Invitee must have a valid session to accept |
| Expired link replayed | `expiresAt` checked server-side |
| Revoked link used | `revokedAt` checked before membership creation |
| Same link accepted twice | `acceptedAt` check returns 409 on re-use |

## Knowledge visibility — listing filter, not a hard ACL (Phase 4)

The `visibility` column on `Knowledge` (`"private"` / `"project"` / `"org"`) is a **listing and retrieval filter**. It controls what appears in the UI, in `GET /api/knowledge`, and in KRA/Oracle retrieval. It does NOT bypass the token-level project ACL.

A project-scoped MCP token (`MCPToken.projectId` set) still cannot write to another project regardless of what `visibility` values exist on Knowledge rows. The hard write-time check is in the MCP tool handlers.

Concretely:
- An "org"-visible row does not grant a token the ability to write knowledge into another project — it can only *read* the org row when `accessibleProjectIds` includes that project.
- Promote requires ownership (`ownerUserId === current user`). Fork requires org membership. A stolen token from a project member cannot promote a row they don't own.

## Multi-user Credentials sign-in

### Overview

Phase-3b extends the single-admin Credentials path to support multiple pilot users who sign up via invite link without needing a GitHub account. The admin path is unchanged — it remains env-based (`ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH`).

### How it differs from the admin path

| | Admin (env-based) | Per-user (invite-based) |
|---|---|---|
| Storage | `.env.local` bcrypt hash | `UserCredential` DB row per user |
| Bootstrap | Operator sets `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` | Invite → `/api/invites/signup` |
| Identifier | Username (or email if `ADMIN_EMAIL` set) | Email address (from invite) |
| Password change | Replace env var + restart | `POST /api/me/password` |
| Reset if forgotten | Operator updates env + restart | Self-service `/forgot-password` (when `EMAIL_PROVIDER=resend`); admin deletes `UserCredential` row + re-invites when email is disabled |
| Auth flow in NextAuth | First check in `authorize()` | Second check (email lookup + `verifyUserCredential`) |

### Password policy

- Minimum 8 characters. No special-character requirements (anti-pattern).
- Enforced by `validatePasswordPolicy()` in `@brain/core/user-credentials`. Called before bcrypt hashing so policy violations reject early without CPU cost.
- Operators who want stronger policies can add a zxcvbn check at the UI layer.

### bcrypt cost

Cost 12 (same as admin path). Each verify takes ~200ms on commodity hardware — the intentional brute-force rate cap.

### Change-password endpoint

`POST /api/me/password` requires the current password before accepting a new one. Fails with:
- `409 NO_CREDENTIAL` — user signed in via OAuth or admin env; no credential to change.
- `401 WRONG_PASSWORD` — current password mismatch (audit not written — don't log wrong guesses).
- `400 WEAK_PASSWORD` — new password fails policy.

Success writes an `user.password_change` audit row.

### invite-signup transaction

`POST /api/invites/signup` executes a single DB transaction:
1. Create `User` row (email from invite, lowercase).
2. Create `UserCredential` with bcrypt(password, 12).
3. Create `OrganizationMember` with invite's role.
4. Mark `OrganizationInvite.acceptedAt`.

If the email already has a `User` row (OAuth or prior admin creation), steps 2–4 run but step 1 is skipped. The response includes `existingUser: true` and the client is told to sign in via existing credentials instead of treating the call as a new registration.

---

## Email-based flows (invites + password reset)

### Email provider

Email is opt-in. Set `EMAIL_PROVIDER=resend` + `EMAIL_API_KEY` + `EMAIL_FROM` to enable. When disabled (default), invite links are returned in the API response only (manual handoff), and password reset requires operator intervention. See `docs/RUNBOOK.md §"Configuring email"`.

### Password reset token security

| Property | Value |
|---|---|
| Entropy | 32 random bytes (`crypto.randomBytes`) encoded as base64url — ~256 bits |
| Storage | Stored plaintext in `PasswordResetToken.token` (acceptable for short-lived tokens; same posture as invite tokens) |
| Expiry | 1 hour from creation |
| One-shot | `usedAt` is set on first use; re-use returns `invalid_token` |
| Cascade-delete | `onDelete: Cascade` on `userId` — user deletion removes all outstanding tokens |

### Enumeration guard

`POST /api/auth/forgot-password` ALWAYS returns HTTP 200 with a generic message regardless of whether the email exists, whether the user has a credential, or whether email delivery succeeded. This prevents user enumeration via timing or response differences.

### Rate limiting

`POST /api/auth/forgot-password` is rate-limited to 3 requests/hour per IP via the same `check()` + `Store` infrastructure as the Oracle and voucher flows. Redis-backed in multi-replica deployments; in-memory fallback for single-host.

### Threat model for reset links

| Threat | Mitigation |
|---|---|
| Link intercepted in transit | HTTPS required in production (Caddy TLS) |
| Link forwarded to wrong person | Token expires in 1 hour; usedAt prevents re-use |
| Exhaustive token search | 256-bit token space; rate-limit on forgot-password generation |
| Account takeover via enumeration | Always-200 response + generic message; no timing leak |
| Token left in DB after user deletion | ON DELETE CASCADE cleans up |

---

## Backup replication credentials

`deploy/rclone.conf` holds the storage-provider credentials used by the
`backup-replicate` sidecar. It is gitignored and must be created on every fresh
VM deployment (use `scripts/setup-backup-replicate.sh`).

**Key hygiene rules:**

- **File mode 600.** `stat -c '%a' deploy/rclone.conf` must show `600`. Anyone
  with read access to the file can read your storage bucket or, depending on the
  key's permissions, delete objects. `chmod 600 deploy/rclone.conf` after every
  write.
- **Minimum permissions.** Create a per-deployment access key with the narrowest
  scope your provider allows: `PutObject`, `GetObject`, and `ListBucket` on the
  backup prefix only (e.g. `my-bucket/brain-prod/*`). Never use root/admin keys.
- **Rotate via the provider's console.** Revoke the old key in the provider
  dashboard, update `deploy/rclone.conf`, then restart the sidecar:
  `docker compose ... restart backup-replicate`. The new key takes effect
  immediately — no service restart for the database or webapp is required.
- **Back up the config file itself.** Because `rclone.conf` is gitignored,
  store a copy in your password manager (1Password, Bitwarden, etc.) alongside
  the VM's other secrets. Losing the file means re-running
  `scripts/setup-backup-replicate.sh` with a fresh access key.

---

## Known gaps

- **No self-service admin role UI.** Admin promotion is via `ADMIN_EMAILS` env; demotion is SQL. Tracked in KNOWN_ISSUES.
- **Vouchers are not scoped to emails.** A voucher can be redeemed by any email that knows the code. An email-pinned voucher (`emailAllowlist String[]`) is a natural next step; current model supports it with a schema addition.
- **No rate-limit on `/api/auth/callback/*`.** NextAuth endpoints are exempt from the proxy limiter. If this becomes an abuse vector, add a separate per-IP limiter inside the callback.
- **No CAPTCHA on voucher entry.** A brute-forcer that enumerates short codes is plausible. Mitigated by the 8-char alphanumeric space (≥ 10^10 possibilities per prefix) but a rate-limit on voucher-validate attempts is cheap defense.
- **No session revocation for rotating compromised JWTs.** JWT expiry is the only mechanism today; a compromised token works until it expires. A `revokedAt` field on a Session table is the retrofit path.

---

## See also

- `apps/web/auth.ts` — NextAuth config + signIn callback.
- `apps/web/lib/brain/auth.ts` — per-request `getCurrentUserId()` and the 503 path.
- `apps/web/lib/brain/vouchers.ts` — `validateVoucher` + `claimVoucher` (transactional).
- `apps/web/lib/brain/admin-auth.ts` — `requireAdmin()`.
- `packages/db/prisma/migrations/20260423_vouchers/` — schema.
- `packages/core/src/audit.ts` — redaction rules + Action union.
- `docs/RUNBOOK.md` — operational recovery.
- `docs/KNOWN_ISSUES.md` — outstanding security gaps.
