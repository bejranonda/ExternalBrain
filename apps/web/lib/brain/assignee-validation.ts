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
 *
 * Validates EVERY `for:`-prefixed tag, not just the first — a caller
 * supplying two `for:` tags with only the first one checked would let a
 * second, unvalidated tag slip through unchecked (2026-07-17 CodeRabbit
 * finding). On success, returns the CANONICALIZED tags array — every
 * `for:<email>` entry rewritten to `for:<lowercased-email>` — rather than
 * the original tags verbatim: `packages/core/src/action-items.ts`'s
 * `for:${email.toLowerCase()}` lookup is an exact-match filter, so a
 * mixed-case `for:Alice@Test.com` tag that only PASSED validation
 * case-insensitively but was persisted as-is would silently never surface
 * to its assignee. Callers must persist the returned `tags`, not their own.
 */
export async function validateForTagAssignee(
  tags: string[],
  resolvedProjectId: string | null,
): Promise<{ ok: true; tags: string[] } | { ok: false; status: number; body: unknown }> {
  const forTags = tags.filter((t) => t.startsWith("for:"));
  if (forTags.length === 0) return { ok: true, tags };

  const project = resolvedProjectId
    ? await db.project.findUnique({
        where: { id: resolvedProjectId },
        select: { organizationId: true },
      })
    : null;
  const members = project ? await listOrgMembers(db, project.organizationId) : [];
  const memberEmails = new Set(members.map((m) => m.email.toLowerCase()));

  for (const forTag of forTags) {
    const assigneeEmail = forTag.slice(4).toLowerCase();
    if (!memberEmails.has(assigneeEmail)) {
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
  }

  const canonicalizedTags = tags.map((t) =>
    t.startsWith("for:") ? `for:${t.slice(4).toLowerCase()}` : t,
  );
  return { ok: true, tags: canonicalizedTags };
}
