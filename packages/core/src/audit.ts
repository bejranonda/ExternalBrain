/**
 * Audit log helper — write-and-forget audit trail for user-facing mutations.
 *
 * Design constraints:
 *   • Never throws outward — a logging failure must not break a mutation.
 *   • Redacts sensitive keys before persistence so operators can read
 *     logs safely and we never store credentials by accident.
 *   • Depth-limited traversal guards against cyclic object graphs that
 *     would otherwise cause unbounded recursion.
 */
import { db } from "@brain/db";
import { getLogger } from "./logger.js";

const log = getLogger("core");

// Known actions; append to the union as the surface grows.
export type Action =
  | "knowledge.create"
  | "knowledge.patch"
  | "knowledge.delete"
  | "knowledge.fork"
  | "knowledge.promote"
  | "knowledge.fork_to_project"
  | "token.create"
  | "token.revoke"
  | "token.change"
  | "token.scope_change"
  | "token.test"
  | "admin.gdpr_export"
  | "admin.gdpr_erase"
  | "admin.role_change"
  | "admin.user_list"
  | "admin.cost_ledger_view"
  | "admin.audit_log_view"
  | "autoskill.approve"
  | "autoskill.reject"
  | "voucher.create"
  | "voucher.update"
  | "voucher.delete"
  | "voucher.redeem"
  | "auth.signin_failed"
  | "auth.admin_bootstrap"
  | "project.create"
  | "project.update"
  | "project.delete"
  | "org.create"
  | "org.invite.create"
  | "org.invite.accept"
  | "org.invite.revoke"
  | "org.member.role"
  | "org.member.remove"
  | "user.register"
  | "user.password_change"
  | "user.password_reset_request"
  | "user.password_reset_complete";

// Keys whose values should never appear in audit payloads.
const REDACT_PATTERN = /token|secret|password|apiKey|authorization/i;

/**
 * Recursively strip sensitive keys up to `depth` levels.
 * Returns a plain object safe to store as Json.
 */
function redact(value: unknown, depth = 4): unknown {
  if (depth <= 0 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth - 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_PATTERN.test(k) ? "<redacted>" : redact(v, depth - 1);
  }
  return out;
}

export interface WriteAuditInput {
  actorUserId?: string | null;
  action: Action | string; // string fallback for ad-hoc callers
  targetType?: string | null;
  targetId?: string | null;
  payload?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
  // Phase 3c: optional scoping context for filtering in the admin audit view.
  orgId?: string | null;
  projectId?: string | null;
}

/**
 * Insert one AuditLog row. Catches all errors — a write failure emits a
 * structured warn but never bubbles up to the caller.
 */
export async function writeAudit(input: WriteAuditInput): Promise<void> {
  try {
    const redactedPayload = input.payload
      ? (redact(input.payload) as object)
      : null;
    await db.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        ...(redactedPayload !== null ? { payload: redactedPayload } : {}),
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        organizationId: input.orgId ?? null,
        projectId: input.projectId ?? null,
      },
    });
  } catch (err) {
    // Audit write failure is non-fatal — warn so operators can detect persistent
    // DB connectivity issues but the user-facing request proceeds normally.
    log.warn({ err, action: input.action }, "audit write failed");
  }
}
