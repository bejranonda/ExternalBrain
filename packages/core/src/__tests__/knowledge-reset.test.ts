import { describe, expect, it, vi } from "vitest";
import { resetKnowledge, _internal } from "../knowledge-reset.js";
import { BrainError } from "../logger.js";

const REQUIRED = "RESET KNOWLEDGE";

// Minimal Prisma stub. Only the two methods resetKnowledge calls.
function makeDbStub(updateCount = 0, deleteCount = 0) {
  return {
    knowledge: {
      updateMany: vi.fn().mockResolvedValue({ count: updateCount }),
      deleteMany: vi.fn().mockResolvedValue({ count: deleteCount }),
    },
  } as unknown as Parameters<typeof resetKnowledge>[0];
}

describe("resetKnowledge — guards", () => {
  it("refuses without the exact confirmation phrase", async () => {
    const db = makeDbStub();
    await expect(
      resetKnowledge(db, {
        userId: "u1",
        orgId: "o1",
        scope: { kind: "all" },
        confirmPhrase: "reset knowledge", // wrong case
      }),
    ).rejects.toMatchObject({ code: "CONFIRM_PHRASE_MISMATCH" });
  });

  it("refuses when orgId is missing", async () => {
    const db = makeDbStub();
    await expect(
      resetKnowledge(db, {
        userId: "u1",
        orgId: "",
        scope: { kind: "all" },
        confirmPhrase: REQUIRED,
      }),
    ).rejects.toMatchObject({ code: "ORG_REQUIRED" });
  });

  it("refuses hard-delete on partial scopes", async () => {
    const db = makeDbStub();
    await expect(
      resetKnowledge(db, {
        userId: "u1",
        orgId: "o1",
        scope: { kind: "older-than", days: 30 },
        hard: true,
        confirmPhrase: REQUIRED,
      }),
    ).rejects.toMatchObject({ code: "HARD_DELETE_LIMIT" });
  });

  it("refuses non-positive days for older-than", async () => {
    const db = makeDbStub();
    await expect(
      resetKnowledge(db, {
        userId: "u1",
        orgId: "o1",
        scope: { kind: "older-than", days: 0 },
        confirmPhrase: REQUIRED,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCOPE" });
    await expect(
      resetKnowledge(db, {
        userId: "u1",
        orgId: "o1",
        scope: { kind: "older-than", days: -7 },
        confirmPhrase: REQUIRED,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SCOPE" });
  });
});

describe("resetKnowledge — soft delete (default)", () => {
  it('all-scope sets deletedAt and skips already-deleted rows', async () => {
    const db = makeDbStub(42, 0);
    const r = await resetKnowledge(db, {
      userId: "u1",
      orgId: "o1",
      scope: { kind: "all" },
      confirmPhrase: REQUIRED,
    });
    expect(r).toEqual({ deleted: 42, scopeLabel: "all", hard: false });
    const call = (db.knowledge.updateMany as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.data).toEqual({ deletedAt: expect.any(Date) });
    // The buildWhere shape adds liveOnly so we re-check it covered.
    const json = JSON.stringify(call.where);
    expect(json).toContain('"deletedAt"');
    expect(json).toContain('"in":[]'); // accessibleProjectIds default is []
    expect(json).toContain('"u1"'); // userId in the personal-ownership branch
  });

  it("older-than:30 picks rows with createdAt < cutoff", async () => {
    const db = makeDbStub(8);
    const r = await resetKnowledge(db, {
      userId: "u1",
      orgId: "o1",
      scope: { kind: "older-than", days: 30 },
      confirmPhrase: REQUIRED,
    });
    expect(r.deleted).toBe(8);
    expect(r.scopeLabel).toBe("older-than:30d");
    const call = (db.knowledge.updateMany as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    const json = JSON.stringify(call.where);
    expect(json).toContain('"createdAt"');
    expect(json).toContain('"lt"');
  });
});

describe("resetKnowledge — hard delete", () => {
  it("all + hard removes rows physically and includes already-deleted ones", async () => {
    const db = makeDbStub(0, 100);
    const r = await resetKnowledge(db, {
      userId: "u1",
      orgId: "o1",
      scope: { kind: "all" },
      hard: true,
      confirmPhrase: REQUIRED,
    });
    expect(r).toEqual({ deleted: 100, scopeLabel: "all", hard: true });
    const call = (db.knowledge.deleteMany as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    // Hard-delete should NOT include deletedAt:null filter.
    expect(JSON.stringify(call.where)).not.toContain('"deletedAt":null');
  });
});

describe("internal helpers", () => {
  it("scopeLabel covers all variants", () => {
    expect(_internal.scopeLabel({ kind: "all" })).toBe("all");
    expect(_internal.scopeLabel({ kind: "older-than", days: 7 })).toBe(
      "older-than:7d",
    );
  });

  it("REQUIRED_CONFIRM is the documented literal", () => {
    expect(_internal.REQUIRED_CONFIRM).toBe("RESET KNOWLEDGE");
  });

  it("BrainError instances carry the helper's error codes", async () => {
    const db = makeDbStub();
    let caught: unknown;
    try {
      await resetKnowledge(db, {
        userId: "u1",
        orgId: "o1",
        scope: { kind: "older-than", days: 30 },
        confirmPhrase: "wrong",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BrainError);
    expect((caught as BrainError).code).toBe("CONFIRM_PHRASE_MISMATCH");
    expect((caught as BrainError).remediation).toMatch(/RESET KNOWLEDGE/);
  });
});
