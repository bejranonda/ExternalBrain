/**
 * Organization helpers — idempotent ops for the Org → Project hierarchy.
 *
 * Design rules:
 *  - Every function accepts a `db` client as the first argument so callers
 *    (API routes, workers, tests) can supply a transaction client or a mock.
 *  - No function imports `db` from "@brain/db" directly — keeps this module
 *    testable without a live database.
 *  - Errors use `BrainError` so the structured-log envelope stays consistent.
 */
import crypto from "crypto";
import type { PrismaClient } from "@brain/db";
import { BrainError } from "./logger.js";

// ---------------------------------------------------------------------------
// Role constants
// ---------------------------------------------------------------------------

const ROLE_RANKS: Record<string, number> = { member: 0, admin: 1, owner: 2 };

function roleRank(role: string): number {
  return ROLE_RANKS[role] ?? 0;
}

// ---------------------------------------------------------------------------
// ensurePersonalOrg
// ---------------------------------------------------------------------------

/**
 * Idempotent: if the user already has an "owner" OrganizationMember row,
 * return the existing orgId. Otherwise create the personal Organization +
 * membership and return the new orgId.
 */
export async function ensurePersonalOrg(
  db: PrismaClient,
  userId: string,
): Promise<{ orgId: string; created: boolean }> {
  // Fast path — look for an existing owner membership.
  const existing = await db.organizationMember.findFirst({
    where: { userId, role: "owner" },
    select: { orgId: true },
  });
  if (existing) {
    return { orgId: existing.orgId, created: false };
  }

  // Slow path — need to create.  Fetch the user to derive name/slug.
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, createdAt: true },
  });

  const orgId = `org_${userId}`;
  const slug = `personal-${userId.slice(3, 15).toLowerCase()}`;
  const name =
    user.name ??
    user.email.split("@")[0] ??
    "Personal";

  // Use a transaction so the Org + Member are always created together.
  await db.$transaction(async (tx) => {
    await tx.organization.upsert({
      where: { id: orgId },
      create: {
        id: orgId,
        slug,
        name,
        createdAt: user.createdAt,
        updatedAt: user.createdAt,
      },
      update: {},
    });

    await tx.organizationMember.upsert({
      where: { orgId_userId: { orgId, userId } },
      create: {
        id: `om_${userId}`,
        orgId,
        userId,
        role: "owner",
        joinedAt: user.createdAt,
      },
      update: {},
    });
  });

  return { orgId, created: true };
}

// ---------------------------------------------------------------------------
// getUserOrgs
// ---------------------------------------------------------------------------

/**
 * Return all organizations the user is a member of, with the user's role.
 */
export async function getUserOrgs(
  db: PrismaClient,
  userId: string,
): Promise<{ orgId: string; slug: string; name: string; role: string }[]> {
  const memberships = await db.organizationMember.findMany({
    where: { userId },
    select: {
      orgId: true,
      role: true,
      organization: { select: { slug: true, name: true } },
    },
  });

  return memberships.map((m) => ({
    orgId: m.orgId,
    slug: m.organization.slug,
    name: m.organization.name,
    role: m.role,
  }));
}

// ---------------------------------------------------------------------------
// requireOrgMember
// ---------------------------------------------------------------------------

/**
 * Assert that the user is a member of the given organization.
 * Throws `BrainError(code: "FORBIDDEN_ORG")` if not.
 */
export async function requireOrgMember(
  db: PrismaClient,
  userId: string,
  orgId: string,
): Promise<{ role: string }> {
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { role: true },
  });

  if (!membership) {
    throw new BrainError({
      code: "FORBIDDEN_ORG",
      category: "auth",
      message: `User ${userId} is not a member of organization ${orgId}`,
      remediation:
        "Ensure the user has been added to the organization before accessing its resources.",
      retryable: false,
      status: 403,
    });
  }

  return { role: membership.role };
}

// ---------------------------------------------------------------------------
// isOrgOwner
// ---------------------------------------------------------------------------

/**
 * Return true if the user has the "owner" role in the given organization.
 */
export async function isOrgOwner(
  db: PrismaClient,
  userId: string,
  orgId: string,
): Promise<boolean> {
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { role: true },
  });

  return membership?.role === "owner";
}

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

/**
 * Derive a URL-safe slug from an arbitrary string.
 * Mirrors the SQL used in the migration:
 *   lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')), trimmed of
 *   leading/trailing dashes.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "project";
}

/**
 * Aggressive normalization for project-identity matching: lowercase with
 * every non-alphanumeric removed, so "Brain Platform", "BrainPlatform", and
 * "brain-platform" are one identity. Deliberately conservative beyond that —
 * no fuzzy matching (flywheel-repair spec §3.1). An all-punctuation name
 * normalizes to "" and must NOT be matched on (empty ≠ empty).
 */
export function normalizeProjectName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface DuplicateProjectGroup {
  organizationId: string;
  normalizedName: string;
  projects: { id: string; name: string }[];
}

/**
 * Group projects that share a `normalizeProjectName` identity within the same
 * organization — the drift the normalized matcher now prevents at create time.
 * Pre-existing duplicates surface here (loop-health panel, flywheel-repair
 * spec §4.2) until the operator runs scripts/merge-duplicate-projects.sql.
 * All-punctuation names (normalized "") never group, mirroring the matcher.
 */
export function findDuplicateProjectGroups(
  projects: { id: string; name: string; organizationId: string }[],
): DuplicateProjectGroup[] {
  const byKey = new Map<string, DuplicateProjectGroup>();
  for (const p of projects) {
    const norm = normalizeProjectName(p.name);
    if (!norm) continue;
    const key = `${p.organizationId} ${norm}`;
    const group = byKey.get(key) ?? {
      organizationId: p.organizationId,
      normalizedName: norm,
      projects: [],
    };
    group.projects.push({ id: p.id, name: p.name });
    byKey.set(key, group);
  }
  return [...byKey.values()].filter((g) => g.projects.length > 1);
}

// ---------------------------------------------------------------------------
// uniqueSlugInOrg
// ---------------------------------------------------------------------------

/**
 * Given a candidate slug and an orgId, return a slug guaranteed to be unique
 * within that org by appending -2, -3, … if needed.
 *
 * @param excludeProjectId - optionally exclude a specific project from the
 *   collision check (used during rename so the project doesn't block itself).
 */
export async function uniqueSlugInOrg(
  db: PrismaClient,
  orgId: string,
  candidate: string,
  excludeProjectId?: string,
): Promise<string> {
  let slug = candidate || "project";
  let suffix = 1;
  while (true) {
    const existing = await db.project.findFirst({
      where: {
        organizationId: orgId,
        slug,
        ...(excludeProjectId ? { id: { not: excludeProjectId } } : {}),
      },
      select: { id: true },
    });
    if (!existing) return slug;
    suffix++;
    slug = `${candidate}-${suffix}`;
  }
}

// ---------------------------------------------------------------------------
// getUserProjects
// ---------------------------------------------------------------------------

export interface UserProject {
  id: string;
  slug: string;
  name: string;
  framework: string | null;
  language: string | null;
  createdAt: Date;
  organizationId: string;
  orgSlug: string;
  orgName: string;
  orgRole: string;
  isOwn: boolean;
}

/**
 * Return all projects across all orgs the user is a member of.
 * The `isOwn` flag is true when ownerUserId === userId.
 */
export async function getUserProjects(
  db: PrismaClient,
  userId: string,
): Promise<UserProject[]> {
  const memberships = await db.organizationMember.findMany({
    where: { userId },
    select: {
      role: true,
      organization: {
        select: {
          id: true,
          slug: true,
          name: true,
          projects: {
            select: {
              id: true,
              slug: true,
              name: true,
              framework: true,
              language: true,
              createdAt: true,
              ownerUserId: true,
            },
          },
        },
      },
    },
  });

  const out: UserProject[] = [];
  for (const m of memberships) {
    for (const p of m.organization.projects) {
      out.push({
        id: p.id,
        slug: p.slug,
        name: p.name,
        framework: p.framework,
        language: p.language,
        createdAt: p.createdAt,
        organizationId: m.organization.id,
        orgSlug: m.organization.slug,
        orgName: m.organization.name,
        orgRole: m.role,
        isOwn: p.ownerUserId === userId,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// ensureDefaultProject
// ---------------------------------------------------------------------------

/**
 * Idempotent: if the user already has at least one Project in their personal
 * org, return the first one. Otherwise create a default project.
 */
export async function ensureDefaultProject(
  db: PrismaClient,
  userId: string,
): Promise<{ projectId: string; slug: string; created: boolean }> {
  const { orgId } = await ensurePersonalOrg(db, userId);

  const existing = await db.project.findFirst({
    where: { organizationId: orgId },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true },
  });

  if (existing) {
    return { projectId: existing.id, slug: existing.slug, created: false };
  }

  const project = await db.project.create({
    data: {
      organizationId: orgId,
      ownerUserId: userId,
      name: "Default",
      slug: "default",
    },
    select: { id: true, slug: true },
  });

  return { projectId: project.id, slug: project.slug, created: true };
}

// ---------------------------------------------------------------------------
// ensureNamedProject
// ---------------------------------------------------------------------------

/**
 * Idempotent: look up a project by name within the user's personal org (or
 * supplied org). If a project with that name already exists, return it.
 * Otherwise create one with a derived unique slug.
 *
 * Name matching uses `normalizeProjectName` (lowercase, all non-alphanumerics
 * stripped) — "Brain Platform", "BrainPlatform", and "brain-platform" resolve
 * to the same project, so agent-supplied projectName drift can't spawn
 * duplicate identities (flywheel-repair spec §3.1). Slug is derived from the
 * trimmed name via the existing `slugify` helper and made unique via
 * `uniqueSlugInOrg`.
 *
 * Used by MCP `brain_start_session` (when `projectName` is supplied) and
 * `brain_create_project` so AI agents can spin up a named project without
 * the user leaving their terminal. See ROADMAP §1 / Bug-1.
 */
export async function ensureNamedProject(
  db: PrismaClient,
  userId: string,
  name: string,
  opts?: { orgId?: string; framework?: string; language?: string },
): Promise<{ projectId: string; slug: string; created: boolean }> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("ensureNamedProject: name must be non-empty after trim");
  }
  const targetOrgId =
    opts?.orgId ?? (await ensurePersonalOrg(db, userId)).orgId;

  // Normalized name match within the org, compared in JS — orgs hold few
  // projects, and Prisma can't express the normalization in a `where`.
  const wanted = normalizeProjectName(trimmed);
  if (wanted) {
    const candidates = await db.project.findMany({
      where: { organizationId: targetOrgId },
      select: { id: true, slug: true, name: true },
    });
    const existing = candidates.find(
      (p: { id: string; slug: string; name: string }) =>
        normalizeProjectName(p.name) === wanted,
    );
    if (existing) {
      return { projectId: existing.id, slug: existing.slug, created: false };
    }
  }

  const candidateSlug = slugify(trimmed);
  const slug = await uniqueSlugInOrg(db, targetOrgId, candidateSlug);

  const project = await db.project.create({
    data: {
      organizationId: targetOrgId,
      ownerUserId: userId,
      name: trimmed,
      slug,
      framework: opts?.framework ?? null,
      language: opts?.language ?? null,
    },
    select: { id: true, slug: true },
  });
  return { projectId: project.id, slug: project.slug, created: true };
}

// ---------------------------------------------------------------------------
// uniqueOrgSlug
// ---------------------------------------------------------------------------

/**
 * Given a candidate slug, return a slug guaranteed to be globally unique across
 * the Organization table by appending -2, -3, … if needed. Org slugs are
 * `@unique` platform-wide (unlike project slugs, which are unique per-org), so
 * this can't reuse `uniqueSlugInOrg`.
 */
export async function uniqueOrgSlug(
  db: PrismaClient,
  candidate: string,
): Promise<string> {
  const base = candidate || "org";
  let slug = base;
  let suffix = 1;
  while (true) {
    const existing = await db.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing) return slug;
    suffix++;
    slug = `${base}-${suffix}`;
  }
}

// ---------------------------------------------------------------------------
// createOrg
// ---------------------------------------------------------------------------

export interface CreatedOrg {
  orgId: string;
  slug: string;
  name: string;
  projectId: string;
  projectSlug: string;
}

/**
 * Create a brand-new organization owned by `userId`, plus a default project so
 * the org is immediately usable (a project-less org can't be activated — see
 * `getActiveProject`). The creator is added as `owner`.
 *
 * Unlike `ensurePersonalOrg` (one auto-provisioned org per user, keyed on a
 * deterministic id), this is the explicit user-initiated path: a user may own
 * any number of these. The whole thing runs in one transaction so a half-built
 * org (no owner, or no project) can never be observed.
 *
 * Throws `BrainError(INVALID_ORG_NAME, 400)` if the name is empty after trim.
 */
export async function createOrg(
  db: PrismaClient,
  userId: string,
  name: string,
): Promise<CreatedOrg> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new BrainError({
      code: "INVALID_ORG_NAME",
      category: "validation",
      message: "Organization name must not be empty.",
      remediation: "Provide a non-empty name for the organization.",
      retryable: false,
      status: 400,
    });
  }
  if (trimmed.length > 120) {
    throw new BrainError({
      code: "INVALID_ORG_NAME",
      category: "validation",
      message: "Organization name must be 120 characters or fewer.",
      remediation: "Shorten the organization name.",
      retryable: false,
      status: 400,
    });
  }

  // Resolve the slug outside the transaction to keep the lock window short.
  // A concurrent creation could still collide on the @unique slug; the
  // transaction's create will then throw P2002 and the caller can retry.
  const slug = await uniqueOrgSlug(db, slugify(trimmed));

  return db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { slug, name: trimmed },
      select: { id: true, slug: true, name: true },
    });

    await tx.organizationMember.create({
      data: { orgId: org.id, userId, role: "owner" },
    });

    const project = await tx.project.create({
      data: {
        organizationId: org.id,
        ownerUserId: userId,
        name: "Default",
        slug: "default",
      },
      select: { id: true, slug: true },
    });

    return {
      orgId: org.id,
      slug: org.slug,
      name: org.name,
      projectId: project.id,
      projectSlug: project.slug,
    };
  });
}

// ---------------------------------------------------------------------------
// listOrgMembers
// ---------------------------------------------------------------------------

export interface OrgMemberView {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  joinedAt: Date;
}

/**
 * Return all members of an org with their user info.
 * Any org member can call this (no privilege check here — enforce at the API layer).
 */
export async function listOrgMembers(
  db: PrismaClient,
  orgId: string,
): Promise<OrgMemberView[]> {
  const rows = await db.organizationMember.findMany({
    where: { orgId },
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { joinedAt: "asc" },
  });

  return rows.map((r) => ({
    userId: r.userId,
    email: r.user.email,
    name: r.user.name,
    role: r.role,
    joinedAt: r.joinedAt,
  }));
}

// ---------------------------------------------------------------------------
// setOrgMemberRole
// ---------------------------------------------------------------------------

/**
 * Change the role of an org member.
 *
 * Privilege rules:
 *  - Caller must be owner or admin.
 *  - Admin can set/remove admin and member roles but cannot touch owner.
 *  - Owner can set any role, but refuses to demote the last owner.
 */
export async function setOrgMemberRole(
  db: PrismaClient,
  callerUserId: string,
  orgId: string,
  targetUserId: string,
  newRole: string,
): Promise<void> {
  const callerMembership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: callerUserId } },
    select: { role: true },
  });
  if (!callerMembership || roleRank(callerMembership.role) < roleRank("admin")) {
    throw new BrainError({
      code: "FORBIDDEN_ORG",
      category: "auth",
      message: "Only org owners or admins can change member roles.",
      remediation: "Ensure the caller has at least admin role in this org.",
      retryable: false,
      status: 403,
    });
  }

  const targetMembership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: targetUserId } },
    select: { role: true },
  });
  if (!targetMembership) {
    throw new BrainError({
      code: "NOT_FOUND",
      category: "validation",
      message: "Target user is not a member of this organization.",
      remediation: "Check the userId is correct and the user has been added to the org.",
      retryable: false,
      status: 404,
    });
  }

  // Admin cannot touch owner-level roles (either the current role or the new role)
  if (callerMembership.role === "admin") {
    if (targetMembership.role === "owner" || newRole === "owner") {
      throw new BrainError({
        code: "FORBIDDEN_ORG",
        category: "auth",
        message: "Admins cannot change owner roles.",
        remediation: "Only an org owner can modify owner-level roles.",
        retryable: false,
        status: 403,
      });
    }
  }

  // Protect the last owner
  if (targetMembership.role === "owner" && newRole !== "owner") {
    const ownerCount = await db.organizationMember.count({
      where: { orgId, role: "owner" },
    });
    if (ownerCount <= 1) {
      throw new BrainError({
        code: "LAST_OWNER",
        category: "validation",
        message: "Cannot demote the last owner of an organization.",
        remediation: "Promote another member to owner first.",
        retryable: false,
        status: 409,
      });
    }
  }

  await db.organizationMember.update({
    where: { orgId_userId: { orgId, userId: targetUserId } },
    data: { role: newRole },
  });
}

// ---------------------------------------------------------------------------
// removeOrgMember
// ---------------------------------------------------------------------------

/**
 * Remove a member from an org.
 *
 * Privilege rules mirror setOrgMemberRole. Additionally refuses to remove
 * the last owner.
 */
export async function removeOrgMember(
  db: PrismaClient,
  callerUserId: string,
  orgId: string,
  targetUserId: string,
): Promise<void> {
  const callerMembership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: callerUserId } },
    select: { role: true },
  });
  if (!callerMembership || roleRank(callerMembership.role) < roleRank("admin")) {
    throw new BrainError({
      code: "FORBIDDEN_ORG",
      category: "auth",
      message: "Only org owners or admins can remove members.",
      remediation: "Ensure the caller has at least admin role in this org.",
      retryable: false,
      status: 403,
    });
  }

  const targetMembership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: targetUserId } },
    select: { role: true },
  });
  if (!targetMembership) {
    throw new BrainError({
      code: "NOT_FOUND",
      category: "validation",
      message: "Target user is not a member of this organization.",
      remediation: "Check the userId is correct.",
      retryable: false,
      status: 404,
    });
  }

  // Admin cannot remove an owner
  if (callerMembership.role === "admin" && targetMembership.role === "owner") {
    throw new BrainError({
      code: "FORBIDDEN_ORG",
      category: "auth",
      message: "Admins cannot remove org owners.",
      remediation: "Only an org owner can remove another owner.",
      retryable: false,
      status: 403,
    });
  }

  // Protect the last owner
  if (targetMembership.role === "owner") {
    const ownerCount = await db.organizationMember.count({
      where: { orgId, role: "owner" },
    });
    if (ownerCount <= 1) {
      throw new BrainError({
        code: "LAST_OWNER",
        category: "validation",
        message: "Cannot remove the last owner of an organization.",
        remediation: "Promote another member to owner first.",
        retryable: false,
        status: 409,
      });
    }
  }

  await db.organizationMember.delete({
    where: { orgId_userId: { orgId, userId: targetUserId } },
  });
}

// ---------------------------------------------------------------------------
// createOrgInvite
// ---------------------------------------------------------------------------

/**
 * Create an invite token for the given email.
 * Caller must be owner or admin of the org.
 */
export async function createOrgInvite(
  db: PrismaClient,
  callerUserId: string,
  orgId: string,
  email: string,
  role: string,
): Promise<{ inviteId: string; token: string }> {
  const callerMembership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: callerUserId } },
    select: { role: true },
  });
  if (!callerMembership || roleRank(callerMembership.role) < roleRank("admin")) {
    throw new BrainError({
      code: "FORBIDDEN_ORG",
      category: "auth",
      message: "Only org owners or admins can create invites.",
      remediation: "Ensure the caller has at least admin role in this org.",
      retryable: false,
      status: 403,
    });
  }

  // Admins cannot invite owners
  if (callerMembership.role === "admin" && role === "owner") {
    throw new BrainError({
      code: "FORBIDDEN_ORG",
      category: "auth",
      message: "Admins cannot invite new owners.",
      remediation: "Only an org owner can invite another owner.",
      retryable: false,
      status: 403,
    });
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invite = await db.organizationInvite.create({
    data: {
      orgId,
      email: email.toLowerCase().trim(),
      role,
      invitedById: callerUserId,
      token,
      expiresAt,
    },
    select: { id: true },
  });

  return { inviteId: invite.id, token };
}

// ---------------------------------------------------------------------------
// acceptOrgInvite
// ---------------------------------------------------------------------------

/**
 * Accept an invite token and add the user to the org.
 * Idempotent: if the user is already a member, the invite is still marked
 * accepted, but no duplicate member row is created.
 */
export async function acceptOrgInvite(
  db: PrismaClient,
  userId: string,
  token: string,
): Promise<{ orgId: string }> {
  const invite = await db.organizationInvite.findUnique({
    where: { token },
    select: {
      id: true,
      orgId: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
    },
  });

  if (!invite) {
    throw new BrainError({
      code: "NOT_FOUND",
      category: "validation",
      message: "Invite token not found.",
      remediation: "Check the invite link is correct.",
      retryable: false,
      status: 404,
    });
  }
  if (invite.revokedAt) {
    throw new BrainError({
      code: "INVITE_REVOKED",
      category: "validation",
      message: "This invite has been revoked.",
      remediation: "Ask the org admin to create a new invite.",
      retryable: false,
      status: 410,
    });
  }
  if (invite.acceptedAt) {
    throw new BrainError({
      code: "INVITE_ALREADY_ACCEPTED",
      category: "validation",
      message: "This invite has already been accepted.",
      remediation: "Check if you are already a member of the organization.",
      retryable: false,
      status: 409,
    });
  }
  if (invite.expiresAt < new Date()) {
    throw new BrainError({
      code: "INVITE_EXPIRED",
      category: "validation",
      message: "This invite has expired.",
      remediation: "Ask the org admin to create a new invite.",
      retryable: false,
      status: 410,
    });
  }

  await db.$transaction(async (tx) => {
    // Create membership (upsert — idempotent if user somehow already joined)
    await tx.organizationMember.upsert({
      where: { orgId_userId: { orgId: invite.orgId, userId } },
      create: {
        orgId: invite.orgId,
        userId,
        role: invite.role,
      },
      update: {}, // don't downgrade if they're already at a higher role
    });

    // Mark invite accepted
    await tx.organizationInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });
  });

  return { orgId: invite.orgId };
}

// ---------------------------------------------------------------------------
// revokeOrgInvite
// ---------------------------------------------------------------------------

/**
 * Revoke a pending invite. Caller must be owner/admin of the invite's org.
 */
export async function revokeOrgInvite(
  db: PrismaClient,
  callerUserId: string,
  inviteId: string,
): Promise<void> {
  const invite = await db.organizationInvite.findUnique({
    where: { id: inviteId },
    select: { orgId: true, revokedAt: true, acceptedAt: true },
  });

  if (!invite) {
    throw new BrainError({
      code: "NOT_FOUND",
      category: "validation",
      message: "Invite not found.",
      remediation: "Check the invite ID is correct.",
      retryable: false,
      status: 404,
    });
  }

  const callerMembership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId: invite.orgId, userId: callerUserId } },
    select: { role: true },
  });
  if (!callerMembership || roleRank(callerMembership.role) < roleRank("admin")) {
    throw new BrainError({
      code: "FORBIDDEN_ORG",
      category: "auth",
      message: "Only org owners or admins can revoke invites.",
      remediation: "Ensure the caller has at least admin role in this org.",
      retryable: false,
      status: 403,
    });
  }

  if (invite.acceptedAt || invite.revokedAt) {
    // Already in a terminal state — silently succeed (idempotent)
    return;
  }

  await db.organizationInvite.update({
    where: { id: inviteId },
    data: { revokedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// listOrgInvites
// ---------------------------------------------------------------------------

export interface OrgInviteView {
  id: string;
  email: string;
  role: string;
  invitedById: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  status: "active" | "accepted" | "revoked" | "expired";
}

/**
 * Return invites for an org.
 * @param status "active" = pending and not expired; "all" = everything.
 */
export async function listOrgInvites(
  db: PrismaClient,
  orgId: string,
  status: "active" | "all" = "active",
): Promise<OrgInviteView[]> {
  const now = new Date();
  const rows = await db.organizationInvite.findMany({
    where: {
      orgId,
      ...(status === "active"
        ? { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      invitedById: true,
      createdAt: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
    },
  });

  return rows.map((r) => {
    let ivStatus: OrgInviteView["status"] = "active";
    if (r.acceptedAt) ivStatus = "accepted";
    else if (r.revokedAt) ivStatus = "revoked";
    else if (r.expiresAt < now) ivStatus = "expired";
    return { ...r, status: ivStatus };
  });
}

// ---------------------------------------------------------------------------
// getAccessibleProjectIds
// ---------------------------------------------------------------------------

/**
 * Return all project IDs in the given org that the user can access.
 * (All projects in orgs where the user is a member.)
 */
export async function getAccessibleProjectIds(
  db: PrismaClient,
  userId: string,
  orgId: string,
): Promise<string[]> {
  // Verify user is a member of this org
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { id: true },
  });
  if (!membership) return [];

  const projects = await db.project.findMany({
    where: { organizationId: orgId },
    select: { id: true },
  });

  return projects.map((p) => p.id);
}

/**
 * True if `userId` is a member of any organization that owns `projectId`.
 *
 * Used by MCP tools and API routes to gate writes when an unscoped token
 * (or a logged-in user) supplies a `projectId` from the request body —
 * without this check, a caller could tag sessions/knowledge against any
 * project ID they happen to know.
 */
export async function userCanAccessProject(
  db: PrismaClient,
  userId: string,
  projectId: string,
): Promise<boolean> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true },
  });
  if (!project) return false;
  const membership = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId: project.organizationId, userId } },
    select: { id: true },
  });
  return membership !== null;
}
