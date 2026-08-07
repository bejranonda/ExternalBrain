/**
 * POST /api/auth/reset-password
 *
 * Anonymous-friendly. Completes the self-service password reset flow.
 *
 * Body: { token: string; newPassword: string }
 *
 * Responses:
 *  200 { ok: true }                    — password updated
 *  400 { error: "invalid_token" }      — token not found / expired / already used
 *  400 { error: "weak_password" }      — password fails policy
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

  // Verify the user still has a credential
  const cred = await db.userCredential.findUnique({
    where: { userId: resetToken.userId },
    select: { id: true },
  });
  if (!cred) {
    // Credential was deleted between token creation and use
    return Response.json({ error: "invalid_token" }, { status: 400 });
  }

  // Hash the new password and update atomically
  const newHash = await bcrypt.hash(newPassword, BCRYPT_COST);

  await db.$transaction([
    db.userCredential.update({
      where: { userId: resetToken.userId },
      data: { passwordHash: newHash },
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
