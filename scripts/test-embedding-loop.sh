#!/usr/bin/env bash
# Provider-agnostic end-to-end test for the embedding loop.
#
# Prereq: `.env.local` has EMBEDDING_BASE_URL + EMBEDDING_API_KEY (or a
# matching fallback var like GOOGLE_GEMINI_API_KEY) + EMBEDDING_MODEL +
# EMBEDDING_DIMENSIONS set for your chosen provider. Tested with Gemini,
# DashScope Qwen3, and OpenAI — see `deploy/DEPLOY.md` §"Provider ecology
# cheat-sheets" for the three known combinations.
#
# Then:  ./scripts/test-embedding-loop.sh
#
# Runs four checks, each isolating one layer:
#   1. Direct embedding call (isolates the provider — no Oracle, no DB).
#   2. /api/knowledge/retrieve (embed() + pgvector ANN search).
#   3. /api/oracle/stream (full path: embed + the chat provider).
#   4. Backfill any null-embedding rows in the DB.
#
# No secret bytes printed on any output path.

set -u
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f deploy/docker-compose.yml --env-file .env"

echo "── 1. Restart web so the new EMBEDDING_API_KEY lands ──"
$COMPOSE up -d --force-recreate web >/dev/null 2>&1
sleep 2

echo
echo "── 2. Direct embedding round-trip (provider in EMBEDDING_BASE_URL) ──"
# Call the DashScope endpoint from inside the web container (uses the
# exact env the runtime sees). Redact everything except status.
$COMPOSE exec -T web sh -lc '
  key=${EMBEDDING_API_KEY:-$ANTHROPIC_API_KEY}
  code=$(curl -s -o /tmp/resp.json -w "%{http_code}" \
    -X POST "${EMBEDDING_BASE_URL}/embeddings" \
    -H "Authorization: Bearer ${key}" \
    -H "content-type: application/json" \
    -d "{\"model\":\"${EMBEDDING_MODEL}\",\"input\":\"hello\",\"dimensions\":${EMBEDDING_DIMENSIONS}}" )
  dim=$(node -e "try{const d=JSON.parse(require(\"fs\").readFileSync(\"/tmp/resp.json\",\"utf8\"));console.log(d.data&&d.data[0]&&d.data[0].embedding?d.data[0].embedding.length:\"no-vector\")}catch(e){console.log(\"parse-err\")}")
  err=$(node -e "try{const d=JSON.parse(require(\"fs\").readFileSync(\"/tmp/resp.json\",\"utf8\"));console.log(d.error?(d.error.message||JSON.stringify(d.error)):\"\")}catch(e){console.log(\"\")}")
  echo "HTTP ${code}   vector-dim=${dim}   ${err:+err=${err}}"
' 2>&1

echo
echo "── 3. /api/knowledge/retrieve (embed + pgvector search) ──"
curl -s -XPOST http://localhost:3000/api/knowledge/retrieve \
  -H 'content-type: application/json' \
  -d '{"prompt":"React forms","maxItems":3}' | head -c 300
echo

echo
echo "── 4. /api/oracle/stream (embed + chat provider end-to-end) ──"
timeout 45 curl -sN -XPOST http://localhost:3000/api/oracle/stream \
  -H 'content-type: application/json' \
  -d '{"question":"What framework do I use for React forms?","reasoningLevel":"low"}' \
  2>&1 | head -c 600
echo

echo
echo "── 5. Backfill embeddings for the Alex seed (15 rows) ──"
$COMPOSE run --rm bootstrap \
  "pnpm --filter @brain/worker backfill:embeddings" 2>&1 | tail -5
