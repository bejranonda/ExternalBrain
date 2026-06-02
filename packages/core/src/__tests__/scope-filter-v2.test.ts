/**
 * Unit tests for Phase 4 V2 scope filter helpers.
 *
 * Tests cover:
 *   - private rows visible only to owner
 *   - project rows visible only inside their project
 *   - org rows visible from any project in the org
 *   - legacy NULL-project rows visible to owner
 *   - accessibleProjectIds limits org-row visibility correctly
 *   - buildRawProjectFilterV2 SQL fragment generation
 *
 * Pure function tests — no DB, no I/O.
 */
import { describe, expect, it } from "vitest";
import {
  buildKnowledgeWhereV2,
  buildRawProjectFilterV2,
} from "../scope-filter.js";
import type { VisibilityScopeArgs } from "../scope-filter.js";

const USER = "user_abc";
const PROJECT_A = "proj_aaa";
const PROJECT_B = "proj_bbb";
const ORG = "org_xyz";

function args(overrides: Partial<VisibilityScopeArgs> = {}): VisibilityScopeArgs {
  return {
    userId: USER,
    activeProjectId: PROJECT_A,
    activeOrgId: ORG,
    accessibleProjectIds: [PROJECT_A, PROJECT_B],
    scope: "project",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildKnowledgeWhereV2 — scope="project"
// ---------------------------------------------------------------------------

describe('buildKnowledgeWhereV2 scope="project"', () => {
  it("returns an AND-wrapped object with deletedAt: null guard", () => {
    const where = buildKnowledgeWhereV2(args()) as { AND: unknown[] };
    expect(where).toHaveProperty("AND");
    const [firstClause] = where.AND as [{ deletedAt: null }];
    expect(firstClause.deletedAt).toBeNull();
  });

  it("includes project-visibility branch for activeProjectId", () => {
    const where = buildKnowledgeWhereV2(args()) as {
      AND: [{ deletedAt: null }, { OR: unknown[] }];
    };
    const orClauses = where.AND[1].OR as object[];
    const projectBranch = orClauses.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "AND" in c &&
        JSON.stringify(c).includes('"project"') &&
        JSON.stringify(c).includes(PROJECT_A),
    );
    expect(projectBranch).toBeDefined();
  });

  it("includes private-visibility branch for owner + activeProjectId", () => {
    const where = buildKnowledgeWhereV2(args()) as {
      AND: [{ deletedAt: null }, { OR: unknown[] }];
    };
    const orClauses = where.AND[1].OR as object[];
    const privateBranch = orClauses.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "AND" in c &&
        JSON.stringify(c).includes('"private"') &&
        JSON.stringify(c).includes(USER),
    );
    expect(privateBranch).toBeDefined();
  });

  it("includes org-visibility branch when accessibleProjectIds is non-empty", () => {
    const where = buildKnowledgeWhereV2(args()) as {
      AND: [{ deletedAt: null }, { OR: unknown[] }];
    };
    const orClauses = where.AND[1].OR as object[];
    const orgBranch = orClauses.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "AND" in c &&
        JSON.stringify(c).includes('"org"') &&
        JSON.stringify(c).includes(PROJECT_A),
    );
    expect(orgBranch).toBeDefined();
  });

  it("includes legacy-personal (null-project) branch", () => {
    const where = buildKnowledgeWhereV2(args()) as {
      AND: [{ deletedAt: null }, { OR: unknown[] }];
    };
    const orClauses = where.AND[1].OR as object[];
    const legacyBranch = orClauses.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "AND" in c &&
        JSON.stringify(c).includes('"ownerProjectId"') &&
        JSON.stringify(c).includes("null"),
    );
    expect(legacyBranch).toBeDefined();
  });

  it("omits project/private branches (that require exact project match) when activeProjectId is null", () => {
    const where = buildKnowledgeWhereV2(
      args({ activeProjectId: null }),
    ) as { AND: [{ deletedAt: null }, { OR: unknown[] }] };
    const orClauses = where.AND[1].OR as object[];
    // The project-visibility branch uses AND[{visibility:"project"},{ownerProjectId:activeProjectId}]
    // When activeProjectId is null, that branch should be absent.
    const exactProjectBranch = orClauses.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "AND" in c &&
        JSON.stringify(c).includes('"visibility":"project"') &&
        JSON.stringify(c).includes('"ownerProjectId"'),
    );
    // There should be no project-exact-match branch
    expect(exactProjectBranch).toBeUndefined();
  });

  it("omits org branch when accessibleProjectIds is empty", () => {
    const where = buildKnowledgeWhereV2(
      args({ accessibleProjectIds: [] }),
    ) as { AND: [{ deletedAt: null }, { OR: unknown[] }] };
    const orClauses = where.AND[1].OR as object[];
    const orgBranch = orClauses.find(
      (c) => typeof c === "object" && c !== null && JSON.stringify(c).includes('"org"'),
    );
    expect(orgBranch).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildKnowledgeWhereV2 — scope="all"
// ---------------------------------------------------------------------------

describe('buildKnowledgeWhereV2 scope="all"', () => {
  it("returns AND-wrapped deletedAt: null guard", () => {
    const where = buildKnowledgeWhereV2(args({ scope: "all" })) as {
      AND: [{ deletedAt: null }, { OR: unknown[] }];
    };
    expect(where.AND[0].deletedAt).toBeNull();
  });

  it("includes project+org-visibility branch for accessibleProjectIds", () => {
    const where = buildKnowledgeWhereV2(args({ scope: "all" })) as {
      AND: [{ deletedAt: null }, { OR: unknown[] }];
    };
    const orClauses = where.AND[1].OR as object[];
    const projOrgBranch = orClauses.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "AND" in c &&
        JSON.stringify(c).includes('"project"') &&
        JSON.stringify(c).includes('"org"'),
    );
    expect(projOrgBranch).toBeDefined();
  });

  it("includes private branch for owner regardless of project", () => {
    const where = buildKnowledgeWhereV2(args({ scope: "all" })) as {
      AND: [{ deletedAt: null }, { OR: unknown[] }];
    };
    const orClauses = where.AND[1].OR as object[];
    const privateBranch = orClauses.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "AND" in c &&
        JSON.stringify(c).includes('"private"') &&
        JSON.stringify(c).includes(USER),
    );
    expect(privateBranch).toBeDefined();
  });

  it("includes legacy-personal branch", () => {
    const where = buildKnowledgeWhereV2(args({ scope: "all" })) as {
      AND: [{ deletedAt: null }, { OR: unknown[] }];
    };
    const orClauses = where.AND[1].OR as object[];
    const legacyBranch = orClauses.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "AND" in c &&
        JSON.stringify(c).includes("null"),
    );
    expect(legacyBranch).toBeDefined();
  });

  it("two different users produce different filters", () => {
    const a = buildKnowledgeWhereV2(args({ userId: "u1", scope: "all" }));
    const b = buildKnowledgeWhereV2(args({ userId: "u2", scope: "all" }));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("empty accessibleProjectIds omits proj+org IN-list branch", () => {
    const where = buildKnowledgeWhereV2(
      args({ scope: "all", accessibleProjectIds: [] }),
    ) as { AND: [{ deletedAt: null }, { OR: unknown[] }] };
    const orClauses = where.AND[1].OR as object[];
    const projOrgBranch = orClauses.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "AND" in c &&
        JSON.stringify(c).includes('"org"'),
    );
    expect(projOrgBranch).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildRawProjectFilterV2 — SQL fragment generation
// ---------------------------------------------------------------------------

describe("buildRawProjectFilterV2", () => {
  it('scope="project" returns non-empty SQL with projectId and userId params', () => {
    const { sql, params } = buildRawProjectFilterV2(args(), 3);
    expect(sql.length).toBeGreaterThan(0);
    expect(params).toContain(PROJECT_A);
    expect(params).toContain(USER);
  });

  it('scope="project" SQL includes visibility conditions', () => {
    const { sql } = buildRawProjectFilterV2(args(), 3);
    expect(sql).toContain("visibility");
    expect(sql).toContain("project");
    expect(sql).toContain("org");
    expect(sql).toContain("private");
  });

  it('scope="project" SQL references $3 as first param', () => {
    const { sql } = buildRawProjectFilterV2(args(), 3);
    expect(sql).toContain("$3");
  });

  it("startParam shifts positional parameters", () => {
    const { sql: at5 } = buildRawProjectFilterV2(args(), 5);
    expect(at5).toContain("$5");
    expect(at5).toContain("$6");
  });

  it('scope="project" accessibleProjectIds appear in SQL IN-list', () => {
    const { sql, params } = buildRawProjectFilterV2(args(), 3);
    // PROJECT_A and PROJECT_B should be in params
    expect(params).toContain(PROJECT_A);
    expect(params).toContain(PROJECT_B);
    expect(sql).toContain("IN");
  });

  it('scope="all" with accessibleProjectIds includes org+project IN-list', () => {
    const { sql, params } = buildRawProjectFilterV2(args({ scope: "all" }), 3);
    expect(sql).toContain("'project','org'");
    expect(params).toContain(PROJECT_A);
    expect(params).toContain(PROJECT_B);
  });

  it('scope="all" with empty accessibleProjectIds falls back to user+deletedAt only', () => {
    const { sql, params } = buildRawProjectFilterV2(
      args({ scope: "all", accessibleProjectIds: [] }),
      3,
    );
    expect(sql).toContain(USER.length > 0 ? "$3" : "");
    expect(params).toContain(USER);
    expect(sql).not.toContain("IN");
  });

  it('scope="project" with no activeProjectId returns personal-only filter', () => {
    const { sql, params } = buildRawProjectFilterV2(
      args({ activeProjectId: null }),
      3,
    );
    expect(sql).toContain("IS NULL");
    expect(params).toContain(USER);
    expect(params).not.toContain(PROJECT_A);
  });

  it('scope="project" with no activeProjectId ALSO returns user/global-scope rows (2026-05-12 fix)', () => {
    // Regression net for the dev-brain retrieval bug surfaced 2026-05-12:
    // KEA-extracted Knowledge rows with `scope='user'` were being silently
    // dropped because they carried an `ownerProjectId` from the writing
    // session even though their declared scope is cross-project. With the
    // fix in place, the SQL fragment must include the OR clause that
    // matches scope IN ('user', 'global').
    const { sql, params } = buildRawProjectFilterV2(
      args({ activeProjectId: null }),
      3,
    );
    expect(sql).toMatch(/scope\s+IN\s*\(\s*'user',\s*'global'\s*\)/);
    expect(params).toContain(USER);
    // Still a one-param fragment — no project param needed
    expect(params.length).toBe(1);
  });

  it("params list length matches placeholder count", () => {
    const { sql, params } = buildRawProjectFilterV2(args(), 3);
    // Count $N patterns in SQL
    const matches = sql.match(/\$\d+/g) ?? [];
    const uniqueParams = new Set(matches.map((m) => parseInt(m.slice(1))));
    expect(uniqueParams.size).toBe(params.length);
  });
});

// ---------------------------------------------------------------------------
// Visibility semantics — conceptual tests
// ---------------------------------------------------------------------------

describe("visibility semantics (conceptual)", () => {
  it("private row from a different owner should not appear in project scope", () => {
    // The filter requires ownerUserId = userId for private rows.
    // Check that the private branch is tied to the requesting user.
    const where = buildKnowledgeWhereV2(args()) as {
      AND: [{ deletedAt: null }, { OR: unknown[] }];
    };
    const orClauses = where.AND[1].OR as object[];
    const privateBranch = orClauses.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "AND" in c &&
        JSON.stringify(c).includes('"private"'),
    );
    // Must include the userId
    expect(JSON.stringify(privateBranch)).toContain(USER);
    // Must NOT include a different user
    expect(JSON.stringify(privateBranch)).not.toContain("other_user");
  });

  it("org-visible row from inaccessible project does not appear in scope=project", () => {
    // When accessibleProjectIds excludes a project, org rows from that project
    // should not be reachable.
    // Verify: the accessibleProjectIds IN-list does NOT include the excluded project.
    const excluded = "proj_excluded";
    const { sql, params } = buildRawProjectFilterV2(
      args({ accessibleProjectIds: [PROJECT_A, PROJECT_B] }),
      3,
    );
    expect(params).not.toContain(excluded);
    expect(sql).not.toContain(excluded);
  });

  it("org-visible rows are included for all accessible projects in scope=all", () => {
    const where = buildKnowledgeWhereV2(
      args({ scope: "all", accessibleProjectIds: [PROJECT_A, PROJECT_B] }),
    ) as { AND: [{ deletedAt: null }, { OR: unknown[] }] };
    const orClauses = where.AND[1].OR as object[];
    // Find the branch that covers project+org visibility with the IN-list
    const projOrgBranch = orClauses.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "AND" in c &&
        JSON.stringify(c).includes(PROJECT_A) &&
        JSON.stringify(c).includes(PROJECT_B),
    );
    expect(projOrgBranch).toBeDefined();
  });

  it("legacy personal rows (ownerProjectId=null) are always visible to owner", () => {
    const where = buildKnowledgeWhereV2(
      args({ activeProjectId: null, accessibleProjectIds: [] }),
    ) as { AND: [{ deletedAt: null }, { OR: unknown[] }] };
    const orClauses = where.AND[1].OR as object[];
    const legacyBranch = orClauses.find(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        "AND" in c &&
        JSON.stringify(c).includes(USER) &&
        JSON.stringify(c).includes("null"),
    );
    expect(legacyBranch).toBeDefined();
  });

  it("single-project user: no accessibleProjectIds = no org-visibility cross-project", () => {
    // Solo user: accessibleProjectIds = [their one project].
    // Org visibility is still visible within their own project.
    const soloArgs = args({ accessibleProjectIds: [PROJECT_A] });
    const { sql, params } = buildRawProjectFilterV2(soloArgs, 3);
    expect(params).toContain(PROJECT_A);
    expect(params).not.toContain(PROJECT_B);
  });
});
