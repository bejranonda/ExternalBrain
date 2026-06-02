/**
 * Admin credentials — username + bcrypt-hashed password stored in `.env`.
 *
 * This is the primary sign-in path for this phase of the pilot. GitHub
 * OAuth remains wired (see `auth.ts`) but is only active when its own
 * envs are populated — swapping providers is additive, no code change.
 *
 * Env contract:
 *   - `ADMIN_USERNAME`        plaintext; operator-chosen ("admin", or an email).
 *   - `ADMIN_PASSWORD_HASH`   bcryptjs hash; generate with
 *                             `pnpm hash-admin-password '<plaintext>'`.
 *   - `ADMIN_EMAILS` (optional) comma-separated; first entry seeds the
 *                              admin User row's email column. Same key the
 *                              OAuth admin-promotion flow reads — one
 *                              canonical name across both modes (#39). If
 *                              unset, synthesized as `${username}@admin.local`
 *                              so the DB's unique-email constraint holds.
 *                              The legacy singular `ADMIN_EMAIL` is still
 *                              honoured with a deprecation warning until
 *                              we drop it in a follow-up.
 *
 * Security notes:
 *   - Hash is bcrypt, cost 12. Compare takes ~200ms on commodity hardware —
 *     that's the intentional rate limit on brute-force.
 *   - Username comparison is constant-time to avoid timing side-channels
 *     on "does this username exist" inference.
 *   - `.env.local` must be mode 600 (see RUNBOOK). Anyone who can read the
 *     hash can brute-force it offline; anyone who can write it owns admin.
 */
import bcrypt from "bcryptjs";

/** True when both ADMIN_USERNAME and ADMIN_PASSWORD_HASH are set + non-empty. */
export function adminCredentialsConfigured(): boolean {
  const u = (process.env.ADMIN_USERNAME ?? "").trim();
  const h = (process.env.ADMIN_PASSWORD_HASH ?? "").trim();
  return u.length > 0 && h.length > 0;
}

// Print the deprecation warning at most once per process — repeating it
// every credentials check would spam the worker/web logs.
let warnedDeprecatedAdminEmail = false;

/**
 * Email column value used when creating the admin's `User` row in the DB.
 *
 * Resolution order (#39 — single canonical key for both Mode A credentials
 * and Mode B OAuth admin-promotion):
 *   1. `ADMIN_EMAILS[0]` (preferred — split on comma, first non-empty entry)
 *   2. legacy `ADMIN_EMAIL` (singular) — accepted with a one-time warning
 *   3. synthesised `${username}@admin.local` so the unique-email constraint
 *      on User.email still holds when neither is set.
 */
export function adminEmail(): string {
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length > 0) return list[0]!;

  const legacy = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (legacy) {
    if (!warnedDeprecatedAdminEmail) {
      warnedDeprecatedAdminEmail = true;
      console.warn(
        "[admin-credentials] ADMIN_EMAIL is deprecated — set ADMIN_EMAILS (comma-separated) instead. " +
          "Both currently honoured; ADMIN_EMAIL will be removed in a future release. (#39)",
      );
    }
    return legacy;
  }

  const username = (process.env.ADMIN_USERNAME ?? "admin").trim();
  // Strip anything the username/email-charset doesn't allow; we'd rather
  // produce `admin@admin.local` than error on an exotic username.
  const safe = username.replace(/[^a-zA-Z0-9._-]/g, "").toLowerCase() || "admin";
  return `${safe}@admin.local`;
}

/** Constant-time string compare. Returns false for length-mismatched inputs. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Dummy bcrypt hash used to burn CPU on wrong-username attempts, so the
 *  response time doesn't leak whether the username exists. Cost 12 to
 *  match the expected real hash. */
const DUMMY_HASH =
  "$2b$12$CwTycUXWue0Thq9StjUM0uJ8.Mm8LP9tYrYvM8hJlB3BcKXVnIcRa";

/**
 * Verify a submitted username + password against env-stored admin creds.
 * Returns `{ ok: true, email, name }` on match; `{ ok: false }` otherwise.
 * Burns constant CPU regardless of which check fails.
 */
export async function verifyAdminCredentials(
  username: string,
  password: string,
): Promise<{ ok: true; email: string; name: string } | { ok: false }> {
  const expectedUsername = (process.env.ADMIN_USERNAME ?? "").trim();
  const hash = (process.env.ADMIN_PASSWORD_HASH ?? "").trim();
  if (!expectedUsername || !hash) {
    // Still run bcrypt to match the success-path timing shape. Otherwise
    // a deployment with no credentials configured would respond in ~1ms
    // vs ~200ms for configured-but-wrong — a trivially detectable signal.
    await bcrypt.compare(password, DUMMY_HASH);
    return { ok: false };
  }
  const usernameOk = constantTimeEquals(username.trim(), expectedUsername);
  // Always run bcrypt against either the real or dummy hash, so bad
  // usernames don't return faster than bad passwords.
  const pwOk = await bcrypt.compare(password, usernameOk ? hash : DUMMY_HASH);
  if (!usernameOk || !pwOk) return { ok: false };
  return { ok: true, email: adminEmail(), name: expectedUsername };
}
