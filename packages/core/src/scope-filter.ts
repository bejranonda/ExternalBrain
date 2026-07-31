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
  /**
   * Opt in to letting the caller's own `scope: 'user' | 'global'` rows reach
   * across project boundaries (#174). Default `false` — this MUST stay opt-in.
   *
   * **What it governs:** the branches that have a project boundary to cross —
   * every `scope: "project"` branch with an `activeProjectId`, plus the
   * `scope: "all"` + `accessibleProjectIds` branch. It does **not** gate the
   * no-`activeProjectId` branch, which includes `user`/`global` rows
   * unconditionally: with no active project there is no boundary to enforce,
   * and that behaviour predates this flag (added 2026-05-12 after 5/5 retrieval
   * misses). Gating it would resurrect that bug for every caller that doesn't
   * opt in. Likewise the `scope: "all"` + empty-`accessibleProjectIds` branch
   * already returns everything the user owns, so there is nothing to widen.
   *
   * Personal-rule retrieval (`kra.ts`, `oracle.ts`) wants it: without it, a
   * rule taught by `brain_teach_knowledge` (whose `scope` defaults to `"user"`)
   * from inside a project is invisible from every other project, which is the
   * "the brain has knowledge but retrieval returns nothing" symptom.
   *
   * Other callers deliberately do NOT want it, and enabling it for them would
   * breach reviewed boundaries: `action-items.ts` treats the project edge as
   * the isolation line for tasks (2026-07-10 review, finding 1), and
   * `meeting-extract.ts`'s supersession search is intentionally project-wide
   * and NOT owner-scoped, so widening would drag the caller's other projects'
   * decisions into a shared team surface. Per GUIDELINES §7: give cross-scope
   * behaviour an explicit path instead of quietly changing a shared helper.
   */
  includeUserScopeAcrossProjects?: boolean;
}

/**
 * Build the Prisma `where` fragment for Knowledge listings (Phase 4 V2).
 *
 * scope="project":
 *   (visibility="project" AND ownerProjectId=activeProjectId)
 *   OR (visibility="org" AND ownerProjectId IN accessibleProjectIds)
 *   OR (visibility="private" AND ownerUserId=userId AND ownerProjectId=activeProjectId)
 *   OR (ownerProjectId IS NULL AND ownerUserId=userId)   // legacy/personal rows
 *   OR (scope IN ('user','global') AND ownerUserId=userId)
 *       — only when `includeUserScopeAcrossProjects` is set, OR when there is
 *         no activeProjectId (no boundary to enforce). See #174.
 *
 * scope="all":
 *   (visibility IN ('project','org') AND ownerProjectId IN accessibleProjectIds)
 *   OR (visibility="private" AND ownerUserId=userId)
 *   OR (ownerProjectId IS NULL AND ownerUserId=userId)
 *   OR (scope IN ('user','global') AND ownerUserId=userId)   // opt-in only
 *
 * Mirrors `buildRawProjectFilterV2` clause for clause — the two are one policy
 * on two query surfaces, so a change here needs the same change there.
 */
export function buildKnowledgeWhereV2(args: VisibilityScopeArgs): object {
  const { userId, activeProjectId, accessibleProjectIds, scope } = args;

  // Legacy / personal rows (no project assigned) — always visible to owner.
  const legacyBranch = {
    AND: [{ ownerProjectId: null }, { ownerUserId: userId }],
  };

  // Rows whose declared scope is cross-project follow the user, wherever the
  // writing session happened to be. Without this, `scope:'user'` rows written
  // from inside a project (brain_teach_knowledge's default) are invisible from
  // every other project — the symptom "the brain has knowledge but retrieval
  // returns nothing". Stays pinned to ownerUserId: cross-project reach must
  // never become cross-user reach.
  const crossProject = args.includeUserScopeAcrossProjects === true;
  const userScopeBranch = {
    AND: [{ scope: { in: ["user", "global"] } }, { ownerUserId: userId }],
  };

  if (scope === "all") {
    // No org context — "all my projects" means exactly that: everything this
    // user owns. Matching buildRawProjectFilterV2's identical branch and the
    // documented ?scope=all contract (KNOWLEDGE §12.19). Enumerating clauses
    // here instead dropped the user's own `visibility: 'project'` rows — the
    // DEFAULT visibility — because none of the private/legacy arms matched
    // them. Reachable whenever getAccessibleProjectIds() short-circuits to []
    // for a non-member (org.ts). Fail-safe (under-reported, never leaked), but
    // wrong. Found in the 2026-07-31 review.
    if (accessibleProjectIds.length === 0) {
      return { ownerUserId: userId, deletedAt: null };
    }

    const orClauses: object[] = [];

    orClauses.push({
      AND: [
        { visibility: { in: ["project", "org"] } },
        { ownerProjectId: { in: accessibleProjectIds } },
      ],
    });

    orClauses.push(
      {
        AND: [{ visibility: "private" }, { ownerUserId: userId }],
      },
      legacyBranch,
      ...(crossProject ? [userScopeBranch] : []),
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
  // Parity with buildRawProjectFilterV2: with no active project there is no
  // boundary to enforce, so cross-project rows are admitted regardless of the
  // flag (that branch has behaved this way since 2026-05-12). With an active
  // project, the widening is opt-in. The two helpers must express one policy —
  // they back the same visibility rule on different query surfaces.
  if (crossProject || !activeProjectId) orClauses.push(userScopeBranch);

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
  const optedIn = args.includeUserScopeAcrossProjects === true;
  /** The cross-project disjunct, or "" when not opted in. Always user-pinned. */
  const userScope = (pUser: string, indent: string) =>
    optedIn ? `\n${indent}OR (scope IN ('user', 'global') AND "ownerUserId" = ${pUser})` : "";

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
      OR ("ownerProjectId" IS NULL AND "ownerUserId" = ${pUser})${userScope(pUser, "      ")}
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
      OR ("ownerProjectId" IS NULL AND "ownerUserId" = ${pUser})${userScope(pUser, "      ")}
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
    OR ("ownerProjectId" IS NULL AND "ownerUserId" = ${pUser})${userScope(pUser, "    ")}
  )`;

  return {
    sql,
    params: [activeProjectId, userId, ...accessibleProjectIds],
  };
}
