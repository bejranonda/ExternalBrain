/**
 * POST /api/auth/forgot-password
 *
 * Anonymous-friendly. Initiates the self-service password reset flow.
 *
 * Body: { email: string }
 *
 * ALWAYS returns 200 with a generic message regardless of whether the email
 * exists in the database — this prevents user enumeration.
 *
 * Flow:
 *  1. Rate-limit: 3 requests/hour per IP (uses existing rate-limit infrastructure).
 *  2. Look up User by email. If found AND has UserCredential, create a
 *     PasswordResetToken (1-hour expiry) and send a reset email.
 *  3. Write audit row: user.password_reset_request (targetId = userId or null).
 *
 * If email-sending is disabled (EMAIL_PROVIDER != "resend") or delivery fails,
 * the token is still created, but only its SHA-256 hash is persisted — the raw
 * value is unrecoverable from the database by design (KNOWN_ISSUES §0w).
 *
 * The log then records the userId and a non-usable hash prefix, so an operator
 * can correlate the attempt without holding a credential. The reset LINK
 * itself is logged ONLY when `ALLOW_RESET_LINK_IN_LOGS=true` is explicitly
 * set — it fails closed, because a live credential in a log file is a
 * deliberate choice, never a default.
 *
 * The honest ordering of options: configure EMAIL_PROVIDER (best), enable the
 * flag on a single-operator instance and accept a one-hour credential in the
 * log (workable), or have no recovery path at all (what shipping this without
 * either would mean).
 */
import { db } from "@brain/db";
import { z } from "zod";
import { headers } from "next/headers";
import {
  rateLimitCheck,
  writeAudit,
  sendEmail,
  isEmailConfigured,
  passwordResetEmail,
  getLogger,
} from "@brain/core";
import { getRateLimitStore } from "@/lib/brain/rate-limit-store";
import crypto from "crypto";
import { hashSecret } from "@brain/core/secret-hash";

const log = getLogger("forgot-password");

const LIMIT = { name: "forgot_password", max: 3, windowMs: 60 * 60 * 1000 };

const bodySchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase().trim()),
});

const GENERIC_OK = {
  ok: true,
  message:
    "If an account with that email exists, a password reset link has been sent.",
};

function getWebUrl(req: Request): string {
  const url = new URL(req.url);
  return (
    process.env.AUTH_URL?.replace(/\/$/, "") ??
    `${url.protocol}//${url.host}`
  );
}

export async function POST(req: Request): Promise<Response> {
  // --- Rate limit ---
  const hdrs = await headers();
  const xff = hdrs.get("x-forwarded-for");
  const ip = xff ? xff.split(",")[0]!.trim() : "local";

  const store = await getRateLimitStore();
  const gate = await rateLimitCheck(store, ip, LIMIT, Date.now());
  if (!gate.ok) {
    // Still return 200 to avoid timing-based enumeration; log for ops.
    log.warn({ ip }, "forgot-password rate limited");
    return Response.json(GENERIC_OK);
  }

  // --- Parse body ---
  let email: string;
  try {
    ({ email } = bodySchema.parse(await req.json()));
  } catch {
    return Response.json(GENERIC_OK);
  }

  // --- Look up user ---
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      credential: { select: { id: true } },
    },
  });

  // Audit regardless of existence
  await writeAudit({
    actorUserId: null,
    action: "user.password_reset_request",
    targetType: "user",
    targetId: user?.id ?? null,
    payload: { emailProvided: email },
    ip,
  });

  if (!user || !user.credential) {
    // No user or no credential — return generic 200 to prevent enumeration.
    return Response.json(GENERIC_OK);
  }

  // --- Create reset token ---
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      // Only the hash is persisted; `rawToken` below goes in the email and is
      // never recoverable from the database.
      tokenHash: hashSecret(rawToken),
      expiresAt,
    },
  });

  // --- Send email (if configured) ---
  const webUrl = getWebUrl(req);
  const resetLink = `${webUrl}/reset-password?token=${rawToken}`;

  // Fails closed. Without the flag the log carries a correlatable but
  // UNUSABLE prefix of the hash — enough to match an audit row, useless to
  // anyone who reads the log file.
  const linkLoggingAllowed = process.env.ALLOW_RESET_LINK_IN_LOGS === "true";
  const linkFields = (link: string) =>
    linkLoggingAllowed
      ? { resetLink: link, sensitive: true as const }
      : { tokenIdHash: hashSecret(rawToken).slice(0, 16) };

  if (isEmailConfigured()) {
    const tpl = passwordResetEmail({
      userName: user.name ?? user.email,
      resetLink,
      expiresAt: expiresAt.toISOString(),
    });

    const result = await sendEmail({
      to: user.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });

    if (result.ok) {
      log.info({ userId: user.id, messageId: result.messageId }, "password reset email sent");
    } else {
      log.warn(
        {
          userId: user.id,
          reason: result.reason,
          ...linkFields(resetLink),
          expiresAt: expiresAt.toISOString(),
        },
        linkLoggingAllowed
          ? "password reset email FAILED — link logged for manual delivery; " +
              "it is a live credential until it expires"
          : "password reset email FAILED and no link was logged. Set " +
              "ALLOW_RESET_LINK_IN_LOGS=true to recover manually, or fix " +
              "EMAIL_PROVIDER. The database stores only a hash.",
      );
    }
  } else {
    log.warn(
      {
        userId: user.id,
        ...linkFields(resetLink),
        expiresAt: expiresAt.toISOString(),
      },
      linkLoggingAllowed
        ? "EMAIL_PROVIDER not configured — reset link logged for manual " +
            "delivery. It is a live credential until it expires."
        : "EMAIL_PROVIDER not configured and ALLOW_RESET_LINK_IN_LOGS is off, " +
            "so this reset cannot be completed. Configure an email provider, " +
            "or set the flag to log the link on a single-operator instance.",
    );
  }

  return Response.json(GENERIC_OK);
}
