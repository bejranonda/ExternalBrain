-- Multi-user Credentials — per-user bcrypt password storage.
-- Phase 3b: invite-based sign-up without GitHub OAuth.
--
-- Admin auth remains env-based (ADMIN_USERNAME + ADMIN_PASSWORD_HASH).
-- UserCredential is opt-in: only invitees and users who explicitly set
-- a password get a row here.

CREATE TABLE "UserCredential" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCredential_pkey" PRIMARY KEY ("id")
);

-- One credential per user
CREATE UNIQUE INDEX "UserCredential_userId_key" ON "UserCredential"("userId");

-- Foreign key: cascade-delete credential when user is deleted
ALTER TABLE "UserCredential"
    ADD CONSTRAINT "UserCredential_userId_fkey"
    FOREIGN KEY ("userId")
    REFERENCES "User"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
