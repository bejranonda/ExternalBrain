/**
 * Prisma `where` for "Knowledge rows this user may read", for surfaces that
 * aggregate rows OTHER users' sessions touched (project value summary,
 * session detail viewed by a teammate).
 *
 * Those surfaces used to join `SessionKnowledgeApplication → knowledge` and
 * return `ruleText` for every row, gated only by org membership — so a
 * teammate's `visibility: "private"` rules, and personal rules injected into
 * their sessions in a shared project, were readable by anyone in the org
 * (KNOWN_ISSUES §0ay). This is the same policy the knowledge list applies
 * with `?scope=all`, not a new one: org/project-visible rows in projects the
 * user can access, plus the user's own rows.
 */
import { buildKnowledgeWhereV2, getAccessibleProjectIds } from "@brain/core";
import { db } from "@brain/db";

export async function readableKnowledgeWhere(
  userId: string,
  orgId: string | null,
): Promise<object> {
  const accessibleProjectIds = orgId ? await getAccessibleProjectIds(db, userId, orgId) : [];
  return buildKnowledgeWhereV2({
    userId,
    activeProjectId: null,
    activeOrgId: orgId,
    accessibleProjectIds,
    scope: "all",
  });
}
