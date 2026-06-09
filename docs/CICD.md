# CI/CD — for people running their own fork

A plain-English map of how External Brain tests and ships. If you fork the
repo, **everything here works out of the box** — the workflows live in
`.github/workflows/`, the deploy lives in two scripts. There is no hidden
infrastructure.

## The whole picture in one diagram

```text
  you open a PR ──▶  GitHub Actions (CI)         you run a script (CD)
                     ├─ typecheck · test · build   ├─ ./scripts/dev-up.sh   (local, no TLS)
                     ├─ fresh-DB migrate · FTS      └─ ./scripts/deploy.sh   (public VM, TLS)
                     └─ anon onboarding e2e*
                              │
                     green ──▶ merge to main ──▶ you deploy main
```

`*` only runs when a PR touches an onboarding/unauth surface (see below).

---

## CI — runs automatically on every PR

Defined in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) and
[`.github/workflows/onboarding-e2e.yml`](../.github/workflows/onboarding-e2e.yml).
A fork inherits both; they run on **your** GitHub Actions minutes.

| Check | What it proves | Cost |
|---|---|---|
| **typecheck · test · build** | The monorepo type-checks, all unit/integration tests pass (against a real pgvector service), and all six packages build. | ~2–3 min |
| **fresh-DB migrate · FTS** | The full migration history applies cleanly to an **empty** database — the day-zero deploy path — plus the full-text-search index DDL. Catches migration-ordering bugs unit tests can't. | ~1 min |
| **anon onboarding e2e** | Builds + boots the app and runs the anonymous-surface Playwright specs (`/welcome`, install-snippet URLs, health, security). **Only does real work when the PR touches an onboarding/unauth surface** (`apps/web/app/{welcome,signin,forgot-password,…}`, `layout.tsx`, the locale/install code); on every other PR it skips to a green no-op in seconds. | ~2–3 min (or seconds when skipped) |

All three are **required checks** on `main`, so a PR can't merge until they're
green. The no-op behaviour of the e2e gate is what makes it safe to require on
*every* PR.

> **Why the e2e gate is path-scoped:** three user-visible bugs once shipped past
> CI because the suite only covered signed-in behaviour. The gate closes that
> gap for the highest-churn public surfaces without slowing down unrelated PRs.

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
```

Brings up the full edge profile (Caddy/Let's Encrypt, Redis, backups), enforces
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
