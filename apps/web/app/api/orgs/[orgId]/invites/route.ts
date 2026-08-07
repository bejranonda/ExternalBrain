/**
 * GET  /api/orgs/:orgId/invites — list active invites (owner/admin only)
 * POST /api/orgs/:orgId/invites — create an invite (owner/admin only)
 *
 * POST returns the invite record plus a copyable invite link, and now
 * optionally sends an email if EMAIL_PROVIDER is configured.
 * Response includes `emailSent: boolean` so the UI can render
 * "✓ Sent to <email>" instead of just the copyable link.
 * If email sending fails, the invite is still returned — no failure regression.
 */
import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import {
  requireOrgMember,
  listOrgInvites,
  createOrgInvite,
  writeAudit,
  sendEmail,
  isEmailConfigured,
  inviteEmail,
  getLogger,
} from "@brain/core";

const log = getLogger("invite-route");

const createSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase().trim()),
  role: z.enum(["owner", "admin", "member"]).default("member"),
});

function getWebUrl(req: Request): string {
  const url = new URL(req.url);
  return (
    process.env.AUTH_URL?.replace(/\/$/, "") ??
    `${url.protocol}//${url.host}`
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { orgId } = await params;

    const { role } = await requireOrgMember(db, userId, orgId);
    if (role !== "owner" && role !== "admin") {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    const invites = await listOrgInvites(db, orgId, "active");

    return Response.json({ invites });
  } catch (err) {
    return authErrorResponse(err);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> },
): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const { orgId } = await params;

    const body = createSchema.parse(await req.json());

    const { inviteId, token } = await createOrgInvite(
      db,
      userId,
      orgId,
      body.email,
      body.role,
    );

    await writeAudit({
      actorUserId: userId,
      action: "org.invite.create",
      targetType: "orgInvite",
      targetId: inviteId,
      payload: { orgId, email: body.email, role: body.role },
    });

    // Fetch the invite record + inviter name + org name for email
    const [invite, inviter, org] = await Promise.all([
      db.organizationInvite.findUnique({
        where: { id: inviteId },
        select: { id: true, email: true, role: true, expiresAt: true },
      }),
      db.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      }),
      db.organization.findUnique({
        where: { id: orgId },
        select: { name: true },
      }),
    ]);

    const webUrl = getWebUrl(req);
    const link = `${webUrl}/accept-invite?token=${token}`;

    let emailSent = false;

    // Only attempt if EMAIL_PROVIDER is configured (non-disabled)
    if (isEmailConfigured() && invite) {
      const inviterName = inviter?.name ?? inviter?.email ?? "A team member";
      const orgName = org?.name ?? orgId;
      const tpl = inviteEmail({
        inviterName,
        orgName,
        acceptLink: link,
        expiresAt: invite.expiresAt.toISOString(),
      });

      const result = await sendEmail({
        to: body.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });

      if (result.ok) {
        emailSent = true;
        log.info(
          { inviteId, to: body.email, messageId: result.messageId },
          "invite email sent",
        );
      } else {
        log.warn(
          { inviteId, to: body.email, reason: result.reason },
          "invite email failed — link still returned for manual handoff",
        );
      }
    }

    return Response.json(
      { invite, link, emailSent },
      { status: 201 },
    );
  } catch (err) {
    return authErrorResponse(err);
  }
}
