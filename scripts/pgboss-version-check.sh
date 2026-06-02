#!/usr/bin/env bash
#
# pgboss-version-check.sh — detect-only pre-flight for pg-boss schema migrations.
#
# Why: pg-boss 12 (and likely future majors) only ship auto-migrations from a
# specific lower-bound schema version. A DB last touched by pg-boss 10 sits at
# `pgboss.version = 24`, and v12's `boss.start()` fails fatal with
# `relation "pgboss.job_common" does not exist`, crashlooping the worker.
# This script catches that BEFORE the worker starts, exits non-zero with an
# actionable recovery command. It NEVER drops a schema on its own — the
# operator's hand has to be on the keyboard for that.
#
# Wiring: invoked from scripts/deploy.sh after Postgres is healthy and before
# `prisma migrate deploy` / worker startup.
#
# Flags none. Inputs from env:
#   COMPOSE                   — full `docker compose -f ... --env-file .env`
#   POSTGRES_USER (default brain), POSTGRES_DB (default brain)
#
# Exit codes:
#   0 — schema absent, or schema version is supported. Safe to proceed.
#   1 — schema version is below installed pg-boss's auto-migrate floor.
#       Operator must DROP SCHEMA pgboss CASCADE (loses queued jobs) or
#       install a transient bridge version of pg-boss.
#
# Updating for future pg-boss majors: bump PGBOSS_FLOOR to match the new
# floor stamped in node_modules/.../pg-boss/dist/migrationStore.js.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="${COMPOSE:-docker compose -f $REPO_ROOT/deploy/docker-compose.yml --env-file $REPO_ROOT/.env}"
PG_USER="${POSTGRES_USER:-brain}"
PG_DB="${POSTGRES_DB:-brain}"

# pg-boss 12.18.2's migrationStore.js lowest entry is `version: 26, previous: 25`.
# Anything < 25 has no auto-migrate path. Recheck with `grep "previous: " on
# any pg-boss bump and update this floor.
PGBOSS_FLOOR=25

log()  { printf '\033[36m[pgboss-check]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[pgboss-check]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[pgboss-check]\033[0m %s\n' "$*" >&2; exit 1; }

# Schema absent? pg-boss creates fresh on first boss.start(). Pass.
schema_present=$($COMPOSE exec -T db psql -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'pgboss');" 2>/dev/null \
  | tr -d '[:space:]')

if [ "$schema_present" != "t" ]; then
  log "pgboss schema absent — pg-boss will create it fresh on worker boot. Pass."
  exit 0
fi

# Version table missing on a present schema = corrupted half-init state.
# Treat as a hard fail.
version_table=$($COMPOSE exec -T db psql -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='pgboss' AND table_name='version');" 2>/dev/null \
  | tr -d '[:space:]')

if [ "$version_table" != "t" ]; then
  die "pgboss schema exists but pgboss.version table is missing — schema is in a corrupt half-init state.
Recover with:
  $COMPOSE exec -T db psql -U $PG_USER -d $PG_DB -c 'DROP SCHEMA pgboss CASCADE;'
then re-run scripts/deploy.sh."
fi

current_version=$($COMPOSE exec -T db psql -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT version FROM pgboss.version LIMIT 1;" 2>/dev/null \
  | tr -d '[:space:]')

if [ -z "$current_version" ]; then
  die "Could not read pgboss.version — table exists but query returned empty. Inspect manually."
fi

if [ "$current_version" -ge "$PGBOSS_FLOOR" ] 2>/dev/null; then
  log "pgboss schema at v$current_version (>= v$PGBOSS_FLOOR floor) — pg-boss can auto-migrate. Pass."
  exit 0
fi

# Below floor — pg-boss 12 cannot auto-migrate from here. Refuse to proceed.
cat >&2 <<EOF
[31m✗[0m pgboss schema is at v$current_version, but the installed pg-boss only ships migrations from v$PGBOSS_FLOOR onward.

This is the failure mode tracked in issue #71 (pg-boss 10 → 12 jump). Without
recovery, the worker will crashloop with:

  relation "pgboss.job_common" does not exist

Recovery (loses any queued jobs — token-revoke schedules auto-rebuild from
MCPToken; KEA jobs re-queue from the next session report):

  $COMPOSE exec -T db psql -U $PG_USER -d $PG_DB -c 'DROP SCHEMA pgboss CASCADE;'
  ./scripts/deploy.sh

If queued jobs CANNOT be lost (only matters once you have real users), use the
bridge path: install pg-boss $PGBOSS_FLOOR.x as a one-shot devDep, run
\`boss.start()\` once to migrate v$current_version → v$PGBOSS_FLOOR, then upgrade
back to the current major. See docs/RUNBOOK.md §"Pre-deploy schema-version check".

EOF
exit 1
