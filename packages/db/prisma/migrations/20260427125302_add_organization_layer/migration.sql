-- AlterTable
ALTER TABLE "MCPToken" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "organizationId" TEXT;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "organizationId" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_orgId_userId_key" ON "OrganizationMember"("orgId", "userId");

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MCPToken" ADD CONSTRAINT "MCPToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: each existing User gets a personal Organization (slug derived
-- from the user id since email is mutable), and is the Owner. Existing
-- Projects/Teams owned by that user get the same organizationId. MCPTokens
-- inherit the user's organization too.
INSERT INTO "Organization" (id, slug, name, "createdAt", "updatedAt")
SELECT
  'org_' || u.id,                             -- deterministic id
  'personal-' || lower(substr(u.id, 4, 12)),  -- slug derived from cuid
  COALESCE(u.name, split_part(u.email, '@', 1), 'Personal'),
  u."createdAt",
  u."createdAt"
FROM "User" u
ON CONFLICT (id) DO NOTHING;

INSERT INTO "OrganizationMember" (id, "orgId", "userId", role, "joinedAt")
SELECT
  'om_' || u.id,
  'org_' || u.id,
  u.id,
  'owner',
  u."createdAt"
FROM "User" u
ON CONFLICT ("orgId", "userId") DO NOTHING;

UPDATE "Project" p
SET "organizationId" = 'org_' || p."ownerUserId"
WHERE p."organizationId" IS NULL AND p."ownerUserId" IS NOT NULL;

UPDATE "Team" t
SET "organizationId" = 'org_' || t."ownerId"
WHERE t."organizationId" IS NULL;

UPDATE "MCPToken" m
SET "organizationId" = 'org_' || m."userId"
WHERE m."organizationId" IS NULL;
