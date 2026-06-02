-- Audit C10-C12 (issue #109): tighten foreign-key semantics.
--
-- C10 — Project.organizationId is NOT NULL but the FK was SetNull. An
-- Organization delete would trigger SET NULL → NOT NULL fail, silently
-- aborting the entire delete (Restrict-by-accident). Restate as Restrict
-- explicitly so the failure mode is loud and the GDPR/erase code path
-- remains the only sanctioned route to purge projects.
--
-- C11 — SessionKnowledgeApplication.knowledgeId was a bare String with no
-- FK constraint. Orphan rows accumulated after Knowledge.deletedAt or
-- hard-delete, silently skewing the KRA outcome bumper and §10.2
-- effectiveness math. Verified zero orphans on dev DB before applying.
--
-- C12 — MCPToken.{organizationId,projectId} used SetNull, which silently
-- WIDENED token authority on scope deletion (the §12.21 fallback "any
-- project the user has access to" kicks in once the column is NULL).
-- Cascade is correct: the token disappears with its scope, matching the
-- revocation semantic the audit expected.

-- DropForeignKey
ALTER TABLE "MCPToken" DROP CONSTRAINT "MCPToken_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "MCPToken" DROP CONSTRAINT "MCPToken_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_organizationId_fkey";

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionKnowledgeApplication" ADD CONSTRAINT "SessionKnowledgeApplication_knowledgeId_fkey" FOREIGN KEY ("knowledgeId") REFERENCES "Knowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MCPToken" ADD CONSTRAINT "MCPToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MCPToken" ADD CONSTRAINT "MCPToken_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
