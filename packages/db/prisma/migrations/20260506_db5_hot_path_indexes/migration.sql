-- Audit DB5 (#103): hot-path indexes for the listings + Oracle queries
-- that previously did seq scans on tenant-scoped reads.
--
-- Knowledge index covers: knowledge listings filtered by
-- (ownerUserId, ownerProjectId) with deletedAt: null — the
-- buildKnowledgeWhere/V2 helpers feed these directly into Prisma's
-- where clause.
--
-- Session index covers: oracle.ts:160 retrieval and dashboard.ts queries
-- that filter by (userId, projectId, startedAt) for trend windows.
--
-- These are pure additions; no impact on existing queries beyond
-- planner choice. CONCURRENTLY would prevent table locks on a populated
-- prod DB but isn't supported in a Prisma migration transaction; the
-- table size at v0.11 is small enough that the brief AccessExclusiveLock
-- shouldn't matter. Operators on larger tenants should consider running
-- the index creation manually with CONCURRENTLY before applying this
-- migration.

-- CreateIndex
CREATE INDEX "Knowledge_ownerUserId_ownerProjectId_deletedAt_idx" ON "Knowledge"("ownerUserId", "ownerProjectId", "deletedAt");

-- CreateIndex
CREATE INDEX "Session_userId_projectId_startedAt_idx" ON "Session"("userId", "projectId", "startedAt");
