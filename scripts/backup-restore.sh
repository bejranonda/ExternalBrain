#!/usr/bin/env bash
#
# Restore a Brain Platform Postgres backup produced by the `backup` compose
# service (prodrigestivill/postgres-backup-local).
#
# Usage:
#   ./scripts/backup-restore.sh
#   FORCE=1 ./scripts/backup-restore.sh     # skip the non-empty-DB guard
#
# Requires: docker compose v2, the stack running (at minimum the `db` service).

set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f deploy/docker-compose.yml --profile edge --env-file .env"

log()  { printf '\033[36m[restore]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[restore]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[restore]\033[0m %s\n' "$*" >&2; exit 1; }

# ---- 1. Load env so we can talk to Postgres ----------------------------
[ -f .env ] || die "Missing .env. Run from the repo root or set up .env first."
# shellcheck disable=SC1091
set -a; source .env; set +a

PG_USER="${POSTGRES_USER:-brain}"
PG_DB="${POSTGRES_DB:-brain}"

# ---- 2. Safety rail: refuse to restore into a non-empty DB -------------
if [ "${FORCE:-0}" != "1" ]; then
  ROW_COUNT=$($COMPOSE exec -T db \
    psql -U "$PG_USER" -d "$PG_DB" -tAq \
    -c "SELECT COUNT(*) FROM \"Knowledge\";" 2>/dev/null || echo "error")

  if [ "$ROW_COUNT" = "error" ]; then
    warn "Could not query Knowledge table (DB may be fresh). Proceeding."
  elif [ "$ROW_COUNT" -gt 0 ] 2>/dev/null; then
    die "Knowledge table has ${ROW_COUNT} rows. Set FORCE=1 to overwrite."
  fi
fi

# ---- 3. List available backups -----------------------------------------
log "Scanning /backups inside the backup container..."

# The image stores dumps under /backups/<db>/ named *.sql.gz or *.sql.bz2
BACKUP_LIST=$($COMPOSE exec -T backup \
  sh -c 'find /backups -maxdepth 2 \( -name "*.sql.gz" -o -name "*.sql.bz2" \) | sort' \
  2>/dev/null || true)

if [ -z "$BACKUP_LIST" ]; then
  die "No backup files found in the backup volume. Has the first nightly run completed?"
fi

echo ""
echo "Available backups:"
i=0
declare -a FILES
while IFS= read -r f; do
  i=$((i + 1))
  FILES[$i]="$f"
  printf '  [%d] %s\n' "$i" "$f"
done <<< "$BACKUP_LIST"
echo ""

read -rp "Pick a backup number (1-${i}): " PICK
[[ "$PICK" =~ ^[0-9]+$ ]] || die "Not a number: $PICK"
[ "$PICK" -ge 1 ] && [ "$PICK" -le "$i" ] || die "Out of range."

CHOSEN="${FILES[$PICK]}"

# ---- 4. Determine decompressor -----------------------------------------
case "$CHOSEN" in
  *.sql.gz)  DECOMP="gunzip -c"  ;;
  *.sql.bz2) DECOMP="bunzip2 -c" ;;
  *)         die "Unknown archive format for: $CHOSEN" ;;
esac

# ---- 5. Print commands and confirm -------------------------------------
echo ""
log "Will execute the following inside the compose network:"
echo ""
echo "  docker compose exec backup sh -c '${DECOMP} \"${CHOSEN}\"' \\"
echo "    | docker compose exec -T db psql -U ${PG_USER} -d ${PG_DB}"
echo ""
warn "This will OVERWRITE data in the '${PG_DB}' database."
read -rp "Type 'yes' to proceed: " CONFIRM
[ "$CONFIRM" = "yes" ] || die "Aborted."

# ---- 6. Restore --------------------------------------------------------
log "Restoring ${CHOSEN} into ${PG_DB}..."

$COMPOSE exec -T backup sh -c "${DECOMP} \"${CHOSEN}\"" \
  | $COMPOSE exec -T db psql -U "$PG_USER" -d "$PG_DB"

log "Restore complete. Run /api/readyz to verify DB connectivity."
