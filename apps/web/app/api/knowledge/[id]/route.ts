import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { toKnowledgeItemView } from "@/lib/brain/views";
import { writeAudit } from "@brain/core";
import { validateForTagAssignee } from "@/lib/brain/assignee-validation";

/**
 * Knowledge rows are semantically immutable once created (KNOWLEDGE.md §5.1).
 * PATCH only accepts metadata fields. To change trigger/rule/rationale, fork.
 */
const IMMUTABLE_FIELDS = ["ruleText", "triggerText", "rationale", "instead"] as const;

const patchSchema = z
  .object({
    tags: z.array(z.string()).optional(),
    scope: z.enum(["user", "project", "team", "global", "community"]).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "empty patch",
  });

async function requireOwned(id: string, userId: string) {
  const row = await db.knowledge.findUnique({ where: { id } });
  if (!row) return { error: Response.json({ error: "not_found" }, { status: 404 }) };
  if (row.ownerUserId !== userId) {
    return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  }
  // Audit R6 (#103): soft-deleted Knowledge previously slipped through
  // requireOwned and could be re-PATCHed, re-forked, and re-DELETEd.
  // Treat soft-deleted as not-found from this surface — a 404 matches
  // the listing endpoints which already filter deletedAt: null.
  if (row.deletedAt) {
    return { error: Response.json({ error: "not_found" }, { status: 404 }) };
  }
  return { row };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;
    const check = await requireOwned(id, userId);
    if ("error" in check) return check.error;
    return Response.json({ item: toKnowledgeItemView(check.row) });
  } catch (err) {
    return authErrorResponse(err);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;
    const check = await requireOwned(id, userId);
    if ("error" in check) return check.error;

    const raw = (await req.json()) as Record<string, unknown>;
    const attemptedImmutable = IMMUTABLE_FIELDS.filter((k) => k in raw);
    if (attemptedImmutable.length > 0) {
      return Response.json(
        {
          error: "immutable_field",
          fields: attemptedImmutable,
          hint: "fork the item (POST with action='fork', overrides) instead of editing in place",
        },
        { status: 409 },
      );
    }
    const patch = patchSchema.parse(raw);

    // Mirror POST /api/knowledge's for:<email> membership check (route.ts's
    // validateForTagAssignee) — without it, an action_item row's tags could
    // be PATCHed to an arbitrary for: assignee that was never validated
    // against org membership, bypassing the check entirely at create time
    // (2026-07-17 final-review finding I3).
    if (patch.tags !== undefined && check.row.type === "action_item") {
      const assigneeCheck = await validateForTagAssignee(patch.tags, check.row.ownerProjectId);
      if (!assigneeCheck.ok) {
        return Response.json(assigneeCheck.body, { status: assigneeCheck.status });
      }
      // Persist the canonicalized (lowercased for:) tags, not the caller's
      // possibly mixed-case originals.
      patch.tags = assigneeCheck.tags;
    }

    const data: Record<string, unknown> = {};
    if (patch.tags !== undefined) data.tags = patch.tags;
    if (patch.scope !== undefined) data.scope = patch.scope;
    if (patch.confidence !== undefined) data.confidence = patch.confidence;
    const updated = await db.knowledge.update({
      where: { id },
      data,
    });
    void writeAudit({
      actorUserId: userId,
      action: "knowledge.patch",
      targetType: "knowledge",
      targetId: id,
      payload: patch as Record<string, unknown>,
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });
    return Response.json({ item: toKnowledgeItemView(updated) });
  } catch (err) {
    return authErrorResponse(err);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;
    const check = await requireOwned(id, userId);
    if ("error" in check) return check.error;

    await db.knowledge.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    void writeAudit({
      actorUserId: userId,
      action: "knowledge.delete",
      targetType: "knowledge",
      targetId: id,
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });
    return Response.json({ ok: true });
  } catch (err) {
    return authErrorResponse(err);
  }
}

const forkSchema = z.object({
  action: z.literal("fork"),
  overrides: z
    .object({
      ruleText: z.string().optional(),
      scope: z.enum(["user", "project", "team", "global"]).optional(),
    })
    .default({}),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { id } = await params;
    const check = await requireOwned(id, userId);
    if ("error" in check) return check.error;

    const body = forkSchema.parse(await req.json());
    const src = check.row;
    const fork = await db.knowledge.create({
      data: {
        type: src.type,
        scope: body.overrides.scope ?? src.scope,
        ownerUserId: userId,
        triggerText: src.triggerText,
        ruleText: body.overrides.ruleText ?? src.ruleText,
        rationale: src.rationale,
        instead: src.instead,
        tags: src.tags,
        confidence: Math.max(0.5, src.confidence - 0.1),
        extractedBy: "user",
        parentKnowledgeId: src.id,
      },
    });
    void writeAudit({
      actorUserId: userId,
      action: "knowledge.fork",
      targetType: "knowledge",
      targetId: fork.id,
      payload: { sourceId: src.id },
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    });
    return Response.json({ item: toKnowledgeItemView(fork) });
  } catch (err) {
    return authErrorResponse(err);
  }
}
