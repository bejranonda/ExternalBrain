import { createHash } from "node:crypto";

/**
 * One-way hash for bearer-style secrets stored at rest.
 *
 * Every credential this platform persists — MCP tokens, password-reset
 * tokens, org-invite tokens — is a high-entropy random value presented
 * verbatim by the holder. The only thing the database needs is the ability to
 * recognise a presented secret, never to reproduce one. Storing the raw value
 * buys nothing and means database read access (a leaked dump, a compromised
 * credential, an operator) is equivalent to holding every live secret.
 *
 * SHA-256 with no salt is correct *here* and would be wrong for passwords:
 * these are 32 random bytes, so there is no dictionary to attack and the
 * lookup must be by exact hash. Passwords are low-entropy and human-chosen,
 * which is why `UserCredential.passwordHash` uses bcrypt cost 12 instead.
 *
 * Existed inline at three MCPToken call sites before 2026-08-06; extracted
 * when a privacy audit found `PasswordResetToken.token` and
 * `OrganizationInvite.token` storing raw values — the rule was known and
 * applied inconsistently, so it now has exactly one implementation
 * (KNOWN_ISSUES §0w).
 */
export function hashSecret(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
