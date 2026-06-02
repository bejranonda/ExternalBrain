-- Add the missing FK constraint for AutoskillProposal.sessionId so the
-- model has a Prisma-navigable `session` relation. Required to scope
-- proposal queries by Session.projectId without an extra round-trip.
--
-- Cascade on session delete: if a session is removed, its proposals
-- have no meaningful anchor anymore. Aligns with the existing pattern
-- on User → AutoskillProposal (CASCADE).

-- Defensive cleanup: drop any rows whose sessionId points to a
-- non-existent Session before installing the constraint. Without this,
-- the ALTER fails on dev DBs where prior seeds left orphans.
DELETE FROM "AutoskillProposal"
 WHERE "sessionId" NOT IN (SELECT id FROM "Session");

ALTER TABLE "AutoskillProposal"
  ADD CONSTRAINT "AutoskillProposal_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
