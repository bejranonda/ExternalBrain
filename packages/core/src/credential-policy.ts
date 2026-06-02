/**
 * Password policy validation — pure logic, no bcrypt dependency.
 *
 * The bcrypt operations (hash, compare, DB CRUD) live in
 * `apps/web/lib/brain/user-credentials.ts` which has access to bcryptjs.
 *
 * Keeping the policy here lets @brain/core re-export it without pulling in
 * bcryptjs as a dependency, and lets the core unit tests cover it directly.
 */
import { BrainError } from "./logger.js";

export const BCRYPT_COST = 12;
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Throw `BrainError(WEAK_PASSWORD)` if the password doesn't satisfy policy.
 * Minimum 8 characters; no special-char requirements (that's an anti-pattern).
 */
export function validatePasswordPolicy(password: string): void {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new BrainError({
      code: "WEAK_PASSWORD",
      category: "validation",
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      remediation: "Choose a longer password.",
      retryable: false,
      status: 400,
    });
  }
}
