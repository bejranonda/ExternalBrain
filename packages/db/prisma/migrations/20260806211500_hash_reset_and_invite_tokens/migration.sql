-- Store password-reset and org-invite tokens hashed, not raw (KNOWN_ISSUES §0w).
--
-- Both columns held the SAME value that is emailed to the user, so anyone with
-- database read access — a leaked backup, a compromised credential, an
-- operator — could take over any account with a live reset token (1 h window)
-- or join an org via a live invite (7 d window). `MCPToken.tokenHash` in the
-- same schema was already SHA-256; the rule was known and applied
-- inconsistently.
--
-- A plain rename is safe here: both tables were empty at migration time
-- (verified against prod, 0 rows each), so there is no raw value to convert
-- and no in-flight link to invalidate. Were that not true, the correct move
-- would be to DELETE the rows — a hash cannot be derived from a value the
-- database no longer legitimately holds, and forcing users to re-request a
-- reset is the cheap side of that trade.
--
-- The rename is deliberate, not cosmetic: a column named `token` invites the
-- next author to compare it against user input directly, which is exactly how
-- this defect arrived.

ALTER TABLE "PasswordResetToken" RENAME COLUMN "token" TO "tokenHash";
ALTER TABLE "OrganizationInvite" RENAME COLUMN "token" TO "tokenHash";
