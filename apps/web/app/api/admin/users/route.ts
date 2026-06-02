/**
 * GET /api/admin/users — list all users with usage counts.
 *
 * Requires admin role. Returns every user row plus denormalized counts so
 * the admin UI can render a summary table without additional fetches.
 */
import { db } from "@brain/db";
import { authErrorResponse } from "@/lib/brain/auth";
import { requireAdmin } from "@/lib/brain/admin-auth";
import { writeAudit } from "@brain/core";

export async function GET(req: Request): Promise<Response> {
  try {
    const { userId: actorId } = await requireAdmin();

    const users = await db.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            knowledge: true,
            sessions: true,
          },
        },
      },
    });

    const mapped = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      createdAt: u.createdAt,
      knowledgeCount: u._count.knowledge,
      sessionCount: u._count.sessions,
    }));

    void writeAudit({
      actorUserId: actorId,
      action: "admin.user_list",
      payload: { count: mapped.length },
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });

    return Response.json({ users: mapped });
  } catch (err) {
    return authErrorResponse(err);
  }
}
