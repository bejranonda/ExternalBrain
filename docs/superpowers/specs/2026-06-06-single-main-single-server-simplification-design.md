# Design: collapse to a single-server, single-`main` repo

**Date:** 2026-06-06
**Status:** Approved (pending written-spec review)
**Author:** bwerapol + Claude

## Problem

The repo is built around a dev/prod duality that no longer reflects reality:
there is now **one self-hosted server**, not separate dev (`brain-dev`) and prod
(`brain.*`) hosts. The duality is encoded in two branches (`develop` + `main`),
a `develop → main` promotion workflow, two Compose files, two deploy scripts, a
deployed-e2e workflow targeting the dev host, and a set of guardrails in
`CLAUDE.local.md`. This is maintenance overhead and a source of confusion (e.g.
the `RELEASE_PAT`-based promotion is currently broken).

## Goal

One server, one branch (`main`), one deploy path, lightweight version tags.
Keep the safety properties that matter (PR + green CI before `main`,
secure-by-default deploy, lockdown audit) while deleting the dev/prod scaffolding.

## Non-goals

- **Do not** touch code-level `NODE_ENV` / dev-auth runtime logic. A single
  server still runs in a production runtime mode; `development` vs `production`
  in `env.ts`, `logger.ts`, `auth.ts`, etc. is unrelated to the *server* split.
- No monorepo restructuring — package boundaries (`types → db → core → apps`)
  stay as-is.
- No change to the application feature set.

## Decisions (settled during brainstorming)

1. **Deploy reality:** one self-hosted server (keep the Docker Compose stack).
2. **Branch model:** single `main` + version tags. `feature → PR → main →
   deploy`. Delete `develop`. Drop the `develop → main` promotion.
3. **Compose:** one server-oriented `docker-compose.yml` + an auto-merged
   `docker-compose.override.yml` for local-laptop dev.
4. **Release:** lean — a `scripts/release.sh` that tags `main` and drafts a
   GitHub release. No workflow, no `RELEASE_PAT`.
5. **Deployed-e2e (`e2e-deployed.yml`):** **remove it.** No safe target exists
   (the one server holds real client data); browser e2e against it would risk
   mutating production data. Coverage is preserved by local CI + post-deploy
   `smoke.sh`.

## Design

### A. Branches & CI

- Retarget the open **PR #23** (`feat/show-app-version`) from `develop` → `main`;
  merge once CI is green.
- **Delete `develop`** (remote + local) and prune already-merged branches
  (`chore/sync-3`, `chore/sync-4`, `feat/project-cascade-delete`,
  `fix/dashboard-418-graph-overlap`).
- Keep branch protection on `main` (PR + the two required checks:
  `typecheck · test · build`, `fresh-DB migrate · FTS`). Remove any `develop`
  protection rule.
- `.github/workflows/ci.yml`: trigger on `main` + PRs only (drop `develop`).
- **Delete `.github/workflows/e2e-deployed.yml`** and
  `.github/workflows/release.yml`.

### B. Compose: one base + local override

- Fold `deploy/docker-compose.prod.yml` into `deploy/docker-compose.yml` so the
  **base is the real server stack**: web, mcp-server, worker, db, redis, and the
  Caddy TLS edge. Host ports stay loopback-locked; hostname/`AUTH_URL`/Sentry env
  come from `.env`. The **Caddy** service sits behind a Compose **profile**
  (e.g. `--profile edge`) so it only starts on the server.
- New **`deploy/docker-compose.override.yml`** (Compose auto-merges it on a bare
  `docker compose up`): expose web/mcp ports to the host and enable the dev-auth
  shim, for local-laptop development. Not used on the server.
- `deploy.sh` continues to invoke Compose with explicit `-f
  deploy/docker-compose.yml` (which disables auto-merge of the override), so the
  server never picks up local-dev settings.
- **Delete `deploy/docker-compose.prod.yml`.**

### C. Deploy: one script

- Merge the production-safety steps from `scripts/deploy-prod.sh` (env/auth
  preflight, `verify-lockdown.sh`, post-deploy smoke, dirty-worktree refusal)
  into a single **`scripts/deploy.sh`** that targets the one server with the
  `edge` profile (Caddy). `APP_VERSION` build-arg stamping (added 2026-06-06)
  stays.
- **Delete `scripts/deploy-prod.sh`.** Rename `scripts/smoke-prod.sh` →
  `scripts/smoke.sh` (update references).
- `scripts/reload.sh` stays for fast single-service iteration; strip any
  prod-compose references.

### D. Release: lean tag script

- New **`scripts/release.sh vX.Y.Z`**:
  1. validate `vX.Y.Z` format and that the tag does not already exist;
  2. ensure on `main`, clean worktree, up to date with `origin/main`;
  3. `git tag -a vX.Y.Z -m "Release vX.Y.Z"` and `git push origin vX.Y.Z`;
  4. `gh release create vX.Y.Z --target main --generate-notes` (draft by
     default; `--publish` flag to publish immediately).
- The rail-footer version label keeps working unchanged — it reads
  `git describe --tags` at build time, independent of how the tag was created.

### E. Guardrails & docs

- Rewrite **`CLAUDE.local.md`** for the single-host/single-branch reality:
  - one host (collapse the two-host SSH rule to the single server);
  - one `main` branch; keep "all merges to `main` go through PR + green CI";
  - drop the `develop → main` promotion rule and `develop` push prohibition;
  - keep the secrets / destructive-DB-consent / no-`--no-verify` rules.
- Update tracked docs that reference `develop` / two hosts / `deploy-prod` /
  the promotion workflow: `docs/CONTRIBUTING.md`, `deploy/DEPLOY.md`,
  `deploy/PRODUCTION.md`, `docs/DEPLOY_CHECKLIST.md`, the workflow section of
  `AGENTS.md` (= `CLAUDE.md`/`GEMINI.md` symlinks), `README`, and
  `docs/KNOWN_ISSUES.md` (drop the release-PAT entry if present).

## Migration order (safety)

1. **Branch consolidation (PR A):** retarget + merge PR #23 to `main`; delete
   `develop` and stale branches; flip `ci.yml` to `main`-only.
2. **Infra simplification (PR B):** merge Compose files + add override; merge
   deploy scripts; add `scripts/release.sh`; delete `release.yml`,
   `e2e-deployed.yml`, `docker-compose.prod.yml`, `deploy-prod.sh`.
3. **Docs & guardrails (PR C, or folded into B):** rewrite `CLAUDE.local.md`
   and update the docs listed in §E.

Two-to-three small PRs rather than one large one, so each step is independently
reviewable and revertible.

## Risks & mitigations

- **Server deploy regression** from merging the two Compose/deploy paths →
  mitigate by keeping the prod-safety preflight + `verify-lockdown` + smoke in
  the unified `deploy.sh`, and by testing a dry `docker compose -f
  deploy/docker-compose.yml config` render in CI/locally before cutover.
- **Local dev breakage** from the override → verify `docker compose config`
  (auto-merge) exposes ports and dev-auth as before.
- **Lost release notes** vs the old workflow → `gh release --generate-notes`
  reproduces them locally.

## Success criteria

- `develop` no longer exists; `main` is the only long-lived branch.
- One `deploy.sh` brings up the full server stack (incl. Caddy) and passes
  `verify-lockdown.sh` + smoke.
- A bare `docker compose up` in `deploy/` runs a working local stack.
- `scripts/release.sh vX.Y.Z` tags `main` and drafts a release without a PAT.
- No references to `develop` / `deploy-prod` / the promotion workflow remain in
  tracked docs or CI.
