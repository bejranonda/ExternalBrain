-- Add token rotation grace-period columns to MCPToken.
-- scheduledRevokeAt: when the old token should auto-revoke (set by the rotate endpoint).
-- rotatedFromId: back-pointer recording which old token this token replaced.
--   Stored as a plain ID column (no FK) to avoid cascade complexities;
--   @unique prevents two tokens both claiming to replace the same source.

ALTER TABLE "MCPToken"
  ADD COLUMN "scheduledRevokeAt" TIMESTAMP(3),
  ADD COLUMN "rotatedFromId"     TEXT;

CREATE UNIQUE INDEX "MCPToken_rotatedFromId_key" ON "MCPToken"("rotatedFromId");
