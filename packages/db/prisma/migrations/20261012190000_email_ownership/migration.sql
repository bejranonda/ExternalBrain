-- Pre-account takeover (KNOWN_ISSUES §0az).
--
-- Every signup path (email+password, voucher claim, agentic onboarding)
-- stores whatever email was typed, unproven. GitHub sign-in then adopted any
-- row with a matching email, so whoever registered an address first owned the
-- account its real owner later signed into. `emailVerifiedAt` records proof of
-- inbox control; `sessionsRevokedAt` lets that proof evict sessions the
-- earlier registrant already holds.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionsRevokedAt" TIMESTAMP(3);

-- A completed password reset already proved the inbox: the link is only ever
-- delivered there. Backfill from the audit trail so those users are not asked
-- to prove it twice (and do not lose their tokens on their next reset).
UPDATE "User" u
SET "emailVerifiedAt" = a.first_reset
FROM (
  SELECT "targetId" AS user_id, MIN("createdAt") AS first_reset
  FROM "AuditLog"
  WHERE action = 'user.password_reset_complete' AND "targetType" = 'user'
  GROUP BY "targetId"
) a
WHERE u.id = a.user_id AND u."emailVerifiedAt" IS NULL;

-- Admins are created by the operator (ADMIN_USERNAME / ADMIN_EMAILS), not by
-- a stranger typing an address.
UPDATE "User" SET "emailVerifiedAt" = "createdAt"
WHERE role = 'admin' AND "emailVerifiedAt" IS NULL;
