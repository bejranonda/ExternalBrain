# Agentic onboarding — voucher → token in one anonymous POST

**Date:** 2026-08-08
**Status:** approved, implemented in `feature/agentic-onboarding`

## Problem

A pilot user holding a voucher code has to open a browser, register, sign in,
navigate to `/settings/tokens`, mint a token, copy an install command, and
paste it into a terminal. Every step is a place to drop off, and the whole
detour exists only to obtain one bearer string.

Three of the four pieces needed to remove the browser already existed and were
already public:

| Piece | Where |
|---|---|
| Hosted usage skill | `apps/web/app/api/skills/brain/route.ts` |
| One-shot installer | `apps/web/app/api/onboard.sh/route.ts` (+ `.ps1`) |
| Anonymous account creation | `apps/web/app/api/auth/register/route.ts` |
| **Anonymous token mint** | **missing** |

`POST /api/tokens` resolves the caller through `getCurrentUserId()`
(`apps/web/lib/brain/auth.ts:47`), which requires a NextAuth session cookie.
There is no session-less path to a token, so an agent can create the account
and then stalls.

The gap is not a missing feature. It is a **missing credential exchange**:
registration is anonymous because a voucher authenticates the request, while
token minting is session-gated because it assumes a human clicked a button.

## Decisions

### 1. The voucher exchanges directly for a token (one anonymous POST)

Rejected: a device-code pairing flow (agent polls, human approves in a
browser). Stronger posture — a leaked voucher is inert without the approval
click — and it is the right answer if vouchers are ever distributed over a
mailing list. It was rejected because it reintroduces the browser, which is
the entire thing being removed.

Rejected: having the agent drive the existing flow (`/api/auth/register`, then
simulate a NextAuth Credentials sign-in, then `POST /api/tokens`). Zero backend
work, but it requires an LLM-invented password and depends on Auth.js's
internal CSRF/cookie contract.

**Consequence:** the voucher becomes a bearer-equivalent secret. It is pasted
into chat prompts, screenshared, and forwarded. Every mitigation below follows
from that one fact.

### 2. No agent-invented passwords, ever

The exchange creates a `User` with **no `UserCredential`**. The human claims web
access afterwards through the existing `forgot-password` → `reset-password`
flow.

The alternative — the agent invents a password and registers with it — puts a
live credential into the transcript, which is sent to a model provider, written
to `~/.claude/projects/*.jsonl`, and folded into session summaries. Worse for
the product: the user never learns their own password and cannot reach the
dashboard. That failure mode onboards people into a product half they can never
open.

### 3. Email is supplied by the user at runtime, unverified

The agent asks; it does not invent. The address is not verified up front but is
verified **by delivery**: the set-password link only lands if the address is
real and theirs. The failure mode is degraded, not broken — the MCP token works
regardless, only web login is unclaimable until they fix the address.

Rejected: binding each voucher to an email at mint time. Stronger identity
guarantee, but it requires knowing all recipients up front and adds a
`VoucherCode` column. The 60 generic `PILOT-*` codes already in production stay
usable under the chosen design.

### 4. A narrow bootstrap page, separate from the usage SKILL.md

`GET /api/onboard/agent.md` does exactly one thing and does not teach Brain
usage. The existing `/api/skills/brain` remains the usage guide and is installed
as a side effect of the installer.

The subtlety this decision addresses: a skill must be installed before it can
trigger. In a fresh session there is no Brain skill yet, so what actually
happens is that the agent fetches a URL and treats the response as inline
instructions. That is prompt injection by design — whoever controls the response
controls the agent — so the fetched document is kept small, declarative, and
free of anything that reads as open-ended authority.

## Design

### `POST /api/onboard/claim` (anonymous)

```jsonc
// request
{ "voucher": "PILOT-XXXX-XXXX", "email": "sam@example.com", "label": "claude-code / macbook" }

// 201
{ "token": "bp_…", "expiresAt": "…",
  "mcpUrl": "https://mcp.example.com/mcp",
  "webUrl": "https://brain.example.com",
  "installCommand": "curl -fsSL https://brain.example.com/api/onboard.sh | bash -s 'bp_…' --client claude-code",
  "setPasswordUrl": "https://brain.example.com/forgot-password?email=sam%40example.com" }
```

Gate order, mirroring `apps/web/app/api/auth/register/route.ts`:

1. `AGENTIC_ONBOARDING` env, **default `false`**. Per hard rule 2 in
   `AGENTS.md`, a fresh `docker compose up` must not ship a bearer-vending
   machine.
2. Per-IP limit, 5/hour (`onboard-claim` bucket).
3. `checkVoucherRateLimit(ip)` — deliberately **shares** the counter with
   `/signin` so an attacker does not get 10 guesses per surface.
4. `validateVoucher(code)` **before** the email lookup. Same reasoning as
   `register/route.ts:112`: otherwise an anonymous caller enumerates accounts
   via `email_taken` without holding a voucher at all.
5. Email already registered → `409 email_taken`, hard stop. Minting a token for
   an existing user would turn any voucher into account takeover.
6. **One transaction**: lock the voucher `FOR UPDATE` → re-check → create `User`
   (no credential) → `ensurePersonalOrg` → `ensureDefaultProject` → increment
   `usedCount` → `VoucherRedemption` → `MCPToken`.
7. `writeAudit({ action: "onboard.claim" })` — awaited so a restart cannot drop
   it, but wrapped in try/catch and **not** allowed to fail the request. By that
   line the voucher is burned and `rawToken` exists only in the response; a 500
   over a log write would strand the user, which is the exact failure the
   transaction above exists to prevent. (`/api/tokens` lets this throw, and is
   right to — its caller has a session and can just mint again.)

**Why one transaction.** `register/route.ts:187` calls `ensurePersonalOrg`
*outside* its transaction, best-effort, because a user who lands without an org
self-heals on next sign-in. That is fine there and wrong here:
a crash after the voucher burns but before the token is minted strands the user
with a spent code, no token, and no browser session to self-heal from. (The
`MCPToken.organizationId` column is nullable, but a token with no org is
unusable — every scope filter resolves through it.)

Delivering that atomicity required widening `packages/core/src/org.ts`. Its
header documents the rule — *"Every function accepts a `db` client as the first
argument so callers can supply a transaction client"* — but the parameter was
typed `PrismaClient`, which a Prisma `TransactionClient` is not structurally
assignable to (no `$transaction`, `$connect`, `$extends`). The intent was
right; the type never delivered it, and no caller had exercised it. Fixed with
a `DbClient` alias exported from `@brain/core`.

### Token defaults, differing from `/api/tokens`

| | `/api/tokens` | `/api/onboard/claim` | why |
|---|---|---|---|
| `ttlDays` | 90 | **14** | time-boxes a leaked voucher's blast radius |
| `capabilities` | `[]` = unrestricted | **`["knowledge","skills","sessions"]`** | omits `oracle` |
| `projectId` | caller's choice | `null` | unscoped, same as the `/api/tokens` default |

`oracle` is the billed capability ($0.01–$0.10/call, tracked in the admin cost
ledger). A headless mint means a leaked voucher is a direct billing exposure.
Excluding it also gives claiming the web login a payoff: *"add Oracle access at
`/settings/tokens`."*

The counterargument was considered: Oracle is the headline feature, and a user
whose first `brain_ask_oracle` returns 403 may read the product as broken rather
than as scoped. The bootstrap token's response and the `/start` copy both say so
explicitly, which is the cheaper fix.

### `GET /api/onboard/agent.md` (anonymous)

Four imperative steps: ask for an email, POST the claim, run the returned
`installCommand` verbatim, then **stop**.

Step 4 earns its place. `docs/KNOWN_ISSUES.md` §"Re-onboarding mid-session"
records that an agent which rewrote `~/.claude.json` mid-session kept using the
previously-bound connection, sent six knowledge writes to the wrong Brain, and
reported the loop "verified end-to-end" while verifying the wrong host. An agent
that has just wired its own MCP is in exactly that state, and it will be
confident. So the instruction is *stop*, not *restart when convenient*.

**Known and accepted:** `installCommand` contains the raw bearer, so it lands in
the transcript and in `~/.claude/projects/*.jsonl`. This is true of any
token-in-terminal flow, including the existing wizard. It is a second reason for
the 14-day TTL and why the closing message points at `/settings/tokens` for a
long-lived token.

### `/start` — one public front door

Roughly eighteen surfaces already answer *"how do I start with Brain"*: six
in-app, six repo documents, the handout HTML/PDFs, and three machine endpoints.
The problem was never a shortage of explanation — it is that **no single URL
could be printed next to a voucher code**. Adding the agentic flow to the
tutorials would have made surface nineteen.

Three concrete defects motivated `/start`:

1. The best surfaces are behind a login the voucher holder does not have.
   `/settings/tokens` and the onboarding modal require auth. `/welcome` is
   public but opens by asking which AI tool you use — step two of the journey.
2. Every voucher error was a dead end. `signin/page.tsx` carried five error
   strings that all terminate in "ask your admin", with no URL.
3. Tutorial content exists in three unlinked representations (repo markdown ×3
   languages, an HTML handout, PDFs ×3 languages), none generated from the
   others, all containing the install command. This is the defect class
   `KNOWN_ISSUES.md` already names: *"one value rendered by several surfaces,
   fixed in one of them."*

`/start` is public, trilingual, accepts `?voucher=CODE` to prefill, and presents
exactly **one decision** — agent or self — instead of eighteen doors.

```text
voucher card ──► /start ──┬──► "Let my AI do it"   (one copyable line)
                    ▲     └──► "I'll do it myself" (/signup → /welcome)
                    │
  every voucher error ┘
```

Everything else keeps its job and is linked *from* `/start`: `/welcome` stays
the post-signin three-step, `/docs` stays the concept primers,
`docs/tutorials/*` stays the depth.

## Scope split

- **PR 1 — the exchange.** `POST /api/onboard/claim`, `GET
  /api/onboard/agent.md`, the `DbClient` widening, `AGENTIC_ONBOARDING`
  defaulting false, rate limits, audit, tests.
- **PR 2 — the front door.** Public `/start` (EN/TH/DE), voucher errors gain
  links, cross-links from `/welcome` and `/docs`, single-source test for the
  install command.

They fail independently and PR 1 carries the security surface.

## Testing

Source-level, no database required, following the
`apps/web/lib/brain/public-urls.test.ts` precedent (a test named after the bug
class, running unconditionally):

- `onboard-claim-policy.test.ts` — the token policy constants: 14-day TTL,
  `oracle` absent from bootstrap capabilities, gate defaults to off.
- `onboard-agent-md.test.ts` — the bootstrap document contains the stop
  instruction and no `{{…}}` placeholder survives rendering.
- `install-command-single-source.test.ts` — the install command is byte-identical
  across every surface that renders it.
- `start-page-locale.test.ts` — `/start` copy resolves in all three languages.

## Follow-ups, deliberately not in scope

- A cost ceiling per bootstrap token, which would let `oracle` be included.
- Regenerating the handout PDFs from `/start` at release time. Until then they
  can drift, and that is a known limitation rather than a solved problem.
- Device-code pairing, if vouchers are ever distributed to a list rather than
  handed out individually.
