/**
 * Unit tests for the Phase 3a org-member and org-invite helpers.
 *
 * Covers:
 *  - listOrgMembers
 *  - setOrgMemberRole (privilege checks, last-owner protection)
 *  - removeOrgMember  (privilege checks, last-owner protection)
 *  - createOrgInvite  (privilege checks, token generation)
 *  - acceptOrgInvite  (expiry, revoked, already-accepted, happy path)
 *  - revokeOrgInvite  (privilege checks, idempotency)
 *  - listOrgInvites   (active vs all filter)
 *  - getAccessibleProjectIds
 *
 * No live database. All tests use a minimal in-memory Prisma mock.
 */

import { describe, expect, it } from "vitest";
import { hashSecret } from "../secret-hash.js";
import {
  listOrgMembers,
  setOrgMemberRole,
  removeOrgMember,
  createOrgInvite,
  acceptOrgInvite,
  revokeOrgInvite,
  listOrgInvites,
  getAccessibleProjectIds,
} from "../org.js";
import { BrainError } from "../logger.js";

// ---------------------------------------------------------------------------
// In-memory store types
// ---------------------------------------------------------------------------

type MemberRow = {
  id: string;
  orgId: string;
  userId: string;
  role: string;
  joinedAt: Date;
};

type UserRow = {
  id: string;
  email: string;
  name: string | null;
};

type InviteRow = {
  id: string;
  orgId: string;
  email: string;
  role: string;
  invitedById: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
};

type ProjectRow = {
  id: string;
  organizationId: string;
};

interface Store {
  members: MemberRow[];
  users: UserRow[];
  invites: InviteRow[];
  projects: ProjectRow[];
}

const BASE_DATE = new Date("2026-04-25T00:00:00.000Z");
// FUTURE / PAST are relative to runtime now, not BASE_DATE. Earlier this
// file pinned them to BASE_DATE+7d / BASE_DATE-1ms — that worked at
// commit time but the tests started failing in CI a week later because
// "FUTURE" was the literal date 2026-05-02, which became "the past"
// once real time moved forward. Anchor to Date.now() so the meaning of
// the names matches what the tests actually need.
const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Mock builder
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMock(store: Store): any {
  return {
    organizationMember: {
      findUnique: async ({
        where,
      }: {
        where: { orgId_userId: { orgId: string; userId: string } };
      }) => {
        const { orgId, userId } = where.orgId_userId;
        const row = store.members.find(
          (m) => m.orgId === orgId && m.userId === userId,
        );
        if (!row) return null;
        const user = store.users.find((u) => u.id === row.userId);
        return { ...row, user };
      },

      findMany: async ({ where }: { where: { orgId: string } }) => {
        const rows = store.members.filter((m) => m.orgId === where.orgId);
        return rows.map((r) => {
          const user = store.users.find((u) => u.id === r.userId) ?? {
            id: r.userId,
            email: `${r.userId}@test.com`,
            name: null,
          };
          return { ...r, user };
        });
      },

      count: async ({ where }: { where: { orgId: string; role: string } }) => {
        return store.members.filter(
          (m) => m.orgId === where.orgId && m.role === where.role,
        ).length;
      },

      update: async ({
        where,
        data,
      }: {
        where: { orgId_userId: { orgId: string; userId: string } };
        data: { role?: string };
      }) => {
        const { orgId, userId } = where.orgId_userId;
        const row = store.members.find(
          (m) => m.orgId === orgId && m.userId === userId,
        );
        if (!row) throw new Error("not found");
        if (data.role) row.role = data.role;
        return row;
      },

      delete: async ({
        where,
      }: {
        where: { orgId_userId: { orgId: string; userId: string } };
      }) => {
        const { orgId, userId } = where.orgId_userId;
        const idx = store.members.findIndex(
          (m) => m.orgId === orgId && m.userId === userId,
        );
        if (idx === -1) throw new Error("not found");
        store.members.splice(idx, 1);
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
        return create;
      },
    },

    organizationInvite: {
      create: async ({ data, select }: { data: Omit<InviteRow, "id" | "createdAt">; select?: Record<string, boolean> }) => {
        const row: InviteRow = {
          id: `inv_${Math.random().toString(36).slice(2, 10)}`,
          createdAt: BASE_DATE,
          ...data,
        };
        store.invites.push(row);
        if (!select) return row;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const out: Record<string, any> = {};
        for (const k of Object.keys(select)) {
          if (select[k]) out[k] = (row as Record<string, unknown>)[k];
        }
        return out;
      },

      findUnique: async ({ where, select }: { where: { tokenHash?: string; id?: string }; select?: Record<string, boolean> }) => {
        const row = store.invites.find((i) =>
          (where.tokenHash && i.tokenHash === where.tokenHash) ||
          (where.id && i.id === where.id),
        );
        if (!row) return null;
        if (!select) return row;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const out: Record<string, any> = {};
        for (const k of Object.keys(select)) {
          if (select[k]) out[k] = (row as Record<string, unknown>)[k];
        }
        return out;
      },

      findMany: async ({
        where,
        orderBy,
        select,
      }: {
        where: {
          orgId: string;
          acceptedAt?: null;
          revokedAt?: null;
          expiresAt?: { gt: Date };
        };
        orderBy?: Record<string, string>;
        select?: Record<string, boolean>;
      }) => {
        let rows = store.invites.filter((i) => i.orgId === where.orgId);
        if (where.acceptedAt === null) rows = rows.filter((i) => !i.acceptedAt);
        if (where.revokedAt === null) rows = rows.filter((i) => !i.revokedAt);
        if (where.expiresAt?.gt) {
          rows = rows.filter((i) => i.expiresAt > where.expiresAt!.gt);
        }
        if (orderBy?.createdAt === "desc") {
          rows = [...rows].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        }
        if (!select) return rows;
        return rows.map((row) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const out: Record<string, any> = {};
          for (const k of Object.keys(select)) {
            if (select[k]) out[k] = (row as Record<string, unknown>)[k];
          }
          return out;
        });
      },

      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { acceptedAt?: Date; revokedAt?: Date };
      }) => {
        const row = store.invites.find((i) => i.id === where.id);
        if (!row) throw new Error("invite not found");
        if (data.acceptedAt) row.acceptedAt = data.acceptedAt;
        if (data.revokedAt) row.revokedAt = data.revokedAt;
        return row;
      },
    },

    project: {
      findMany: async ({ where, select }: { where: { organizationId: string }; select?: Record<string, boolean> }) => {
        const rows = store.projects.filter(
          (p) => p.organizationId === where.organizationId,
        );
        if (!select) return rows;
        return rows.map((row) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const out: Record<string, any> = {};
          for (const k of Object.keys(select)) {
            if (select[k]) out[k] = (row as Record<string, unknown>)[k];
          }
          return out;
        });
      },
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: async (fn: (tx: any) => Promise<void>) => {
      await fn(makeMock(store));
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeStore(overrides: Partial<Store> = {}): Store {
  return {
    members: [],
    users: [
      { id: "owner_1", email: "owner@example.com", name: "Owner" },
      { id: "admin_1", email: "admin@example.com", name: "Admin" },
      { id: "member_1", email: "member@example.com", name: "Member" },
      { id: "outsider_1", email: "outsider@example.com", name: "Outsider" },
    ],
    invites: [],
    projects: [],
    ...overrides,
  };
}

function withMembers(store: Store): Store {
  store.members = [
    { id: "om_o1", orgId: "org_1", userId: "owner_1", role: "owner", joinedAt: BASE_DATE },
    { id: "om_a1", orgId: "org_1", userId: "admin_1", role: "admin", joinedAt: BASE_DATE },
    { id: "om_m1", orgId: "org_1", userId: "member_1", role: "member", joinedAt: BASE_DATE },
  ];
  return store;
}

// ---------------------------------------------------------------------------
// listOrgMembers
// ---------------------------------------------------------------------------

describe("listOrgMembers", () => {
  it("returns all members with user info", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    const result = await listOrgMembers(db, "org_1");

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      userId: "owner_1",
      email: "owner@example.com",
      role: "owner",
    });
  });

  it("returns empty array when org has no members", async () => {
    const store = makeStore();
    const db = makeMock(store);

    const result = await listOrgMembers(db, "org_empty");
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// setOrgMemberRole
// ---------------------------------------------------------------------------

describe("setOrgMemberRole", () => {
  it("owner can promote member to admin", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await setOrgMemberRole(db, "owner_1", "org_1", "member_1", "admin");

    const row = store.members.find((m) => m.userId === "member_1");
    expect(row?.role).toBe("admin");
  });

  it("admin can change member to admin", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await setOrgMemberRole(db, "admin_1", "org_1", "member_1", "admin");

    const row = store.members.find((m) => m.userId === "member_1");
    expect(row?.role).toBe("admin");
  });

  it("admin cannot promote to owner", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await expect(
      setOrgMemberRole(db, "admin_1", "org_1", "member_1", "owner"),
    ).rejects.toSatisfy((e: unknown) => e instanceof BrainError && (e as BrainError).status === 403);
  });

  it("admin cannot demote an owner", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await expect(
      setOrgMemberRole(db, "admin_1", "org_1", "owner_1", "member"),
    ).rejects.toSatisfy((e: unknown) => e instanceof BrainError && (e as BrainError).status === 403);
  });

  it("member cannot change any role", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await expect(
      setOrgMemberRole(db, "member_1", "org_1", "admin_1", "member"),
    ).rejects.toSatisfy((e: unknown) => e instanceof BrainError && (e as BrainError).status === 403);
  });

  it("non-member cannot change roles", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await expect(
      setOrgMemberRole(db, "outsider_1", "org_1", "member_1", "admin"),
    ).rejects.toSatisfy((e: unknown) => e instanceof BrainError && (e as BrainError).status === 403);
  });

  it("refuses to demote the last owner", async () => {
    const store = makeStore({
      members: [
        { id: "om_o1", orgId: "org_1", userId: "owner_1", role: "owner", joinedAt: BASE_DATE },
        { id: "om_m1", orgId: "org_1", userId: "member_1", role: "member", joinedAt: BASE_DATE },
      ],
    });
    const db = makeMock(store);

    await expect(
      setOrgMemberRole(db, "owner_1", "org_1", "owner_1", "member"),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof BrainError &&
        (e as BrainError).code === "LAST_OWNER",
    );
  });

  it("allows demoting an owner when another owner exists", async () => {
    const store = makeStore({
      members: [
        { id: "om_o1", orgId: "org_1", userId: "owner_1", role: "owner", joinedAt: BASE_DATE },
        { id: "om_o2", orgId: "org_1", userId: "admin_1", role: "owner", joinedAt: BASE_DATE },
      ],
    });
    const db = makeMock(store);

    await setOrgMemberRole(db, "owner_1", "org_1", "admin_1", "admin");

    const row = store.members.find((m) => m.userId === "admin_1");
    expect(row?.role).toBe("admin");
  });

  it("throws NOT_FOUND for a target not in the org", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await expect(
      setOrgMemberRole(db, "owner_1", "org_1", "outsider_1", "member"),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof BrainError && (e as BrainError).status === 404,
    );
  });
});

// ---------------------------------------------------------------------------
// removeOrgMember
// ---------------------------------------------------------------------------

describe("removeOrgMember", () => {
  it("owner can remove a member", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await removeOrgMember(db, "owner_1", "org_1", "member_1");

    expect(store.members.find((m) => m.userId === "member_1")).toBeUndefined();
  });

  it("admin can remove a member", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await removeOrgMember(db, "admin_1", "org_1", "member_1");

    expect(store.members.find((m) => m.userId === "member_1")).toBeUndefined();
  });

  it("admin cannot remove an owner", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await expect(
      removeOrgMember(db, "admin_1", "org_1", "owner_1"),
    ).rejects.toSatisfy((e: unknown) => e instanceof BrainError && (e as BrainError).status === 403);
  });

  it("member cannot remove anyone", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await expect(
      removeOrgMember(db, "member_1", "org_1", "admin_1"),
    ).rejects.toSatisfy((e: unknown) => e instanceof BrainError && (e as BrainError).status === 403);
  });

  it("refuses to remove the last owner", async () => {
    const store = makeStore({
      members: [
        { id: "om_o1", orgId: "org_1", userId: "owner_1", role: "owner", joinedAt: BASE_DATE },
      ],
    });
    const db = makeMock(store);

    await expect(
      removeOrgMember(db, "owner_1", "org_1", "owner_1"),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof BrainError && (e as BrainError).code === "LAST_OWNER",
    );
  });

  it("non-member cannot remove anyone", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await expect(
      removeOrgMember(db, "outsider_1", "org_1", "member_1"),
    ).rejects.toSatisfy((e: unknown) => e instanceof BrainError && (e as BrainError).status === 403);
  });
});

// ---------------------------------------------------------------------------
// createOrgInvite
// ---------------------------------------------------------------------------

describe("createOrgInvite", () => {
  it("owner can create an invite", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    const result = await createOrgInvite(db, "owner_1", "org_1", "new@example.com", "member");

    expect(result.inviteId).toBeTruthy();
    expect(result.token).toBeTruthy();
    // Token should be a non-trivial string
    expect(result.token.length).toBeGreaterThan(20);
  });

  it("admin can create an invite for member role", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    const result = await createOrgInvite(db, "admin_1", "org_1", "new@example.com", "member");
    expect(result.inviteId).toBeTruthy();
  });

  it("admin cannot invite with owner role", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await expect(
      createOrgInvite(db, "admin_1", "org_1", "new@example.com", "owner"),
    ).rejects.toSatisfy((e: unknown) => e instanceof BrainError && (e as BrainError).status === 403);
  });

  it("member cannot create an invite", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await expect(
      createOrgInvite(db, "member_1", "org_1", "new@example.com", "member"),
    ).rejects.toSatisfy((e: unknown) => e instanceof BrainError && (e as BrainError).status === 403);
  });

  it("non-member cannot create an invite", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await expect(
      createOrgInvite(db, "outsider_1", "org_1", "new@example.com", "member"),
    ).rejects.toSatisfy((e: unknown) => e instanceof BrainError && (e as BrainError).status === 403);
  });

  it("invite is stored with 7-day expiry and lowercased email", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    const before = Date.now();
    await createOrgInvite(db, "owner_1", "org_1", "New@Example.COM", "member");
    const after = Date.now();

    const invite = store.invites[0];
    expect(invite?.email).toBe("new@example.com");

    // expiresAt is set relative to Date.now() in the helper, not to BASE_DATE in the mock
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const expiresMs = invite!.expiresAt.getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
    expect(expiresMs).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
  });

  it("each invite gets a unique token", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    const r1 = await createOrgInvite(db, "owner_1", "org_1", "a@example.com", "member");
    const r2 = await createOrgInvite(db, "owner_1", "org_1", "b@example.com", "member");

    expect(r1.token).not.toBe(r2.token);
  });
});

// ---------------------------------------------------------------------------
// acceptOrgInvite
// ---------------------------------------------------------------------------

describe("acceptOrgInvite", () => {
  function makeInvite(overrides: Partial<InviteRow> = {}): InviteRow {
    return {
      id: "inv_1",
      orgId: "org_1",
      email: "new@example.com",
      role: "member",
      invitedById: "owner_1",
      // Stored hashed, exactly as production does — the tests still pass the
      // RAW value to acceptOrgInvite, which is the point of the round-trip.
      tokenHash: hashSecret("valid_token_abc123"),
      createdAt: BASE_DATE,
      expiresAt: FUTURE,
      acceptedAt: null,
      revokedAt: null,
      ...overrides,
    };
  }

  it("accepts a valid invite and creates membership", async () => {
    const store = withMembers(makeStore({ invites: [makeInvite()] }));
    const db = makeMock(store);

    const result = await acceptOrgInvite(db, "outsider_1", "valid_token_abc123");

    expect(result.orgId).toBe("org_1");
    expect(store.members.find((m) => m.userId === "outsider_1")).toBeDefined();
    expect(store.invites[0]?.acceptedAt).not.toBeNull();
  });

  it("refuses an expired invite", async () => {
    const store = makeStore({
      invites: [makeInvite({ expiresAt: PAST })],
    });
    const db = makeMock(store);

    await expect(
      acceptOrgInvite(db, "outsider_1", "valid_token_abc123"),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof BrainError && (e as BrainError).code === "INVITE_EXPIRED",
    );
  });

  it("refuses a revoked invite", async () => {
    const store = makeStore({
      invites: [makeInvite({ revokedAt: BASE_DATE })],
    });
    const db = makeMock(store);

    await expect(
      acceptOrgInvite(db, "outsider_1", "valid_token_abc123"),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof BrainError && (e as BrainError).code === "INVITE_REVOKED",
    );
  });

  it("refuses an already-accepted invite", async () => {
    const store = makeStore({
      invites: [makeInvite({ acceptedAt: BASE_DATE })],
    });
    const db = makeMock(store);

    await expect(
      acceptOrgInvite(db, "outsider_1", "valid_token_abc123"),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof BrainError &&
        (e as BrainError).code === "INVITE_ALREADY_ACCEPTED",
    );
  });

  it("throws NOT_FOUND for an unknown token", async () => {
    const store = makeStore({ invites: [] });
    const db = makeMock(store);

    await expect(
      acceptOrgInvite(db, "outsider_1", "nonexistent_token"),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof BrainError && (e as BrainError).status === 404,
    );
  });

  it("is idempotent — user already member just accepts invite", async () => {
    const store = withMembers(
      makeStore({ invites: [makeInvite({ email: "member@example.com" })] }),
    );
    const db = makeMock(store);

    // member_1 is already in the org — accepting should not throw
    const result = await acceptOrgInvite(db, "member_1", "valid_token_abc123");
    expect(result.orgId).toBe("org_1");
  });
});

// ---------------------------------------------------------------------------
// revokeOrgInvite
// ---------------------------------------------------------------------------

describe("revokeOrgInvite", () => {
  function makeInvite(overrides: Partial<InviteRow> = {}): InviteRow {
    return {
      id: "inv_1",
      orgId: "org_1",
      email: "new@example.com",
      role: "member",
      invitedById: "owner_1",
      tokenHash: "tok_abc",
      createdAt: BASE_DATE,
      expiresAt: FUTURE,
      acceptedAt: null,
      revokedAt: null,
      ...overrides,
    };
  }

  it("owner can revoke a pending invite", async () => {
    const store = withMembers(makeStore({ invites: [makeInvite()] }));
    const db = makeMock(store);

    await revokeOrgInvite(db, "owner_1", "inv_1");

    expect(store.invites[0]?.revokedAt).not.toBeNull();
  });

  it("admin can revoke a pending invite", async () => {
    const store = withMembers(makeStore({ invites: [makeInvite()] }));
    const db = makeMock(store);

    await revokeOrgInvite(db, "admin_1", "inv_1");

    expect(store.invites[0]?.revokedAt).not.toBeNull();
  });

  it("member cannot revoke an invite", async () => {
    const store = withMembers(makeStore({ invites: [makeInvite()] }));
    const db = makeMock(store);

    await expect(
      revokeOrgInvite(db, "member_1", "inv_1"),
    ).rejects.toSatisfy((e: unknown) => e instanceof BrainError && (e as BrainError).status === 403);
  });

  it("non-member cannot revoke an invite", async () => {
    const store = withMembers(makeStore({ invites: [makeInvite()] }));
    const db = makeMock(store);

    await expect(
      revokeOrgInvite(db, "outsider_1", "inv_1"),
    ).rejects.toSatisfy((e: unknown) => e instanceof BrainError && (e as BrainError).status === 403);
  });

  it("throws NOT_FOUND for unknown inviteId", async () => {
    const store = withMembers(makeStore());
    const db = makeMock(store);

    await expect(
      revokeOrgInvite(db, "owner_1", "inv_nonexistent"),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof BrainError && (e as BrainError).status === 404,
    );
  });

  it("is idempotent — revoking an already-revoked invite does not throw", async () => {
    const store = withMembers(makeStore({ invites: [makeInvite({ revokedAt: BASE_DATE })] }));
    const db = makeMock(store);

    // Should not throw
    await revokeOrgInvite(db, "owner_1", "inv_1");
    expect(store.invites[0]?.revokedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listOrgInvites
// ---------------------------------------------------------------------------

describe("listOrgInvites", () => {
  it("returns only active invites with status=active (default)", async () => {
    const store = withMembers(
      makeStore({
        invites: [
          {
            id: "inv_1",
            orgId: "org_1",
            email: "a@example.com",
            role: "member",
            invitedById: "owner_1",
            tokenHash: "t1",
            createdAt: BASE_DATE,
            expiresAt: FUTURE,
            acceptedAt: null,
            revokedAt: null,
          },
          {
            id: "inv_2",
            orgId: "org_1",
            email: "b@example.com",
            role: "member",
            invitedById: "owner_1",
            tokenHash: "t2",
            createdAt: BASE_DATE,
            expiresAt: FUTURE,
            acceptedAt: BASE_DATE, // accepted
            revokedAt: null,
          },
          {
            id: "inv_3",
            orgId: "org_1",
            email: "c@example.com",
            role: "member",
            invitedById: "owner_1",
            tokenHash: "t3",
            createdAt: BASE_DATE,
            expiresAt: PAST, // expired
            acceptedAt: null,
            revokedAt: null,
          },
        ],
      }),
    );
    const db = makeMock(store);

    const active = await listOrgInvites(db, "org_1", "active");
    expect(active).toHaveLength(1);
    expect(active[0]?.email).toBe("a@example.com");
    expect(active[0]?.status).toBe("active");
  });

  it("returns all invites when status=all", async () => {
    const store = withMembers(
      makeStore({
        invites: [
          {
            id: "inv_1",
            orgId: "org_1",
            email: "a@example.com",
            role: "member",
            invitedById: "owner_1",
            tokenHash: "t1",
            createdAt: BASE_DATE,
            expiresAt: FUTURE,
            acceptedAt: null,
            revokedAt: null,
          },
          {
            id: "inv_2",
            orgId: "org_1",
            email: "b@example.com",
            role: "member",
            invitedById: "owner_1",
            tokenHash: "t2",
            createdAt: BASE_DATE,
            expiresAt: FUTURE,
            acceptedAt: BASE_DATE,
            revokedAt: null,
          },
        ],
      }),
    );
    const db = makeMock(store);

    const all = await listOrgInvites(db, "org_1", "all");
    expect(all).toHaveLength(2);
  });

  it("sets status correctly for accepted, revoked, expired, active", async () => {
    const store = withMembers(
      makeStore({
        invites: [
          {
            id: "inv_accepted",
            orgId: "org_1",
            email: "acc@example.com",
            role: "member",
            invitedById: "owner_1",
            tokenHash: "t_acc",
            createdAt: BASE_DATE,
            expiresAt: FUTURE,
            acceptedAt: BASE_DATE,
            revokedAt: null,
          },
          {
            id: "inv_revoked",
            orgId: "org_1",
            email: "rev@example.com",
            role: "member",
            invitedById: "owner_1",
            tokenHash: "t_rev",
            createdAt: BASE_DATE,
            expiresAt: FUTURE,
            acceptedAt: null,
            revokedAt: BASE_DATE,
          },
          {
            id: "inv_expired",
            orgId: "org_1",
            email: "exp@example.com",
            role: "member",
            invitedById: "owner_1",
            tokenHash: "t_exp",
            createdAt: BASE_DATE,
            expiresAt: PAST,
            acceptedAt: null,
            revokedAt: null,
          },
          {
            id: "inv_active",
            orgId: "org_1",
            email: "act@example.com",
            role: "member",
            invitedById: "owner_1",
            tokenHash: "t_act",
            createdAt: BASE_DATE,
            expiresAt: FUTURE,
            acceptedAt: null,
            revokedAt: null,
          },
        ],
      }),
    );
    const db = makeMock(store);

    const all = await listOrgInvites(db, "org_1", "all");
    const byEmail = Object.fromEntries(all.map((i) => [i.email, i.status]));

    expect(byEmail["acc@example.com"]).toBe("accepted");
    expect(byEmail["rev@example.com"]).toBe("revoked");
    expect(byEmail["exp@example.com"]).toBe("expired");
    expect(byEmail["act@example.com"]).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// getAccessibleProjectIds
// ---------------------------------------------------------------------------

describe("getAccessibleProjectIds", () => {
  it("returns all project IDs in the org for a member", async () => {
    const store = makeStore({
      members: [
        { id: "om_1", orgId: "org_1", userId: "member_1", role: "member", joinedAt: BASE_DATE },
      ],
      projects: [
        { id: "proj_1", organizationId: "org_1" },
        { id: "proj_2", organizationId: "org_1" },
        { id: "proj_other", organizationId: "org_other" },
      ],
    });
    const db = makeMock(store);

    const ids = await getAccessibleProjectIds(db, "member_1", "org_1");

    expect(ids).toHaveLength(2);
    expect(ids).toContain("proj_1");
    expect(ids).toContain("proj_2");
    expect(ids).not.toContain("proj_other");
  });

  it("returns empty array for a non-member", async () => {
    const store = makeStore({
      projects: [{ id: "proj_1", organizationId: "org_1" }],
    });
    const db = makeMock(store);

    const ids = await getAccessibleProjectIds(db, "outsider_1", "org_1");
    expect(ids).toHaveLength(0);
  });

  it("returns empty array when org has no projects", async () => {
    const store = makeStore({
      members: [
        { id: "om_1", orgId: "org_1", userId: "owner_1", role: "owner", joinedAt: BASE_DATE },
      ],
    });
    const db = makeMock(store);

    const ids = await getAccessibleProjectIds(db, "owner_1", "org_1");
    expect(ids).toHaveLength(0);
  });
});
