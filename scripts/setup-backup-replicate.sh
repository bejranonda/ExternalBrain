#!/usr/bin/env bash
#
# Guided setup for off-host backup replication via rclone.
#
# Asks for the provider (Cloudflare R2 / AWS S3 / Backblaze B2), prompts for
# the relevant credentials, writes a correctly-formatted deploy/rclone.conf,
# and reminds the operator to add BACKUP_REMOTE to their .env.
#
# Usage (from the repo root):
#   bash scripts/setup-backup-replicate.sh
#
# The script does NOT start any containers; it only writes the config file.
# After running it, activate replication by setting COMPOSE_PROFILES to
# include "backup-replicate" and re-deploying:
#
#   COMPOSE_PROFILES=edge,backup-replicate ./scripts/deploy.sh
#
# See docs/RUNBOOK.md §"Off-host backup replication" for full details.

set -euo pipefail

cd "$(dirname "$0")/.."

CONF_PATH="deploy/rclone.conf"

log()  { printf '\033[36m[setup-backup-replicate]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[setup-backup-replicate]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[setup-backup-replicate]\033[0m %s\n' "$*" >&2; exit 1; }

echo ""
echo "============================================================"
echo "  Brain Platform — Off-host backup replication setup"
echo "============================================================"
echo ""
echo "This script writes deploy/rclone.conf with your provider"
echo "credentials. That file is gitignored and must be created on"
echo "every fresh VM deployment."
echo ""

# ---- Backup existing conf if present ----------------------------------------
if [ -f "$CONF_PATH" ]; then
  BAK="${CONF_PATH}.bak.$(date +%Y%m%d-%H%M%S)"
  warn "Existing $CONF_PATH found — backing up to $BAK"
  cp "$CONF_PATH" "$BAK"
fi

# ---- Provider selection ------------------------------------------------------
echo "Supported providers:"
echo "  1) Cloudflare R2"
echo "  2) AWS S3"
echo "  3) Backblaze B2"
echo ""
read -rp "Pick a provider [1-3]: " PROVIDER_CHOICE

case "$PROVIDER_CHOICE" in
  1) PROVIDER="r2" ;;
  2) PROVIDER="s3" ;;
  3) PROVIDER="b2" ;;
  *) die "Unknown choice: $PROVIDER_CHOICE" ;;
esac

# ---- Collect credentials per provider ---------------------------------------
case "$PROVIDER" in

  r2)
    echo ""
    log "Cloudflare R2 setup"
    echo "  You need: Account ID, Access Key ID, Secret Access Key"
    echo "  (R2 → Manage R2 API Tokens → Create API Token with Object Read & Write)"
    echo ""
    read -rp "  R2 Account ID: " R2_ACCOUNT_ID
    read -rp "  R2 Access Key ID: " R2_KEY_ID
    read -rsp "  R2 Secret Access Key (hidden): " R2_SECRET
    echo ""
    read -rp "  Bucket name: " BUCKET_NAME
    read -rp "  Path prefix inside bucket (e.g. brain-prod, or leave blank): " BUCKET_PREFIX
    BUCKET_PREFIX="${BUCKET_PREFIX%/}"   # strip trailing slash

    REMOTE_TYPE="s3"
    REMOTE_PROVIDER="Cloudflare"
    ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    ACCESS_KEY_ID="$R2_KEY_ID"
    SECRET_ACCESS_KEY="$R2_SECRET"
    REGION="auto"

    CONF_BLOCK="[s3-r2]
type = ${REMOTE_TYPE}
provider = ${REMOTE_PROVIDER}
access_key_id = ${ACCESS_KEY_ID}
secret_access_key = ${SECRET_ACCESS_KEY}
endpoint = ${ENDPOINT}
region = ${REGION}
"
    if [ -n "$BUCKET_PREFIX" ]; then
      REMOTE_VALUE="s3-r2:${BUCKET_NAME}/${BUCKET_PREFIX}"
    else
      REMOTE_VALUE="s3-r2:${BUCKET_NAME}"
    fi
    REMOTE_NAME="s3-r2"
    ;;

  s3)
    echo ""
    log "AWS S3 setup"
    echo "  You need: Access Key ID + Secret from an IAM user with:"
    echo "    s3:PutObject, s3:GetObject, s3:ListBucket on the bucket prefix only."
    echo ""
    read -rp "  AWS Access Key ID: " S3_KEY_ID
    read -rsp "  AWS Secret Access Key (hidden): " S3_SECRET
    echo ""
    read -rp "  AWS Region (e.g. us-east-1): " S3_REGION
    read -rp "  Bucket name: " BUCKET_NAME
    read -rp "  Path prefix inside bucket (e.g. brain-prod, or leave blank): " BUCKET_PREFIX
    BUCKET_PREFIX="${BUCKET_PREFIX%/}"

    CONF_BLOCK="[s3-aws]
type = s3
provider = AWS
access_key_id = ${S3_KEY_ID}
secret_access_key = ${S3_SECRET}
region = ${S3_REGION}
"
    if [ -n "$BUCKET_PREFIX" ]; then
      REMOTE_VALUE="s3-aws:${BUCKET_NAME}/${BUCKET_PREFIX}"
    else
      REMOTE_VALUE="s3-aws:${BUCKET_NAME}"
    fi
    REMOTE_NAME="s3-aws"
    ;;

  b2)
    echo ""
    log "Backblaze B2 setup"
    echo "  You need: Application Key ID + Application Key from B2 console"
    echo "    (create a key with Read and Write capabilities on the bucket only)"
    echo ""
    read -rp "  B2 Application Key ID: " B2_KEY_ID
    read -rsp "  B2 Application Key (hidden): " B2_SECRET
    echo ""
    read -rp "  B2 Bucket name: " BUCKET_NAME
    read -rp "  Path prefix inside bucket (e.g. brain-prod, or leave blank): " BUCKET_PREFIX
    BUCKET_PREFIX="${BUCKET_PREFIX%/}"

    CONF_BLOCK="[b2]
type = b2
account = ${B2_KEY_ID}
key = ${B2_SECRET}
"
    if [ -n "$BUCKET_PREFIX" ]; then
      REMOTE_VALUE="b2:${BUCKET_NAME}/${BUCKET_PREFIX}"
    else
      REMOTE_VALUE="b2:${BUCKET_NAME}"
    fi
    REMOTE_NAME="b2"
    ;;

esac

# ---- Write the config file --------------------------------------------------
printf '%s\n' "$CONF_BLOCK" > "$CONF_PATH"
chmod 600 "$CONF_PATH"

log "Wrote $CONF_PATH (mode 600)"

# ---- Remind the operator what to do next ------------------------------------
echo ""
echo "============================================================"
echo "  Next steps"
echo "============================================================"
echo ""
echo "1. Add or update BACKUP_REMOTE in your .env / .env.local:"
echo ""
echo "     BACKUP_REMOTE=\"${REMOTE_VALUE}\""
echo "     BACKUP_INTERVAL=\"3600\"   # seconds between syncs (default)"
echo ""
echo "2. Activate the backup-replicate profile in your next deploy:"
echo ""
echo "     COMPOSE_PROFILES=edge,backup-replicate ./scripts/deploy.sh"
echo ""
echo "3. Verify it's working after the first sync interval:"
echo ""
echo "     docker compose -f deploy/docker-compose.yml --env-file .env \\"
echo "       --profile edge --profile backup-replicate \\"
echo "       logs -f backup-replicate"
echo ""
echo "   You should see lines like:"
echo "     Mon Apr 28 03:05:00 UTC 2026: synced to ${REMOTE_VALUE}"
echo ""
echo "4. For the admin heartbeat endpoint, visit:"
echo "     GET /api/admin/backup-status"
echo "   This returns { ok, lastSyncAge, threshold, warn } once the first"
echo "   sync completes and the container writes the heartbeat file."
echo ""
warn "IMPORTANT: deploy/rclone.conf is gitignored. Back it up securely"
warn "(e.g. 1Password / Bitwarden) — it contains your storage credentials."
echo ""
