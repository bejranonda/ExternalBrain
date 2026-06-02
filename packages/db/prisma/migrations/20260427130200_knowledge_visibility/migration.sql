-- Phase 4: Knowledge visibility + promote/fork chain
-- Adds visibility (listing control) and originProjectId (lineage audit trail).
-- No backfill required — existing rows default to 'project' which preserves
-- current behavior (they are already project-scoped by ownerProjectId).

ALTER TABLE "Knowledge"
  ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'project';

ALTER TABLE "Knowledge"
  ADD COLUMN IF NOT EXISTS "originProjectId" TEXT NULL;
