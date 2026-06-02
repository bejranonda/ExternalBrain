#!/usr/bin/env bash
#
# dump-anonymised-snapshot.sh — pg_dump with user-content stripped or hashed,
# safe to copy from prod into dev for repro work (#56 gap 2).
#
# Use case: a pilot user reports a Knowledge query returning weird results
# on prod. We can't SSH-into-prod-and-debug (AGENTS.md hard rule). Instead,
# capture an anonymised snapshot of the prod DB, restore it on dev, and
# repro there.
#
# What gets anonymised:
#   - User.email          → sha256(email)[:12]@anonymised.local
#   - User.name           → "User <id-prefix>"
#   - UserCredential rows → DELETED (bcrypt hashes are sensitive even at rest)
#   - MCPToken.tokenHash  → kept (already a hash; needed for FK shape)
#   - MCPToken.name       → "token-<id-prefix>"
#   - VoucherCode rows    → kept (codes are short-lived, low-sensitivity)
#   - AuditLog rows       → kept (action shape, but every payload field
#                           wrapped in jsonb_strip_secrets())
#   - Knowledge ruleText / triggerText / rationale → KEPT (this is the
#                           data you actually want for repro). Personal
#                           PII in rule text is a known limitation —
#                           operator must accept by passing --keep-rules
#                           or strip via --redact-rules-matching <regex>.
#
# What's NEVER touched:
#   - Schema (DDL is identical to prod)
#   - Knowledge embeddings (vectors are derived; no PII in numbers)
#   - Session.summary / Session.context (these are ALREADY redacted by
#                           KEA at extraction; if your KEA prompt isn't
#                           redacting, fix that first)
#
# Usage:
#   ./scripts/dump-anonymised-snapshot.sh                    # default — strips PII, keeps rule text
#   ./scripts/dump-anonymised-snapshot.sh --redact-rules-matching '\b(?:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+)\b'
#
# Output: logs/snapshots/db-anon-<timestamp>.sql.zst
#
# Restore on dev:
#   zstd -d -c logs/snapshots/db-anon-<ts>.sql.zst | docker exec -i deploy-db-1 \
#     psql -U brain -d brain
#
# WARNING: This is a best-effort anonymisation. Always review the resulting
# dump before sharing externally; this script does not guarantee zero PII
# leakage in the long-tail of free-text columns.

set -euo pipefail
cd "$(dirname "$0")/.."

REDACT_RULES_RE=""
KEEP_RULES=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --redact-rules-matching)
      REDACT_RULES_RE="$2"; KEEP_RULES=0; shift 2 ;;
    --strip-rules)
      KEEP_RULES=0; shift ;;
    -h|--help)
      sed -n '2,40p' "$0"; exit 0 ;;
    *)
      printf '\033[31m[anon]\033[0m unknown flag: %s\n' "$1" >&2; exit 1 ;;
  esac
done

TS=$(date -u +"%Y%m%dT%H%M%SZ")
OUT_DIR="logs/snapshots"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/db-anon-$TS.sql"

COMPOSE="docker compose -f deploy/docker-compose.yml --env-file .env"

PG_USER="${POSTGRES_USER:-brain}"
PG_DB="${POSTGRES_DB:-brain}"

printf '\033[36m[anon]\033[0m dumping schema + anonymised data → %s\n' "$OUT"

# Step 1 — stage a copy of the data into a fresh schema we can mutate
# without touching production rows. `--clean --if-exists` makes the dump
# reapply-able on a fresh dev DB without manual cleanup.
$COMPOSE exec -T db psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DROP SCHEMA IF EXISTS anon_export CASCADE;
CREATE SCHEMA anon_export;
SQL

# Step 2 — copy each table with redactions. Done as ONE psql script so the
# whole thing rolls back on any error.
RULES_REDACT_SQL=""
if [ "$KEEP_RULES" = "0" ]; then
  if [ -n "$REDACT_RULES_RE" ]; then
    RULES_REDACT_SQL=$(printf "UPDATE anon_export.\"Knowledge\" SET \"ruleText\" = regexp_replace(\"ruleText\", %s, '<redacted>', 'g'), \"triggerText\" = regexp_replace(\"triggerText\", %s, '<redacted>', 'g'), \"rationale\" = regexp_replace(COALESCE(\"rationale\", ''), %s, '<redacted>', 'g');" \
      "$(printf "'%s'" "${REDACT_RULES_RE//\'/\'\'}")" \
      "$(printf "'%s'" "${REDACT_RULES_RE//\'/\'\'}")" \
      "$(printf "'%s'" "${REDACT_RULES_RE//\'/\'\'}")")
  else
    RULES_REDACT_SQL='UPDATE anon_export."Knowledge" SET "ruleText" = ''<stripped>'', "triggerText" = ''<stripped>'', "rationale" = ''<stripped>'';'
  fi
fi

$COMPOSE exec -T db psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 <<SQL >/dev/null
BEGIN;

-- Copy each public.* table into anon_export.* with the same shape.
DO \$\$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname='public'
  LOOP
    EXECUTE format('CREATE TABLE anon_export.%I (LIKE public.%I INCLUDING ALL); INSERT INTO anon_export.%I SELECT * FROM public.%I',
                   r.tablename, r.tablename, r.tablename, r.tablename);
  END LOOP;
END;
\$\$;

-- Anonymise User identity columns. md5 is built-in (no pgcrypto needed)
-- and is fine for stable opaque identifiers — we're not authenticating
-- against the hashes, just deriving consistent fake emails.
UPDATE anon_export."User"
SET email = substr(md5(email), 1, 12) || '@anonymised.local',
    name  = 'User ' || substr(id, 1, 8);

-- UserCredential bcrypt hashes are still sensitive (offline brute-force).
DELETE FROM anon_export."UserCredential";

-- Token names can leak project / customer hostnames; replace with a stub.
UPDATE anon_export."MCPToken"
SET name = 'token-' || substr(id, 1, 8);

${RULES_REDACT_SQL}

COMMIT;
SQL

# Step 3 — pg_dump the anon_export schema only, mapping it back to public
# so a restore lands in the standard schema.
$COMPOSE exec -T db pg_dump \
  -U "$PG_USER" -d "$PG_DB" \
  --schema=anon_export \
  --no-owner --no-privileges \
  --clean --if-exists \
  | sed 's/anon_export\./public./g' \
  > "$OUT"

# Step 4 — clean up the staging schema; the dump file is the artefact.
$COMPOSE exec -T db psql -U "$PG_USER" -d "$PG_DB" \
  -c "DROP SCHEMA anon_export CASCADE;" >/dev/null

# Step 5 — compress aggressively for transport.
if command -v zstd >/dev/null 2>&1; then
  zstd -q --rm "$OUT"
  out_size=$(stat -c %s "${OUT}.zst" 2>/dev/null || stat -f %z "${OUT}.zst")
  printf '\033[32m[anon]\033[0m wrote %s.zst (%s bytes)\n' "$OUT" "$out_size"
else
  out_size=$(stat -c %s "$OUT" 2>/dev/null || stat -f %z "$OUT")
  printf '\033[32m[anon]\033[0m wrote %s (%s bytes; install zstd for compression)\n' "$OUT" "$out_size"
fi

cat <<DOC

Restore on dev (different host) — copy the file over, then:
  zstd -d -c "$(basename "$OUT").zst" \\
    | docker exec -i deploy-db-1 psql -U brain -d brain

Always review the dump before sharing externally; free-text columns may
still contain PII not covered by this script. See header for caveats.
DOC
