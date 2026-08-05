# Contributing — External Brain

Thanks for considering a contribution! External Brain is MIT-licensed — fork
it, run your own instance, and send improvements back.

## Workflow

1. Fork the repo and branch from `main`: `feature/<slug>`, `bugfix/<slug>`, or
   `docs/<slug>`.
2. Make one logical change. Run the gates locally: `pnpm turbo run typecheck test build`.
3. Open a PR. CI re-runs the gates (typecheck · test · build · fresh-DB
   migration) on every PR.

Standard fork → branch → PR. There's **no mandated dev/prod promotion flow** —
how you deploy your own instance is entirely up to you (see "Deploying your own
instance" below).

## Commit & PR conventions

- Conventional Commits: `feat(scope): …`, `fix(scope): …`, `docs: …`, `chore: …`.
- One logical change per PR; split refactors out of feature PRs.
- The PR description should state: what changed and why; how it was tested
  (commands, screenshots, or `curl` output); and any new env var (add it to
  `.env.example` in the same PR).

## Environment discipline

- Real secrets never enter git — only `.env.example` (placeholders) is committed.
- MCP tokens are per-user rows issued via the webapp at `/settings/tokens`;
  there is no shared-secret bearer token in `.env`.
- Any new required env var goes into `.env.example` in the same PR that reads
  it, with a one-line comment describing its purpose.

## Deploying your own instance

External Brain runs as a single Docker Compose stack. See
[QUICKSTART](./QUICKSTART.md) to get running, and
[DEPLOY_CHECKLIST](./DEPLOY_CHECKLIST.md) for a public-VM deploy with TLS.

Day-two operations each have a smaller command:

| Situation | Command | Why |
|---|---|---|
| **Local dev** | `./scripts/dev-up.sh` | Core stack only (db · web · mcp-server · worker) on localhost — builds, migrates, seeds the demo fixture, audits auth. The `edge` services (TLS/Redis) stay off; the nightly `backup` service is not profile-gated and comes up with the core stack. |
| **Server deploy (TLS)** | `./scripts/deploy.sh` | Build + migrate + backfill + up with the `edge` profile (Caddy + ACME cert, Redis); refuses the deploy on a lockdown-audit failure. Idempotent. |
| **Edited TypeScript** | `./scripts/reload.sh web` (or `worker`, `mcp-server`) | Rebuilds + force-recreates only the named service(s). Skips DB wait/migrations. |
| **Edited Prisma schema** | `./scripts/dev-up.sh` (local) / `./scripts/deploy.sh` (server) | Runs `prisma migrate deploy`. Add the migration SQL under `packages/db/prisma/migrations/` first. |
| **Edited `.env` only** | `./scripts/reload.sh web` (+ others as needed) | `--force-recreate` is what picks up new env values. |
| **Audit the auth posture** | `./scripts/verify-lockdown.sh` | Probes root, `/api/knowledge`, MCP with/without bearer; exits non-zero on a leak. |
| **Back up / restore** | `./scripts/backup-restore.sh backup` / `restore <timestamp>` | Writes to / restores from the `brain_backups` Docker volume. |

Rules of thumb: `./scripts/dev-up.sh` is always safe locally (idempotent; handles
schema + backfill); `./scripts/reload.sh <service>` is the fast dev loop. Both
end by running `verify-lockdown.sh`, so an auth misconfiguration surfaces at
every deploy.

## For AI assistants

The orientation brief for AI agents is [`AGENTS.md`](../AGENTS.md) (`CLAUDE.md`
and `GEMINI.md` symlink to it). In short: branch from `main`, open a PR (never
push directly to protected branches), never commit secrets, and update
`.env.example` when you add an env var.
