/**
 * Resolve the org-sharing context for a read.
 *
 * Phase-4 `visibility: 'org'` knowledge works in the webapp and, until
 * 2026-08-03, silently did not apply over MCP: nothing on the MCP path ever
 * populated `accessibleProjectIds`, so `kra.retrieve` fell to its empty-list
 * branch and — behind the `ownerUserId` gate — returned only the caller's own
 * rows. AGENTS.md meanwhile told users "a teammate's next
 * `brain_start_session` surfaces them", which was not true.
 *
 * The list this returns is the ONLY thing that widens the owner gate in
 * `kra.ts`, so its trustworthiness is load-bearing:
 *
 *   - It is derived from the project's OWN `organizationId`, read from the
 *     database — never from client input.
 *   - `getAccessibleProjectIds` re-checks `OrganizationMember` and returns
 *     `[]` for a non-member, so a caller who names a project they cannot
 *     reach gets no widening at all rather than a partial one.
 *   - On any failure it returns `{}` — retrieval then behaves exactly as it
 *     did before org sharing existed. Failing closed here costs a teammate's
 *     rule; failing open would cost a tenant boundary.
 */
import { db } from "@brain/db";
import { getAccessibleProjectIds, getLogger } from "@brain/core";

const log = getLogger("mcp-server").child({ subsystem: "org-scope" });

export interface OrgScope {
  orgId?: string;
  accessibleProjectIds?: string[];
}

export async function resolveOrgScope(
  userId: string,
  projectId: string | undefined,
): Promise<OrgScope> {
  if (!projectId) return {};
  try {
    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true },
    });
    if (!project?.organizationId) return {};

    const accessibleProjectIds = await getAccessibleProjectIds(
      db,
      userId,
      project.organizationId,
    );
    // Non-member → []. Return nothing rather than an empty list so the
    // caller's `?? []` path and this one cannot diverge.
    if (accessibleProjectIds.length === 0) return {};

    return { orgId: project.organizationId, accessibleProjectIds };
  } catch (err) {
    log.warn(
      { err, op: "org-scope.resolve", projectId },
      "could not resolve org scope — falling back to owner-only retrieval",
    );
    return {};
  }
}
