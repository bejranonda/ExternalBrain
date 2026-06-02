/**
 * scope-filter — buildKnowledgeWhere / buildSessionWhere helpers.
 *
 * Centralises the "active-project filter" rule:
 *   (ownerProjectId = activeProjectId)
 *   OR
 *   (ownerProjectId IS NULL AND ownerUserId = userId)
 *
 * When scope = "all" with accessibleProjectIds:
 *   (ownerProjectId IN accessibleProjectIds)
 *   OR
 *   (ownerProjectId IS NULL AND ownerUserId = userId)
 *
 * When scope = "all" without accessibleProjectIds, falls back to the legacy
 * behaviour (returns every row owned by the user across all projects).
 *
 * Phase 4 adds V2 helpers that understand the `visibility` field:
 *   - "private"  — only ownerUserId sees it
 *   - "project"  — visible inside ownerProjectId
 *   - "org"      — visible to any member across all projects in the org
 *
 * Helpers are pure functions that return a Prisma `where` object fragment — no
 * DB calls, no side effects. Tests live in __tests__/scope-filter.test.ts.
 */

export type DataScope = "project" | "all";

/**
 * Build the Prisma `where` fragment for Knowledge listings.
 *
 * @param userId                - The authenticated user's ID (always required).
 * @param projectId             - The active project ID. Ignored when scope = "all".
 * @param scope                 - "project" (default) applies the project filter;
 *                                "all" returns everything the user owns.
 * @param accessibleProjectIds  - When provided and scope = "all", filters to
 *                                knowledge owned by any of these project IDs OR
 *                                by the user with no project. Enables org-scoped
 *                                multi-user access (Phase 3a).
 */
export function buildKnowledgeWhere(
  userId: string,
  projectId: string,
  scope: DataScope = "project",
  accessibleProjectIds?: string[],
): object {
  const base = { ownerUserId: userId, deletedAt: null } as const;
  if (scope === "all") {
    if (accessibleProjectIds && accessibleProjectIds.length > 0) {
      // Org-scoped all: show knowledge for any project in the org OR user-level rows
      return {
        AND: [
          { deletedAt: null },
          {
            OR: [
              { ownerProjectId: { in: accessibleProjectIds } },
              { AND: [{ ownerProjectId: null }, { ownerUserId: userId }] },
            ],
          },
        ],
      };
    }
    return base;
  }
  return {
    AND: [
      base,
      {
        OR: [
          { ownerProjectId: projectId },
          { AND: [{ ownerProjectId: null }, { ownerUserId: userId }] },
        ],
      },
    ],
  };
}

/**
 * Build the Prisma `where` fragment for Session listings.
 *
 * Sessions use `projectId` (not `ownerProjectId`) and `userId` (not
 * `ownerUserId`).  The rule is otherwise the same.
 *
 * @param userId    - The authenticated user's ID.
 * @param projectId - The active project ID. Ignored when scope = "all".
 * @param scope     - "project" (default) | "all".
 */
export function buildSessionWhere(
  userId: string,
  projectId: string,
  scope: DataScope = "project",
): object {
  const base = { userId } as const;
  if (scope === "all") {
    return base;
  }
  return {
    AND: [
      base,
      {
        OR: [
          { projectId },
          { AND: [{ projectId: null }, { userId }] },
        ],
      },
    ],
  };
}

/**
 * Build the Prisma `where` fragment for AutoskillProposal listings.
 *
 * AutoskillProposal has no direct projectId column — proposals are
 * scoped to a project via their originating Session. Filter through
 * the `session` relation: a proposal belongs to the active project
 * iff its session's projectId matches (or the session has no project,
 * in which case it falls back to the proposal owner's user scope).
 */
export function buildProposalWhere(
  userId: string,
  projectId: string,
  scope: DataScope = "project",
): object {
  const base = { userId } as const;
  if (scope === "all") {
    return base;
  }
  return {
    AND: [
      base,
      {
        session: {
          OR: [
            { projectId },
            { AND: [{ projectId: null }, { userId }] },
          ],
        },
      },
    ],
  };
}

/**
 * Build the raw-SQL WHERE clause snippet for pgvector queries (kra.ts, oracle.ts).
 *
 * Returns the SQL fragment that should be appended after the existing
 * `AND "ownerUserId" = $N` filter. Uses positional parameter placeholders
 * starting at `startParam`.
 *
 * Example (startParam = 3):
 *   sql fragment: `AND ("ownerProjectId" = $3 OR ("ownerProjectId" IS NULL AND "ownerUserId" = $4))`
 *   params:       [projectId, userId]
 *
 * When scope = "all", returns `{ sql: "", params: [] }` — no extra clause.
 */
export function buildRawProjectFilter(
  userId: string,
  projectId: string,
  scope: DataScope,
  startParam: number,
): { sql: string; params: (string | null)[] } {
  if (scope === "all") {
    return { sql: "", params: [] };
  }
  const pProject = `$${startParam}`;
  const pUser = `$${startParam + 1}`;
  const sql = ` AND ("ownerProjectId" = ${pProject} OR ("ownerProjectId" IS NULL AND "ownerUserId" = ${pUser}))`;
  return { sql, params: [projectId, userId] };
}

// ============================================================
// Phase 4 — Visibility-aware V2 helpers
// ============================================================

export type KnowledgeVisibility = "private" | "project" | "org";

export interface VisibilityScopeArgs {
  userId: string;
  activeProjectId: string | null;
  activeOrgId: string | null;
  /** All project IDs in the active org that this user can access. */
  accessibleProjectIds: string[];
  scope: "project" | "all";
}

/**
 * Build the Prisma `where` fragment for Knowledge listings (Phase 4 V2).
 *
 * scope="project":
 *   (visibility="project" AND ownerProjectId=activeProjectId)
 *   OR (visibility="org" AND ownerProjectId IN accessibleProjectIds)
 *   OR (visibility="private" AND ownerUserId=userId AND ownerProjectId=activeProjectId)
 *   OR (ownerProjectId IS NULL AND ownerUserId=userId)   // legacy/personal rows
 *
 * scope="all":
 *   (visibility IN ('project','org') AND ownerProjectId IN accessibleProjectIds)
 *   OR (visibility="private" AND ownerUserId=userId)
 *   OR (ownerProjectId IS NULL AND ownerUserId=userId)
 */
export function buildKnowledgeWhereV2(args: VisibilityScopeArgs): object {
  const { userId, activeProjectId, accessibleProjectIds, scope } = args;

  // Legacy / personal rows (no project assigned) — always visible to owner.
  const legacyBranch = {
    AND: [{ ownerProjectId: null }, { ownerUserId: userId }],
  };

  if (scope === "all") {
    const orClauses: object[] = [];

    if (accessibleProjectIds.length > 0) {
      orClauses.push({
        AND: [
          { visibility: { in: ["project", "org"] } },
          { ownerProjectId: { in: accessibleProjectIds } },
        ],
      });
    }

    orClauses.push(
      {
        AND: [{ visibility: "private" }, { ownerUserId: userId }],
      },
      legacyBranch,
    );

    return {
      AND: [
        { deletedAt: null },
        { OR: orClauses },
      ],
    };
  }

  // scope="project"
  const orClauses: object[] = [];

  if (activeProjectId) {
    orClauses.push(
      {
        AND: [{ visibility: "project" }, { ownerProjectId: activeProjectId }],
      },
      {
        AND: [
          { visibility: "private" },
          { ownerUserId: userId },
          { ownerProjectId: activeProjectId },
        ],
      },
    );
  }

  if (accessibleProjectIds.length > 0) {
    orClauses.push({
      AND: [
        { visibility: "org" },
        { ownerProjectId: { in: accessibleProjectIds } },
      ],
    });
  }

  orClauses.push(legacyBranch);

  return {
    AND: [
      { deletedAt: null },
      { OR: orClauses },
    ],
  };
}

/**
 * Build the raw-SQL WHERE clause fragment for pgvector queries with Phase 4
 * visibility semantics (kra.ts, oracle.ts).
 *
 * Replaces `buildRawProjectFilter` for callers that have been migrated to V2.
 *
 * Positional parameter indices start at `startParam`.
 *
 * scope="project": params = [activeProjectId, userId, ...accessibleProjectIds]
 * scope="all":     params = [userId, ...accessibleProjectIds]
 */
export function buildRawProjectFilterV2(
  args: VisibilityScopeArgs,
  startParam: number,
): { sql: string; params: (string | null)[] } {
  const { userId, activeProjectId, accessibleProjectIds, scope } = args;

  if (scope === "all") {
    if (accessibleProjectIds.length === 0) {
      // No org context — show user-owned + personal rows only.
      const pUser = `$${startParam}`;
      const sql = ` AND ("ownerUserId" = ${pUser} AND "deletedAt" IS NULL)`;
      return { sql, params: [userId] };
    }

    // Build IN-list placeholders for accessible projects
    const inPlaceholders = accessibleProjectIds
      .map((_, i) => `$${startParam + 1 + i}`)
      .join(", ");
    const pUser = `$${startParam}`;
    const sql = ` AND "deletedAt" IS NULL AND (
      ("visibility" IN ('project','org') AND "ownerProjectId" IN (${inPlaceholders}))
      OR ("visibility" = 'private' AND "ownerUserId" = ${pUser})
      OR ("ownerProjectId" IS NULL AND "ownerUserId" = ${pUser})
    )`;
    return {
      sql,
      params: [userId, ...accessibleProjectIds],
    };
  }

  // scope="project"
  if (!activeProjectId) {
    // No active project — match user-owned rows whose declared scope is
    // cross-project (`user` or `global`), regardless of which project they
    // happened to be persisted under. The previous filter (only
    // `ownerProjectId IS NULL`) silently dropped any `scope='user'` row
    // that had an `ownerProjectId` set because the writing session was in
    // a project — the dominant pre-pilot case. This left clients with the
    // confusing symptom "the brain has knowledge but retrieval returns
    // nothing." Surfaced 2026-05-12 against the dev brain: 5/5 retrieval
    // misses traced to this branch.
    //
    // Project-scoped rows (`scope='project'`) still require the caller to
    // pass `projectId` — those are the rows genuinely locked to a single
    // project (frameworks, team-specific patterns).
    const pUser = `$${startParam}`;
    const sql = ` AND "deletedAt" IS NULL AND "ownerUserId" = ${pUser} AND (
      "ownerProjectId" IS NULL
      OR scope IN ('user', 'global')
    )`;
    return { sql, params: [userId] };
  }

  const pProject = `$${startParam}`;
  const pUser = `$${startParam + 1}`;

  if (accessibleProjectIds.length === 0) {
    // No org context — only this project's rows + personal.
    const sql = ` AND "deletedAt" IS NULL AND (
      ("visibility" IN ('project','private') AND "ownerProjectId" = ${pProject})
      OR ("ownerProjectId" IS NULL AND "ownerUserId" = ${pUser})
    )`;
    return { sql, params: [activeProjectId, userId] };
  }

  const inPlaceholders = accessibleProjectIds
    .map((_, i) => `$${startParam + 2 + i}`)
    .join(", ");

  const sql = ` AND "deletedAt" IS NULL AND (
    ("visibility" = 'project' AND "ownerProjectId" = ${pProject})
    OR ("visibility" = 'private' AND "ownerUserId" = ${pUser} AND "ownerProjectId" = ${pProject})
    OR ("visibility" = 'org' AND "ownerProjectId" IN (${inPlaceholders}))
    OR ("ownerProjectId" IS NULL AND "ownerUserId" = ${pUser})
  )`;

  return {
    sql,
    params: [activeProjectId, userId, ...accessibleProjectIds],
  };
}
