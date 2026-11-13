#!/usr/bin/env bash
#
# sunset.sh — close an External Brain instance gracefully (docs/SUNSET.md).
#
# Timeline, driven by SERVICE_SUNSET_* in .env:
#   T-30d  set SERVICE_SUNSET_AT and redeploy: the banner, the MCP notice and
#          the announcement email go out, and registration closes (app side).
#   T-7d   reminder email; T-1d final reminder (worker, SERVICE_SUNSET_EMAILS).
#   T      `sunset.sh close`: final dump, stop the stack, start the closure
#          server on the same loopback ports (410 page + MCP JSON-RPC error).
#          `sunset.sh schedule` installs a one-shot systemd timer for this.
#   T+30d  `sunset.sh purge`: delete every volume and dump. Operator only,
#          interactive — never from an agent or a timer.
#
# Usage:
#   ./scripts/sunset.sh status
#   ./scripts/sunset.sh responses [--emails]
#   ./scripts/sunset.sh render
#   ./scripts/sunset.sh close [--dry-run] [--early]
#   ./scripts/sunset.sh reopen
#   ./scripts/sunset.sh schedule [--print] | unschedule
#   ./scripts/sunset.sh purge --print
#   ./scripts/sunset.sh purge --confirm-delete-all-data [--early]
#
# Overridable for testing against a scratch setup (defaults are production):
#   ENV_FILE  DEPLOY_PROJECT  DEPLOY_COMPOSE_FILE  DB_CONTAINER  SUNSET_PROJECT
#   BACKUP_DIR  SUNSET_LOG
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

ENV_FILE="${ENV_FILE:-.env}"
case "$ENV_FILE" in /*) ;; *) ENV_FILE="$REPO_ROOT/$ENV_FILE" ;; esac
DEPLOY_PROJECT="${DEPLOY_PROJECT:-deploy}"
DEPLOY_COMPOSE_FILE="${DEPLOY_COMPOSE_FILE:-deploy/docker-compose.yml}"
DB_CONTAINER="${DB_CONTAINER:-deploy-db-1}"
SUNSET_PROJECT="${SUNSET_PROJECT:-brain-sunset}"
BACKUP_DIR="${BACKUP_DIR:-/root/brain-backups}"
SUNSET_LOG="${SUNSET_LOG:-/var/log/brain-sunset.log}"
SUNSET_DIR="$REPO_ROOT/deploy/sunset"
RENDER_DIR="$SUNSET_DIR/rendered"
STATE_FILE="$RENDER_DIR/stopped-containers.txt"
PURGED_MARKER="$RENDER_DIR/.purged"
UNIT_DIR=/etc/systemd/system
REPO_URL="https://github.com/bejranonda/ExternalBrain"

SUNSET_COMPOSE=(docker compose -p "$SUNSET_PROJECT" -f "$SUNSET_DIR/docker-compose.sunset.yml" --env-file "$ENV_FILE")
DEPLOY_COMPOSE=(docker compose -p "$DEPLOY_PROJECT" -f "$DEPLOY_COMPOSE_FILE" --env-file "$ENV_FILE")

log() {
  local line
  line="[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
  echo "$line"
  { echo "$line" >>"$SUNSET_LOG"; } 2>/dev/null || true
}
die() { log "ERROR: $*"; exit 1; }

env_get() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | tail -n1 || true)"
  line="${line#*=}"
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  printf '%s' "$line"
}

to_epoch() { date -u -d "$1" +%s 2>/dev/null || die "cannot parse date '$1'"; }

load_env() {
  [[ -f "$ENV_FILE" ]] || die "env file not found: $ENV_FILE"
  SUNSET_AT="$(env_get SERVICE_SUNSET_AT)"
  SUNSET_KIND="$(env_get SERVICE_SUNSET_KIND)"
  SUNSET_KIND="${SUNSET_KIND:-closure}"
  SUNSET_DELETE_AT="$(env_get SERVICE_SUNSET_DELETE_AT)"
  WEB_PORT="$(env_get WEB_HOST_PORT)"; WEB_PORT="${WEB_PORT:-3000}"
  MCP_PORT="$(env_get MCP_HOST_PORT)"; MCP_PORT="${MCP_PORT:-3100}"
  WEB_HOST="$(env_get BRAIN_PUBLIC_HOSTNAME)"
  CONTACT="$(env_get EMAIL_REPLY_TO)"
  [[ -n "$CONTACT" ]] || CONTACT="$(env_get EMAIL_FROM)"
  # EMAIL_FROM may be `Name <addr@host>`; keep the address.
  if [[ "$CONTACT" =~ \<([^>]+)\> ]]; then CONTACT="${BASH_REMATCH[1]}"; fi
  PG_USER="$(env_get POSTGRES_USER)"
  PG_DB="$(env_get POSTGRES_DB)"
  AT_EPOCH=""; DELETE_EPOCH=""
  if [[ -n "$SUNSET_AT" ]]; then
    AT_EPOCH="$(to_epoch "$SUNSET_AT")"
    if [[ -n "$SUNSET_DELETE_AT" ]]; then
      DELETE_EPOCH="$(to_epoch "$SUNSET_DELETE_AT")"
    else
      DELETE_EPOCH=$((AT_EPOCH + 30 * 86400))
      SUNSET_DELETE_AT="$(date -u -d "@$DELETE_EPOCH" '+%Y-%m-%dT%H:%M:%SZ')"
    fi
  fi
}

require_sunset() { [[ -n "$SUNSET_AT" ]] || die "SERVICE_SUNSET_AT is not set in $ENV_FILE"; }

phase() {
  if [[ -z "$SUNSET_AT" ]]; then echo none
  elif [[ -f "$PURGED_MARKER" ]]; then echo purged
  elif [[ -n "$(sunset_running)" ]]; then echo closed
  elif (( $(date -u +%s) < AT_EPOCH )); then echo notice
  else echo closed
  fi
}

deploy_running() { docker ps -q --filter "label=com.docker.compose.project=$DEPLOY_PROJECT"; }
sunset_running() { docker ps -q --filter "label=com.docker.compose.project=$SUNSET_PROJECT"; }

http_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@" || true; }

cmd_status() {
  load_env
  echo "env file        $ENV_FILE"
  echo "sunset at       ${SUNSET_AT:-<unset>}"
  echo "kind            $SUNSET_KIND"
  echo "data deleted at ${SUNSET_DELETE_AT:-<unset>}"
  echo "phase           $(phase)"
  echo "ports           web 127.0.0.1:$WEB_PORT  mcp 127.0.0.1:$MCP_PORT"
  echo
  echo "== $DEPLOY_PROJECT stack (running)"
  docker ps --filter "label=com.docker.compose.project=$DEPLOY_PROJECT" --format '  {{.Names}}\t{{.Status}}' | grep . || echo "  none"
  echo "== $SUNSET_PROJECT closure server (running)"
  docker ps --filter "label=com.docker.compose.project=$SUNSET_PROJECT" --format '  {{.Names}}\t{{.Status}}' | grep . || echo "  none"
  echo "== latest final dump"
  local latest
  latest="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'final-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -n1 | cut -d' ' -f2- || true)"
  if [[ -n "$latest" ]]; then stat -c '  %n (%s bytes, %y)' "$latest"; else echo "  none"; fi
  echo "== close timer"
  systemctl list-timers --all brain-sunset.timer --no-pager 2>/dev/null | sed 's/^/  /' || echo "  not installed"
}

cmd_responses() {
  load_env
  require_sunset
  local show=0 arg
  for arg in "$@"; do
    case "$arg" in
      --emails) show=1 ;;
      *) die "unknown responses option: $arg" ;;
    esac
  done
  docker ps -q --filter "name=^${DB_CONTAINER}$" | grep -q . \
    || die "$DB_CONTAINER is not running; after close the answers are in the final dump"
  # Read-only. One row per account: the notices it was sent for this sunset,
  # then what it did after the first one (downloads are audited by
  # /api/me/export) and when any of its MCP tokens was last used.
  local rows
  rows="$(docker exec -i "$DB_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -v sunset="$SUNSET_AT" -AtqF $'\t' <<'SQL'
with notice as (
  select "targetId" as uid, replace(action, 'service.sunset_notice.', '') as stage,
         coalesce(payload->>'messageId', '') as mid, "createdAt" as at
  from "AuditLog"
  where action like 'service.sunset_notice.%'
    and (payload->>'sunsetAt')::timestamptz = :'sunset'::timestamptz
), first_notice as (select uid, min(at) as at from notice group by uid)
select u.id, u.email, u.role,
  coalesce((select string_agg(n.stage || ':' || n.mid, ',' order by n.at) from notice n where n.uid = u.id), ''),
  coalesce(to_char(f.at, 'YYYY-MM-DD HH24:MI'), ''),
  coalesce((select to_char(min(a."createdAt"), 'YYYY-MM-DD HH24:MI') from "AuditLog" a
            where a.action = 'user.data_export' and a."actorUserId" = u.id and a."createdAt" >= f.at), ''),
  (select count(*) from "AuditLog" a
   where a.action = 'user.data_export' and a."actorUserId" = u.id and a."createdAt" >= f.at),
  coalesce((select to_char(max(t."lastUsedAt"), 'YYYY-MM-DD HH24:MI') from "MCPToken" t
            where t."userId" = u.id), '')
from "User" u left join first_notice f on f.uid = u.id
where u.email not like '%@deleted.local'
order by u."createdAt";
SQL
)" || die "database query failed"
  # The same key order and auto-detect as resolveProvider() in
  # packages/core/src/email.ts: a key with no EMAIL_PROVIDER means Resend.
  local key provider
  key="$(env_get EMAIL_API_KEY)"
  [[ -n "$key" ]] || key="$(env_get RESEND_API)"
  [[ -n "$key" ]] || key="$(env_get RESEND_API_KEY)"
  provider="$(env_get EMAIL_PROVIDER)"
  [[ -n "$provider" || -z "$key" ]] || provider=resend
  SUNSET_AT="$SUNSET_AT" SUNSET_CONTACT="$CONTACT" SUNSET_SHOW_EMAILS="$show" \
    SUNSET_EMAIL_PROVIDER="$provider" SUNSET_EMAIL_API_KEY="$key" \
    python3 -I "$SUNSET_DIR/responses.py" <<<"$rows"
}

cmd_render() {
  load_env
  require_sunset
  [[ -n "$WEB_HOST" ]] || die "BRAIN_PUBLIC_HOSTNAME is not set in $ENV_FILE"
  mkdir -p "$RENDER_DIR"
  SUNSET_HOST="$WEB_HOST" SUNSET_AT="$SUNSET_AT" SUNSET_DELETE_AT="$SUNSET_DELETE_AT" \
  SUNSET_KIND="$SUNSET_KIND" SUNSET_CONTACT="$CONTACT" SUNSET_REPO_URL="$REPO_URL" \
  SUNSET_PURGED="$(if [[ -f "$PURGED_MARKER" ]]; then echo 1; fi)" \
  SUNSET_SRC_DIR="$SUNSET_DIR" SUNSET_OUT_DIR="$RENDER_DIR" \
    python3 -I "$SUNSET_DIR/render.py"
  python3 -c 'import json,sys;json.load(sys.stdin)' <"$RENDER_DIR/mcp-body.json" \
    || die "rendered MCP body is not valid JSON"
}

verify_closed() {
  local web mcp i
  for i in $(seq 1 15); do
    web="$(http_code "http://127.0.0.1:$WEB_PORT/")"
    mcp="$(http_code -X POST -H 'content-type: application/json' --data '{}' "http://127.0.0.1:$MCP_PORT/mcp")"
    if [[ "$web" == 410 && "$mcp" == 410 ]]; then
      log "verified: web 127.0.0.1:$WEB_PORT -> 410, mcp 127.0.0.1:$MCP_PORT/mcp -> 410"
      return 0
    fi
    sleep 2
  done
  log "verification failed after ${i} tries: web=$web mcp=$mcp"
  return 1
}

cmd_close() {
  local dry=0 early=0 arg
  for arg in "$@"; do
    case "$arg" in
      --dry-run) dry=1 ;;
      --early) early=1 ;;
      *) die "close: unknown option $arg" ;;
    esac
  done
  load_env
  require_sunset
  [[ -n "$PG_USER" && -n "$PG_DB" ]] || die "POSTGRES_USER / POSTGRES_DB missing from $ENV_FILE"

  if [[ -n "$(sunset_running)" ]]; then
    log "already closed: $SUNSET_PROJECT is running; nothing to do"
    return 0
  fi
  local now; now="$(date -u +%s)"
  # Two minutes of slack for a timer firing on a slightly fast clock.
  if (( now < AT_EPOCH - 120 )) && (( early == 0 )); then
    die "it is before SERVICE_SUNSET_AT ($SUNSET_AT); users were promised service until then (--early overrides)"
  fi
  [[ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true)" == true ]] \
    || die "$DB_CONTAINER is not running — cannot take the final dump"

  local stamp dump running
  stamp="$(date -u +%Y%m%d%H%M)"
  dump="$BACKUP_DIR/final-$stamp.dump"
  running="$(docker ps --filter "label=com.docker.compose.project=$DEPLOY_PROJECT" --format '{{.Names}}' | sort)"

  if (( dry == 1 )); then
    echo "close --dry-run (nothing will change):"
    echo "  1. pg_dump $PG_DB from $DB_CONTAINER -> $dump (mode 600), verified with pg_restore --list"
    echo "  2. render $RENDER_DIR (kind=$SUNSET_KIND, data deleted $SUNSET_DELETE_AT, contact $CONTACT)"
    echo "  3. stop these $DEPLOY_PROJECT containers (volumes kept), recorded in $STATE_FILE:"
    # shellcheck disable=SC2086
    printf '       %s\n' $running
    echo "  4. start $SUNSET_PROJECT on 127.0.0.1:$WEB_PORT (web) and 127.0.0.1:$MCP_PORT (mcp)"
    echo "  5. verify both answer 410; on failure stop $SUNSET_PROJECT and restart the containers above"
    return 0
  fi

  log "close: starting (sunset at $SUNSET_AT, kind $SUNSET_KIND)"
  mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
  log "1/5 final dump -> $dump"
  if ! (umask 077; docker exec "$DB_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc >"$dump.partial"); then
    rm -f "$dump.partial"
    die "pg_dump failed — nothing was stopped"
  fi
  local entries
  entries="$(docker exec -i "$DB_CONTAINER" pg_restore --list <"$dump.partial" 2>/dev/null | grep -c 'TABLE DATA' || true)"
  if [[ ! -s "$dump.partial" || "${entries:-0}" -eq 0 ]]; then
    die "dump $dump.partial is empty or unreadable (TABLE DATA entries: ${entries:-0}) — nothing was stopped"
  fi
  mv "$dump.partial" "$dump"
  chmod 600 "$dump"
  log "dump ok: $(stat -c %s "$dump") bytes, $entries table-data entries"

  log "2/5 render closure page"
  cmd_render >/dev/null

  log "3/5 stop $DEPLOY_PROJECT: $(echo "$running" | tr '\n' ' ')"
  printf '%s\n' "$running" >"$STATE_FILE"
  # Container names from the label, not `docker compose stop`: compose skips
  # services whose profile is not active, and must never reach another project.
  # shellcheck disable=SC2086
  [[ -z "$running" ]] || docker stop $running >/dev/null

  log "4/5 start $SUNSET_PROJECT"
  if ! "${SUNSET_COMPOSE[@]}" up -d; then
    log "closure server failed to start — rolling back"
    if rollback_close; then die "close aborted; the stack is back up"; fi
    die "close aborted AND the rollback is incomplete — see above"
  fi

  log "5/5 verify"
  if ! verify_closed; then
    if rollback_close; then die "close aborted; the stack is back up"; fi
    die "close aborted AND the rollback is incomplete — see above"
  fi
  log "close: done. Final dump $dump. Data deletion due $SUNSET_DELETE_AT (sunset.sh purge)."
}

# Polls the web and MCP health endpoints for up to $1 seconds.
stack_healthy() {
  local secs="$1" waited=0 web="" mcp=""
  while (( waited < secs )); do
    web="$(http_code "http://127.0.0.1:$WEB_PORT/api/healthz")"
    mcp="$(http_code "http://127.0.0.1:$MCP_PORT/health")"
    [[ "$web" == 200 && "$mcp" == 200 ]] && return 0
    sleep 3; waited=$((waited + 3))
  done
  log "after ${secs}s: web /api/healthz=$web, mcp /health=$mcp"
  return 1
}

# Starts what close stopped, judged by HTTP rather than container state.
# A start that once failed on a port conflict leaves the container "running"
# but detached from every network (seen on Docker 29.4): `docker start` cannot
# repair that, so the fallback recreates those services through compose.
restart_stack() {
  [[ -s "$STATE_FILE" ]] || { log "no $STATE_FILE; nothing recorded to restart"; return 1; }
  # shellcheck disable=SC2046
  docker start $(cat "$STATE_FILE") >/dev/null 2>&1 || true
  stack_healthy 120 && return 0
  local services
  services="$(xargs -r docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' <"$STATE_FILE" 2>/dev/null | grep -v '^$' | sort -u | tr '\n' ' ' || true)"
  [[ -n "$services" ]] || { log "the stopped containers carry no compose service label; cannot recreate them"; return 1; }
  log "a plain start did not bring the site back; recreating: $services"
  # shellcheck disable=SC2086
  "${DEPLOY_COMPOSE[@]}" up -d --no-build --force-recreate $services || true
  stack_healthy 120
}

rollback_close() {
  "${SUNSET_COMPOSE[@]}" down >/dev/null 2>&1 || true
  if restart_stack; then
    log "rollback: the site answers again"
    return 0
  fi
  log "ROLLBACK INCOMPLETE — the site is NOT answering; start the stack by hand: ${DEPLOY_COMPOSE[*]} up -d"
  return 1
}

cmd_reopen() {
  load_env
  [[ ! -f "$PURGED_MARKER" ]] || die "data was purged; there is nothing to reopen"
  log "reopen: stopping $SUNSET_PROJECT"
  "${SUNSET_COMPOSE[@]}" down
  log "reopen: starting $(tr '\n' ' ' <"$STATE_FILE" 2>/dev/null || true)"
  restart_stack || die "reopen: the site is not answering; start it by hand: ${DEPLOY_COMPOSE[*]} up -d"
  log "reopen: web and MCP answer 200"
}

unit_files() {
  local cal
  cal="$(date -u -d "@$AT_EPOCH" '+%Y-%m-%d %H:%M:%S') UTC"
  cat <<EOF
# ---- $UNIT_DIR/brain-sunset.service
[Unit]
Description=External Brain sunset: close the instance (scripts/sunset.sh close)
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
WorkingDirectory=$REPO_ROOT
Environment=ENV_FILE=$ENV_FILE
ExecStart=$REPO_ROOT/scripts/sunset.sh close

# ---- $UNIT_DIR/brain-sunset.timer
[Unit]
Description=External Brain sunset at $cal

[Timer]
OnCalendar=$cal
AccuracySec=1s
# Persistent=false on purpose: if the host is down at that moment, the close
# must not fire on the next boot at a time nobody announced or is watching.
# The operator runs \`scripts/sunset.sh close\` by hand instead.
Persistent=false
Unit=brain-sunset.service

[Install]
WantedBy=timers.target
EOF
}

cmd_schedule() {
  load_env
  require_sunset
  if [[ "${1:-}" == "--print" ]]; then unit_files; return 0; fi
  (( $(date -u +%s) < AT_EPOCH )) || die "SERVICE_SUNSET_AT ($SUNSET_AT) is already past; run close by hand"
  # Render now, so a setting the closure page cannot use fails today, in
  # front of the operator, not unattended at the sunset instant.
  cmd_render >/dev/null || die "render failed; fix the SERVICE_SUNSET_* settings before scheduling"
  local out
  out="$(unit_files)"
  awk '/^# ---- .*brain-sunset.service$/{f=1;next} /^# ---- /{f=0} f' <<<"$out" >"$UNIT_DIR/brain-sunset.service"
  awk '/^# ---- .*brain-sunset.timer$/{f=1;next} /^# ---- /{f=0} f' <<<"$out" >"$UNIT_DIR/brain-sunset.timer"
  systemctl daemon-reload
  systemctl enable --now brain-sunset.timer
  log "schedule: close at $SUNSET_AT"
  systemctl list-timers --all brain-sunset.timer --no-pager
}

cmd_unschedule() {
  systemctl disable --now brain-sunset.timer 2>/dev/null || true
  rm -f "$UNIT_DIR/brain-sunset.timer" "$UNIT_DIR/brain-sunset.service"
  systemctl daemon-reload
  log "unschedule: brain-sunset timer removed"
}

blast_radius() {
  echo "== containers of project '$DEPLOY_PROJECT'"
  docker ps -a --filter "label=com.docker.compose.project=$DEPLOY_PROJECT" --format '  {{.Names}}\t{{.Image}}\t{{.Status}}'
  echo "== volumes of project '$DEPLOY_PROJECT' (all user data lives here)"
  docker volume ls -q --filter "label=com.docker.compose.project=$DEPLOY_PROJECT" | sed 's/^/  /'
  echo "== networks of project '$DEPLOY_PROJECT'"
  docker network ls --filter "label=com.docker.compose.project=$DEPLOY_PROJECT" --format '  {{.Name}}'
  echo "== files in $BACKUP_DIR"
  find "$BACKUP_DIR" -maxdepth 1 -type f -printf '  %p (%s bytes)\n' 2>/dev/null || true
  echo "== images (not deleted; no user data — remove by hand if wanted)"
  docker images --format '  {{.Repository}}:{{.Tag}}' | grep -E "^  $DEPLOY_PROJECT-" || echo "  none"
  echo "Kept: the $SUNSET_PROJECT closure server, .env, and every other compose project."
}

cmd_purge() {
  local confirm=0 early=0 print=0 arg
  for arg in "$@"; do
    case "$arg" in
      --confirm-delete-all-data) confirm=1 ;;
      --early) early=1 ;;
      --print) print=1 ;;
      *) die "purge: unknown option $arg" ;;
    esac
  done
  load_env
  require_sunset
  case "$BACKUP_DIR" in
    /*backup*) ;;
    *) die "BACKUP_DIR=$BACKUP_DIR must be an absolute path containing 'backup'" ;;
  esac
  if (( print == 1 )); then blast_radius; return 0; fi

  # Every guard runs before anything is listed or touched.
  (( confirm == 1 )) || die "purge deletes ALL user data permanently; pass --confirm-delete-all-data (see purge --print)"
  if (( $(date -u +%s) < DELETE_EPOCH )) && (( early == 0 )); then
    die "data is promised until $SUNSET_DELETE_AT; purge refuses before then (--early overrides)"
  fi
  [[ -t 0 ]] || die "purge needs an interactive terminal — it is not for agents or timers"
  [[ -z "$(deploy_running)" ]] || die "the $DEPLOY_PROJECT stack is still running; run close first"
  [[ -n "$WEB_HOST" ]] || die "BRAIN_PUBLIC_HOSTNAME is not set in $ENV_FILE"

  blast_radius
  local answer
  read -r -p "Type ${WEB_HOST} to delete everything listed above: " answer
  [[ "$answer" == "$WEB_HOST" ]] || die "confirmation did not match; nothing was deleted"

  log "purge: removing containers, volumes and networks of $DEPLOY_PROJECT"
  local ids
  ids="$(docker ps -aq --filter "label=com.docker.compose.project=$DEPLOY_PROJECT")"
  # shellcheck disable=SC2086
  [[ -z "$ids" ]] || docker rm -f $ids >/dev/null
  ids="$(docker volume ls -q --filter "label=com.docker.compose.project=$DEPLOY_PROJECT")"
  # shellcheck disable=SC2086
  [[ -z "$ids" ]] || docker volume rm $ids >/dev/null
  ids="$(docker network ls -q --filter "label=com.docker.compose.project=$DEPLOY_PROJECT")"
  # shellcheck disable=SC2086
  [[ -z "$ids" ]] || docker network rm $ids >/dev/null
  log "purge: deleting files in $BACKUP_DIR"
  find "$BACKUP_DIR" -maxdepth 1 -type f -delete

  touch "$PURGED_MARKER"
  cmd_render >/dev/null
  "${SUNSET_COMPOSE[@]}" up -d --force-recreate >/dev/null
  log "purge: done; closure page now says the data was deleted"
}

main() {
  local sub="${1:-}"
  [[ $# -gt 0 ]] && shift
  case "$sub" in
    status) cmd_status ;;
    responses) cmd_responses "$@" ;;
    render) cmd_render ;;
    close) cmd_close "$@" ;;
    reopen) cmd_reopen ;;
    schedule) cmd_schedule "$@" ;;
    unschedule) cmd_unschedule ;;
    purge) cmd_purge "$@" ;;
    *)
      sed -n '2,/^set -euo/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
      exit 2
      ;;
  esac
}

main "$@"
