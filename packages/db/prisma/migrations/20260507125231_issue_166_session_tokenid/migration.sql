-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "tokenId" TEXT;

-- CreateIndex
CREATE INDEX "Session_tokenId_startedAt_idx" ON "Session"("tokenId", "startedAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "MCPToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
