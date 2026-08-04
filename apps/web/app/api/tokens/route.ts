import { createHash, randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { writeAudit, ensurePersonalOrg , sanitizeCapabilities, CAPABILITIES } from "@brain/core";

// 90-day default follows best practice for long-lived bearer tokens.
// Callers can override with any positive integer up to 3650 (10y) or set
// `ttlDays: 0` to opt out of expiry entirely (discouraged — requires an
// explicit, visible choice by the user).
const DEFAULT_TTL_DAYS = 90;

const createSchema = z.object({
  name: z.string().min(1).max(80),
  scope: z.enum(["personal", "team"]).default("personal"),
  teamId: z.string().optional(),
  ttlDays: z.number().int().min(0).max(3650).optional(),
  // Phase 3c: optional project-scoping. Null / absent = any project the
  // user has access to (prior behavior unchanged). When set, must be a
  // project the calling user has access to — verified server-side.
  projectId: z.string().optional().nullable(),
  // Token-scope feature: optional organization-scoping. Null / absent =
  // user's personal org (prior behavior). When set, must be an org the
  // user is a member of. When BOTH organizationId and projectId are set,
  // the project must belong to that org.
  organizationId: z.string().optional().nullable(),
  // Capability allow-list. Absent or empty = UNRESTRICTED (prior behaviour
  // for every token that already exists). Unknown slugs are dropped by
  // sanitizeCapabilities rather than rejected, so a client on an older
  // capability vocabulary degrades to a narrower token instead of a 400 —
  // but see the guard below: "asked for restrictions, none survived" must
  // NOT silently become "unrestricted".
  capabilities: z.array(z.string()).optional(),
});

export async function GET(): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const tokens = await db.mCPToken.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        scope: true,
        teamId: true,
        organizationId: true,
        projectId: true,
        capabilities: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        scheduledRevokeAt: true,
        rotatedFromId: true,
      },
    });
    return Response.json({ tokens });
  } catch (err) {
    return authErrorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const body = createSchema.parse(await req.json());
    // bp_ prefix + 32 bytes base64url ≈ 45 chars. Copyable, unambiguous.
    const raw = `bp_${randomBytes(32).toString("base64url")}`;
    const tokenHash = createHash("sha256").update(raw).digest("hex");
    // Resolve the effective TTL: explicit value wins, explicit 0 means
    // "no expiry" (caller opts out), omitted means the default.
    const effectiveTtlDays =
      body.ttlDays === undefined ? DEFAULT_TTL_DAYS : body.ttlDays;
    const expiresAt =
      effectiveTtlDays > 0
        ? new Date(Date.now() + effectiveTtlDays * 86_400_000)
        : null;
    // Resolve organization scope:
    //   - If body.organizationId is set, validate user membership and use it.
    //   - Otherwise fall back to the personal org (matches prior behavior).
    let resolvedOrgId: string;
    if (body.organizationId) {
      const member = await db.organizationMember.findUnique({
        where: { orgId_userId: { orgId: body.organizationId, userId } },
        select: { id: true },
      });
      if (!member) {
        return Response.json(
          { error: "forbidden", message: "Organization not found or not accessible" },
          { status: 403 },
        );
      }
      resolvedOrgId = body.organizationId;
    } else {
      const personal = await ensurePersonalOrg(db, userId);
      resolvedOrgId = personal.orgId;
    }

    // Validate project access when projectId is provided. If
    // organizationId is also set, the project must belong to that org.
    const resolvedProjectId: string | null = body.projectId ?? null;
    if (resolvedProjectId) {
      const project = await db.project.findFirst({
        where: {
          id: resolvedProjectId,
          organizationId: resolvedOrgId,
          organization: { members: { some: { userId } } },
        },
        select: { id: true },
      });
      if (!project) {
        return Response.json(
          {
            error: "forbidden",
            message:
              "Project not found, not accessible, or doesn't belong to the selected organization",
          },
          { status: 403 },
        );
      }
    }

    // Capabilities: [] means unrestricted, so a caller who ASKED for
    // restrictions and had every slug dropped must not silently receive an
    // all-powerful token. Fail instead of guessing.
    const resolvedCapabilities = sanitizeCapabilities(body.capabilities);
    if ((body.capabilities?.length ?? 0) > 0 && resolvedCapabilities.length === 0) {
      return Response.json(
        {
          error: "invalid_capabilities",
          message: `None of the requested capabilities are recognised. Valid: ${CAPABILITIES.join(", ")}.`,
        },
        { status: 400 },
      );
    }

    const row = await db.mCPToken.create({
      data: {
        userId,
        organizationId: resolvedOrgId,
        name: body.name,
        tokenHash,
        scope: body.scope,
        teamId: body.scope === "team" ? (body.teamId ?? null) : null,
        projectId: resolvedProjectId,
        capabilities: resolvedCapabilities,
        ...(expiresAt ? { expiresAt } : {}),
      },
      select: {
        id: true,
        name: true,
        scope: true,
        projectId: true,
        capabilities: true,
        organizationId: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    // Audit W6 (#103): await the audit write so a process restart
    // between the response and the audit insert can't silently drop
    // the row. Token issuance is too security-sensitive to log
    // best-effort — admin's "every admin action is audited" promise
    // in docs/SECURITY.md needs to hold even on crash.
    await writeAudit({
      actorUserId: userId,
      action: "token.create",
      targetType: "token",
      targetId: row.id,
      // raw token intentionally excluded — only safe metadata logged
      payload: {
        name: body.name,
        scope: body.scope,
        expiresAt: row.expiresAt,
        organizationId: row.organizationId ?? null,
        projectId: row.projectId ?? null,
      },
      ip: req.headers.get("x-forwarded-for")?.split(",").at(0)?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
      orgId: resolvedOrgId,
      projectId: row.projectId ?? null,
    });
    // `raw` is returned ONCE on create — never stored, never retrievable again.
    return Response.json({ token: row, raw }, { status: 201 });
  } catch (err) {
    return authErrorResponse(err);
  }
}
