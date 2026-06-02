-- Session full-text search indexes.
--
-- Applied manually (or wire into a prisma migration) after `prisma migrate dev`
-- creates the base tables. Prisma does not manage expression indexes on JSON
-- paths, so we keep the DDL here and apply via psql:
--
--   psql $DATABASE_URL -f packages/db/sql/session-fts-index.sql
--
-- Used by `apps/mcp-server/src/tools/session-search.ts`.

CREATE INDEX IF NOT EXISTS session_prompt_fts_idx
  ON "Session"
  USING GIN (to_tsvector('english', coalesce(metadata->>'prompt', '')));

CREATE INDEX IF NOT EXISTS session_event_payload_fts_idx
  ON "SessionEvent"
  USING GIN (to_tsvector('english', coalesce(payload::text, '')));
