# CI/CD — for people running their own fork

A plain-English map of how External Brain tests and ships. If you fork the
repo, **everything here works out of the box** — the workflows live in
`.github/workflows/`, the deploy lives in two scripts. There is no hidden
infrastructure.

## The whole picture in one diagram

```text
  you open a PR ──▶  GitHub Actions (CI)         you run a script (CD)
                     ├─ typecheck · test · build   ├─ ./scripts/dev-up.sh   (local, no TLS)
                     │  (incl. fresh-DB migrate)    └─ ./scripts/deploy.sh   (public VM, TLS)
                     ├─ doc refs (no phantom PRs)
                     ├─ dependency audit (critical, prod)
                     ├─ anon onboarding e2e*
                     └─ authed surfaces e2e*
                              │
                     green ──▶ merge to main ──▶ you deploy main
                                                  (a daily prod-drift watchdog
                                                   flags main-ahead-of-prod)
```

`*` only does real work when a PR touches the matching paths (see below).

---

## CI — runs automatically on every PR

Defined in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml),
[`.github/workflows/onboarding-e2e.yml`](../.github/workflows/onboarding-e2e.yml)
and [`.github/workflows/authed-e2e.yml`](../.github/workflows/authed-e2e.yml).
A fork inherits them; they run on **your** GitHub Actions minutes.

| Check | What it proves | Cost |
|---|---|---|
| **typecheck · test · build** | The monorepo type-checks, all unit/integration tests pass (against a real pgvector service), and all six packages build. The migrate step doubles as the **fresh-DB gate**: the service DB starts empty every run, so the full migration history applies front-to-back exactly like a day-zero deploy (then the FTS index DDL) — catches migration-ordering bugs unit tests can't. | ~2–3 min |
| **doc refs (no phantom PRs)** | Runs `scripts/check-doc-refs.sh`: fails if any public doc cites a `PR #NNN` / `(#NNN)` above the repo's current PR ceiling — an unresolvable reference from the pre-open-source history. Allow-lists CSS hex, external `…cli #NNN`, and `docs/internal/**`. Standalone (no pnpm/DB). | ~5 s |
| **dependency audit (critical, prod only)** | Runs `pnpm audit --prod --audit-level critical` against the frozen lockfile. Deliberately narrow so a red run always means *act now*: `--prod` skips devDependencies (the ~70 moderate/high findings here are `@prisma/dev`'s tree, which never reaches the deployed image), and `critical` is the only tier currently clean — `high` exits 1 on pre-existing transitive findings with no fix available. Added after a critical `next-auth`/`@auth/core` CVE sat unnoticed in the deployed auth path because nothing ever ran an audit (`KNOWN_ISSUES §0aj`). Raise the bar to `high` once that tier is genuinely clean. | ~30 s |
| **anon onboarding e2e** | Builds + boots the app and runs the anonymous-surface Playwright specs (`/welcome`, install-snippet URLs, health). **Only does real work when the PR touches an onboarding/unauth surface** (`apps/web/app/{welcome,signin,forgot-password,…}`, `layout.tsx`, the locale/install code); on every other PR it skips to a green no-op in seconds. | ~2–3 min (or seconds when skipped) |
| **authed surfaces e2e** | Boots the app in credentials mode with the seeded fixture (the env-admin maps onto seeded Alex), signs in once, and runs the signed-in suite (dashboard, sessions, skills, nav, plus a 375px
mobile-overflow regression net). Path-gated on `apps/web/**` + `packages/{core,db}/**`. The CI app env raises `RATE_LIMIT_MCP_PER_MINUTE` — the whole suite hits `/api/*` from one IP, and the production default (200/min) trips under the burst. | ~4–5 min (or seconds when skipped) |

The verify + two e2e gates are **required checks** on `main`, so a PR can't
merge until they're green. The no-op behaviour of the e2e gates is what makes
them safe to run on *every* PR. The `doc-refs` guard also runs on every PR (it's
seconds and standalone); add it to your branch-protection required set if you
want phantom references to be merge-blocking as well as visible.

A fourth workflow, [`prod-drift.yml`](../.github/workflows/prod-drift.yml),
runs daily (not per-PR): it compares the deployed `/api/healthz` `version`
against `main`'s `git describe` and keeps exactly one `prod-drift` issue open
while they differ — closing it itself once you redeploy. **Docs-only drift is
exempt** (v1.14.0): when every file between the deployed build and `main`
matches `docs/`, `REBUILD/`, or a root `*.md`, the state counts as in-sync —
GitHub serves those from the repo, so nothing merged is missing from
production, and a watchdog that cries over documentation trains you to
ignore it. Forks without a `BRAIN_DEPLOY_URL` secret skip it green.
>
> ⚠️ **Known misconfiguration (2026-08-14):** on this repo `BRAIN_DEPLOY_URL`
> resolves to the **dev** host, so the watchdog has been reporting dev's
> version under a "production is behind main" title — see
> [`KNOWN_ISSUES §0al`](./KNOWN_ISSUES.md). The stale-deploy gap it exists to
> close is therefore still open. Repoint the secret at the production origin,
> then `workflow_dispatch` once and confirm the reported version matches
> production's `/api/healthz` before trusting it again.

> **Why the e2e gate is path-scoped:** three user-visible bugs once shipped past
> CI because the suite only covered signed-in behaviour. The gate closes that
> gap for the highest-churn public surfaces without slowing down unrelated PRs.

> ⚠️ **The spec lists are hand-maintained, and they have drifted.** Both e2e
> workflows name their Playwright files explicitly. As of 2026-08-05, **20 of
> the 31 specs in `apps/web/e2e/` are referenced by neither workflow** — among
> them `a11y`, `responsive`, `i18n`, `oracle`, `autoskill` and `tokens`. Those
> files exist, run locally, and gate nothing. Before citing a spec as coverage:
>
> ```bash
> grep -rhoE 'e2e/[a-z0-9-]+\.spec\.ts' .github/workflows/*.yml | sort -u
> ls apps/web/e2e/*.spec.ts
> ```
>
> Adding a spec file is not the same as adding a gate — wire it into a workflow
> in the same PR, and check **which** job: `welcome-public-urls.spec.ts` runs in
> the *anon* job, so an authed assertion added there fails with
> `auth_not_configured`. Tracked in [`KNOWN_ISSUES §0r`](./KNOWN_ISSUES.md).
>
> **Corollary for test design:** an invariant you can assert without a browser
> belongs in a plain vitest file under `apps/web/lib/**` (that glob is in
> `apps/web/vitest.config.ts` and needs no DOM or database, so it runs
> unconditionally on every PR). `lib/brain/public-urls.test.ts` is the worked
> example — it guards a bug class that three separate e2e specs had failed to
> catch.

There is **no deploy step in CI** — deploying is a deliberate, human-run action
(below). CI proves the code is sound; you decide when it goes live.

---

## CD — two scripts, pick by audience

Both are idempotent (safe to re-run) and both run an auth-posture audit at the
end. You only ever need one of them.

### Local / dev — `./scripts/dev-up.sh`

```bash
cp .env.example .env        # add one LLM provider key
./scripts/dev-up.sh         # build · migrate · seed demo data · start on localhost
```

No TLS, no Caddy, seeds a demo fixture so the app has something to show. This is
the right choice on your laptop or any throwaway box. App on
`http://localhost:3000`, MCP on `http://localhost:3100/mcp`.

### Public server — `./scripts/deploy.sh`

```bash
cp .env.example .env        # set DATABASE_URL, BRAIN_*_PUBLIC_HOSTNAME, an auth mode, CADDY_EMAIL
./scripts/deploy.sh         # build · migrate · start with Caddy auto-TLS + nightly backups

# Host already terminating TLS (nginx / Traefik / a cloud LB)?
DEPLOY_EDGE=false ./scripts/deploy.sh
```

`DEPLOY_EDGE=false` skips the `edge` profile — no Caddy sidecar, so nothing
competes for `:80`/`:443` — while still doing build, migrations, FTS,
embedding backfill, service start, lockdown audit and smoke. Use it on any
host with its own reverse proxy: with the sidecar running there, `up -d`
fails on the port bind and the script then dies waiting for a certificate
Caddy could never fetch, which is why such hosts previously had to
hand-assemble every migration from raw `docker compose` invocations.

Brings up the full edge profile (Caddy/Let's Encrypt, Redis) — backups come up
with the core stack on every topology, not just this one — enforces
real auth (the dev-auth shim is refused), waits for the first certificate, then
runs `scripts/verify-lockdown.sh` + `scripts/smoke.sh` and **aborts the deploy
if either fails** — so a broken build never goes live. Re-run after a
`git pull` to ship the latest `main`.

> ⚠️ Both scripts use the same Docker Compose project (`deploy`). Don't run
> `dev-up.sh` on a host that's already serving a real `deploy.sh` stack — it
> would rebuild those containers and seed demo data into the live database. One
> host, one purpose.

### Releases — `./scripts/release.sh vX.Y.Z`

Tags `main` and drafts (or `--publish`es) a GitHub release with auto-generated
notes. The rail footer's version label is `git describe --tags` baked at build
time, so the tag shows up in the UI on the next deploy.

---

## Adapting it for your fork

- **Don't want the e2e gate?** Delete `.github/workflows/onboarding-e2e.yml` and
  remove `anon onboarding e2e` from your branch-protection required checks.
- **Different deploy target?** `deploy.sh` is a normal bash script over
  `docker compose -f deploy/docker-compose.yml`; swap the Caddyfile / compose
  file for your platform, or run the compose stack directly:
  ```bash
  docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
  ```
- **Secrets:** CI needs none (it uses a throwaway pgvector service). Deployment
  reads everything from your `.env` — never commit it; only `.env.example` is
  tracked.

See [`QUICKSTART.md`](./QUICKSTART.md) to get running, [`DEPLOY_CHECKLIST.md`](./DEPLOY_CHECKLIST.md)
for the production checklist, and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the
PR flow.
