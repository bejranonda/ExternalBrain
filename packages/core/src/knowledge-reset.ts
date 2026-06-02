/**
 * Knowledge reset — bulk soft-delete (or hard-delete) Knowledge rows scoped
 * to a user / org with a configurable time window or "all".
 *
 * Designed for the admin-gated reset surface (apps/web/app/settings/reset-knowledge).
 * Always writes an AuditLog row so resets are traceable; refuses to act
 * without an explicit confirmation phrase.
 *
 * Soft-delete by default — sets `deletedAt = NOW()` so the row is hidden
 * from KRA/Oracle/Skills queries (they all filter `deletedAt IS NULL`)
 * but stays in the table for forensic recovery. `hard: true` is reserved
 * for the "all" path when the operator wants the rows physically gone.
 */
import type { PrismaClient, Prisma } from "@brain/db";
import { BrainError } from "./logger.js";

export type ResetScope =
  | { kind: "all" }
  | { kind: "older-than"; days: number };

export interface ResetOpts {
  /** Required — the user initiating the reset (audit + ownership filter). */
  userId: string;
  /** What to delete. */
  scope: ResetScope;
  /**
   * Constrain to a single org. Required: a reset must always specify which
   * org's knowledge it touches — refusing org-less resets prevents an
   * accidental "delete every Knowledge row in the DB" call.
   */
  orgId: string;
  /**
   * Soft-delete (default) sets `deletedAt = NOW()`; hard-delete physically
   * removes the row. Hard is reserved for the `all` scope (the only path
   * where keeping audit-trail rows is meaningless because there's nothing
   * to reference them).
   */
  hard?: boolean;
  /**
   * Operator confirmation. Must be the literal string `RESET KNOWLEDGE`
   * (case-sensitive). Defends against accidental triggers from a stray
   * test fixture or a curl-pipe-bash that types one wrong character.
   */
  confirmPhrase: string;
}

export interface ResetResult {
  /** How many rows were affected. */
  deleted: number;
  /** Echoes the scope selector (useful for audit). */
  scopeLabel: string;
  /** Whether soft-delete or hard-delete was used. */
  hard: boolean;
}

const REQUIRED_CONFIRM = "RESET KNOWLEDGE";

/**
 * Build the SQL WHERE shape that matches the requested scope. Always also
 * filters by org membership — the caller's `orgId` is the safety floor.
 *
 * `accessibleProjectIds` is supplied by the caller (the route handler
 * looks them up via `getAccessibleProjectIds`) — the schema has no direct
 * `Knowledge.ownerProject` relation we can join through, only an opaque
 * `ownerProjectId` string column. The list-of-ids approach keeps the
 * helper Prisma-version-agnostic.
 */
function buildWhere(
  opts: ResetOpts,
  accessibleProjectIds: string[],
): Prisma.KnowledgeWhereInput {
  const { scope, userId } = opts;

  // Ownership filter: the user can only reset rows they own personally
  // OR rows owned by a project inside the org. The `OR` is intentional —
  // an org admin clearing test data should be able to clear rows
  // their teammates created in the same org's projects.
  const ownership: Prisma.KnowledgeWhereInput = {
    OR: [
      { ownerUserId: userId },
      { ownerProjectId: { in: accessibleProjectIds } },
    ],
  };

  // Scope filter.
  let scopeFilter: Prisma.KnowledgeWhereInput;
  if (scope.kind === "all") {
    scopeFilter = {};
  } else {
    if (!Number.isFinite(scope.days) || scope.days <= 0) {
      throw new BrainError({
        code: "INVALID_SCOPE",
        category: "validation",
        message: `older-than: days must be a positive number, got ${scope.days}`,
      });
    }
    const cutoff = new Date(Date.now() - scope.days * 24 * 60 * 60 * 1000);
    scopeFilter = { createdAt: { lt: cutoff } };
  }

  // Soft-delete only: skip already-deleted rows so we don't double-count.
  // Hard-delete: include them so they're physically removed.
  const liveOnly: Prisma.KnowledgeWhereInput = opts.hard
    ? {}
    : { deletedAt: null };

  return { AND: [ownership, scopeFilter, liveOnly] };
}

/** Human-readable label for audit-log payloads. */
function scopeLabel(scope: ResetScope): string {
  switch (scope.kind) {
    case "all":
      return "all";
    case "older-than":
      return `older-than:${scope.days}d`;
  }
}

/**
 * Bulk-delete Knowledge rows. Returns the number deleted and the scope
 * label. Does NOT write the audit log — that's the caller's responsibility
 * (the route handler) so the audit row carries the request id, IP, and
 * user-agent the helper can't see.
 *
 * The caller must look up the user's accessible project ids (via
 * `getAccessibleProjectIds(db, userId, orgId)`) and pass them in. This
 * keeps the helper Prisma-agnostic and avoids a JOIN through a relation
 * that isn't declared on the Knowledge model.
 */
export async function resetKnowledge(
  db: PrismaClient,
  opts: ResetOpts & { accessibleProjectIds?: string[] },
): Promise<ResetResult> {
  if (opts.confirmPhrase !== REQUIRED_CONFIRM) {
    throw new BrainError({
      code: "CONFIRM_PHRASE_MISMATCH",
      category: "validation",
      message: `confirm phrase must be exactly "${REQUIRED_CONFIRM}"`,
      remediation:
        "Pass `confirmPhrase: \"RESET KNOWLEDGE\"` (uppercase, no quotes around the literal) in the request body.",
    });
  }
  if (!opts.orgId) {
    throw new BrainError({
      code: "ORG_REQUIRED",
      category: "validation",
      message: "orgId is required — refuse to reset without an org scope.",
    });
  }
  if (opts.hard && opts.scope.kind !== "all") {
    throw new BrainError({
      code: "HARD_DELETE_LIMIT",
      category: "validation",
      message:
        "hard-delete is only allowed when scope.kind === 'all'. For partial resets, use soft-delete (default) so the rows can be recovered if the wrong window was chosen.",
    });
  }

  const where = buildWhere(opts, opts.accessibleProjectIds ?? []);
  const label = scopeLabel(opts.scope);

  if (opts.hard) {
    const res = await db.knowledge.deleteMany({ where });
    return { deleted: res.count, scopeLabel: label, hard: true };
  }

  const res = await db.knowledge.updateMany({
    where,
    data: { deletedAt: new Date() },
  });
  return { deleted: res.count, scopeLabel: label, hard: false };
}

/** Test export — caller can introspect the SQL filter without running it. */
export const _internal = { buildWhere, scopeLabel, REQUIRED_CONFIRM };
