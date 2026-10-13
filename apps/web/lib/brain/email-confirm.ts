/**
 * Signup confirmation (KNOWN_ISSUES §0bb) — the last gap of the pre-account
 * takeover class (§0az).
 *
 * Self-registration stores whatever address was typed. Since v2.22.0 such an
 * account cannot take over the real owner's GitHub sign-in, but it could still
 * sign in with its password and use the address. Now, while email delivery is
 * configured, a self-registered account's password sign-in is refused until
 * the emailed link is used. The link is the same proof a password reset is, so
 * it goes through `proveEmailOwnership`.
 *
 * Confirming takes the inbox AND the account's password. The inbox alone is
 * not enough: someone who registered another person's address would get the
 * confirmation mail sent to that person, and if they clicked it the
 * registrant's password would then sign in to a verified account.
 *
 * The gate needs an email provider and a configured public URL (`AUTH_URL`).
 * The link is never built from request headers — a forged Host would mail the
 * real owner a link to someone else's server, carrying the token. Without
 * either, the gate is off: a self-hosted instance with no mail would otherwise
 * strand every new account. The check is made at sign-in as well as at
 * registration, so removing the provider later does not lock out accounts that
 * were still pending.
 */
import crypto from "crypto";
import { db } from "@brain/db";
import {
  confirmEmailEmail,
  getLogger,
  isEmailConfigured,
  sendEmail,
} from "@brain/core";
import { hashSecret } from "@brain/core/secret-hash";
import { proveEmailOwnership } from "./email-ownership";
import { verifyUserCredential } from "./user-credentials";

const log = getLogger("email-confirm");

export const CONFIRM_TTL_MS = 24 * 60 * 60 * 1000;

function confirmLinkBase(): string | null {
  return process.env.AUTH_URL?.trim().replace(/\/$/, "") || null;
}

/** Whether new self-registrations must confirm their email. */
export function confirmationEnabled(): boolean {
  return isEmailConfigured() && confirmLinkBase() !== null;
}

/** Whether this account's password sign-in must wait for confirmation. */
export function emailConfirmPending(user: {
  emailConfirmRequired: boolean;
  emailVerifiedAt: Date | null;
}): boolean {
  return user.emailConfirmRequired && user.emailVerifiedAt === null && confirmationEnabled();
}

/**
 * Mint a confirmation link for `userId` and email it. Returns whether the
 * provider accepted the message; the token exists either way, but only its
 * hash is stored, so a failed send is recovered by asking for a new link.
 */
export async function issueEmailConfirmation(
  userId: string,
  email: string,
  now: Date = new Date(),
): Promise<{ sent: boolean }> {
  const webUrl = confirmLinkBase();
  if (!webUrl) return { sent: false };
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + CONFIRM_TTL_MS);
  await db.emailConfirmToken.create({
    data: { userId, tokenHash: hashSecret(rawToken), expiresAt },
  });

  const tpl = confirmEmailEmail({
    confirmLink: `${webUrl}/confirm-email?token=${rawToken}`,
    expiresAt: expiresAt.toISOString(),
  });
  const result = await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text });
  if (!result.ok) {
    log.warn({ userId, reason: result.reason }, "signup confirmation email failed");
    return { sent: false };
  }
  log.info({ userId, messageId: result.messageId }, "signup confirmation email sent");
  return { sent: true };
}

export type ConfirmOutcome =
  | { ok: true; userId: string }
  | { ok: false; error: "invalid_token" | "expired_token" | "invalid_credentials" };

/**
 * Use a confirmation link: single use, and only with the account's password.
 * A wrong password leaves the link usable.
 */
export async function confirmEmailToken(
  rawToken: string,
  password: string,
  now: Date = new Date(),
): Promise<ConfirmOutcome> {
  const row = await db.emailConfirmToken.findUnique({
    where: { tokenHash: hashSecret(rawToken) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  if (!row || row.usedAt) return { ok: false, error: "invalid_token" };
  if (row.expiresAt < now) return { ok: false, error: "expired_token" };
  if (!(await verifyUserCredential(db, row.userId, password))) {
    return { ok: false, error: "invalid_credentials" };
  }

  return db.$transaction(async (tx) => {
    // Conditional on usedAt still null, so two concurrent clicks cannot both
    // succeed.
    const claimed = await tx.emailConfirmToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count !== 1) return { ok: false as const, error: "invalid_token" as const };
    await proveEmailOwnership(tx, row.userId, now);
    await tx.user.update({
      where: { id: row.userId },
      data: { emailConfirmRequired: false },
    });
    return { ok: true as const, userId: row.userId };
  });
}
