/**
 * POST /api/auth/reset-password
 *
 * Anonymous-friendly. Completes the self-service password reset flow.
 *
 * Body: { token: string; newPassword: string }
 *
 * Responses:
 *  200 { ok: true }                    — password created/updated
 *  400 { error: "invalid_token" }      — token not found / expired / already used
 *  400 { error: "weak_password" }      — password fails policy
 *
 * Upserts UserCredential rather than requiring one to pre-exist, so this
 * flow also bootstraps a first password for accounts created via agentic
 * onboarding (User + API token, no credential). See forgot-password/route.ts.
 */
import { db } from "@brain/db";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { writeAudit, validatePasswordPolicy, BCRYPT_COST, BrainError, getLogger } from "@brain/core";
import { hashSecret } from "@brain/core/secret-hash";

const log = getLogger("reset-password");

const bodySchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const { token, newPassword } = body;

  // Validate password policy first (cheap, before DB hit)
  try {
    validatePasswordPolicy(newPassword);
  } catch (err) {
    if (err instanceof BrainError) {
      return Response.json({ error: "weak_password" }, { status: 400 });
    }
    throw err;
  }

  // Look up by HASH — the raw value is never stored (KNOWN_ISSUES §0w).
  const resetToken = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashSecret(token) },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      usedAt: true,
    },
  });

  if (!resetToken) {
    return Response.json({ error: "invalid_token" }, { status: 400 });
  }
  if (resetToken.usedAt) {
    return Response.json({ error: "invalid_token" }, { status: 400 });
  }
  if (resetToken.expiresAt < new Date()) {
    return Response.json({ error: "invalid_token" }, { status: 400 });
  }

  // Hash the new password and update atomically.
  //
  // Upsert, not update: an account created via agentic onboarding
  // (/api/onboard/claim) has a User row and an API token but no
  // UserCredential — this is its only path to a first web password, so a
  // missing credential is created here rather than rejected. An account
  // whose credential existed and was since deleted still lands here safely;
  // the token is single-use and time-boxed either way.
  const newHash = await bcrypt.hash(newPassword, BCRYPT_COST);

  await db.$transaction([
    db.userCredential.upsert({
      where: { userId: resetToken.userId },
      update: { passwordHash: newHash },
      create: { userId: resetToken.userId, passwordHash: newHash },
    }),
    db.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  log.info({ userId: resetToken.userId }, "password reset complete");

  await writeAudit({
    actorUserId: resetToken.userId,
    action: "user.password_reset_complete",
    targetType: "user",
    targetId: resetToken.userId,
    payload: {},
  });

  return Response.json({ ok: true });
}
