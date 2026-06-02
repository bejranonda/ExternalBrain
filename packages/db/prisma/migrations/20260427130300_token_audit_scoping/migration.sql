-- Phase 3c: token-level project scoping + audit-log org/project columns
--
-- Operator sequence for migrate deploy:
--   1. This migration runs as a single DDL block.
--   2. All new columns are nullable — no backfill required beyond what Postgres
--      provides as NULL for existing rows.
--   3. Existing MCPToken rows remain project-less (projectId = NULL), meaning
--      they continue to grant access to any project the user can reach.
--   4. Existing AuditLog rows remain org/project-less (= NULL), which is correct
--      — those events predated scoping and carry no project context.

-- MCPToken: add nullable projectId + FK
ALTER TABLE "MCPToken" ADD COLUMN "projectId" TEXT;
ALTER TABLE "MCPToken"
  ADD CONSTRAINT "MCPToken_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AuditLog: add nullable organizationId and projectId columns
ALTER TABLE "AuditLog" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "projectId" TEXT;

-- Indexes for the new AuditLog columns
CREATE INDEX "AuditLog_organizationId_idx" ON "AuditLog"("organizationId");
CREATE INDEX "AuditLog_projectId_idx"      ON "AuditLog"("projectId");
CREATE INDEX "AuditLog_organizationId_createdAt_idx"
  ON "AuditLog"("organizationId", "createdAt");
