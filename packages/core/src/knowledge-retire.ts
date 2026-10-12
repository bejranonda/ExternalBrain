/**
 * Retire a Knowledge row with a soft-delete plus a full-content audit snapshot.
 *
 * WHO may retire WHAT (operator decision 2026-10-12, v2.23.0 — narrows the
 * 2026-08-30 one below): your own rows freely; anyone else's row only by
 * naming the knowledge that REPLACES it (`replacedById` — a live row you can
 * see). Knowledge leaves the Brain because better knowledge took its place,
 * not because an agent decided it was wrong. That covers the two real cases
 * for touching a teammate's row — an outdated rule (teach the new one, then
 * retire the old with its id) and a duplicate (point at the copy that stays)
 * — while a hallucinating agent can no longer erase a teammate's decision
 * with nothing in its place. A project-scoped token reaches only rows in its
 * own project. There is no age-based retirement: ordinary rules already fade
 * through decay, and decisions are exempt because a still-true old decision
 * is the most valuable kind.
 *
 * History (2026-08-30):
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
  | { ok: true; snapshot: KnowledgeSnapshot; wasOwnRow: boolean; replacedById: string | null }
  | {
      ok: false;
      error:
        | "NOT_FOUND"
        | "FORBIDDEN"
        // Someone else's row, and no replacement named.
        | "REPLACEMENT_REQUIRED"
        // The named replacement is missing, retired, the row itself, or not
        // visible to the caller.
        | "REPLACEMENT_INVALID";
    };

/**
 * Whether `actorUserId` can read this Knowledge row, by the same predicate
 * retrieval uses. The org is resolved from the row's OWN project — never from
 * the caller's session or a client-supplied value, which a caller could use
 * to claim membership in an unrelated org and widen `accessibleProjectIds`.
 */
async function canRead(
  db: PrismaClient,
  actorUserId: string,
  row: { id: string; ownerProjectId: string | null },
): Promise<boolean> {
  let accessibleProjectIds: string[] = [];
  if (row.ownerProjectId) {
    const project = await db.project.findUnique({
      where: { id: row.ownerProjectId },
      select: { organizationId: true },
    });
    if (project?.organizationId) {
      accessibleProjectIds = await getAccessibleProjectIds(db, actorUserId, project.organizationId);
    }
  }
  const visible = await db.knowledge.findFirst({
    where: {
      AND: [
        { id: row.id },
        buildKnowledgeWhereV2({
          userId: actorUserId,
          activeProjectId: null,
          activeOrgId: null,
          accessibleProjectIds,
          scope: "all",
        }),
      ],
    },
    select: { id: true },
  });
  return visible !== null;
}

/** The named replacement, if it is a different live row the caller may use. */
async function resolveVisibleReplacement(
  db: PrismaClient,
  args: { id: string; replacedById: string; actorUserId: string; tokenProjectId?: string | null | undefined },
) {
  if (args.replacedById === args.id) return null;
  const r = await db.knowledge.findFirst({
    where: { id: args.replacedById, deletedAt: null },
    select: { id: true, ownerUserId: true, ownerProjectId: true, parentKnowledgeId: true },
  });
  if (!r) return null;
  if (args.tokenProjectId && r.ownerProjectId !== args.tokenProjectId) return null;
  if (r.ownerUserId === args.actorUserId) return r;
  return (await canRead(db, args.actorUserId, r)) ? r : null;
}

export async function retireKnowledgeById(
  db: PrismaClient,
  args: {
    id: string;
    actorUserId: string;
    reason?: string | undefined;
    /** The live row that takes this one's place. Required for others' rows. */
    replacedById?: string | undefined;
    /** Set for a project-scoped token: only rows in this project are reachable. */
    tokenProjectId?: string | null | undefined;
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

  // A project-scoped token is a narrower credential than its owner; it must
  // not reach the owner's rows in other projects (KNOWN_ISSUES §0ay).
  if (args.tokenProjectId && target.ownerProjectId !== args.tokenProjectId) {
    return { ok: false, error: "FORBIDDEN" };
  }

  const wasOwnRow = target.ownerUserId === args.actorUserId;
  if (!wasOwnRow) {
    if (!(await canRead(db, args.actorUserId, target))) return { ok: false, error: "FORBIDDEN" };
    // After the visibility check, so a row the caller cannot see answers
    // FORBIDDEN rather than confirming it exists.
    if (!args.replacedById) return { ok: false, error: "REPLACEMENT_REQUIRED" };
  }

  const replacement = args.replacedById
    ? await resolveVisibleReplacement(db, {
        id: args.id,
        replacedById: args.replacedById,
        actorUserId: args.actorUserId,
        tokenProjectId: args.tokenProjectId,
      })
    : null;
  if (args.replacedById && !replacement) return { ok: false, error: "REPLACEMENT_INVALID" };

  // One transaction: a retire whose lineage write failed would leave the row
  // gone with nothing recording what replaced it. Lineage — the same link
  // `supersedeKnowledge` writes — goes only on a row the caller owns that has
  // no parent yet: naming a teammate's row as the replacement must not
  // rewrite that teammate's row.
  const writeLineage =
    replacement !== null &&
    replacement.ownerUserId === args.actorUserId &&
    replacement.parentKnowledgeId === null;
  await db.$transaction([
    db.knowledge.update({ where: { id: args.id }, data: { deletedAt: new Date() } }),
    ...(writeLineage
      ? [db.knowledge.update({ where: { id: replacement.id }, data: { parentKnowledgeId: args.id } })]
      : []),
  ]);

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
    payload: {
      snapshot,
      reason: args.reason ?? null,
      retiredSomeoneElsesRow: !wasOwnRow,
      replacedById: replacement?.id ?? null,
    },
    ...(target.ownerProjectId ? { projectId: target.ownerProjectId } : {}),
  });

  return { ok: true, snapshot, wasOwnRow, replacedById: replacement?.id ?? null };
}
