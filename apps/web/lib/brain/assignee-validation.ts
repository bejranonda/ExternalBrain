import { db } from "@brain/db";
import { listOrgMembers } from "@brain/core";

/**
 * A `for:<email>` tag addresses an action item to a specific person — the
 * whole point of using a dropdown of real project members (rather than free
 * text) at teach time is defeated if the server doesn't also check it.
 * Client state is not a trust boundary (2026-07-14 review finding).
 *
 * Shared between POST /api/knowledge (create) and PATCH /api/knowledge/[id]
 * (`apps/web/app/api/knowledge/route.ts` and `.../[id]/route.ts`) so the two
 * validations can't silently drift apart — PATCH originally accepted `tags`
 * verbatim with no equivalent check, letting an `action_item` row's `for:`
 * tag be edited in after creation without ever being validated against org
 * membership (2026-07-17 final-review finding I3). Lives in `lib/` rather
 * than being exported from a `route.ts` file since Next.js App Router route
 * handlers are only sanctioned to export HTTP method handlers and a small
 * set of segment-config values.
 */
export async function validateForTagAssignee(
  tags: string[],
  resolvedProjectId: string | null,
): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  const forTag = tags.find((t) => t.startsWith("for:"));
  if (!forTag) return { ok: true };
  const assigneeEmail = forTag.slice(4).toLowerCase();
  const project = resolvedProjectId
    ? await db.project.findUnique({
        where: { id: resolvedProjectId },
        select: { organizationId: true },
      })
    : null;
  const members = project ? await listOrgMembers(db, project.organizationId) : [];
  const isMember = members.some((m) => m.email.toLowerCase() === assigneeEmail);
  if (!isMember) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: "INVALID_ASSIGNEE",
          message: `${assigneeEmail} is not a member of this project's organization.`,
        },
      },
    };
  }
  return { ok: true };
}
