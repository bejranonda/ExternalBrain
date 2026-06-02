/**
 * POST /api/admin/knowledge/reset — bulk-soft-delete knowledge rows in
 * the caller's org with a configurable scope.
 *
 * Admin-gated (org-admin or platform-admin) and writes an AuditLog row
 * with the count + scope so every reset is traceable.
 *
 * Request body (validated):
 *   {
 *     "scope": "all" | "older-than",
 *     "olderThanDays"?: number,        // required when scope="older-than"
 *     "hard"?: boolean,                // only allowed with scope="all"
 *     "confirmPhrase": "RESET KNOWLEDGE"
 *   }
 *
 * Response: { deleted: number, scopeLabel: string, hard: boolean }
 */
import { z } from "zod";
import { db } from "@brain/db";
import {
  resetKnowledge,
  writeAudit,
  requireOrgMember,
  getAccessibleProjectIds,
  type ResetScope,
  BrainError,
} from "@brain/core";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";

const bodySchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("all"),
    hard: z.boolean().optional(),
    confirmPhrase: z.string(),
  }),
  z.object({
    scope: z.literal("older-than"),
    olderThanDays: z.number().int().positive(),
    confirmPhrase: z.string(),
  }),
]);

export async function POST(req: Request): Promise<Response> {
  let userId: string;
  let orgId: string;
  try {
    userId = await getCurrentUserId();
    const active = await getActiveProject(userId);
    orgId = active.orgId;
  } catch (err) {
    return authErrorResponse(err);
  }

  // Org-admin gate — must be `owner` or `admin`. Members are refused.
  try {
    const { role } = await requireOrgMember(db, userId, orgId);
    if (role !== "owner" && role !== "admin") {
      return Response.json(
        { error: "forbidden", message: "Org-admin role required to reset knowledge." },
        { status: 403 },
      );
    }
  } catch {
    return Response.json(
      { error: "forbidden", message: "Not a member of this organization." },
      { status: 403 },
    );
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    return Response.json(
      { error: "bad_request", message: err instanceof Error ? err.message : "invalid body" },
      { status: 400 },
    );
  }

  const scope: ResetScope =
    body.scope === "all"
      ? { kind: "all" }
      : { kind: "older-than", days: body.olderThanDays };

  const hard = body.scope === "all" ? body.hard ?? false : false;

  try {
    const accessibleProjectIds = await getAccessibleProjectIds(db, userId, orgId);
    const result = await resetKnowledge(db, {
      userId,
      orgId,
      scope,
      hard,
      confirmPhrase: body.confirmPhrase,
      accessibleProjectIds,
    });

    // Audit row — separated from the helper so we have request metadata here.
    await writeAudit({
      actorUserId: userId,
      action: "knowledge.reset",
      orgId,
      payload: {
        scope: result.scopeLabel,
        hard: result.hard,
        deleted: result.deleted,
      },
    });

    return Response.json(result);
  } catch (err) {
    if (err instanceof BrainError) {
      return Response.json(
        { error: err.code, message: err.message, remediation: err.remediation },
        { status: 400 },
      );
    }
    return Response.json(
      { error: "internal", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
