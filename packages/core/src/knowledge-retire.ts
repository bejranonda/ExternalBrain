/**
 * Retire ANY Knowledge row the caller can currently see — not only rows they
 * authored — with a soft-delete plus a full-content audit snapshot.
 *
 * This is new, and deliberately broader than every other write on this
 * surface. `supersedeKnowledge` (knowledge-stats.ts) only ever retires a row
 * the SAME user owns; `brain_teach_knowledge` only ever adds. Nothing before
 * this let a caller unilaterally erase a row that belonged to someone else —
 * including an org-shared decision. That was an explicit operator choice
 * (2026-08-30), made aware of the risk: a hallucinating agent or a bad prompt
 * can now retire a teammate's decision, not only its own mistakes. The two
 * mitigations below are the price of taking that trade:
 *
 *   1. Authorization mirrors READ access EXACTLY, via `buildKnowledgeWhereV2`
 *      — the same predicate `kra.ts`/`oracle.ts` already use. If a row would
 *      not appear in this caller's retrieval, it cannot be retired either.
 *      Re-running the real predicate rather than reimplementing "is this
 *      visible to me" a second time is the point: two copies of a visibility
 *      rule drift the way every duplicated rule in this repo has
 *      (GUIDELINES §4) — and here a drift would be a privilege escalation,
 *      not a cosmetic bug.
 *   2. It NEVER hard-deletes. `deletedAt` is set, and the full pre-delete
 *      content is written into an AuditLog payload — append-only by this
 *      platform's existing contract (no code path deletes an AuditLog row;
 *      see KNOWLEDGE.md "the log is append-only by contract"). "Keep it in
 *      backup for future recovery" therefore costs no new infrastructure:
 *      it reuses the same guarantee GDPR erase already relies on for its own
 *      audit trail. The snapshot is also returned to the caller directly, so
 *      an agent that retires the wrong row can re-teach it from the response
 *      without needing an operator to touch the database at all.
 */
import type { PrismaClient } from "@brain/db";
import { buildKnowledgeWhereV2 } from "./scope-filter.js";
import { writeAudit } from "./audit.js";
import { getAccessibleProjectIds } from "./org.js";

export interface KnowledgeSnapshot {
  id: string;
  type: string;
  scope: string;
  visibility: string;
  ownerUserId: string | null;
  ownerProjectId: string | null;
  triggerText: string;
  ruleText: string;
  rationale: string | null;
  instead: string | null;
  tags: string[];
  framework: string | null;
  language: string | null;
  confidence: number;
  createdAt: Date;
}

export type RetireOutcome =
  | { ok: true; snapshot: KnowledgeSnapshot; wasOwnRow: boolean }
  | { ok: false; error: "NOT_FOUND" | "FORBIDDEN" };

export async function retireKnowledgeById(
  db: PrismaClient,
  args: {
    id: string;
    actorUserId: string;
    reason?: string | undefined;
  },
): Promise<RetireOutcome> {
  const target = await db.knowledge.findUnique({
    where: { id: args.id },
    select: {
      id: true,
      type: true,
      scope: true,
      visibility: true,
      ownerUserId: true,
      ownerProjectId: true,
      triggerText: true,
      ruleText: true,
      rationale: true,
      instead: true,
      tags: true,
      framework: true,
      language: true,
      confidence: true,
      createdAt: true,
      deletedAt: true,
    },
  });
  // Already-retired reads as NOT_FOUND, not a second success — a caller
  // retrying a retire must not be told it worked twice.
  if (!target || target.deletedAt) return { ok: false, error: "NOT_FOUND" };

  const wasOwnRow = target.ownerUserId === args.actorUserId;
  if (!wasOwnRow) {
    // Resolve the target's OWN org from its OWN project — never from the
    // caller's session or a client-supplied value. A caller could otherwise
    // claim membership in an unrelated org to widen `accessibleProjectIds`
    // for a row that has nothing to do with it.
    let accessibleProjectIds: string[] = [];
    if (target.ownerProjectId) {
      const project = await db.project.findUnique({
        where: { id: target.ownerProjectId },
        select: { organizationId: true },
      });
      if (project?.organizationId) {
        accessibleProjectIds = await getAccessibleProjectIds(
          db,
          args.actorUserId,
          project.organizationId,
        );
      }
    }
    const visible = await db.knowledge.findFirst({
      where: {
        AND: [
          { id: args.id },
          buildKnowledgeWhereV2({
            userId: args.actorUserId,
            activeProjectId: null,
            activeOrgId: null,
            accessibleProjectIds,
            scope: "all",
          }),
        ],
      },
      select: { id: true },
    });
    if (!visible) return { ok: false, error: "FORBIDDEN" };
  }

  await db.knowledge.update({
    where: { id: args.id },
    data: { deletedAt: new Date() },
  });

  const snapshot: KnowledgeSnapshot = {
    id: target.id,
    type: target.type,
    scope: target.scope,
    visibility: target.visibility,
    ownerUserId: target.ownerUserId,
    ownerProjectId: target.ownerProjectId,
    triggerText: target.triggerText,
    ruleText: target.ruleText,
    rationale: target.rationale,
    instead: target.instead,
    tags: target.tags,
    framework: target.framework,
    language: target.language,
    confidence: target.confidence,
    createdAt: target.createdAt,
  };

  // Best-effort by convention (writeAudit swallows its own errors) — but the
  // soft-delete above must never roll back because the audit write failed;
  // losing the log entry is strictly better than un-retiring silently.
  await writeAudit({
    actorUserId: args.actorUserId,
    action: "knowledge.retire",
    targetType: "knowledge",
    targetId: args.id,
    payload: { snapshot, reason: args.reason ?? null, retiredSomeoneElsesRow: !wasOwnRow },
    ...(target.ownerProjectId ? { projectId: target.ownerProjectId } : {}),
  });

  return { ok: true, snapshot, wasOwnRow };
}
