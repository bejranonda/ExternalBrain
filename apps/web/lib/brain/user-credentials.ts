/**
 * Per-user bcrypt credential helpers.
 *
 * Separate from `admin-credentials.ts` (which uses env vars for single-admin).
 * This module is database-backed: one `UserCredential` row per user who signed
 * up via invite or explicitly set a password.
 *
 * Design rules:
 *  - Accepts a `db` (or transaction) argument so callers can run inside a
 *    larger transaction (e.g. the invite-signup flow).
 *  - Never imports `db` directly — stays testable without a live database.
 *  - Throws `BrainError` with structured codes so API routes get meaningful
 *    HTTP status codes.
 *
 * Password policy: min 8 characters. No special-char requirements — that is
 * an anti-pattern. Operators who want stronger policies should layer in a
 * separate check at the UI layer.
 */
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@brain/db";
import { BrainError, validatePasswordPolicy, BCRYPT_COST, MIN_PASSWORD_LENGTH } from "@brain/core";

export { validatePasswordPolicy, BCRYPT_COST, MIN_PASSWORD_LENGTH };

// ---------------------------------------------------------------------------
// createUserCredential
// ---------------------------------------------------------------------------

/**
 * Hash `password` and insert a new `UserCredential` row for `userId`.
 * Throws `BrainError(CREDENTIAL_ALREADY_EXISTS)` if a row already exists.
 *
 * Intended to be called inside a transaction during invite-signup.
 */
export async function createUserCredential(
  db: PrismaClient,
  userId: string,
  password: string,
): Promise<void> {
  validatePasswordPolicy(password);

  const existing = await db.userCredential.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (existing) {
    throw new BrainError({
      code: "CREDENTIAL_ALREADY_EXISTS",
      category: "validation",
      message: "A credential already exists for this user.",
      remediation: "Use the change-password endpoint instead.",
      retryable: false,
      status: 409,
    });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  await db.userCredential.create({
    data: { userId, passwordHash },
  });
}

// ---------------------------------------------------------------------------
// verifyUserCredential
// ---------------------------------------------------------------------------

/**
 * Look up the UserCredential for a given userId and bcrypt-compare `password`.
 * Returns `true` on match, `false` on mismatch or missing credential.
 * Never throws — callers handle the false return.
 *
 * Audit W1 (#103): the no-credential path previously returned in ~1ms
 * (DB roundtrip only) while the credential-present path took ~200ms
 * (bcrypt compare). A timing attacker could enumerate which userIds
 * have password credentials. Run a dummy bcrypt compare on the
 * no-cred path to flatten — same trick `verifyAdminCredentials` uses.
 */
const DUMMY_HASH =
  "$2b$12$CwTycUXWue0Thq9StjUM0uJ8.Mm8LP9tYrYvM8hJlB3BcKXVnIcRa";

export async function verifyUserCredential(
  db: PrismaClient,
  userId: string,
  password: string,
): Promise<boolean> {
  const cred = await db.userCredential.findUnique({
    where: { userId },
    select: { passwordHash: true },
  });
  if (!cred) {
    // Burn CPU equivalent to the success-path bcrypt so the response
    // time doesn't reveal whether this user has a password credential.
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(password, cred.passwordHash);
}

// ---------------------------------------------------------------------------
// changeUserPassword
// ---------------------------------------------------------------------------

/**
 * Verify `currentPassword` against the stored hash, then replace with a new
 * bcrypt hash for `newPassword`.
 *
 * Throws:
 *  - `BrainError(NO_CREDENTIAL, 409)` — user has no password-based credential.
 *  - `BrainError(WRONG_PASSWORD, 401)` — currentPassword doesn't match.
 *  - `BrainError(WEAK_PASSWORD, 400)` — newPassword fails policy.
 */
export async function changeUserPassword(
  db: PrismaClient,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const cred = await db.userCredential.findUnique({
    where: { userId },
    select: { id: true, passwordHash: true },
  });
  if (!cred) {
    throw new BrainError({
      code: "NO_CREDENTIAL",
      category: "validation",
      message: "This account does not have a password credential.",
      remediation:
        "You signed in via OAuth or the admin env path. Password change is not supported for this account type.",
      retryable: false,
      status: 409,
    });
  }

  const ok = await bcrypt.compare(currentPassword, cred.passwordHash);
  if (!ok) {
    throw new BrainError({
      code: "WRONG_PASSWORD",
      category: "auth",
      message: "Current password is incorrect.",
      remediation: "Enter the password you use to sign in to Brain Platform.",
      retryable: false,
      status: 401,
    });
  }

  validatePasswordPolicy(newPassword);

  const newHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await db.userCredential.update({
    where: { userId },
    data: { passwordHash: newHash },
  });
}

// ---------------------------------------------------------------------------
// hasUserCredential
// ---------------------------------------------------------------------------

/**
 * Return true if the user has a UserCredential row.
 */
export async function hasUserCredential(
  db: PrismaClient,
  userId: string,
): Promise<boolean> {
  const row = await db.userCredential.findUnique({
    where: { userId },
    select: { id: true },
  });
  return row !== null;
}
