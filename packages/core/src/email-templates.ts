/**
 * Transactional email templates for Brain Platform.
 *
 * Two templates:
 *  - inviteEmail     — sent when an org admin creates an invite (if email is configured)
 *  - passwordResetEmail — sent when a user requests a password reset
 *
 * Plain string interpolation only — no templating library dependency.
 * HTML is minimal and inline-styled so it renders in every mail client.
 * Plaintext companion is always included for accessibility + spam scoring.
 */

// ---------------------------------------------------------------------------
// Shared layout helpers
// ---------------------------------------------------------------------------

function htmlWrap(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0e11;color:#ececf0;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0e11;">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="520" cellpadding="0" cellspacing="0"
        style="background:#171820;border:1px solid #23242c;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:8px 28px 6px;background:#0d0e11;border-bottom:1px solid #23242c;">
          <span style="font-size:13px;font-weight:600;letter-spacing:0.04em;color:#7aa2f7;">
            Brain Platform
          </span>
        </td></tr>
        <tr><td style="padding:28px 28px 32px;">${body}</td></tr>
        <tr><td style="padding:14px 28px;background:#0d0e11;border-top:1px solid #23242c;
          font-size:11px;color:#6b6d7a;line-height:1.5;">
          This is a transactional message from Brain Platform. If you did not expect
          this email, you can safely ignore it.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const CTABtn = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;margin-top:20px;padding:10px 22px;
    background:#7aa2f7;color:#0d0e11;border-radius:8px;font-size:14px;font-weight:600;
    text-decoration:none;">${label}</a>`;

// ---------------------------------------------------------------------------
// Invite email
// ---------------------------------------------------------------------------

export interface InviteEmailArgs {
  inviterName: string;
  orgName: string;
  acceptLink: string;
  expiresAt: string; // ISO
}

export interface TemplateResult {
  subject: string;
  html: string;
  text: string;
}

export function inviteEmail(args: InviteEmailArgs): TemplateResult {
  const { inviterName, orgName, acceptLink, expiresAt } = args;
  const expiry = new Date(expiresAt).toUTCString();

  const subject = `${inviterName} invited you to ${orgName} on Brain Platform`;

  const htmlBody = `
<p style="margin:0 0 8px;font-size:18px;font-weight:500;color:#ececf0;">
  You&rsquo;ve been invited
</p>
<p style="margin:0 0 16px;font-size:13px;color:#9a9cab;line-height:1.6;">
  <strong style="color:#ececf0;">${escHtml(inviterName)}</strong> has invited you to join
  <strong style="color:#ececf0;">${escHtml(orgName)}</strong> on Brain Platform.
</p>
<p style="margin:0 0 4px;font-size:12px;color:#6b6d7a;">
  Click the button below to accept the invite and set up your account.
  The link expires on ${escHtml(expiry)}.
</p>
${CTABtn(acceptLink, "Accept invite")}
<p style="margin:24px 0 0;font-size:11px;color:#6b6d7a;">
  Or copy this URL into your browser:<br>
  <a href="${acceptLink}" style="color:#7aa2f7;word-break:break-all;">${escHtml(acceptLink)}</a>
</p>`;

  const text = `You've been invited to ${orgName} on Brain Platform

${inviterName} has invited you to join ${orgName}. Click the link below to accept:

${acceptLink}

The invite link expires on: ${expiry}

If you did not expect this email, you can safely ignore it.`;

  return { subject, html: htmlWrap(htmlBody), text };
}

// ---------------------------------------------------------------------------
// Password reset email
// ---------------------------------------------------------------------------

export interface PasswordResetEmailArgs {
  userName: string;
  resetLink: string;
  expiresAt: string; // ISO
}

export function passwordResetEmail(args: PasswordResetEmailArgs): TemplateResult {
  const { userName, resetLink, expiresAt } = args;
  const expiry = new Date(expiresAt).toUTCString();

  const subject = "Reset your Brain Platform password";

  const htmlBody = `
<p style="margin:0 0 8px;font-size:18px;font-weight:500;color:#ececf0;">
  Password reset request
</p>
<p style="margin:0 0 16px;font-size:13px;color:#9a9cab;line-height:1.6;">
  Hi <strong style="color:#ececf0;">${escHtml(userName)}</strong>, we received a request to
  reset the password for your Brain Platform account.
</p>
<p style="margin:0 0 4px;font-size:12px;color:#6b6d7a;">
  Click the button below to choose a new password.
  This link is valid for one hour (expires ${escHtml(expiry)})
  and can only be used once.
</p>
${CTABtn(resetLink, "Reset password")}
<p style="margin:18px 0 0;font-size:12px;color:#9a9cab;line-height:1.5;
  padding:12px;background:rgba(217,119,87,0.07);border:1px solid rgba(217,119,87,0.25);
  border-radius:6px;">
  <strong>Did not request this?</strong> Do not click the link — your password will remain
  unchanged. Someone may have entered your email by mistake.
</p>
<p style="margin:16px 0 0;font-size:11px;color:#6b6d7a;">
  Or copy this URL into your browser:<br>
  <a href="${resetLink}" style="color:#7aa2f7;word-break:break-all;">${escHtml(resetLink)}</a>
</p>`;

  const text = `Password reset request — Brain Platform

Hi ${userName},

We received a request to reset your Brain Platform password.

Click the link below (valid for 1 hour, one-time use):

${resetLink}

Expires: ${expiry}

DID NOT REQUEST THIS? Do not click the link. Your password remains unchanged.
Someone may have entered your email address by mistake.

If you did not expect this email, you can safely ignore it.`;

  return { subject, html: htmlWrap(htmlBody), text };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
