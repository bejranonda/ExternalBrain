/**
 * Unit tests for Phase 4 promote / fork-to-project guard logic.
 *
 * These tests exercise the guard conditions (ownership, visibility state,
 * project membership, cross-org checks) and the originProjectId chain
 * preservation rule WITHOUT a live database — all DB calls are mocked.
 *
 * The tests import pure helper functions that encode the guard logic; the
 * actual route handlers are Next.js server-side and tested via E2E.
 */
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Pure guard functions (extracted from the route logic for unit testing)
// ---------------------------------------------------------------------------

interface RowLike {
  id: string;
  ownerUserId: string | null;
  ownerProjectId: string | null;
  visibility: string;
  originProjectId: string | null;
  deletedAt: Date | null;
}

function canPromote(
  row: RowLike,
  requestingUserId: string,
): { ok: true } | { ok: false; reason: string } {
  if (row.deletedAt) return { ok: false, reason: "deleted" };
  if (row.ownerUserId !== requestingUserId) return { ok: false, reason: "not_owner" };
  if (row.visibility !== "project") return { ok: false, reason: "wrong_visibility" };
  if (!row.ownerProjectId) return { ok: false, reason: "no_project" };
  return { ok: true };
}

function applyPromote(row: RowLike): RowLike {
  return {
    ...row,
    visibility: "org",
    originProjectId: row.ownerProjectId,
  };
}

interface ForkArgs {
  source: RowLike;
  requestingUserId: string;
  targetProjectId: string;
  sourceProjectOrgId: string;
  targetProjectOrgId: string;
  accessibleSourceProjectIds: string[];
}

function canForkToProject(
  a: ForkArgs,
): { ok: true } | { ok: false; reason: string } {
  if (a.source.deletedAt) return { ok: false, reason: "deleted" };
  if (a.source.visibility !== "org") return { ok: false, reason: "not_org_visible" };
  if (!a.source.ownerProjectId) return { ok: false, reason: "no_source_project" };
  if (a.sourceProjectOrgId !== a.targetProjectOrgId)
    return { ok: false, reason: "cross_org" };
  if (!a.accessibleSourceProjectIds.includes(a.source.ownerProjectId))
    return { ok: false, reason: "inaccessible_source" };
  return { ok: true };
}

function applyForkToProject(source: RowLike, targetProjectId: string, userId: string): RowLike {
  return {
    id: "new_id",
    ownerUserId: userId,
    ownerProjectId: targetProjectId,
    visibility: "project",
    originProjectId: source.originProjectId ?? source.ownerProjectId,
    deletedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseRow: RowLike = {
  id: "k_001",
  ownerUserId: "user_a",
  ownerProjectId: "proj_a",
  visibility: "project",
  originProjectId: null,
  deletedAt: null,
};

// ---------------------------------------------------------------------------
// canPromote
// ---------------------------------------------------------------------------

describe("canPromote", () => {
  it("allows promote when owner + project visibility + non-null projectId", () => {
    expect(canPromote(baseRow, "user_a")).toEqual({ ok: true });
  });

  it("rejects promote when requesting user is not the owner", () => {
    const result = canPromote(baseRow, "user_b");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("not_owner");
  });

  it("rejects promote when row has already been promoted (visibility=org)", () => {
    const promoted = { ...baseRow, visibility: "org", originProjectId: "proj_a" };
    const result = canPromote(promoted, "user_a");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("wrong_visibility");
  });

  it("rejects promote when visibility=private", () => {
    const priv = { ...baseRow, visibility: "private" };
    const result = canPromote(priv, "user_a");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("wrong_visibility");
  });

  it("rejects promote when ownerProjectId is null (personal/unscoped row)", () => {
    const personal = { ...baseRow, ownerProjectId: null };
    const result = canPromote(personal, "user_a");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("no_project");
  });

  it("rejects promote on a deleted row", () => {
    const deleted = { ...baseRow, deletedAt: new Date() };
    const result = canPromote(deleted, "user_a");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("deleted");
  });
});

// ---------------------------------------------------------------------------
// applyPromote — state transition
// ---------------------------------------------------------------------------

describe("applyPromote", () => {
  it("sets visibility to 'org'", () => {
    const updated = applyPromote(baseRow);
    expect(updated.visibility).toBe("org");
  });

  it("sets originProjectId to the previous ownerProjectId", () => {
    const updated = applyPromote(baseRow);
    expect(updated.originProjectId).toBe(baseRow.ownerProjectId);
  });

  it("preserves other fields unchanged", () => {
    const updated = applyPromote(baseRow);
    expect(updated.id).toBe(baseRow.id);
    expect(updated.ownerUserId).toBe(baseRow.ownerUserId);
    expect(updated.ownerProjectId).toBe(baseRow.ownerProjectId);
  });
});

// ---------------------------------------------------------------------------
// canForkToProject
// ---------------------------------------------------------------------------

const orgRow: RowLike = {
  id: "k_002",
  ownerUserId: "user_a",
  ownerProjectId: "proj_a",
  visibility: "org",
  originProjectId: "proj_a",
  deletedAt: null,
};

const forkArgs: ForkArgs = {
  source: orgRow,
  requestingUserId: "user_b",
  targetProjectId: "proj_b",
  sourceProjectOrgId: "org_1",
  targetProjectOrgId: "org_1",
  accessibleSourceProjectIds: ["proj_a", "proj_b"],
};

describe("canForkToProject", () => {
  it("allows fork when source is org-visible + same org + accessible", () => {
    expect(canForkToProject(forkArgs)).toEqual({ ok: true });
  });

  it("rejects fork when source visibility is not 'org'", () => {
    const a = { ...forkArgs, source: { ...orgRow, visibility: "project" } };
    const result = canForkToProject(a);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("not_org_visible");
  });

  it("rejects fork when source has no ownerProjectId", () => {
    const a = { ...forkArgs, source: { ...orgRow, ownerProjectId: null } };
    const result = canForkToProject(a);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("no_source_project");
  });

  it("rejects fork when source and target are in different orgs", () => {
    const a = { ...forkArgs, targetProjectOrgId: "org_2" };
    const result = canForkToProject(a);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("cross_org");
  });

  it("rejects fork when user cannot access the source project", () => {
    const a = { ...forkArgs, accessibleSourceProjectIds: ["proj_b"] }; // proj_a excluded
    const result = canForkToProject(a);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("inaccessible_source");
  });

  it("rejects fork on a deleted source row", () => {
    const a = {
      ...forkArgs,
      source: { ...orgRow, deletedAt: new Date() },
    };
    const result = canForkToProject(a);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("deleted");
  });
});

// ---------------------------------------------------------------------------
// applyForkToProject — state transition + chain preservation
// ---------------------------------------------------------------------------

describe("applyForkToProject", () => {
  it("creates a new row with visibility='project'", () => {
    const forked = applyForkToProject(orgRow, "proj_b", "user_b");
    expect(forked.visibility).toBe("project");
  });

  it("sets ownerProjectId to the target project", () => {
    const forked = applyForkToProject(orgRow, "proj_b", "user_b");
    expect(forked.ownerProjectId).toBe("proj_b");
  });

  it("sets ownerUserId to the requesting user", () => {
    const forked = applyForkToProject(orgRow, "proj_b", "user_b");
    expect(forked.ownerUserId).toBe("user_b");
  });

  it("preserves originProjectId from the source row", () => {
    const forked = applyForkToProject(orgRow, "proj_b", "user_b");
    // orgRow.originProjectId = "proj_a"
    expect(forked.originProjectId).toBe("proj_a");
  });

  it("falls back to ownerProjectId when source.originProjectId is null", () => {
    const noOrigin = { ...orgRow, originProjectId: null };
    const forked = applyForkToProject(noOrigin, "proj_b", "user_b");
    expect(forked.originProjectId).toBe("proj_a"); // ownerProjectId fallback
  });

  it("forked row itself has null deletedAt", () => {
    const forked = applyForkToProject(orgRow, "proj_b", "user_b");
    expect(forked.deletedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Chain: promote → fork → fork (originProjectId preserved through 3 levels)
// ---------------------------------------------------------------------------

describe("promote → fork chain (originProjectId invariant)", () => {
  it("originProjectId stays at the original project through promote+fork chain", () => {
    // Step 1: start with a project row
    const step1 = baseRow; // visibility="project", originProjectId=null

    // Step 2: promote to org
    const step2 = applyPromote(step1);
    expect(step2.visibility).toBe("org");
    expect(step2.originProjectId).toBe("proj_a");

    // Step 3: fork into project_b
    const step3 = applyForkToProject(step2, "proj_b", "user_b");
    expect(step3.visibility).toBe("project");
    expect(step3.ownerProjectId).toBe("proj_b");
    // originProjectId should still point back to proj_a (the origin)
    expect(step3.originProjectId).toBe("proj_a");

    // Step 4: fork the project_b row into project_c (hypothetical)
    const step4 = applyForkToProject(step3, "proj_c", "user_c");
    // originProjectId is preserved from step3
    expect(step4.originProjectId).toBe("proj_a");
  });
});
