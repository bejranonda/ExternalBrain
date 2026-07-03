/**
 * Unit tests for the Organization helpers in packages/core/src/org.ts.
 *
 * No live database required. All tests use a minimal in-memory mock of the
 * Prisma client — only the methods exercised by the helpers are implemented.
 * Anything not stubbed throws so a missing mock surface is caught immediately.
 */
import { describe, expect, it } from "vitest";
import {
  ensurePersonalOrg,
  getUserOrgs,
  getUserProjects,
  requireOrgMember,
  isOrgOwner,
  ensureDefaultProject,
  ensureNamedProject,
  normalizeProjectName,
  findDuplicateProjectGroups,
  createOrg,
  slugify,
  uniqueSlugInOrg,
  uniqueOrgSlug,
} from "../org.js";
import { BrainError } from "../logger.js";

// ---------------------------------------------------------------------------
// In-memory data store + Prisma mock builder
// ---------------------------------------------------------------------------

type OrgRow = {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

type MemberRow = {
  id: string;
  orgId: string;
  userId: string;
  role: string;
  joinedAt: Date;
};

type UserRow = {
  id: string;
  name: string | null;
  email: string;
  createdAt: Date;
};

type ProjectRow = {
  id: string;
  organizationId: string;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  name: string;
  slug: string;
  framework: string | null;
  language: string | null;
  createdAt: Date;
};

interface Store {
  orgs: OrgRow[];
  members: MemberRow[];
  users: UserRow[];
  projects: ProjectRow[];
}

const BASE_DATE = new Date("2026-04-27T00:00:00.000Z");

function makeUser(partial: Partial<UserRow> = {}): UserRow {
  return {
    id: "cuid_user_01",
    name: "Alice",
    email: "alice@example.com",
    createdAt: BASE_DATE,
    ...partial,
  };
}

/**
 * Build a minimal Prisma mock wired to the given store.
 * Only the model methods called by org.ts are stubbed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMock(store: Store): any {
  // Track calls to transaction so we can assert it runs.
  const txLog: string[] = [];

  return {
    organizationMember: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; role?: string };
      }) => {
        return (
          store.members.find(
            (m) =>
              m.userId === where.userId &&
              (where.role === undefined || m.role === where.role),
          ) ?? null
        );
      },

      findUnique: async ({
        where,
      }: {
        where: { orgId_userId: { orgId: string; userId: string } };
      }) => {
        const { orgId, userId } = where.orgId_userId;
        return store.members.find((m) => m.orgId === orgId && m.userId === userId) ?? null;
      },

      findMany: async ({ where }: { where: { userId: string } }) => {
        const rows = store.members.filter((m) => m.userId === where.userId);
        return rows.map((m) => {
          const org = store.orgs.find((o) => o.id === m.orgId);
          if (!org) throw new Error(`org ${m.orgId} not found in store`);
          return {
            ...m,
            organization: {
              ...org,
              projects: store.projects
                .filter((p) => p.organizationId === org.id)
                .map((p) => ({ ...p })),
            },
          };
        });
      },

      upsert: async ({
        where,
        create,
      }: {
        where: { orgId_userId: { orgId: string; userId: string } };
        create: MemberRow;
      }) => {
        const { orgId, userId } = where.orgId_userId;
        const existing = store.members.find(
          (m) => m.orgId === orgId && m.userId === userId,
        );
        if (!existing) {
          store.members.push(create);
        }
        txLog.push("member.upsert");
      },

      create: async ({ data }: { data: Partial<MemberRow> & { orgId: string; userId: string; role: string } }) => {
        const row: MemberRow = {
          id: data.id ?? `om_${Math.random().toString(36).slice(2, 10)}`,
          orgId: data.orgId,
          userId: data.userId,
          role: data.role,
          joinedAt: data.joinedAt ?? new Date(),
        };
        store.members.push(row);
        txLog.push("member.create");
        return row;
      },
    },

    organization: {
      upsert: async ({
        where,
        create,
      }: {
        where: { id: string };
        create: OrgRow;
      }) => {
        const existing = store.orgs.find((o) => o.id === where.id);
        if (!existing) {
          store.orgs.push(create);
        }
        txLog.push("org.upsert");
      },

      findUnique: async ({
        where,
        select,
      }: {
        where: { slug?: string; id?: string };
        select?: Record<string, boolean>;
      }) => {
        const row =
          store.orgs.find(
            (o) =>
              (where.slug !== undefined && o.slug === where.slug) ||
              (where.id !== undefined && o.id === where.id),
          ) ?? null;
        if (!row || !select) return row;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const out: Record<string, any> = {};
        for (const k of Object.keys(select)) {
          if (select[k]) out[k] = (row as Record<string, unknown>)[k];
        }
        return out;
      },

      create: async ({
        data,
        select,
      }: {
        data: { id?: string; slug: string; name: string };
        select?: Record<string, boolean>;
      }) => {
        const row: OrgRow = {
          id: data.id ?? `org_${Math.random().toString(36).slice(2, 10)}`,
          slug: data.slug,
          name: data.name,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        store.orgs.push(row);
        txLog.push("org.create");
        if (!select) return row;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const out: Record<string, any> = {};
        for (const k of Object.keys(select)) {
          if (select[k]) out[k] = (row as Record<string, unknown>)[k];
        }
        return out;
      },
    },

    project: {
      findFirst: async ({
        where,
        orderBy,
      }: {
        where: { organizationId?: string; slug?: string; id?: { not?: string } };
        orderBy?: { createdAt?: "asc" | "desc" };
        select?: Record<string, boolean>;
      }) => {
        let rows = store.projects;
        if (where.organizationId) rows = rows.filter((p) => p.organizationId === where.organizationId);
        if (where.slug) rows = rows.filter((p) => p.slug === where.slug);
        if (where.id?.not) rows = rows.filter((p) => p.id !== where.id?.not);
        if (orderBy?.createdAt === "asc") {
          rows = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        }
        return rows[0] ?? null;
      },

      findMany: async ({
        where,
        select,
      }: {
        where: { organizationId?: string };
        select?: Record<string, boolean>;
      }) => {
        let rows = store.projects;
        if (where.organizationId) rows = rows.filter((p) => p.organizationId === where.organizationId);
        if (!select) return rows.map((p) => ({ ...p }));
        return rows.map((p) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const out: Record<string, any> = {};
          for (const k of Object.keys(select)) {
            if (select[k]) out[k] = (p as Record<string, unknown>)[k];
          }
          return out;
        });
      },

      create: async ({
        data,
        select,
      }: {
        data: Omit<ProjectRow, "id"> & { id?: string };
        select?: Record<string, boolean>;
      }) => {
        const row: ProjectRow = {
          id: data.id ?? `proj_${Math.random().toString(36).slice(2, 10)}`,
          organizationId: data.organizationId,
          ownerUserId: data.ownerUserId ?? null,
          ownerTeamId: data.ownerTeamId ?? null,
          name: data.name,
          slug: data.slug,
          framework: data.framework ?? null,
          language: data.language ?? null,
          createdAt: data.createdAt instanceof Date ? data.createdAt : new Date(),
        };
        store.projects.push(row);
        if (!select) return row;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const out: Record<string, any> = {};
        for (const k of Object.keys(select)) {
          if (select[k]) out[k] = (row as Record<string, unknown>)[k];
        }
        return out;
      },
    },

    user: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const user = store.users.find((u) => u.id === where.id);
        if (!user) throw new Error(`User ${where.id} not found`);
        return user;
      },
    },

    // Minimal $transaction: run the callback with a fresh client over the same
    // store and RETURN its result (real Prisma resolves to the callback's
    // return value — createOrg relies on this).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      return fn(makeMock(store));
    },

    _txLog: txLog,
  };
}

// ---------------------------------------------------------------------------
// ensurePersonalOrg
// ---------------------------------------------------------------------------

describe("ensurePersonalOrg", () => {
  it("creates org + membership on first call, returns created: true", async () => {
    const store: Store = {
      orgs: [],
      members: [],
      users: [makeUser()],
      projects: [],
    };
    const db = makeMock(store);

    const result = await ensurePersonalOrg(db, "cuid_user_01");

    expect(result.created).toBe(true);
    expect(result.orgId).toBe("org_cuid_user_01");
    expect(store.orgs).toHaveLength(1);
    expect(store.orgs[0]?.id).toBe("org_cuid_user_01");
    expect(store.members).toHaveLength(1);
    expect(store.members[0]?.role).toBe("owner");
  });

  it("is idempotent — second call returns same orgId, created: false", async () => {
    const store: Store = {
      orgs: [
        {
          id: "org_cuid_user_01",
          slug: "personal-uid_user_01",
          name: "Alice",
          createdAt: BASE_DATE,
          updatedAt: BASE_DATE,
        },
      ],
      members: [
        {
          id: "om_cuid_user_01",
          orgId: "org_cuid_user_01",
          userId: "cuid_user_01",
          role: "owner",
          joinedAt: BASE_DATE,
        },
      ],
      users: [makeUser()],
      projects: [],
    };
    const db = makeMock(store);

    // First call.
    const first = await ensurePersonalOrg(db, "cuid_user_01");
    expect(first.created).toBe(false);
    expect(first.orgId).toBe("org_cuid_user_01");

    // Second call — same result.
    const second = await ensurePersonalOrg(db, "cuid_user_01");
    expect(second.created).toBe(false);
    expect(second.orgId).toBe("org_cuid_user_01");

    // Store untouched.
    expect(store.orgs).toHaveLength(1);
    expect(store.members).toHaveLength(1);
  });

  it("uses email prefix when user.name is null", async () => {
    const store: Store = {
      orgs: [],
      members: [],
      users: [makeUser({ name: null, email: "bob@example.com" })],
      projects: [],
    };
    const db = makeMock(store);

    await ensurePersonalOrg(db, "cuid_user_01");

    expect(store.orgs[0]?.name).toBe("bob");
  });
});

// ---------------------------------------------------------------------------
// createOrg
// ---------------------------------------------------------------------------

describe("createOrg", () => {
  it("creates the org, an owner membership, and a default project", async () => {
    const store: Store = { orgs: [], members: [], users: [makeUser()], projects: [] };
    const db = makeMock(store);

    const result = await createOrg(db, "cuid_user_01", "Acme Inc.");

    expect(result.slug).toBe("acme-inc");
    expect(result.name).toBe("Acme Inc.");
    expect(result.projectSlug).toBe("default");

    expect(store.orgs).toHaveLength(1);
    expect(store.members).toHaveLength(1);
    expect(store.members[0]).toMatchObject({
      orgId: result.orgId,
      userId: "cuid_user_01",
      role: "owner",
    });
    expect(store.projects).toHaveLength(1);
    expect(store.projects[0]).toMatchObject({
      organizationId: result.orgId,
      ownerUserId: "cuid_user_01",
      slug: "default",
    });
  });

  it("derives a globally-unique slug when the base slug is taken", async () => {
    const store: Store = {
      orgs: [
        { id: "org_existing", slug: "acme", name: "Acme", createdAt: BASE_DATE, updatedAt: BASE_DATE },
      ],
      members: [],
      users: [makeUser()],
      projects: [],
    };
    const db = makeMock(store);

    const result = await createOrg(db, "cuid_user_01", "Acme");

    expect(result.slug).toBe("acme-2");
  });

  it("trims the name and rejects an empty one", async () => {
    const store: Store = { orgs: [], members: [], users: [makeUser()], projects: [] };
    const db = makeMock(store);

    await expect(createOrg(db, "cuid_user_01", "   ")).rejects.toBeInstanceOf(BrainError);
    expect(store.orgs).toHaveLength(0);
  });

  it("rejects a name longer than 120 characters", async () => {
    const store: Store = { orgs: [], members: [], users: [makeUser()], projects: [] };
    const db = makeMock(store);

    await expect(createOrg(db, "cuid_user_01", "x".repeat(121))).rejects.toBeInstanceOf(BrainError);
    expect(store.orgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// uniqueOrgSlug
// ---------------------------------------------------------------------------

describe("uniqueOrgSlug", () => {
  it("returns the candidate when free", async () => {
    const store: Store = { orgs: [], members: [], users: [makeUser()], projects: [] };
    const db = makeMock(store);
    expect(await uniqueOrgSlug(db, "fresh")).toBe("fresh");
  });

  it("appends an incrementing suffix past collisions", async () => {
    const store: Store = {
      orgs: [
        { id: "o1", slug: "team", name: "T", createdAt: BASE_DATE, updatedAt: BASE_DATE },
        { id: "o2", slug: "team-2", name: "T2", createdAt: BASE_DATE, updatedAt: BASE_DATE },
      ],
      members: [],
      users: [makeUser()],
      projects: [],
    };
    const db = makeMock(store);
    expect(await uniqueOrgSlug(db, "team")).toBe("team-3");
  });
});

// ---------------------------------------------------------------------------
// getUserOrgs
// ---------------------------------------------------------------------------

describe("getUserOrgs", () => {
  it("returns the org for a member", async () => {
    const store: Store = {
      orgs: [
        {
          id: "org_cuid_user_01",
          slug: "personal-abc",
          name: "Alice",
          createdAt: BASE_DATE,
          updatedAt: BASE_DATE,
        },
      ],
      members: [
        {
          id: "om_cuid_user_01",
          orgId: "org_cuid_user_01",
          userId: "cuid_user_01",
          role: "owner",
          joinedAt: BASE_DATE,
        },
      ],
      users: [makeUser()],
      projects: [],
    };
    const db = makeMock(store);

    const result = await getUserOrgs(db, "cuid_user_01");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      orgId: "org_cuid_user_01",
      slug: "personal-abc",
      name: "Alice",
      role: "owner",
    });
  });

  it("returns empty array for a non-member", async () => {
    const store: Store = {
      orgs: [],
      members: [],
      users: [makeUser()],
      projects: [],
    };
    const db = makeMock(store);

    const result = await getUserOrgs(db, "cuid_user_01");
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// requireOrgMember
// ---------------------------------------------------------------------------

describe("requireOrgMember", () => {
  it("returns role for a valid member", async () => {
    const store: Store = {
      orgs: [],
      members: [
        {
          id: "om_1",
          orgId: "org_abc",
          userId: "cuid_user_01",
          role: "admin",
          joinedAt: BASE_DATE,
        },
      ],
      users: [],
      projects: [],
    };
    const db = makeMock(store);

    const result = await requireOrgMember(db, "cuid_user_01", "org_abc");
    expect(result.role).toBe("admin");
  });

  it("throws BrainError FORBIDDEN_ORG for a non-member", async () => {
    const store: Store = { orgs: [], members: [], users: [], projects: [] };
    const db = makeMock(store);

    await expect(
      requireOrgMember(db, "cuid_user_01", "org_abc"),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof BrainError)) return false;
      return err.code === "FORBIDDEN_ORG" && err.category === "auth" && err.retryable === false;
    });
  });

  it("FORBIDDEN_ORG has status 403", async () => {
    const store: Store = { orgs: [], members: [], users: [], projects: [] };
    const db = makeMock(store);

    await expect(
      requireOrgMember(db, "cuid_user_01", "org_abc"),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof BrainError)) return false;
      return err.status === 403;
    });
  });
});

// ---------------------------------------------------------------------------
// isOrgOwner
// ---------------------------------------------------------------------------

describe("isOrgOwner", () => {
  function makeStore(role: string): Store {
    return {
      orgs: [],
      members: [
        {
          id: "om_1",
          orgId: "org_abc",
          userId: "cuid_user_01",
          role,
          joinedAt: BASE_DATE,
        },
      ],
      users: [],
      projects: [],
    };
  }

  it("returns true for the owner role", async () => {
    const db = makeMock(makeStore("owner"));
    expect(await isOrgOwner(db, "cuid_user_01", "org_abc")).toBe(true);
  });

  it("returns false for the admin role", async () => {
    const db = makeMock(makeStore("admin"));
    expect(await isOrgOwner(db, "cuid_user_01", "org_abc")).toBe(false);
  });

  it("returns false for the member role", async () => {
    const db = makeMock(makeStore("member"));
    expect(await isOrgOwner(db, "cuid_user_01", "org_abc")).toBe(false);
  });

  it("returns false for a non-member (no row)", async () => {
    const store: Store = { orgs: [], members: [], users: [], projects: [] };
    const db = makeMock(store);
    expect(await isOrgOwner(db, "cuid_user_01", "org_abc")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("lowercases and replaces non-alphanumeric with dashes", () => {
    expect(slugify("My Awesome Project")).toBe("my-awesome-project");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify("---hello---")).toBe("hello");
  });

  it("collapses multiple non-alphanumeric chars into one dash", () => {
    expect(slugify("hello   world!!!")).toBe("hello-world");
  });

  it("returns 'project' for all-non-alphanumeric input", () => {
    expect(slugify("---")).toBe("project");
    expect(slugify("")).toBe("project");
  });

  it("preserves numbers", () => {
    expect(slugify("Project 42 Beta")).toBe("project-42-beta");
  });
});

// ---------------------------------------------------------------------------
// uniqueSlugInOrg
// ---------------------------------------------------------------------------

describe("uniqueSlugInOrg", () => {
  it("returns the candidate slug when no collision exists", async () => {
    const store: Store = {
      orgs: [],
      members: [],
      users: [],
      projects: [],
    };
    const db = makeMock(store);
    const slug = await uniqueSlugInOrg(db, "org_abc", "my-project");
    expect(slug).toBe("my-project");
  });

  it("appends -2 on collision", async () => {
    const store: Store = {
      orgs: [],
      members: [],
      users: [],
      projects: [
        {
          id: "proj_01",
          organizationId: "org_abc",
          ownerUserId: "cuid_user_01",
          ownerTeamId: null,
          name: "My Project",
          slug: "my-project",
          framework: null,
          language: null,
          createdAt: BASE_DATE,
        },
      ],
    };
    const db = makeMock(store);
    const slug = await uniqueSlugInOrg(db, "org_abc", "my-project");
    expect(slug).toBe("my-project-2");
  });

  it("excludeProjectId allows the same project to keep its slug during rename", async () => {
    const store: Store = {
      orgs: [],
      members: [],
      users: [],
      projects: [
        {
          id: "proj_01",
          organizationId: "org_abc",
          ownerUserId: "cuid_user_01",
          ownerTeamId: null,
          name: "My Project",
          slug: "my-project",
          framework: null,
          language: null,
          createdAt: BASE_DATE,
        },
      ],
    };
    const db = makeMock(store);
    // Excluding proj_01 itself — the collision check skips it.
    const slug = await uniqueSlugInOrg(db, "org_abc", "my-project", "proj_01");
    expect(slug).toBe("my-project");
  });
});

// ---------------------------------------------------------------------------
// getUserProjects
// ---------------------------------------------------------------------------

describe("getUserProjects", () => {
  it("returns projects for each org the user is a member of", async () => {
    const store: Store = {
      orgs: [
        {
          id: "org_cuid_user_01",
          slug: "personal-abc",
          name: "Alice Personal",
          createdAt: BASE_DATE,
          updatedAt: BASE_DATE,
        },
      ],
      members: [
        {
          id: "om_01",
          orgId: "org_cuid_user_01",
          userId: "cuid_user_01",
          role: "owner",
          joinedAt: BASE_DATE,
        },
      ],
      users: [makeUser()],
      projects: [
        {
          id: "proj_01",
          organizationId: "org_cuid_user_01",
          ownerUserId: "cuid_user_01",
          ownerTeamId: null,
          name: "Default",
          slug: "default",
          framework: null,
          language: null,
          createdAt: BASE_DATE,
        },
      ],
    };
    const db = makeMock(store);

    const result = await getUserProjects(db, "cuid_user_01");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "proj_01",
      slug: "default",
      name: "Default",
      orgSlug: "personal-abc",
      orgName: "Alice Personal",
      orgRole: "owner",
      isOwn: true,
    });
  });

  it("marks isOwn false for projects owned by another user", async () => {
    const store: Store = {
      orgs: [
        {
          id: "org_other",
          slug: "team-org",
          name: "Team Org",
          createdAt: BASE_DATE,
          updatedAt: BASE_DATE,
        },
      ],
      members: [
        {
          id: "om_member",
          orgId: "org_other",
          userId: "cuid_user_01",
          role: "member",
          joinedAt: BASE_DATE,
        },
      ],
      users: [makeUser()],
      projects: [
        {
          id: "proj_team",
          organizationId: "org_other",
          ownerUserId: "cuid_user_02", // different user
          ownerTeamId: null,
          name: "Team Project",
          slug: "team-project",
          framework: null,
          language: null,
          createdAt: BASE_DATE,
        },
      ],
    };
    const db = makeMock(store);

    const result = await getUserProjects(db, "cuid_user_01");

    expect(result).toHaveLength(1);
    expect(result[0]?.isOwn).toBe(false);
  });

  it("returns empty array when user has no org memberships", async () => {
    const store: Store = {
      orgs: [],
      members: [],
      users: [makeUser()],
      projects: [],
    };
    const db = makeMock(store);

    const result = await getUserProjects(db, "cuid_user_01");
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ensureDefaultProject
// ---------------------------------------------------------------------------

describe("ensureDefaultProject", () => {
  it("creates a default project when none exists", async () => {
    const store: Store = {
      orgs: [
        {
          id: "org_cuid_user_01",
          slug: "personal-abc",
          name: "Alice",
          createdAt: BASE_DATE,
          updatedAt: BASE_DATE,
        },
      ],
      members: [
        {
          id: "om_01",
          orgId: "org_cuid_user_01",
          userId: "cuid_user_01",
          role: "owner",
          joinedAt: BASE_DATE,
        },
      ],
      users: [makeUser()],
      projects: [],
    };
    const db = makeMock(store);

    const result = await ensureDefaultProject(db, "cuid_user_01");

    expect(result.created).toBe(true);
    expect(result.slug).toBe("default");
    expect(store.projects).toHaveLength(1);
    expect(store.projects[0]?.name).toBe("Default");
  });

  it("is idempotent — returns existing project on second call", async () => {
    const store: Store = {
      orgs: [
        {
          id: "org_cuid_user_01",
          slug: "personal-abc",
          name: "Alice",
          createdAt: BASE_DATE,
          updatedAt: BASE_DATE,
        },
      ],
      members: [
        {
          id: "om_01",
          orgId: "org_cuid_user_01",
          userId: "cuid_user_01",
          role: "owner",
          joinedAt: BASE_DATE,
        },
      ],
      users: [makeUser()],
      projects: [
        {
          id: "proj_existing",
          organizationId: "org_cuid_user_01",
          ownerUserId: "cuid_user_01",
          ownerTeamId: null,
          name: "My App",
          slug: "my-app",
          framework: null,
          language: null,
          createdAt: BASE_DATE,
        },
      ],
    };
    const db = makeMock(store);

    const first = await ensureDefaultProject(db, "cuid_user_01");
    const second = await ensureDefaultProject(db, "cuid_user_01");

    expect(first.created).toBe(false);
    expect(first.projectId).toBe("proj_existing");
    expect(second.created).toBe(false);
    expect(second.projectId).toBe("proj_existing");
    // No new projects were created.
    expect(store.projects).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// normalizeProjectName + ensureNamedProject normalized matching
// ---------------------------------------------------------------------------

describe("normalizeProjectName", () => {
  it("strips case, whitespace, and punctuation", () => {
    expect(normalizeProjectName("Brain Platform")).toBe("brainplatform");
    expect(normalizeProjectName("BrainPlatform")).toBe("brainplatform");
    expect(normalizeProjectName("brain-platform!")).toBe("brainplatform");
  });

  it("keeps genuinely distinct names distinct", () => {
    expect(normalizeProjectName("External Brain")).not.toBe(
      normalizeProjectName("Brain Platform"),
    );
  });

  it("returns empty string for all-punctuation input", () => {
    expect(normalizeProjectName("--- !!!")).toBe("");
  });
});

describe("ensureNamedProject normalized matching", () => {
  function seededStore(): Store {
    return {
      orgs: [
        {
          id: "org_cuid_user_01",
          slug: "personal-abc",
          name: "Alice",
          createdAt: BASE_DATE,
          updatedAt: BASE_DATE,
        },
      ],
      members: [
        {
          id: "om_01",
          orgId: "org_cuid_user_01",
          userId: "cuid_user_01",
          role: "owner",
          joinedAt: BASE_DATE,
        },
      ],
      users: [makeUser()],
      projects: [
        {
          id: "proj_existing",
          organizationId: "org_cuid_user_01",
          ownerUserId: "cuid_user_01",
          ownerTeamId: null,
          name: "Brain Platform",
          slug: "brain-platform",
          framework: null,
          language: null,
          createdAt: BASE_DATE,
        },
      ],
    };
  }

  it("resolves 'BrainPlatform' to the existing 'Brain Platform' project", async () => {
    const store = seededStore();
    const db = makeMock(store);

    const result = await ensureNamedProject(db, "cuid_user_01", "BrainPlatform");

    expect(result.created).toBe(false);
    expect(result.projectId).toBe("proj_existing");
    expect(store.projects).toHaveLength(1);
  });

  it("resolves punctuation/case variants to the same project", async () => {
    const store = seededStore();
    const db = makeMock(store);

    const result = await ensureNamedProject(db, "cuid_user_01", "  brain_platform! ");

    expect(result.created).toBe(false);
    expect(result.projectId).toBe("proj_existing");
  });

  it("still creates when no normalized match exists", async () => {
    const store = seededStore();
    const db = makeMock(store);

    const result = await ensureNamedProject(db, "cuid_user_01", "External Brain");

    expect(result.created).toBe(true);
    expect(store.projects).toHaveLength(2);
    expect(store.projects[1]?.name).toBe("External Brain");
  });

  it("does not unite all-punctuation names with each other via empty normalization", async () => {
    const store = seededStore();
    store.projects.push({
      id: "proj_punct",
      organizationId: "org_cuid_user_01",
      ownerUserId: "cuid_user_01",
      ownerTeamId: null,
      name: "***",
      slug: "project",
      framework: null,
      language: null,
      createdAt: BASE_DATE,
    });
    const db = makeMock(store);

    const result = await ensureNamedProject(db, "cuid_user_01", "!!!");

    expect(result.created).toBe(true);
    expect(result.projectId).not.toBe("proj_punct");
  });
});

describe("findDuplicateProjectGroups", () => {
  it("groups normalized-name collisions within one org", () => {
    const groups = findDuplicateProjectGroups([
      { id: "p1", name: "Brain Platform", organizationId: "org1" },
      { id: "p2", name: "BrainPlatform", organizationId: "org1" },
      { id: "p3", name: "External Brain", organizationId: "org1" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.normalizedName).toBe("brainplatform");
    expect(groups[0]?.projects.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });

  it("does not group same-name projects across different orgs", () => {
    const groups = findDuplicateProjectGroups([
      { id: "p1", name: "Default", organizationId: "org1" },
      { id: "p2", name: "Default", organizationId: "org2" },
    ]);
    expect(groups).toHaveLength(0);
  });

  it("never groups all-punctuation names", () => {
    const groups = findDuplicateProjectGroups([
      { id: "p1", name: "***", organizationId: "org1" },
      { id: "p2", name: "!!!", organizationId: "org1" },
    ]);
    expect(groups).toHaveLength(0);
  });
});
