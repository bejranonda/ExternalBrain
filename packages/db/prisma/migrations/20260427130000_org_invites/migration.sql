-- Phase 3a: OrganizationInvite table
-- Allows owners/admins to generate signed invite links for new members.

CREATE TABLE "OrganizationInvite" (
    "id"          TEXT NOT NULL,
    "orgId"       TEXT NOT NULL,
    "email"       TEXT NOT NULL,
    "role"        TEXT NOT NULL DEFAULT 'member',
    "invitedById" TEXT NOT NULL,
    "token"       TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"   TIMESTAMP(3) NOT NULL,
    "acceptedAt"  TIMESTAMP(3),
    "revokedAt"   TIMESTAMP(3),

    CONSTRAINT "OrganizationInvite_pkey" PRIMARY KEY ("id")
);

-- Unique token constraint (for O(1) lookup on accept)
CREATE UNIQUE INDEX "OrganizationInvite_token_key" ON "OrganizationInvite"("token");

-- Indexes for org-scoped and email-scoped queries
CREATE INDEX "OrganizationInvite_orgId_idx"  ON "OrganizationInvite"("orgId");
CREATE INDEX "OrganizationInvite_email_idx"  ON "OrganizationInvite"("email");

-- Foreign key to Organization (cascade delete)
ALTER TABLE "OrganizationInvite"
    ADD CONSTRAINT "OrganizationInvite_orgId_fkey"
    FOREIGN KEY ("orgId")
    REFERENCES "Organization"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
