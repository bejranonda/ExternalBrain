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
