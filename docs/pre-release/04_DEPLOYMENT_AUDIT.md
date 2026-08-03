# Pass 4 — Deployment, Release-Candidate & i18n Audit

**Role:** DevOps & Release Engineer
**Scope:** `deploy/docker-compose.yml`, `deploy/Caddyfile`, `scripts/dev-up.sh`,
`scripts/deploy.sh`, `.env.example`, `apps/web` i18n
**Baseline:** `202fe7a` (`v2.7.1`), branch `main`, 2026-08-02.

## Method & honesty statement

Static audit. No stack was brought up; no script was executed.

- ✅ **Performed:** mechanical diff of all 66 `process.env.*` references in
  `apps/` + `packages/` against the 81 keys in `.env.example`, **re-verified by
  name** against `deploy/` and `scripts/` to eliminate false positives from
  dynamic `process.env[name]` access; full read of the Caddyfile, both deploy
  scripts, and `verify-lockdown.sh`'s summary; key-by-key diff of the EN/TH/DE
  dictionaries; service-by-service map of healthcheck and restart coverage.
- ⬜ **Not performed (reviewer must do):** `./scripts/dev-up.sh` on a clean host,
  a real ACME cert issuance, an SSE stream through Caddy (see D-5).

My first pass at the env diff produced a list of ~34 "unused" variables that was
wrong — `proxy.ts` reads its rate-limit keys via `process.env[name]`, which a
`process.env.NAME` grep cannot see. The list below is the re-verified one. I am
noting this because the same mistake in the other direction would have produced
confident, false findings.

---

## Findings

| ID | Severity | Finding |
|---|---|---|
| **D-1** | **[HIGH]** | `.env.example` documents safety knobs that are wired to nothing — including a KEA cost cap and an MCP token secret. |
| **D-2** | [MEDIUM] | `worker` is the only long-running service with no healthcheck — and it is the service whose failures are already silent (Pass 3). |
| **D-3** | [MEDIUM] | TH and DE are each missing 4 keys; nothing in the type system or CI can catch locale drift. |
| **D-4** | [MEDIUM] | No `rate_limit` on the MCP vhost — the edge mirrors the application-layer gap from Pass 2. |
| **D-5** | [LOW] | `encode gzip zstd` on the MCP vhost may buffer SSE. *(Unverified — reviewer check.)* |
| **D-6** | [LOW] | 8 env vars referenced in code and absent from `.env.example`. |
| **D-7** | [LOW] | `deploy/DEPLOY.md:25` still lists a manual step the tooling now performs. |
| **D-8** | [LOW] | No resource limits on any service. |

### Verified healthy

- **Env-variable audit is otherwise clean.** Every variable the *application*
  genuinely needs is documented, with prose explaining it.
- **Caddy forwarding headers: PASS** — see §2.
- **Script PASS/FAIL summary: PASS** — see §4.
- **Secrets hygiene:** only `.env.example` and `.env.pilot.example` are tracked;
  `deploy.sh` refuses to run without a valid auth mode (`:72-81`).
- **Port binding is secure-by-default:** `WEB_HOST_BIND` and `MCP_HOST_BIND`
  default to `127.0.0.1` (`docker-compose.yml:156,212`), and
  `verify-lockdown.sh` §6 actively re-checks with `ss` that nothing landed on a
  public interface — a control written after a real CERT-Bund/BSI finding.

---

## 1. Env-variable audit

### D-1 — [MEDIUM, downgraded from HIGH] `.env.example` promises controls that do not exist

> **CORRECTION (2026-08-02, during remediation).** I filed this as HIGH and
> framed the whole block as misleading. On re-reading the file with its
> comments, **most of it is already honest**: the four feature flags are
> annotated `# aspirational — …`, the storage block sits under
> `# --- Object storage (not yet wired — Phase 2 item) ---`, and
> `MCP_TOKEN_SECRET` carried `# not yet required`. I had read the key names
> and not the comment column. **Two** keys were genuinely misleading, which is
> a MEDIUM, not a HIGH.

Nine variables appear in `.env.example` with **zero references** anywhere in
`apps/`, `packages/`, `deploy/`, or `scripts/`. Verified by name, not by the
`process.env.` grep that produced the false positives:

| Variable | Refs in TS | Refs in compose/scripts |
|---|---|---|
| `MAX_KEA_COST_USD_PER_SESSION` | 0 | 0 |
| `MCP_TOKEN_SECRET` | 0 | 0 |
| `SEMANTIC_RETRIEVAL_ENABLED` | 0 | 0 |
| `OUTCOME_FEEDBACK_ENABLED` | 0 | 0 |
| `COMMUNITY_PUBLISHING_ENABLED` | 0 | 0 |
| `LIVESYNC_BRIDGE_ENABLED` | 0 | 0 |
| `COUCHDB_URL`, `COUCHDB_DB_PREFIX` | 0 | 0 |
| `STORAGE_PROVIDER` / `_BUCKET` / `_REGION` / `_ACCESS_KEY` / `_SECRET_KEY` | 0 | 0 |

Seven of the nine are **already labelled** in the file as aspirational or
not-yet-wired — those are fine as-is and need no change. **Two were not**, and
an operator would read them as active controls:

- **`MAX_KEA_COST_USD_PER_SESSION`** sits next to `MAX_ORACLE_COST_USD_PER_DAY`,
  which **is** real and enforced (`cost.ts:141`, `reserveCapSlot`). An operator
  configuring spend limits will reasonably set both and believe KEA extraction is
  capped per session. It is not: nothing reads this, and there is no per-session
  cap anywhere in the KEA path. Combined with Pass 3's **R-1** (no LLM retry
  ceiling, and vendor SDK retries hidden inside), the actual per-session KEA spend
  is unbounded.
- **`MCP_TOKEN_SECRET`** reads as though MCP tokens are HMAC-signed with an
  operator-held secret. They are not — `mcp-server/src/auth.ts:28` stores an
  unsalted SHA-256 of the raw token and looks it up. That design is fine for a
  256-bit random token, but the variable describes a mechanism the system does not
  use. An operator rotating `MCP_TOKEN_SECRET` expecting to invalidate outstanding
  tokens would invalidate nothing while believing otherwise.

The fix is deletion plus one honest line, not implementation:

```diff
--- a/.env.example
+++ b/.env.example
@@
-# Per-session KEA extraction spend ceiling.
-MAX_KEA_COST_USD_PER_SESSION="0.50"
-
-# Signing secret for MCP bearer tokens.
-MCP_TOKEN_SECRET=""
+# NOTE: the Oracle day-cap below is the ONLY LLM spend control that is
+# enforced today (packages/core/src/cost.ts, reserveCapSlot). There is no
+# per-session KEA cap — a `MAX_KEA_COST_USD_PER_SESSION` key used to be
+# listed here and was wired to nothing.
+#
+# MCP bearer tokens are random 256-bit values stored as unsalted SHA-256
+# (apps/mcp-server/src/auth.ts). There is no signing secret to rotate;
+# revoke individual tokens from /settings/tokens instead.
```

Delete the seven dead feature flags outright, or move them under a clearly
labelled `# --- NOT YET IMPLEMENTED ---` heading. A config file is documentation,
and this part of it is currently wrong in the direction that makes an operator
feel safer than they are.

### D-6 — [LOW] Referenced in code, absent from `.env.example`

Eight, after excluding test/benchmark-only names (`BENCHMARK_*`, `SKIP_E2E`,
`SKIP_DB_INIT`, `NODE_ENV`, `NEXT_PUBLIC_APP_VERSION`, `BRAIN_MCP_*`):

| Variable | Where | Note |
|---|---|---|
| `BRAIN_ROBOTS_DISALLOW_ALL` | `app/robots.ts:20` | Controls whether the deployment is indexable. Defaults to disallow-all (`!== "false"`) — secure, but an operator wanting an indexable public Brain cannot discover the knob. **Worth documenting.** |
| `NEXTAUTH_URL` | `signin/page.tsx:237,382` | The Auth.js **v4** name, checked *before* `AUTH_URL`. See below. |
| `GEMINI_API_KEY` | `embedding.ts:39` | Alias fallback after `GOOGLE_GEMINI_API_KEY` (which is documented). |
| `ADMIN_EMAIL` | `admin-credentials.ts:60` | Explicit legacy alias for `ADMIN_EMAILS`. Intentional; undocumented. |
| `RESEND_API` | `email.ts:47` | Alias fallback before `RESEND_API_KEY`. |
| `CROSS_SESSION_KEA_MODEL`, `KEA_REFINE_MODEL`, `CROSS_SESSION_WINDOW` | `kea.ts` | Real tuning knobs for the cross-session pipeline, undocumented. |

**This confirms Pass 1's Finding 4 as fact rather than conjecture.**
`NEXTAUTH_URL` appears nowhere in `.env.example` or `docker-compose.yml` — only
`AUTH_URL` is wired (`docker-compose.yml:85`). And `.env.example:147` states
*"AUTH_URL must match the EXACT origin users hit in the browser"*. So in
production the registration self-fetch at `signin/page.tsx:382` resolves to the
**public HTTPS origin**, meaning the web container calls itself back out through
Caddy for every signup. That requires self-egress and split-horizon DNS, and it
has no `try`/`catch`. Pass 1 proposed the fix; this pass confirms the production
value it resolves to.

---

## 2. Caddy & TLS hardening — **PASS**

### ✅ Forwarding headers are correct, and correct for a subtle reason

Both vhosts set all three (`Caddyfile:53-55`, `:78-80`):

```
header_up X-Real-IP        {remote_host}
header_up X-Forwarded-For  {remote_host}
header_up X-Forwarded-Proto {scheme}
```

Using `header_up X-Forwarded-For {remote_host}` **replaces** the header rather
than appending to it. That is what makes every per-IP limit in the application
sound. The app parses it as:

```ts
// apps/web/app/api/auth/register/route.ts:68-69 (also proxy.ts:53, signin:625)
const xff = hdrs.get("x-forwarded-for");
const ip = xff ? xff.split(",")[0]!.trim() : "local";
```

— it takes the **first** element. Under Caddy's default appending behaviour the
first element would be whatever the *client* sent, so a caller could defeat the
5-registrations/hour, 10-voucher-attempts/hour, and 100-Oracle-calls/day limits by
rotating a header. The overwrite is what prevents that.

**This is load-bearing and undocumented.** Anyone who "fixes" these lines to the
conventional append form, or fronts the stack with a different proxy, silently
turns every rate limit into a no-op. Worth a comment:

```diff
--- a/deploy/Caddyfile
+++ b/deploy/Caddyfile
@@ -51,6 +51,11 @@
 	reverse_proxy web:3000 {
-		# Pass the real client IP to the rate-limit proxy + logger.
+		# Pass the real client IP to the rate-limit proxy + logger.
+		# NOTE: this REPLACES X-Forwarded-For rather than appending. That is
+		# deliberate and load-bearing: the app reads split(",")[0] (see
+		# api/auth/register/route.ts), so with the conventional appending
+		# form the first element would be client-controlled and every
+		# per-IP limit would be bypassable by rotating the header.
 		header_up X-Real-IP {remote_host}
```

The compose defaults reinforce this: `WEB_HOST_BIND` / `MCP_HOST_BIND` default to
`127.0.0.1`, so reaching the app without passing through Caddy takes a deliberate
override, and `verify-lockdown.sh` §6 re-checks it with `ss`.

### ✅ Security headers, ✅ TLS, ✅ streaming timeouts

HSTS (1 year, `includeSubDomains`, preload deliberately withheld with the reason
written down), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, `-Server`. Automatic ACME.
`read_timeout`/`write_timeout` raised to 300 s on the MCP vhost for long-lived
streams (`:82-85`).

**On WebSocket upgrade specifically:** the checklist asks for WS upgrade headers.
None are needed — Caddy's `reverse_proxy` handles `Upgrade`/`Connection`
transparently, and MCP Streamable HTTP does not use WebSockets. It uses POST plus
`text/event-stream` (confirmed by the installer's own smoke test, which sends
`Accept: application/json, text/event-stream`). The relevant control is the
timeout pair, which is present.

### D-4 — [MEDIUM] No rate limit on the MCP vhost

The web vhost rate-limits `/api/*` at 10 events/second/IP (`:29-36`). The MCP
vhost has **no `rate_limit` directive at all**.

This is the edge-layer half of Pass 2's **M-2** (`proxy.ts` matches `/api/:path*`
only, so the MCP server has no application-layer limit either). Neither layer
throttles MCP. That is the amplifier behind Pass 2's **H-1**: unauthenticated
`initialize` spray allocates in-memory sessions with nothing anywhere slowing it
down.

```diff
--- a/deploy/Caddyfile
+++ b/deploy/Caddyfile
@@ -70,6 +70,15 @@
 {$BRAIN_MCP_PUBLIC_HOSTNAME} {
+	# Neither Caddy nor the app throttles MCP today (apps/web/proxy.ts
+	# matches /api/* only), so an unauthenticated `initialize` spray is
+	# limited by nothing. 30/s/IP is far above a real editor's cadence —
+	# a normal session is a handful of calls per minute.
+	rate_limit {
+		zone mcp_per_ip {
+			key {http.request.remote_host}
+			events 30
+			window 1s
+		}
+	}
 	encode gzip zstd
```

Edge limiting is a mitigation, not the fix — Pass 2's H-1 patch is. Both are worth
having.

### D-5 — [LOW, UNVERIFIED] `encode` on an SSE vhost

`encode gzip zstd` is applied to the MCP vhost (`:71`), which serves
`text/event-stream`. Compressing an event stream can introduce buffering that
delays or coalesces events.

⚠️ **I could not verify this.** Modern Caddy is understood to skip compression
for `text/event-stream`, in which case this is a non-issue. I am flagging it
rather than asserting it because the failure mode — a stream that works in
testing and stalls under a particular client — is expensive to diagnose later.

⬜ **Reviewer:** `curl -N` an Oracle stream through the edge profile and confirm
events arrive incrementally. If they arrive batched, exclude SSE:

```
@sse header Accept *text/event-stream*
encode @sse off
```

---

## 3. Trilingual completeness (EN / TH / DE)

> **CORRECTION (2026-08-02, during remediation).** The count below originally
> read "226 EN keys; TH and DE each carry 222 — four missing from both". That
> was **wrong, and undercounted by more than half.** My extraction was flat
> (`grep '^\s+[a-z_0-9]+:'`), which collapses the nesting: keys like `title`
> and `empty_body` exist under *many* sections, so their presence anywhere
> masked their absence under `decisions`. A correct nested diff — and then the
> type lock proposed below, which caught one more the diff still missed —
> gives the real figure. The finding's severity is unchanged (EN fallback means
> no raw keys reach users); the scope was twice what I reported.

**Result: 265 EN keys; TH and DE each carried 255 — ten missing from both.**

Missing from **both** `th` and `de`:

- **The entire `decisions` section — 9 keys.** `title`, `subtitle`, `loading`,
  `empty_title`, `empty_body`, `help_what`, `help_todo_1..3`. Neither locale had
  the section object at all (`grep -n '    decisions: {'` returns exactly one
  hit, in `en`).
- **`oracle.tagline`** — the subtitle under the Oracle heading, one of the most
  visible strings on the surface. This one was missed even by the corrected
  nested diff and surfaced only when `tsc` checked the type lock.

No keys exist in TH or DE that are absent from EN, so there is no stale-key
problem in the other direction.

### ✅ No raw fallback strings

The checklist asks specifically about raw fallback strings leaking to users.
**They do not.** `translate()` falls back to English before giving up:

```ts
// apps/web/lib/brain/i18n.ts:987-988
let o = walk(I18N[lang]);
if (o == null) o = walk(I18N.en);   // ← EN fallback
…
return typeof o === "string" ? o : path;   // raw key only if EN also lacks it
```

A Thai or German user opening the Decisions help popover sees four English
sentences inside an otherwise translated UI. Cosmetic, and confined to one
popover on one surface — **not a release blocker.**

Unauthenticated pages are fine: `/signin` and `/welcome` both mount
`<LocalePicker />` and their copy is fully covered in all three locales.

### D-3 — [MEDIUM] Nothing can catch locale drift

The four gaps are the symptom; this is the cause. The dictionary is declared
`as const` (`i18n.ts:970`) with **no type relating `th` and `de` to `en`**, so a
missing key is invisible to `tsc`, to ESLint, and to CI. `translate()` takes
`path: string`, so a typo at a call site is equally invisible — it silently
returns the path.

Adding four strings fixes today. Adding a type fixes the class:

```diff
--- a/apps/web/lib/brain/i18n.ts
+++ b/apps/web/lib/brain/i18n.ts
@@ -968,6 +968,20 @@
 } as const;
 
+/**
+ * Structural lock: `th` and `de` must carry exactly the keys `en` carries.
+ * Without this the dictionary is just three independent object literals and
+ * a missing key is invisible to tsc — which is how four `decisions.help_*`
+ * keys went missing from both locales. `translate()` falls back to EN so the
+ * user saw English rather than a raw key, which is precisely why nobody
+ * noticed.
+ */
+type Dict = {
+  [Section in keyof typeof I18N.en]: {
+    [Key in keyof (typeof I18N.en)[Section]]: string;
+  };
+};
+const _localeCompleteness: Record<Exclude<Lang, "en">, Dict> = {
+  th: I18N.th,
+  de: I18N.de,
+};
+void _localeCompleteness;
+
 export type Vars = Record<string, string | number>;
```

`pnpm turbo run typecheck` then fails on any future omission. ⬜ Reviewer must run
it — I cannot typecheck in this checkout — and it will fail on the four current
gaps until the strings are added, which is the point.

---

## 4. Script smoke-test — **PASS**

Both scripts run the auth-posture audit at completion, and the exit contract is
unambiguous.

`verify-lockdown.sh` ends with an explicit summary block (`§7. Summary`) printing
a coloured `PASS` or `FAIL` and exiting `0`/`1`. It is mode-aware — a dev-shim
`PASS` is yellow and carries *"Do NOT expose on public internet"*, rather than
being reported identically to a locked credentials deployment.

The two callers treat it differently, correctly:

| Script | Call | On failure |
|---|---|---|
| `deploy.sh:206` | `verify-lockdown.sh \|\| die "Lockdown audit FAILED — deploy refused."` | **fatal** |
| `dev-up.sh:178` | `verify-lockdown.sh \|\| warn "…review before exposing this URL"` | warn |

That asymmetry is right: a dev stack is intentionally not locked, so a hard
failure there would train operators to ignore the check.

`deploy.sh` additionally runs `scripts/smoke.sh` (`:213`) and dies on failure with
a message that names the rerun command. Both scripts run `prisma migrate deploy`
followed by a `migrate status` **drift check** (Pass 3 §2). **No change
recommended.**

### D-2 — [MEDIUM] The worker has no healthcheck

Coverage across the nine services:

| Service | healthcheck | restart |
|---|---|---|
| `db`, `web`, `mcp-server`, `redis` | ✅ | ✅ |
| **`worker`** | ❌ | ✅ |
| `backup`, `backup-replicate`, `caddy` | ❌ | ✅ |
| `bootstrap` | ❌ | ❌ (correct — one-shot) |

`restart: unless-stopped` only reacts to the process **exiting**. A worker that is
alive but wedged — pg-boss connection dropped, event loop blocked, a handler hung
on an LLM call with no timeout (Pass 3 **R-1**) — keeps running forever and Docker
reports it healthy.

This compounds directly with Pass 3: the worker is already the service where
failures are silent (no dead-letter queue, no failure marker on the session, five
of nine handlers with no error capture). It is also the only long-running service
with no liveness probe. The service that most needs one has none.

The worker has no HTTP surface, so probe the queue instead:

```diff
--- a/deploy/docker-compose.yml
+++ b/deploy/docker-compose.yml
@@  (worker service)
     restart: unless-stopped
+    # `restart` alone only catches a process that EXITS. A worker wedged on a
+    # dropped pg-boss connection or a hung LLM call stays "up" forever. Probe
+    # the thing that actually matters: can this process still reach its queue?
+    healthcheck:
+      test: ["CMD-SHELL", "node -e \"const{Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query('select 1 from '+(process.env.PG_BOSS_SCHEMA||'pgboss')+'.version limit 1')).then(()=>{c.end();process.exit(0)}).catch(()=>process.exit(1))\""]
+      interval: 60s
+      timeout: 10s
+      retries: 3
+      start_period: 30s
```

`backup` / `backup-replicate` lacking probes is acceptable — the
`/api/admin/backup-status` endpoint is the compensating control, and Pass 3 found
it thorough.

### D-8 — [LOW] No resource limits

No service declares `mem_limit`, `cpus`, or a `deploy.resources` block. On a
single-VM deployment one runaway container (the worker holding a large KEA payload,
Postgres under a heavy vector query) can starve the others, including Caddy —
taking TLS termination down with it. Modest `mem_limit` values on `worker` and
`web` would bound the blast radius. Not a blocker at pilot scale.

### D-7 — [LOW] `DEPLOY.md` documents a step the tooling performs

`deploy/DEPLOY.md:25` still lists `CREATE EXTENSION IF NOT EXISTS vector` as
manual step 4. As Pass 3 §2 established, this now happens in three places
automatically. Reword to "verified automatically by `deploy.sh`; listed for
operators provisioning Postgres by hand."

---

# GO / NO-GO — Customer Release

## Verdict: **CONDITIONAL GO** — ship after the five blockers below

Nothing found across four passes is architectural, and nothing is CRITICAL.
Specifically, and these are the questions that decide a release:

- **No cross-tenant data leak.** Both pgvector paths are hard-pinned to
  `"ownerUserId" = $2` outside the visibility filter (Pass 2).
- **No authentication bypass.** Every tool call and resource read validates
  against the DB; all 49 non-public API routes are gated; admin routes check role.
- **No secret exposure.** Clean secret sweep, working log redaction, tracked
  example files only.
- **Fresh-database provisioning works.** Migrations are self-sufficient including
  the pgvector extension, with a drift check after (Pass 3).
- **Backups are monitored**, with the silent-failure state explicitly alarmed.

What stands between this and GO is a set of last-mile defects — each small, most
one-file — concentrated where a customer meets the product for the first time and
where the background pipeline fails quietly.

## Release blockers — must land before customer release

| # | Pass | Finding | Effort |
|---|---|---|---|
| 1 | 1 | **Installer's success message points at a 404** (`/skills` is a hash route). The last instruction a new user receives is broken. | 1 char |
| 2 | 2 | **H-1 — pre-auth capability disclosure + unauthenticated session allocation.** Fix the test in the same PR; it currently passes for the wrong reason. | ~30 lines |
| 3 | 3 | **R-2 — no graceful shutdown.** Every deploy kills in-flight jobs and re-spends LLM tokens. | ~25 lines |
| 4 | 3 | **R-1 — LLM seam has no timeout or retry.** A provider 429 loses the session's extraction silently. | ~40 lines |
| 5 | 1 | **Invite link destroyed on clipboard failure** (`settings/org`) — loses a once-shown secret on any non-TLS deployment. | ~15 lines |

All five are independent and land in a day.

## Ship-with, fix-next-sprint

- Pass 2 **H-2** (token project-scope ignored on reads) — a confinement promise
  the read path does not keep. Not a leak; contain by not advertising
  project-scoped tokens as an isolation boundary until it lands.
- Pass 3 **R-3** (`FAILED_EXTRACTION`) — **carries a Prisma migration**, so per
  the operator rules it needs explicit authorization and its own deploy. Do not
  batch it with the blockers.
- Pass 3 **R-4/R-5** (dead-letter queue, error capture on five handlers) — the
  prerequisite for knowing whether anything above is actually working in prod.
- Pass 4 **D-1** (`.env.example` fiction) — a doc fix, but it currently tells
  operators they have a KEA spend cap they do not have.
- Pass 4 **D-2** (worker healthcheck), **D-4** (MCP edge rate limit).

## Accept for this release

Pass 1 findings 6–12; Pass 2 M-1/M-3/M-4 and L-1/L-2; Pass 3 R-6 through R-11;
Pass 4 D-3 (four English strings in a help popover), D-5, D-6, D-7, D-8.

## Pre-release checklist

**Automated — must be green:**

- [ ] `pnpm turbo run typecheck` — ⬜ *not run in this checkout (Node 18, no
      pnpm); CI is the gate.* Will fail on the D-3 locale type until the four
      strings are added.
- [ ] `pnpm turbo run test`
- [ ] `pnpm turbo run build`
- [ ] `./scripts/verify-lockdown.sh` → `PASS`
- [ ] `./scripts/smoke.sh` post-deploy
- [ ] `gitleaks` scan (local operator rule 3)

**Manual — the things this audit could not execute:**

- [ ] Confirm Pass 2 **H-1** with the `curl initialize` command in that report,
      before and after the patch.
- [ ] Confirm Pass 2 **M-1**: `brain_find_skill({query: "test"})` with no `stage`.
- [ ] Confirm Pass 3 **R-6**: read the installed Anthropic/OpenAI SDK default
      timeout and check it against `expireInSeconds: 600`.
- [ ] Confirm Pass 4 **D-5**: `curl -N` an Oracle stream through the edge profile.
- [ ] Walk the first-run journey on a **non-TLS** origin — that is where the three
      clipboard findings bite, and it is the default `dev-up.sh` posture.
- [ ] `./scripts/dev-up.sh` on a clean host from an empty DB.

---

## Closing note

Four passes over ~9,000 lines produced **zero CRITICAL findings and no
cross-tenant or auth-bypass path** — which for a multi-tenant, self-hostable
platform with an MCP surface is the result that matters. The codebase is
unusually well-commented at exactly the points that matter: several findings here
were confirmed *because* a previous author wrote down why something was done, and
in two cases (Pass 2 H-1, Pass 3 R-1) the comment stating the intended defence is
what made it possible to show the defence was incomplete.

The recurring pattern across all four passes is worth naming, because it is one
pattern and not eleven: **hardening applied in one place and not carried to its
siblings.** The clipboard is hardened in four call sites and not the other three.
The 429 lesson reached `embedding.ts` and not `llm.ts`. Token project-scope is
enforced on every write tool and no read tool. `captureError` wraps four handlers
and not the other five. Rate limiting covers `/api/*` and not `/mcp`.

That is a good problem to have — every instance has a working implementation
sitting next to it to copy. But it suggests the highest-leverage process change is
not another audit: it is asking, whenever a fix lands, *which sibling call sites
just became inconsistent with this one?*
