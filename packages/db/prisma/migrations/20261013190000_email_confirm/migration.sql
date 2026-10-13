-- Signup confirmation (KNOWN_ISSUES §0bb). Additive only: existing accounts
-- keep emailConfirmRequired = false and sign in exactly as before.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailConfirmRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "EmailConfirmToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "EmailConfirmToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailConfirmToken_tokenHash_key" ON "EmailConfirmToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "EmailConfirmToken_userId_idx" ON "EmailConfirmToken"("userId");

DO $$ BEGIN
  ALTER TABLE "EmailConfirmToken" ADD CONSTRAINT "EmailConfirmToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
