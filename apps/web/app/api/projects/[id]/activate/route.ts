/**
 * POST /api/projects/:id/activate
 *
 * Sets the bp_active_project HTTP-only cookie to the given project id.
 * The project must belong to the current user (either as ownerUserId or
 * as a project inside any org the user is a member of).
 */
import { cookies } from "next/headers";
import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getUserProjects } from "@brain/core";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;

    // Verify the project belongs to one of the user's orgs.
    const projects = await getUserProjects(db, userId);
    const match = projects.find((p) => p.id === id);

    if (!match) {
      return Response.json({ error: "not_found_or_forbidden" }, { status: 403 });
    }

    const cookieStore = await cookies();
    cookieStore.set("bp_active_project", id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // No maxAge — session cookie (cleared on browser close).
      // Callers that want persistence can extend this later.
    });

    return Response.json({ ok: true, projectId: id });
  } catch (err) {
    return authErrorResponse(err);
  }
}
