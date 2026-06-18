/**
 * GET  /api/orgs — list the current user's organizations + projects.
 * POST /api/orgs — create a new organization owned by the current user.
 */
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { createOrg, getUserOrgs, getUserProjects, writeAudit, BrainError } from "@brain/core";

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

const createSchema = z.object({
  name: z.string().min(1).max(120),
});

export async function POST(req: Request): Promise<Response> {
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch (err) {
    return authErrorResponse(err);
  }

  let name: string;
  try {
    ({ name } = createSchema.parse(await req.json()));
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const org = await createOrg(db, userId, name);

    await writeAudit({
      actorUserId: userId,
      action: "org.create",
      targetType: "organization",
      targetId: org.orgId,
      payload: { slug: org.slug, name: org.name },
    });

    // Make the new org the active context so the user lands inside it.
    const jar = await cookies();
    jar.set("bp_active_project", org.projectId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });

    return Response.json({
      ok: true,
      org: {
        id: org.orgId,
        slug: org.slug,
        name: org.name,
        role: "owner",
      },
      redirectTo: `/${org.slug}/${org.projectSlug}`,
    });
  } catch (err) {
    if (err instanceof BrainError) {
      return Response.json(
        { error: err.code, message: err.message },
        { status: err.status ?? 400 },
      );
    }
    // P2002 = unique slug collision under concurrent creation — transient.
    if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
      return Response.json(
        {
          error: "slug_conflict",
          message: "Couldn't create the organization just now — please try again.",
        },
        { status: 409 },
      );
    }
    throw err;
  }
}
