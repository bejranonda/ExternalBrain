/**
 * GET /api/orgs
 *
 * Returns the current user's organizations with their projects, plus the
 * active project id resolved from the bp_active_project cookie.
 */
import { cookies } from "next/headers";
import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getUserOrgs, getUserProjects } from "@brain/core";

export async function GET(): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const cookieStore = await cookies();
    const activeProjectId = cookieStore.get("bp_active_project")?.value ?? null;

    const orgs = await getUserOrgs(db, userId);
    const projects = await getUserProjects(db, userId);

    // Group projects by org
    const projectsByOrg = new Map<
      string,
      Array<{
        id: string;
        slug: string;
        name: string;
        framework: string | null;
        language: string | null;
        createdAt: Date;
        isOwn: boolean;
      }>
    >();

    for (const p of projects) {
      const list = projectsByOrg.get(p.organizationId) ?? [];
      list.push({
        id: p.id,
        slug: p.slug,
        name: p.name,
        framework: p.framework,
        language: p.language,
        createdAt: p.createdAt,
        isOwn: p.isOwn,
      });
      projectsByOrg.set(p.organizationId, list);
    }

    const result = orgs.map((o) => ({
      id: o.orgId,
      slug: o.slug,
      name: o.name,
      role: o.role,
      projects: projectsByOrg.get(o.orgId) ?? [],
    }));

    return Response.json({ orgs: result, activeProjectId });
  } catch (err) {
    return authErrorResponse(err);
  }
}
