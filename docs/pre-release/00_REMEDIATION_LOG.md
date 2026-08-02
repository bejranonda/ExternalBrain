# Pre-Release Remediation Log

**Branch:** `bugfix/pre-release-audit-blockers`
**Baseline:** `202fe7a` (`v2.7.1`) → this change
**Date:** 2026-08-02

Companion to the four audit reports in this directory. Records what was actually
fixed, how each fix was verified, and — explicitly — what was **not** fixed and
why. The audit reports keep their original findings; where remediation proved a
finding wrong, the report carries an in-place `CORRECTION` block rather than a
quiet edit.

---

## Verification available in this checkout

This checkout has Node 18, no pnpm, no `node_modules`, so `pnpm turbo run
typecheck / test / build` cannot run locally. Two things **do** work and were
used as real gates, not as gestures:

| Tool | What it proved |
|---|---|
| `npx vitest@2 run --config <minimal>` | 89/89 tests green across 4 suites, including 25 new ones written for the LLM seam. Works because these suites import only relative paths. |
| `npx -p typescript@5 tsc --noEmit` on single files | No syntax errors in any edited file; the i18n locale lock verified to accept a complete locale and reject an incomplete one. |

Module-resolution errors (`TS2307` on `@brain/*`, `react`, `next`) and
`TS2580` (`process` without `@types/node`) are expected artifacts of
compiling single files outside the workspace and were filtered. The check that
they are artifacts rather than regressions: pre-existing untouched code
(`mcp-server/src/index.ts:225`, `sweeper.unref()`) emits an identical error.

**The authoritative gate is CI.** ⬜ Reviewer: confirm
`pnpm turbo run typecheck && pnpm turbo run test && pnpm turbo run build` is
green before merge.

---

## Blockers — all five closed

### 1. Installer's success message pointed at a 404 — *Pass 1, Finding 1*

`apps/web/lib/brain/installer-templates.ts:286` told every successful first-run
user to visit `${webUrl}/skills`. The app's surfaces are hash routes inside the
SPA shell (`lib/brain/routes.ts`); a single-segment `/skills` path resolves to
`not-found.tsx`. Changed to `/#skills`, which survives the `/` → `/<org>/<project>`
redirect because fragments are client-side.

Swept the same string out of four doc references: `docs/USING_BRAIN.md` (×2),
`docs/tutorials/03-teaching-knowledge.md` (×2),
`docs/tutorials/06-troubleshooting.md`.

**Verified:** `installer-templates-reconcile.test.ts` 10/10 green.

### 2. MCP pre-auth capability disclosure — *Pass 2, H-1*

`apps/mcp-server/src/index.ts` validated only the *presence* of a Bearer before
allocating a session, so any syntactically-valid string reached `initialize` and
got back `serverInfo`, a live session id, and — via `tools/list` /
`resources/list`, neither of which called `authenticate()` — the full tool
catalogue. That defeated the stated goal of the strict-auth override documented
in the same file.

Three changes:
- `authenticate(token)` now runs **before** the transport is allocated, in the
  `if (!session)` branch only. Established sessions are not re-validated —
  they are already pinned to the same token by the existing `timingSafeEqual`
  check — so the per-request cost for real clients is unchanged.
- `ListToolsRequestSchema` and `ListResourcesRequestSchema` call
  `authenticate()` as defence in depth (covers stdio, which has no HTTP gate).
- Replaced the e2e test that passed for the wrong reason.

**On that test:** `security.spec.ts` sent `tools/list` with a bogus Bearer and
asserted `>= 400`. It passed because a session-less `tools/list` is rejected by
the SDK with "Server not initialized" — the bearer was never consulted, and the
assertion would have stayed green with auth removed entirely. It now probes
`initialize`, asserts exactly `401`, and asserts no `Mcp-Session-Id` header and
no `serverInfo` in the body.

⬜ **Reviewer must confirm against a running server** — this path is e2e-only:
```bash
curl -sD- -X POST "$MCP_URL/mcp" -H 'Authorization: Bearer x' \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
# expect 401, no mcp-session-id, no serverInfo
```

### 3. Worker had no graceful shutdown — *Pass 3, R-2*

`apps/worker/src/index.ts` registered no SIGTERM/SIGINT handler, so every
`deploy.sh` killed in-flight jobs without releasing their pg-boss lease. Rows sat
`active` until `expireInSeconds` (10 min for `kea.extract`, 60 for
`kea.cross_extract`) and then re-ran, re-spending the LLM tokens the killed
attempt had already burned. `kea.cross_extract` is `retryLimit: 1`, so a deploy
in its 06:00 window skipped that day's extraction outright.

Added `boss.stop({ wait: true })` behind a 25 s bounded grace window, plus
`stop_grace_period: 30s` on the worker service so Docker's 10 s default
doesn't SIGKILL mid-drain. Also wrapped the floating `initSentry()` promise
(an unhandled rejection there terminates the process on Node 18+, i.e. the
error reporter failing to start stopped the worker starting) and added
`unhandledRejection` / `uncaughtException` handlers.

### 4. LLM seam had no timeout or retry — *Pass 3, R-1 + R-6*

`packages/core/src/llm.ts` — the single seam every KEA, autoskill and
meeting-extract call goes through — had no timeout, no retry and no error
classification, while its sibling `embedding.ts` has had all three since the
first live 429. A provider rate-limit therefore propagated straight out and cost
that session its extraction, silently.

Added `isTransientLLMError` (the same predicate `embedding.ts` uses), a
`timeoutMs` budget defaulting to **120 s**, and one jittered retry on a transient
failure. The default matters beyond ergonomics: the vendor SDKs' documented
default is 10 min, which is **not shorter than** `expireInSeconds: 600` on the
`kea.extract` queue — so a hung call and the job's expiry raced, and pg-boss
could hand the job to a second worker while the first was still spending tokens.

**Verified — this is the one place real TDD was possible.** 25 new tests in
`packages/core/src/__tests__/llm-resilience.test.ts`, all green, covering: the
transient/non-transient classifier (including non-`Error` throwables); retry
once and succeed; **no** retry on a 401; give up after exactly one retry; timeout
fires and names the model; a timeout is itself treated as transient; dispatch
routing unchanged by the wrapper; and a regression guard that the race's loser
timer is cleared rather than left holding the event loop.

### 5. Invite link destroyed on clipboard failure — *Pass 1, Finding 2*

`apps/web/app/settings/org/page.tsx` fired
`void navigator.clipboard.writeText(...)` and cleared the once-shown invite link
on an unconditional 800 ms timer. `navigator.clipboard` is `undefined` on a
non-secure origin — the default `dev-up.sh` posture — so the call threw; on a
secure origin a denied permission rejected a promise `void` discarded. Either
way the only copy of the link vanished and the admin had to revoke and re-issue.

Extracted `copyInviteLink()`, which dismisses **only** after the write resolves
and otherwise keeps the link on screen with a `role="alert"` explaining that the
text is still selectable.

---

## Also fixed (small, high-value, diffs already reviewed in the audit)

| Item | Finding | Change |
|---|---|---|
| Voucher error copy claimed codes are case-sensitive | P1-F3 | They are `.trim().toUpperCase()`d. Copy now points at typos instead of the one thing that cannot be the cause. |
| `/settings` 404 | P1-F5 | Added `app/settings/page.tsx` → redirect to `/settings/tokens`. |
| `/signup` 404 | P1-F5 | Added `app/signup/page.tsx` → redirect to `/signin?mode=register`. |
| 5 of 9 worker handlers had no error capture | P3-R5 | `observed()` wrapper emits the same `op`/`outcome`/`durMs` shape the other four use, and calls `captureError`. |
| Worker had no healthcheck | P4-D2 | Added a pg-boss-schema probe; `restart:` alone only catches a process that *exits*. |
| TH/DE missing 10 keys each | P4-D3 | Added the full `decisions` section + `oracle.tagline` to both, **and** a recursive `DeepStrings` type lock so `tsc` fails on the next omission. |
| `.env.example` cost/secret keys | P4-D1 | `MAX_KEA_COST_USD_PER_SESSION` marked `NOT ENFORCED`; `MCP_TOKEN_SECRET` marked `no reader` with the real revocation path. |

### The i18n lock earned its place immediately

Written to prevent future drift, it found a **current** gap on its first run:
`oracle.tagline` — the subtitle on one of the most-viewed surfaces — missing from
both non-English locales, and missed by both my flat extraction *and* the
corrected nested diff. That is the argument for structural checks over
inventories: the inventory is only as good as the person writing it.

Verified with a self-contained fixture (`tsc --strict`): a complete locale
compiles; one with a single missing key fails with
`Property 'help_what' is missing in type … but required in type 'DeepStrings<…>'`.

---

## Deliberately NOT fixed

| Finding | Severity | Why deferred |
|---|---|---|
| **P2-H2** — token project-scope ignored on all read paths | HIGH | Touches 4 tools + 4 resources and needs matching `cross-user-isolation` tests. Not a data leak (`kra.ts`/`oracle.ts` hard-pin `ownerUserId`), so it is a confinement gap, not an exposure. **Until it lands, do not describe project-scoped tokens as an isolation boundary.** |
| **P3-R3** — `FAILED_EXTRACTION` status | HIGH | **Requires a Prisma migration.** Local operator rules forbid auto-deploying a diff touching `packages/db/prisma/migrations/**`. Needs explicit authorization and its own deploy. |
| **P3-R4** — dead-letter queue + admin tile | MEDIUM | Worth doing with the `/api/admin/queue-health` surface in one PR rather than half now. |
| **P1-F8** — Oracle copy button: no feedback, throws on insecure origin | MEDIUM | Needs a `copied` prop threaded through `TurnView`; larger than the other clipboard fixes. |
| **P1-F4** — registration self-fetch over the public origin | MEDIUM | The right fix is to stop self-fetching entirely, which is a refactor. Pass 4 confirmed the production value it resolves to. |
| **P4-D4/D5** — MCP edge rate limit, SSE `encode` | MEDIUM/LOW | D-4 is mitigation for a hole H-1 now closes properly; D-5 is unverified pending a `curl -N` check. |
| Everything in the audits' "Accept for this release" buckets | LOW | Unchanged. |

---

## Net effect on the GO / NO-GO

All five release blockers are closed. Of the eight HIGH findings across four
passes, **six are fixed**; the two that remain (P2-H2, P3-R3) are documented
above with their containment.

**Recommendation: GO**, conditional on CI being green and on the one manual
check that cannot be automated from this checkout — the `curl` probe of
`initialize` with a junk Bearer against a running MCP server.
