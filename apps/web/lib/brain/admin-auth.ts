/**
 * Admin auth guard — extends the normal session check with a role assertion.
 *
 * Call `requireAdmin()` at the top of every /api/admin/* handler. It throws
 * AuthError(403) rather than returning a value so callers can use early-return
 * pattern or let the catch boundary in authErrorResponse handle it.
 */
import { db } from "@brain/db";
import { AuthError, getCurrentUserId } from "@/lib/brain/auth";

export interface AdminCaller {
  userId: string;
  email: string;
}

/**
 * Resolve the current session and assert the user holds the "admin" role.
 * Throws AuthError("admin_required", 403) if not.
 */
export async function requireAdmin(): Promise<AdminCaller> {
  const userId = await getCurrentUserId();
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true },
  });
  if (!user || user.role !== "admin") {
    throw new AuthError("admin_required", 403);
  }
  return { userId: user.id, email: user.email };
}
