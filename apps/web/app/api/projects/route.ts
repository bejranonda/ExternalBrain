/**
 * POST /api/projects
 *
 * Create a new project inside an org the user is a member of.
 * Body: { orgId: string; name: string }
 * Returns: { project: { id, slug, name, organizationId } }
 */
import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import {
  requireOrgMember,
  slugify,
  uniqueSlugInOrg,
  writeAudit,
} from "@brain/core";

const createSchema = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1).max(120),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const body = createSchema.parse(await req.json());

    // Verify membership — throws 403 if not a member.
    await requireOrgMember(db, userId, body.orgId);

    const baseSlug = slugify(body.name);
    const slug = await uniqueSlugInOrg(db, body.orgId, baseSlug);

    const project = await db.project.create({
      data: {
        organizationId: body.orgId,
        ownerUserId: userId,
        name: body.name,
        slug,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        organizationId: true,
        createdAt: true,
      },
    });

    void writeAudit({
      actorUserId: userId,
      action: "project.create",
      targetType: "project",
      targetId: project.id,
      payload: { orgId: body.orgId, name: body.name, slug },
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });

    return Response.json({ project }, { status: 201 });
  } catch (err) {
    return authErrorResponse(err);
  }
}
