/**
 * Regression net for #229 — KEA persist paths must write an AuditLog
 * row so historical extractions are queryable by timestamp after
 * worker logs roll off.
 *
 * Skips cleanly when DB unreachable.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { writeAudit } from "../audit.js";

const dbReachable = await db.user.count().then(() => true).catch(() => false);
const guard = dbReachable ? describe : describe.skip;

guard("kea AuditLog writes — #229", () => {
  const cleanup: { auditIds: string[]; userIds: string[] } = {
    auditIds: [],
    userIds: [],
  };

  afterAll(async () => {
    for (const id of cleanup.auditIds) {
      await db.auditLog.delete({ where: { id } }).catch(() => {});
    }
    for (const id of cleanup.userIds) {
      await db.user.delete({ where: { id } }).catch(() => {});
    }
    await db.$disconnect().catch(() => {});
  });

  it("writeAudit('kea.extract_session') lands a row queryable by action prefix", async () => {
    const user = await db.user.create({
      data: { email: `kea-audit-${randomBytes(6).toString("hex")}@test.local` },
      select: { id: true },
    });
    cleanup.userIds.push(user.id);

    await writeAudit({
      action: "kea.extract_session",
      actorUserId: user.id,
      targetType: "Session",
      targetId: "test-session-id",
      payload: { llmFindings: 3, filterPassed: 2, persisted: 2, model: "test-model" },
    });

    const row = await db.auditLog.findFirst({
      where: { actorUserId: user.id, action: "kea.extract_session" },
      orderBy: { createdAt: "desc" },
    });
    expect(row, "AuditLog row must exist after writeAudit").not.toBeNull();
    expect(row!.action).toBe("kea.extract_session");
    expect(row!.targetType).toBe("Session");
    const payload = row!.payload as Record<string, unknown>;
    expect(payload.llmFindings).toBe(3);
    expect(payload.filterPassed).toBe(2);
    expect(payload.persisted).toBe(2);
    if (row) cleanup.auditIds.push(row.id);
  });

  it("the diagnostic-script query (action LIKE 'kea.%') now returns rows", async () => {
    // Before #229, this query was always empty. The previous test wrote one row.
    // We don't filter by userId here because the diagnostic script doesn't either —
    // we just need ANY kea.* row to prove `last_audit_kea_event_at` works.
    const count = await db.auditLog.count({
      where: { action: { startsWith: "kea." } },
    });
    expect(count, "kea.* audit rows must exist somewhere after #229").toBeGreaterThan(0);
  });
});
