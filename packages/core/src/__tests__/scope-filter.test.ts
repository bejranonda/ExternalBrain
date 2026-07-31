/**
 * Unit tests for packages/core/src/scope-filter.ts.
 *
 * Pure function tests — no DB, no I/O.
 */
import { describe, expect, it } from "vitest";
import {
  buildKnowledgeWhere,
  buildSessionWhere,
  buildProposalWhere,
  buildRawProjectFilter,
  buildRawProjectFilterV2,
  buildKnowledgeWhereV2,
} from "../scope-filter.js";

const USER = "user_abc";
const PROJECT = "proj_xyz";

// ---------------------------------------------------------------------------
// buildKnowledgeWhere
// ---------------------------------------------------------------------------

describe("buildKnowledgeWhere", () => {
  it('scope="project" includes ownerUserId + deletedAt + project OR clause', () => {
    const where = buildKnowledgeWhere(USER, PROJECT, "project") as {
      AND: unknown[];
    };
    expect(where).toHaveProperty("AND");
    const [base, projectFilter] = where.AND as [
      { ownerUserId: string; deletedAt: null },
      { OR: unknown[] },
    ];
    expect(base.ownerUserId).toBe(USER);
    expect(base.deletedAt).toBeNull();
    expect(projectFilter).toHaveProperty("OR");
  });

  it('scope="project" OR clause has projectId branch and null-project user branch', () => {
    const where = buildKnowledgeWhere(USER, PROJECT, "project") as {
      AND: [unknown, { OR: unknown[] }];
    };
    const orClauses = where.AND[1].OR;
    expect(orClauses).toHaveLength(2);
    // First branch: ownerProjectId = projectId
    expect(orClauses[0]).toEqual({ ownerProjectId: PROJECT });
    // Second branch: ownerProjectId IS NULL AND ownerUserId = userId
    expect(orClauses[1]).toEqual({
      AND: [{ ownerProjectId: null }, { ownerUserId: USER }],
    });
  });

  it('scope="all" returns only base filter (no project OR clause) when no accessibleProjectIds', () => {
    const where = buildKnowledgeWhere(USER, PROJECT, "all");
    expect(where).toEqual({ ownerUserId: USER, deletedAt: null });
  });

  it('scope="all" with accessibleProjectIds returns org-scoped OR filter', () => {
    const where = buildKnowledgeWhere(USER, PROJECT, "all", ["p1", "p2"]) as {
      AND: unknown[];
    };
    expect(where).toHaveProperty("AND");
    const [base, orFilter] = where.AND as [
      { deletedAt: null },
      { OR: unknown[] },
    ];
    expect(base.deletedAt).toBeNull();
    expect(orFilter).toHaveProperty("OR");
    const [projBranch, nullBranch] = (orFilter as { OR: unknown[] }).OR as [unknown, unknown];
    expect(projBranch).toEqual({ ownerProjectId: { in: ["p1", "p2"] } });
    expect(nullBranch).toEqual({
      AND: [{ ownerProjectId: null }, { ownerUserId: USER }],
    });
  });

  it('scope="all" with empty accessibleProjectIds falls back to base filter', () => {
    const where = buildKnowledgeWhere(USER, PROJECT, "all", []);
    expect(where).toEqual({ ownerUserId: USER, deletedAt: null });
  });

  it("defaults to project scope when scope argument is omitted", () => {
    const withDefault = buildKnowledgeWhere(USER, PROJECT) as { AND: unknown[] };
    const withExplicit = buildKnowledgeWhere(USER, PROJECT, "project") as { AND: unknown[] };
    expect(withDefault).toEqual(withExplicit);
  });

  it("different userId and projectId produce different filters", () => {
    const a = buildKnowledgeWhere("u1", "p1", "project");
    const b = buildKnowledgeWhere("u2", "p2", "project");
    expect(a).not.toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// buildSessionWhere
// ---------------------------------------------------------------------------

describe("buildSessionWhere", () => {
  it('scope="project" includes userId + project OR clause', () => {
    const where = buildSessionWhere(USER, PROJECT, "project") as {
      AND: unknown[];
    };
    expect(where).toHaveProperty("AND");
  });

  it('scope="project" OR clause matches projectId and null-project sessions', () => {
    const where = buildSessionWhere(USER, PROJECT, "project") as {
      AND: [{ userId: string }, { OR: unknown[] }];
    };
    expect(where.AND[0]).toEqual({ userId: USER });
    const [projBranch, nullBranch] = where.AND[1].OR as [unknown, unknown];
    expect(projBranch).toEqual({ projectId: PROJECT });
    expect(nullBranch).toEqual({ AND: [{ projectId: null }, { userId: USER }] });
  });

  it('scope="all" returns only userId base filter', () => {
    const where = buildSessionWhere(USER, PROJECT, "all");
    expect(where).toEqual({ userId: USER });
  });
});

// ---------------------------------------------------------------------------
// buildProposalWhere
// ---------------------------------------------------------------------------

describe("buildProposalWhere", () => {
  it('scope="project" wraps userId in AND + session relation filter', () => {
    const where = buildProposalWhere(USER, PROJECT, "project") as {
      AND: [{ userId: string }, { session: { OR: unknown[] } }];
    };
    expect(where.AND[0]).toEqual({ userId: USER });
    const [projBranch] = where.AND[1].session.OR as [unknown];
    expect(projBranch).toEqual({ projectId: PROJECT });
  });

  it('scope="all" returns only userId base filter', () => {
    const where = buildProposalWhere(USER, PROJECT, "all");
    expect(where).toEqual({ userId: USER });
  });
});

// ---------------------------------------------------------------------------
// buildRawProjectFilter
// ---------------------------------------------------------------------------

describe("buildRawProjectFilter", () => {
  it('scope="all" returns empty sql and empty params', () => {
    const result = buildRawProjectFilter(USER, PROJECT, "all", 3);
    expect(result.sql).toBe("");
    expect(result.params).toEqual([]);
  });

  it('scope="project" returns correct SQL fragment with positional params', () => {
    const result = buildRawProjectFilter(USER, PROJECT, "project", 3);
    expect(result.sql).toContain("$3");
    expect(result.sql).toContain("$4");
    expect(result.sql).toContain('"ownerProjectId"');
    expect(result.sql).toContain('"ownerUserId"');
    expect(result.params).toEqual([PROJECT, USER]);
  });

  it("startParam shifts positional parameters correctly", () => {
    const at5 = buildRawProjectFilter(USER, PROJECT, "project", 5);
    expect(at5.sql).toContain("$5");
    expect(at5.sql).toContain("$6");
    expect(at5.params).toEqual([PROJECT, USER]);
  });

  it('scope="project" SQL includes NULL check for ownerProjectId', () => {
    const { sql } = buildRawProjectFilter(USER, PROJECT, "project", 1);
    expect(sql).toContain("IS NULL");
  });
});

// ---------------------------------------------------------------------------
// buildRawProjectFilterV2 — the filter kra.ts / oracle.ts actually use
// ---------------------------------------------------------------------------

describe("buildRawProjectFilterV2 — cross-project reach of user-scope rows", () => {
  const args = (
    activeProjectId: string | null,
    accessible: string[] = [],
    optIn = false,
  ) => ({
    userId: USER,
    activeProjectId,
    activeOrgId: null,
    accessibleProjectIds: accessible,
    scope: "project" as const,
    includeUserScopeAcrossProjects: optIn,
  });

  const USER_SCOPE = /scope IN \('user',\s*'global'\)/;

  // The no-active-project branch got this unconditionally on 2026-05-12 after
  // 5/5 retrieval misses traced to it. Pins the precedent.
  it("always admits scope=user/global rows when there is no active project", () => {
    expect(buildRawProjectFilterV2(args(null), 3).sql).toMatch(USER_SCOPE);
  });

  // Default MUST stay closed: action-items.ts and meeting-extract.ts rely on
  // the project edge holding (2026-07-10 review finding 1; 2026-07-17 I2).
  it("does NOT widen under an active project unless opted in", () => {
    expect(buildRawProjectFilterV2(args(PROJECT), 3).sql).not.toMatch(USER_SCOPE);
    expect(buildRawProjectFilterV2(args(PROJECT, ["proj_other"]), 3).sql).not.toMatch(
      USER_SCOPE,
    );
  });

  it("admits scope=user/global rows when opted in, no org context", () => {
    expect(buildRawProjectFilterV2(args(PROJECT, [], true), 3).sql).toMatch(
      USER_SCOPE,
    );
  });

  it("admits scope=user/global rows when opted in, with org context", () => {
    const { sql } = buildRawProjectFilterV2(args(PROJECT, ["proj_other"], true), 3);
    expect(sql).toMatch(USER_SCOPE);
  });

  // Cross-tenant guard: widening project REACH must never widen user reach.
  // The user-scope disjunct sits inside an OR, so it has to carry its own
  // ownerUserId predicate — an outer AND would not constrain the other arms.
  it("pins the opted-in disjunct to ownerUserId itself", () => {
    for (const a of [args(PROJECT, [], true), args(PROJECT, ["proj_other"], true)]) {
      const { sql } = buildRawProjectFilterV2(a, 3);
      const line = sql.split("\n").find((l) => USER_SCOPE.test(l)) ?? "";
      expect(line).toContain('"ownerUserId"');
    }
  });

  // The no-project branch reaches the same guarantee differently: its whole
  // fragment is gated by a top-level `AND "ownerUserId" = $n` before the OR.
  it("constrains ownerUserId at the top level in the no-project branch", () => {
    const { sql } = buildRawProjectFilterV2(args(null), 3);
    expect(sql).toMatch(/AND\s+"ownerUserId"\s*=\s*\$\d+\s+AND\s+\(/);
  });

  // CodeRabbit #177: the opt-in must reach every branch that HAS a project
  // boundary, including scope="all" with an accessible-project list.
  it('applies the opt-in to scope="all" with accessible projects', () => {
    const allArgs = {
      userId: USER,
      activeProjectId: PROJECT,
      activeOrgId: null,
      accessibleProjectIds: ["proj_other"],
      scope: "all" as const,
    };
    expect(buildRawProjectFilterV2(allArgs, 3).sql).not.toMatch(USER_SCOPE);
    expect(
      buildRawProjectFilterV2({ ...allArgs, includeUserScopeAcrossProjects: true }, 3).sql,
    ).toMatch(USER_SCOPE);
  });

  it("params are unchanged by the opt-in (no new bind slots)", () => {
    const off = buildRawProjectFilterV2(args(PROJECT, ["proj_other"]), 3);
    const on = buildRawProjectFilterV2(args(PROJECT, ["proj_other"], true), 3);
    expect(on.params).toEqual(off.params);
  });
});

// ---------------------------------------------------------------------------
// buildKnowledgeWhereV2 — the Prisma-side twin of buildRawProjectFilterV2.
// Had no coverage at all before 2026-07-31 despite backing the knowledge
// listing route and action-items.
// ---------------------------------------------------------------------------

describe("buildKnowledgeWhereV2 — user-scope reach", () => {
  const args = (
    activeProjectId: string | null,
    accessible: string[] = [],
    optIn = false,
    scope: "project" | "all" = "project",
  ) => ({
    userId: USER,
    activeProjectId,
    activeOrgId: null,
    accessibleProjectIds: accessible,
    scope,
    includeUserScopeAcrossProjects: optIn,
  });

  /** The user-scope disjunct, as it appears in a serialised Prisma where. */
  const hasUserScope = (where: object) =>
    JSON.stringify(where).includes('{"scope":{"in":["user","global"]}}');

  it("does NOT widen under an active project unless opted in", () => {
    expect(hasUserScope(buildKnowledgeWhereV2(args(PROJECT)))).toBe(false);
    expect(hasUserScope(buildKnowledgeWhereV2(args(PROJECT, ["p2"])))).toBe(false);
  });

  it("widens under an active project when opted in", () => {
    expect(hasUserScope(buildKnowledgeWhereV2(args(PROJECT, [], true)))).toBe(true);
    expect(hasUserScope(buildKnowledgeWhereV2(args(PROJECT, ["p2"], true)))).toBe(true);
  });

  it('applies the opt-in to scope="all" too', () => {
    expect(hasUserScope(buildKnowledgeWhereV2(args(PROJECT, ["p2"], false, "all")))).toBe(false);
    expect(hasUserScope(buildKnowledgeWhereV2(args(PROJECT, ["p2"], true, "all")))).toBe(true);
  });

  // Parity with buildRawProjectFilterV2: with no active project there is no
  // boundary to enforce, so user/global rows are admitted regardless of the
  // flag. The raw helper has done this since 2026-05-12; the two must agree.
  it("admits user/global rows with no active project, even when not opted in", () => {
    expect(hasUserScope(buildKnowledgeWhereV2(args(null)))).toBe(true);
    const raw = buildRawProjectFilterV2(args(null), 3).sql;
    expect(raw).toMatch(/scope IN \('user',\s*'global'\)/);
  });

  it("pins the user-scope disjunct to ownerUserId", () => {
    const where = buildKnowledgeWhereV2(args(PROJECT, [], true));
    const json = JSON.stringify(where);
    const idx = json.indexOf('{"scope":{"in":["user","global"]}}');
    expect(json.slice(idx, idx + 120)).toContain(`"ownerUserId":"${USER}"`);
  });

  // Pre-existing divergence found in the 2026-07-31 review, not introduced by
  // #174/#180. scope="all" with no accessible-project list: the raw helper
  // returns everything the user owns, while the Prisma twin returned only
  // `private` + project-less rows — dropping the user's own `visibility:
  // 'project'` rows, which is the DEFAULT visibility. That contradicts the
  // documented ?scope=all contract in KNOWLEDGE §12.19. Reachable whenever
  // getAccessibleProjectIds() returns [] (org.ts: non-member short-circuit).
  it('scope="all" with no org context returns everything the user owns', () => {
    const a = {
      userId: USER,
      activeProjectId: PROJECT,
      activeOrgId: null,
      accessibleProjectIds: [] as string[],
      scope: "all" as const,
    };
    expect(buildKnowledgeWhereV2(a)).toEqual({ ownerUserId: USER, deletedAt: null });
    // The raw helper already behaved this way — this pins them together.
    expect(buildRawProjectFilterV2(a, 3).sql).toContain('"ownerUserId" = $3');
  });
});
