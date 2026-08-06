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
 * If email-sending is disabled (EMAIL_PROVIDER != "resend") the token is still
 * created in the DB — the operator can look it up manually — but the user
 * won't receive the link automatically.
 */
import { db } from "@brain/db";
import { z } from "zod";
import { headers } from "next/headers";
import {
  rateLimitCheck,
  writeAudit,
  sendEmail,
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

  if (process.env.EMAIL_PROVIDER === "resend") {
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
        { userId: user.id, reason: result.reason },
        "password reset email failed — token created but not delivered",
      );
    }
  } else {
    log.info(
      { userId: user.id },
      "EMAIL_PROVIDER not configured — password reset token created but not emailed; operator must look up token manually",
    );
  }

  return Response.json(GENERIC_OK);
}
