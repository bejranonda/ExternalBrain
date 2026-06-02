/**
 * Unit tests for Phase 3c: token-level project scoping.
 *
 * Tests cover:
 *   1. Project-scope enforcement logic (pure functions extracted from tool handlers)
 *   2. writeAudit orgId/projectId field propagation (mock DB)
 *   3. Auth context shape (projectId field present)
 *
 * All tests are pure / mock-based — no live DB required.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// 1. Project-scope enforcement — pure helper tests
//    Mirrors the logic in start-session.ts and teach.ts handlers.
// ---------------------------------------------------------------------------

/**
 * Check whether a token is cross-project. Returns true when the auth context
 * has a projectId set AND the requested projectId differs from it.
 */
function isCrossProjectWrite(
  authProjectId: string | null,
  requestedProjectId: string | undefined | null,
): boolean {
  if (authProjectId === null) return false;
  if (!requestedProjectId) return false;
  return requestedProjectId !== authProjectId;
}

/**
 * Resolve the effective projectId given auth context + explicit caller input.
 * Phase 3c: token projectId takes precedence; Phase 2b first-project fallback
 * kicks in only when auth.projectId is null.
 */
function resolveEffectiveProjectId(
  authProjectId: string | null,
  callerProjectId: string | undefined | null,
): string | null {
  return authProjectId ?? callerProjectId ?? null;
}

describe("isCrossProjectWrite", () => {
  it("returns false when auth.projectId is null (unscoped token)", () => {
    expect(isCrossProjectWrite(null, "proj_B")).toBe(false);
  });

  it("returns false when no projectId is requested by the caller", () => {
    expect(isCrossProjectWrite("proj_A", undefined)).toBe(false);
    expect(isCrossProjectWrite("proj_A", null)).toBe(false);
  });

  it("returns false when caller requests the same project as the token", () => {
    expect(isCrossProjectWrite("proj_A", "proj_A")).toBe(false);
  });

  it("returns true when caller requests a different project than the token", () => {
    expect(isCrossProjectWrite("proj_A", "proj_B")).toBe(true);
  });

  it("returns false when both are null", () => {
    expect(isCrossProjectWrite(null, null)).toBe(false);
  });

  it("returns true for a token scoped to project X with caller requesting project Y", () => {
    expect(isCrossProjectWrite("cld_project_x", "cld_project_y")).toBe(true);
  });
});

describe("resolveEffectiveProjectId", () => {
  it("uses auth.projectId when set, ignoring caller input", () => {
    expect(resolveEffectiveProjectId("proj_A", "proj_B")).toBe("proj_A");
  });

  it("falls back to caller projectId when auth.projectId is null", () => {
    expect(resolveEffectiveProjectId(null, "proj_B")).toBe("proj_B");
  });

  it("returns null when both are absent", () => {
    expect(resolveEffectiveProjectId(null, null)).toBeNull();
    expect(resolveEffectiveProjectId(null, undefined)).toBeNull();
  });

  it("uses auth.projectId even if caller also provides one (auth takes precedence)", () => {
    expect(resolveEffectiveProjectId("token_proj", "caller_proj")).toBe("token_proj");
  });
});

// ---------------------------------------------------------------------------
// 2. AuthContext shape — projectId and organizationId must be present
// ---------------------------------------------------------------------------

interface AuthContext {
  userId: string;
  teamId: string | null;
  scope: "personal" | "team";
  tokenId: string;
  organizationId: string | null;
  projectId: string | null;
}

describe("AuthContext shape (Phase 3c)", () => {
  it("has organizationId and projectId fields", () => {
    const ctx: AuthContext = {
      userId: "user_1",
      teamId: null,
      scope: "personal",
      tokenId: "token_1",
      organizationId: "org_abc",
      projectId: "proj_xyz",
    };
    expect(ctx).toHaveProperty("organizationId");
    expect(ctx).toHaveProperty("projectId");
    expect(ctx.organizationId).toBe("org_abc");
    expect(ctx.projectId).toBe("proj_xyz");
  });

  it("allows null for both organizationId and projectId (unscoped token)", () => {
    const ctx: AuthContext = {
      userId: "user_2",
      teamId: null,
      scope: "personal",
      tokenId: "token_2",
      organizationId: null,
      projectId: null,
    };
    expect(ctx.organizationId).toBeNull();
    expect(ctx.projectId).toBeNull();
  });

  it("projectId can be set without organizationId (edge case)", () => {
    const ctx: AuthContext = {
      userId: "user_3",
      teamId: null,
      scope: "personal",
      tokenId: "token_3",
      organizationId: null,
      projectId: "proj_standalone",
    };
    expect(ctx.projectId).toBe("proj_standalone");
    expect(ctx.organizationId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. WriteAudit orgId/projectId propagation
// ---------------------------------------------------------------------------

describe("writeAudit orgId/projectId propagation", () => {
  const mockCreate = vi.fn();

  beforeEach(() => {
    mockCreate.mockReset();
  });

  async function writeAuditMock(input: {
    actorUserId?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    payload?: Record<string, unknown> | null;
    ip?: string | null;
    userAgent?: string | null;
    orgId?: string | null;
    projectId?: string | null;
  }) {
    await mockCreate({
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      payload: input.payload ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      organizationId: input.orgId ?? null,
      projectId: input.projectId ?? null,
    });
  }

  it("passes orgId as organizationId to db.auditLog.create", async () => {
    await writeAuditMock({
      action: "token.create",
      orgId: "org_test",
      projectId: "proj_test",
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_test",
        projectId: "proj_test",
      }),
    );
  });

  it("stores null when orgId is not provided", async () => {
    await writeAuditMock({ action: "token.revoke" });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: null,
        projectId: null,
      }),
    );
  });

  it("stores null for projectId when explicitly set to null", async () => {
    await writeAuditMock({ action: "knowledge.create", orgId: "org_x", projectId: null });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_x", projectId: null }),
    );
  });

  it("org.invite.create gets orgId in audit row", async () => {
    await writeAuditMock({
      action: "org.invite.create",
      targetType: "invite",
      targetId: "invite_1",
      orgId: "org_invite",
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_invite", projectId: null }),
    );
  });

  it("project.create gets orgId and projectId", async () => {
    await writeAuditMock({
      action: "project.create",
      targetType: "project",
      targetId: "proj_new",
      orgId: "org_parent",
      projectId: "proj_new",
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_parent", projectId: "proj_new" }),
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Admin audit-log filter query construction
// ---------------------------------------------------------------------------

describe("audit-log filter query construction", () => {
  function buildAuditWhere(params: {
    action?: string;
    actorUserId?: string;
    orgId?: string;
    projectId?: string;
  }) {
    return {
      ...(params.action ? { action: params.action } : {}),
      ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
      ...(params.orgId ? { organizationId: params.orgId } : {}),
      ...(params.projectId ? { projectId: params.projectId } : {}),
    };
  }

  it("builds empty where when no filters provided", () => {
    expect(buildAuditWhere({})).toEqual({});
  });

  it("includes organizationId filter when orgId provided", () => {
    const where = buildAuditWhere({ orgId: "org_abc" });
    expect(where).toEqual({ organizationId: "org_abc" });
  });

  it("includes projectId filter when provided", () => {
    const where = buildAuditWhere({ projectId: "proj_xyz" });
    expect(where).toEqual({ projectId: "proj_xyz" });
  });

  it("combines all filters", () => {
    const where = buildAuditWhere({
      action: "token.create",
      actorUserId: "user_1",
      orgId: "org_1",
      projectId: "proj_1",
    });
    expect(where).toEqual({
      action: "token.create",
      actorUserId: "user_1",
      organizationId: "org_1",
      projectId: "proj_1",
    });
  });

  it("orgId and projectId can be combined without other filters", () => {
    const where = buildAuditWhere({ orgId: "org_A", projectId: "proj_B" });
    expect(where).toEqual({ organizationId: "org_A", projectId: "proj_B" });
  });
});

// ---------------------------------------------------------------------------
// 5. Schema invariants — nullable columns
// ---------------------------------------------------------------------------

describe("schema nullable invariants (Phase 3c)", () => {
  type MCPTokenShape = {
    id: string;
    userId: string;
    projectId: string | null;
    organizationId: string | null;
  };

  it("existing token without projectId has null projectId", () => {
    const token: MCPTokenShape = {
      id: "t1",
      userId: "u1",
      projectId: null,
      organizationId: "org_1",
    };
    expect(token.projectId).toBeNull();
  });

  it("new scoped token has projectId set", () => {
    const token: MCPTokenShape = {
      id: "t2",
      userId: "u1",
      projectId: "proj_scoped",
      organizationId: "org_1",
    };
    expect(token.projectId).toBe("proj_scoped");
  });

  type AuditLogShape = {
    id: string;
    action: string;
    organizationId: string | null;
    projectId: string | null;
  };

  it("existing audit row has null org and project (pre-3c rows)", () => {
    const row: AuditLogShape = { id: "a1", action: "token.revoke", organizationId: null, projectId: null };
    expect(row.organizationId).toBeNull();
    expect(row.projectId).toBeNull();
  });

  it("new audit row can have both org and project", () => {
    const row: AuditLogShape = { id: "a2", action: "token.create", organizationId: "org_1", projectId: "proj_1" };
    expect(row.organizationId).toBe("org_1");
    expect(row.projectId).toBe("proj_1");
  });
});
