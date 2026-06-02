#!/usr/bin/env bash
#
# Print the first User row's id from the running stack.
# Useful for one-liners like:
#   BENCHMARK_USER_ID=$(./scripts/dev-user-id.sh) pnpm run benchmark
#
set -euo pipefail

cd "$(dirname "$0")/.."

docker compose -f deploy/docker-compose.yml --env-file .env exec -T db \
  psql -U "${POSTGRES_USER:-brain}" -d "${POSTGRES_DB:-brain}" -tAc \
  'SELECT id FROM "User" ORDER BY "createdAt" ASC LIMIT 1;' \
  | head -n 1 | tr -d '[:space:]'
