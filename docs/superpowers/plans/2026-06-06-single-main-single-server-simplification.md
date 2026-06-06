# Single-Server, Single-`main` Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the dev/prod + `develop`/`main` duality into one self-hosted server driven from a single `main` branch, with one Compose base + local override, one deploy script, and a lean tag-based release.

**Architecture:** Three sequential PRs — (A) branch consolidation, (B) infra simplification, (C) docs & guardrails. Each is independently revertible. The app code is untouched; this is repo/deploy/CI/docs structure only.

**Tech Stack:** Docker Compose v2, bash deploy scripts, GitHub Actions, `gh` CLI, Caddy (TLS edge), Next.js (web).

**Verification reality:** This environment has no Docker/pnpm, so Compose/deploy correctness is verified by `docker compose -f deploy/docker-compose.yml config` rendering cleanly (run by the operator), CI (`typecheck · test · build`), and the post-deploy `smoke.sh`. Each infra task lists the exact render command as its check.

---

## Spec reference

`docs/superpowers/specs/2026-06-06-single-main-single-server-simplification-design.md`

## File map

- Delete: `deploy/docker-compose.prod.yml`, `scripts/deploy-prod.sh`,
  `.github/workflows/release.yml`, `.github/workflows/e2e-deployed.yml`
- Create: `deploy/docker-compose.override.yml`, `scripts/release.sh`,
  `scripts/smoke.sh` (rename of `smoke-prod.sh`)
- Modify: `deploy/docker-compose.yml` (absorb prod services),
  `scripts/deploy.sh` (absorb prod preflight + edge profile),
  `.github/workflows/ci.yml` (main-only), `CLAUDE.local.md`,
  `docs/CONTRIBUTING.md`, `deploy/DEPLOY.md`, `deploy/PRODUCTION.md`,
  `docs/DEPLOY_CHECKLIST.md`, `AGENTS.md`, `README.md`, `docs/KNOWN_ISSUES.md`

---

## PR A — Branch consolidation

### Task A1: Land the version feature on `main`

**Files:** none (GitHub state)

- [ ] **Step 1:** Retarget PR #23 to `main`.
  Run: `gh pr edit 23 --base main`
- [ ] **Step 2:** Confirm it's still mergeable and CI green.
  Run: `gh pr checks 23 && gh pr view 23 --json mergeable -q .mergeable`
  Expected: required checks `pass`; `MERGEABLE`.
- [ ] **Step 3:** Merge.
  Run: `gh pr merge 23 --merge`
- [ ] **Step 4:** Verify.
  Run: `gh pr view 23 --json state -q .state`  →  `MERGED`

### Task A2: Delete `develop` and stale merged branches

**Files:** none (git state)

- [ ] **Step 1:** Confirm `develop` has no commits ahead of `main`.
  Run: `git fetch origin && git log --oneline origin/main..origin/develop`
  Expected: empty (develop fully contained in main).
- [ ] **Step 2:** Delete remote `develop`.
  Run: `gh api -X DELETE repos/bejranonda/ExternalBrain/git/refs/heads/develop`
- [ ] **Step 3:** Delete merged remote feature branches.
  Run: `for b in feat/project-cascade-delete fix/dashboard-418-graph-overlap feat/show-app-version chore/sync-3 chore/sync-4; do gh api -X DELETE repos/bejranonda/ExternalBrain/git/refs/heads/$b 2>/dev/null || true; done`
- [ ] **Step 4:** Prune locals.
  Run: `git fetch -p && git branch -D develop feat/project-cascade-delete fix/dashboard-418-graph-overlap 2>/dev/null || true`

### Task A3: CI triggers on `main` only

**Files:** Modify `.github/workflows/ci.yml:3-7`

- [ ] **Step 1:** Replace the `on:` block.

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

- [ ] **Step 2:** Commit on a branch off `main`.

```bash
git checkout -b chore/ci-main-only origin/main
git add .github/workflows/ci.yml
git commit -m "ci: trigger on main only (drop develop)"
git push -u origin chore/ci-main-only
gh pr create --base main --title "ci: trigger on main only" --body "Single-branch model — develop is gone." 
```

- [ ] **Step 3:** Merge once green. Run: `gh pr checks <n> --watch && gh pr merge <n> --merge`

### Task A4: Release the version feature

**Files:** none (tag + release)

- [ ] **Step 1:** Tag `main` HEAD as `v1.2.0` (version display is a new feature → minor bump).
  Run: `git fetch origin main && gh api repos/bejranonda/ExternalBrain/git/refs -f ref="refs/tags/v1.2.0" -f sha="$(gh api repos/bejranonda/ExternalBrain/commits/main -q .sha)"`
- [ ] **Step 2:** Draft release.
  Run: `gh release create v1.2.0 --target main --title v1.2.0 --generate-notes --draft`
- [ ] **Step 3:** Verify. Run: `gh release view v1.2.0 --json tagName,isDraft`

---

## PR B — Infra simplification

Branch: `chore/repo-simplification` (already created off `main`; carries the spec commit).

### Task B1: Fold prod services into the base Compose

**Files:** Modify `deploy/docker-compose.yml`; Delete `deploy/docker-compose.prod.yml`

Move these from `docker-compose.prod.yml` into `docker-compose.yml` as the new base:
- `redis`, `backup`, `backup-replicate`, `caddy` services verbatim.
- Fold the prod `web`/`mcp-server`/`worker` env (`NODE_ENV`, `AUTH_URL`,
  `AUTH_TRUST_HOST`, `REDIS_URL`, `SENTRY_*`, `ALLOW_DEV_AUTH_IN_PRODUCTION`),
  healthchecks, `restart: unless-stopped`, and the `web` `brain_backups:ro`
  volume into the base service definitions.
- Add the volumes block: `caddy_data`, `caddy_config`, `caddy_logs`,
  `brain_backups`, `brain_redis` (merge with existing volumes).
- Gate `caddy` (and `backup`/`backup-replicate`) behind profiles so a bare
  local `up` doesn't start the TLS edge:

```yaml
  caddy:
    profiles: ["edge"]
    # …rest unchanged from prod file…
```

- Keep the base host-port bindings **loopback-locked** as they already are
  (`127.0.0.1:3000`, `127.0.0.1:3100`). The override (Task B2) is what exposes
  them for local dev. On the server, Caddy fronts them via the `edge` profile.

- [ ] **Step 1:** Edit `deploy/docker-compose.yml` per the above.
- [ ] **Step 2:** `git rm deploy/docker-compose.prod.yml`
- [ ] **Step 3 (operator check):** `docker compose -f deploy/docker-compose.yml --env-file .env config >/dev/null && echo OK`
  Expected: renders without error; `caddy`/`backup` only present under
  `--profile edge`.
- [ ] **Step 4:** Commit.
  `git add -A && git commit -m "deploy: fold prod compose into the base (caddy/redis/backup behind edge profile)"`

### Task B2: Local-dev override

**Files:** Create `deploy/docker-compose.override.yml`

```yaml
# Local-laptop development overrides. Compose auto-merges this file on a bare
# `docker compose up` from deploy/. The server deploy uses an explicit
# `-f docker-compose.yml` (no override), so these settings never reach prod.
services:
  web:
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      ALLOW_DEV_AUTH: "true"
  mcp-server:
    ports:
      - "3100:3100"
    environment:
      NODE_ENV: development
```

- [ ] **Step 1:** Create the file above.
- [ ] **Step 2 (operator check):** from `deploy/`, `docker compose config | grep -A2 '3000'`
  Expected: web port exposed to host; dev auth on.
- [ ] **Step 3:** Commit.
  `git add deploy/docker-compose.override.yml && git commit -m "deploy: local-dev compose override (exposed ports, dev auth)"`

### Task B3: Single deploy script

**Files:** Modify `scripts/deploy.sh`; Delete `scripts/deploy-prod.sh`

Merge into `scripts/deploy.sh`:
- the prod preflight from `deploy-prod.sh` (env/auth checks: `AUTH_SECRET`,
  Mode A/B auth, `ALLOW_DEV_AUTH` refusal, `ADMIN_EMAILS`, embedding-key warn,
  `BRAIN_PUBLIC_HOSTNAME`/`BRAIN_MCP_PUBLIC_HOSTNAME`/`CADDY_EMAIL`,
  dirty-worktree refusal with `DEPLOY_ALLOW_DIRTY` escape);
- build/migrate with the `edge` profile so Caddy is included:
  change the `$COMPOSE` build/up lines to add `--profile edge`;
- post-build: `verify-lockdown.sh` then `smoke.sh` (renamed in B4).

- [ ] **Step 1:** Edit `scripts/deploy.sh` to add the preflight block + `--profile edge` + lockdown + smoke. Keep the existing `APP_VERSION` stamping.
- [ ] **Step 2:** `git rm scripts/deploy-prod.sh`
- [ ] **Step 3 (check):** `bash -n scripts/deploy.sh && shellcheck scripts/deploy.sh || true`
  Expected: no syntax errors.
- [ ] **Step 4:** Commit. `git add -A && git commit -m "deploy: single deploy.sh for the one server (absorbs prod preflight + edge profile)"`

### Task B4: Rename smoke script

**Files:** `git mv scripts/smoke-prod.sh scripts/smoke.sh`; update references

- [ ] **Step 1:** `git mv scripts/smoke-prod.sh scripts/smoke.sh`
- [ ] **Step 2:** `grep -rl smoke-prod.sh . --include=*.sh --include=*.md | xargs sed -i 's/smoke-prod.sh/smoke.sh/g'` (review each hit).
- [ ] **Step 3:** Commit. `git add -A && git commit -m "deploy: rename smoke-prod.sh → smoke.sh"`

### Task B5: Lean release script; delete workflows

**Files:** Create `scripts/release.sh`; Delete `.github/workflows/release.yml`, `.github/workflows/e2e-deployed.yml`

```bash
#!/usr/bin/env bash
# release.sh — tag main and draft a GitHub release. Single-branch model:
# no develop→main promotion, no RELEASE_PAT. Run from a clean main.
#
#   ./scripts/release.sh v1.3.0            # draft release
#   ./scripts/release.sh v1.3.0 --publish  # publish immediately
set -euo pipefail

VERSION="${1:?Usage: $0 <vX.Y.Z> [--publish]}"
PUBLISH="${2:-}"

[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Version must be vX.Y.Z (got: $VERSION)" >&2; exit 1; }
command -v gh >/dev/null || { echo "gh CLI not found" >&2; exit 1; }

git fetch origin main
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { echo "Not on main." >&2; exit 1; }
git diff --quiet HEAD || { echo "Worktree dirty — commit or stash first." >&2; exit 1; }
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "Local main not in sync with origin/main." >&2; exit 1; }
if git rev-parse "$VERSION" >/dev/null 2>&1; then echo "Tag $VERSION already exists." >&2; exit 1; fi

git tag -a "$VERSION" -m "Release $VERSION"
git push origin "$VERSION"

if [ "$PUBLISH" = "--publish" ]; then
  gh release create "$VERSION" --target main --title "$VERSION" --generate-notes
else
  gh release create "$VERSION" --target main --title "$VERSION" --generate-notes --draft
  echo "→ Draft release created. Review and publish at the URL above."
fi
```

- [ ] **Step 1:** Create `scripts/release.sh`; `chmod +x scripts/release.sh`.
- [ ] **Step 2:** `git rm .github/workflows/release.yml .github/workflows/e2e-deployed.yml`
- [ ] **Step 3 (check):** `bash -n scripts/release.sh`
- [ ] **Step 4:** Commit. `git add -A && git commit -m "release: lean tag-based scripts/release.sh; remove promotion + deployed-e2e workflows"`

### Task B6: Open PR B

- [ ] **Step 1:** `git push -u origin chore/repo-simplification`
- [ ] **Step 2:** `gh pr create --base main --title "infra: collapse to single-server compose + deploy + lean release" --body "<summary + the operator docker compose config check as the test plan>"`
- [ ] **Step 3:** Merge once CI green AND operator confirms `docker compose -f deploy/docker-compose.yml config` renders. **Do not auto-merge before the config render is confirmed** — CI does not exercise Compose.

---

## PR C — Docs & guardrails

**Files:** `CLAUDE.local.md`, `docs/CONTRIBUTING.md`, `deploy/DEPLOY.md`, `deploy/PRODUCTION.md`, `docs/DEPLOY_CHECKLIST.md`, `AGENTS.md`, `README.md`, `docs/KNOWN_ISSUES.md`

### Task C1: Rewrite `CLAUDE.local.md`

Replace the two-host / two-branch content with:
- one host (single self-hosted server);
- one `main` branch; "all merges to `main` go through PR + green CI" (kept);
- remove the `develop → main` promotion rule and `develop` push prohibition;
- keep: never commit real secrets; destructive-DB needs consent; never
  `--no-verify`.

- [ ] **Step 1:** Rewrite `CLAUDE.local.md` per above.
- [ ] **Step 2:** Commit. `git add CLAUDE.local.md && git commit -m "docs(local): single-host/single-main guardrails"`
  (Note: `CLAUDE.local.md` is gitignored — this commit is a no-op in git;
  edit it in place on the working host. Confirm with `git check-ignore CLAUDE.local.md`.)

### Task C2: Update tracked docs

For each of `docs/CONTRIBUTING.md`, `deploy/DEPLOY.md`, `deploy/PRODUCTION.md`, `docs/DEPLOY_CHECKLIST.md`, `AGENTS.md`, `README.md`:
- replace `develop`-branch flow with `feature → PR → main`;
- replace `deploy-prod.sh` / `docker-compose.prod.yml` references with the
  single `deploy.sh` / `docker-compose.yml` + `--profile edge`;
- replace the `release.yml`/promotion description with `scripts/release.sh`.
- In `docs/KNOWN_ISSUES.md`, drop any `RELEASE_PAT`/promotion entry.

- [ ] **Step 1:** `grep -rn "develop\|deploy-prod\|docker-compose.prod\|release.yml\|RELEASE_PAT" docs/ deploy/ AGENTS.md README.md` and fix each hit (skip code-level `development`/`NODE_ENV`).
- [ ] **Step 2:** Commit. `git add -A && git commit -m "docs: single-server/single-main workflow"`
- [ ] **Step 3:** Open PR C against `main`; merge once CI green.

---

## Self-review

- **Spec coverage:** §A→PR A + Task A3/B6; §B→B1/B2; §C→B3/B4; §D→B5/A4;
  §E→C1/C2; e2e removal→B5. All covered.
- **Placeholder scan:** new-file content (override yml, release.sh) is complete;
  merges specify exact keys to move. No TBDs.
- **Type/name consistency:** `smoke.sh`, `--profile edge`, `scripts/release.sh`,
  `docker-compose.override.yml` used consistently across tasks.
- **Gap noted:** `CLAUDE.local.md` is gitignored, so C1 is a working-tree edit,
  not a committed change — called out in the task.
