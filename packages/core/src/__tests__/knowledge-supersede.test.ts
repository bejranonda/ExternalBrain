import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@brain/db";
import { supersedeKnowledge } from "../knowledge-stats.js";

function mockDb(superseded: { id: string; ownerUserId: string } | null) {
  const findFirst = vi.fn().mockResolvedValue(superseded);
  const update = vi.fn().mockResolvedValue({});
  const db = { knowledge: { findFirst, update } } as unknown as PrismaClient;
  return { db, findFirst, update };
}


describe("supersedeKnowledge", () => {
  it("retires the predecessor and links the successor when owned by the user", async () => {
    const { db, update } = mockDb({ id: "old", ownerUserId: "u1" });
    const linked = await supersedeKnowledge(db, {
      newId: "new",
      supersededId: "old",
      userId: "u1",
    });
    expect(linked).toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "old" },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "new" },
        data: { parentKnowledgeId: "old" },
      }),
    );
  });

  it("does nothing (no throw) when the supersede target is missing or not owned", async () => {
    const { db, update } = mockDb(null);
    const linked = await supersedeKnowledge(db, {
      newId: "new",
      supersededId: "ghost",
      userId: "u1",
    });
    expect(linked).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("includes ownerProjectId in the lookup when projectId is passed (2026-07-14 hardening)", async () => {
    const { db, findFirst } = mockDb({ id: "old", ownerUserId: "u1" });
    await supersedeKnowledge(db, {
      newId: "new",
      supersededId: "old",
      userId: "u1",
      projectId: "proj-a",
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "old",
          ownerUserId: "u1",
          ownerProjectId: "proj-a",
        }),
      }),
    );
  });

  it("omits ownerProjectId from the lookup when projectId is not passed (back-compat)", async () => {
    const { db, findFirst } = mockDb({ id: "old", ownerUserId: "u1" });
    await supersedeKnowledge(db, {
      newId: "new",
      supersededId: "old",
      userId: "u1",
    });
    const call = findFirst.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where).not.toHaveProperty("ownerProjectId");
  });
});
