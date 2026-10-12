# Handoff — where things stand

The page to read first when you pick this repo up after someone else — human or
agent. It records **current state and what is waiting on whom**; the reasoning
lives in the documents it links. Update it at the end of a working session
that changes either.

_Last updated: 2026-10-12 · release **v2.23.0** · live on the reference instance._

---

## Current state

| | |
|---|---|
| Released | **v2.23.0** (2026-10-12): knowledge leaves the Brain only when new knowledge replaces it (`§0ba`). **v2.22.0** the same evening: pre-account takeover closed, Node 24 LTS, all high advisories cleared. v2.21.0 / v2.21.1 earlier that day. |
| Runtime | Node 24 (`node:24-bookworm-slim`) in every image and in CI |
| Schema | latest migration `20261012190000_email_ownership` (additive: `User.emailVerifiedAt`, `User.sessionsRevokedAt`) |
| Dependencies | `pnpm audit --prod`: 0 critical, 0 high (21 low/moderate) |
| CI | 8 checks, all required ones green on `main`. CodeRabbit is advisory (`AGENTS.md`). |

What each release fixed, and how it was verified on the live instance:
[`KNOWN_ISSUES.md §0ay`](./KNOWN_ISSUES.md) (v2.21.x, sixteen "switch that did
nothing" defects), [`§0az`](./KNOWN_ISSUES.md) (v2.22.0) and
[`§0ba`](./KNOWN_ISSUES.md) (v2.23.0).

## Waiting on the operator

These cannot be done from the repo:

1. **Set `SENTRY_DSN`.** Error reporting is wired and verified (a DSN makes
   `web.sentry_init {enabled:true}` appear; compose delivers it to all three
   services), but no Sentry project exists yet. Create one, put the DSN in
   `.env`, then `./scripts/reload.sh web mcp-server worker`.
2. **Mark the GitGuardian incident on PR #278 a false positive.** It flagged a
   test-fixture password literal; the replacement PR #279 has no such literal
   in its history, but the dashboard incident stays open until dismissed.

## Open engineering work, in suggested order

| Item | Why | Where tracked |
|---|---|---|
| Confirm-on-signup email | A stranger can still *occupy* an address until its owner proves it via forgot-password (which now evicts them). Closes the last gap of the takeover class | `§0az` |
| Lint in CI + dependabot/renovate | Neither runs today; the advisory backlog grew to 27 high unnoticed | `§0ay` |
| 20 of 31 Playwright specs run in no workflow; worker has no test runner | Coverage that exists but never runs | `§0ay` |
| Per-device sign-out / admin "revoke sessions" | Revocation is per user only | `§0az` |

## Unattended runs

The operator keeps stop rules for overnight work in the local, gitignored
`CLAUDE.local.md` (backup before deploy; roll back on failed health, lockdown,
live sign-in or new errors; additive migrations only; at most one rollback a
night). If a run stopped on one of them, the reason is written at the top of
this page.

## How to ship (the path used for v2.22.0 and v2.23.0)

1. One PR, many commits (`AGENTS.md`). Wait for required checks when the change
   touches auth, tokens, MCP gating, schema, deps, `deploy/`, or is going to
   production.
2. **Anything on the sign-in path:** build the production image and drive a
   browser against it with a scratch database before merging — sign in, reload
   a protected page, sign out, reset (`GUIDELINES §7`, `APPROACH §5ch`). This is
   what caught a total password-login lockout in v2.22.0 that 12 unit tests
   passed.
3. Squash-merge, then `./scripts/release.sh vX.Y.Z --publish` **before**
   building — the version label comes from `git describe`.
4. Before a schema change on a live instance: dump the database and tag the
   running images for rollback (below). Apply the migration on its own first;
   additive migrations keep the old code running.
5. Redeploy one service at a time (`./scripts/reload.sh web`, then
   `mcp-server`, then `worker`) — a parallel build can run an 8 GB host out of
   memory. Then `./scripts/verify-lockdown.sh`.
6. Verify as a visitor and as a signed-in user on the live site. A throwaway
   account is fine; delete its rows afterwards in FK order (project → org
   member → org → tokens → credential → user).

## Rollback

```bash
# Before deploying: keep the running images
for s in web mcp-server worker; do docker tag deploy-$s:latest deploy-$s:rollback-<prev>; done
docker exec deploy-db-1 pg_dump -U brain -d brain -Fc > <backup-dir>/pre-<version>.dump

# To roll back code (an additive migration can stay in place)
for s in web mcp-server worker; do docker tag deploy-$s:rollback-<prev> deploy-$s:latest; done
docker compose -f deploy/docker-compose.yml --env-file .env up -d --no-build --force-recreate web mcp-server worker
```

## Read next

- [`AGENTS.md`](../AGENTS.md) — house rules and the Brain memory loop
- [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md) — every tracked risk, newest first at `§0az`
- [`APPROACH.md`](./APPROACH.md) — why the methods are what they are (`§5cg`, `§5ch` are this week's)
- [`GUIDELINES.md`](./GUIDELINES.md) — the rules those lessons became
