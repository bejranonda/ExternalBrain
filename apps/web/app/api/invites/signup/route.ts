/**
 * POST /api/invites/signup
 *
 * Invite-based sign-up without GitHub OAuth. The caller is anonymous.
 *
 * Body:  { token: string; name: string; password: string }
 * Returns: { ok: true; redirectTo: string } on success.
 *
 * Flow (all inside a single DB transaction):
 *  1. Validate invite token — not revoked/expired/already-accepted.
 *  2. Look up or create a User row for invite.email.
 *     - If the User already exists (previously created via OAuth or admin),
 *       we skip credential creation and just accept the invite + add member.
 *       The response includes `existingUser: true` so the client can show
 *       "sign in with existing password" instead.
 *  3. Create UserCredential (bcrypt cost 12) for new users.
 *  4. Mark invite acceptedAt.
 *  5. Create OrganizationMember with invite's role (upsert — idempotent).
 *  6. Run ensurePersonalOrg + ensureDefaultProject for the new user.
 *  7. Return redirectTo pointing at the invited org's first project.
 */
import { db } from "@brain/db";
import { hashSecret } from "@brain/core/secret-hash";
import { z } from "zod";
import {
  createUserCredential,
  validatePasswordPolicy,
} from "@/lib/brain/user-credentials";
import {
  ensurePersonalOrg,
  ensureDefaultProject,
  writeAudit,
} from "@brain/core";

// Audit FE3 (#103): enforce the documented min-8 password policy at the
// route boundary. The `claimVoucher` flow eventually calls
// `validatePasswordPolicy` internally, but a boundary check refuses
// weak passwords cheaply and consistently with /api/me/password.
const bodySchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(120),
  password: z.string().min(8),
});

export async function POST(req: Request): Promise<Response> {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err) {
    if (err && typeof err === "object" && (err as { name?: string }).name === "ZodError") {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const { token, name, password } = body;

  // Validate password policy before hitting the DB.
  try {
    validatePasswordPolicy(password);
  } catch {
    return Response.json(
      { error: "weak_password", message: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  // Look up the invite.
  const invite = await db.organizationInvite.findUnique({
    where: { tokenHash: hashSecret(token) },
    select: {
      id: true,
      orgId: true,
      email: true,
      role: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      organization: {
        select: {
          slug: true,
          projects: { select: { slug: true }, take: 1, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });

  if (!invite) {
    return Response.json({ error: "invite_not_found" }, { status: 404 });
  }
  if (invite.revokedAt) {
    return Response.json({ error: "invite_revoked" }, { status: 410 });
  }
  if (invite.acceptedAt) {
    return Response.json({ error: "invite_already_accepted" }, { status: 409 });
  }
  if (invite.expiresAt < new Date()) {
    return Response.json({ error: "invite_expired" }, { status: 410 });
  }

  const inviteEmail = invite.email.toLowerCase();

  // Check whether a User for this email already exists.
  const existingUser = await db.user.findUnique({
    where: { email: inviteEmail },
    select: { id: true, email: true, name: true },
  });

  if (existingUser) {
    // Existing user — just accept invite + add org membership; skip credential.
    await db.$transaction(async (tx) => {
      await tx.organizationMember.upsert({
        where: { orgId_userId: { orgId: invite.orgId, userId: existingUser.id } },
        create: { orgId: invite.orgId, userId: existingUser.id, role: invite.role },
        update: {},
      });
      await tx.organizationInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
    });

    await writeAudit({
      actorUserId: existingUser.id,
      action: "org.invite.accept",
      targetType: "organization",
      targetId: invite.orgId,
      payload: { orgId: invite.orgId, viaSignup: true, existingUser: true },
    });

    const orgSlug = invite.organization.slug;
    const projectSlug = invite.organization.projects[0]?.slug ?? "default";
    const redirectTo = `/${orgSlug}/${projectSlug}`;
    return Response.json({ ok: true, redirectTo, existingUser: true });
  }

  // New user — create User + Credential + OrgMember atomically.
  let newUserId: string;
  try {
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: inviteEmail,
          name: name.trim(),
          role: "user",
        },
        select: { id: true },
      });

      // createUserCredential calls db.userCredential.create; we need to pass
      // the transaction client. Since createUserCredential uses the passed-in
      // db arg, we cast tx to the expected type.
      await createUserCredential(tx as Parameters<typeof createUserCredential>[0], user.id, password);

      await tx.organizationMember.create({
        data: { orgId: invite.orgId, userId: user.id, role: invite.role },
      });

      await tx.organizationInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });

      return user;
    });
    newUserId = result.id;
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      (err as { code?: string }).code === "P2002"
    ) {
      // Unique constraint — race condition on email; rare but possible.
      return Response.json({ error: "email_taken" }, { status: 409 });
    }
    throw err;
  }

  // Bootstrap personal org + default project outside the main transaction
  // (idempotent helpers, failures must not roll back the main write).
  try {
    await ensurePersonalOrg(db, newUserId);
    await ensureDefaultProject(db, newUserId);
  } catch (e) {
    console.error("[invites/signup] ensurePersonalOrg/ensureDefaultProject failed:", e);
  }

  await writeAudit({
    actorUserId: newUserId,
    action: "org.invite.accept",
    targetType: "organization",
    targetId: invite.orgId,
    payload: { orgId: invite.orgId, viaSignup: true },
  });

  const orgSlug = invite.organization.slug;
  const projectSlug = invite.organization.projects[0]?.slug ?? "default";
  const redirectTo = `/${orgSlug}/${projectSlug}`;
  return Response.json({ ok: true, redirectTo });
}
