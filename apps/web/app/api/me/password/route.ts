/**
 * POST /api/me/password — change the current user's password.
 *
 * Body: { currentPassword: string; newPassword: string }
 *
 * Errors:
 *  409 no_credential   — user signed in via OAuth or admin env; no credential to change.
 *  401 wrong_password  — currentPassword doesn't match.
 *  400 weak_password   — newPassword fails policy (< 8 chars).
 */
import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { changeUserPassword } from "@/lib/brain/user-credentials";
import { writeAudit, BrainError } from "@brain/core";

// Audit FE3 (#103): match the documented policy (min 8 chars) at the
// route boundary. Previously `min(1)` left `changeUserPassword`'s
// internal `validatePasswordPolicy` as the sole enforcement — fine in
// practice, but defense-in-depth wants the boundary to refuse weak
// inputs early. `currentPassword` stays at min(1) since it's a lookup
// key for an existing hash, not a new credential.
const bodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await req.json());
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    const { currentPassword, newPassword } = body;

    await changeUserPassword(db, userId, currentPassword, newPassword);

    await writeAudit({
      actorUserId: userId,
      action: "user.password_change",
      targetType: "user",
      targetId: userId,
      payload: {},
    });

    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof BrainError) {
      return Response.json(
        { error: err.code },
        { status: err.status ?? 500 },
      );
    }
    return authErrorResponse(err);
  }
}
