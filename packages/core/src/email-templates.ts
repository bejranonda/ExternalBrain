/**
 * Transactional email templates for External Brain.
 *
 * Four templates:
 *  - inviteEmail     — sent when an org admin creates an invite (if email is configured)
 *  - passwordResetEmail — sent when a user requests a password reset
 *  - confirmEmailEmail  — sent after self-registration; the account signs in only once it is confirmed
 *  - serviceSunsetEmail — the instance is closing; sent by the worker at three stages
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
            External Brain
          </span>
        </td></tr>
        <tr><td style="padding:28px 28px 32px;">${body}</td></tr>
        <tr><td style="padding:14px 28px;background:#0d0e11;border-top:1px solid #23242c;
          font-size:11px;color:#6b6d7a;line-height:1.5;">
          This is a transactional message from External Brain. If you did not expect
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

  const subject = `${inviterName} invited you to ${orgName} on External Brain`;

  const htmlBody = `
<p style="margin:0 0 8px;font-size:18px;font-weight:500;color:#ececf0;">
  You&rsquo;ve been invited
</p>
<p style="margin:0 0 16px;font-size:13px;color:#9a9cab;line-height:1.6;">
  <strong style="color:#ececf0;">${escHtml(inviterName)}</strong> has invited you to join
  <strong style="color:#ececf0;">${escHtml(orgName)}</strong> on External Brain.
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

  const text = `You've been invited to ${orgName} on External Brain

${inviterName} has invited you to join ${orgName}. Click the link below to accept:

${acceptLink}

The invite link expires on: ${expiry}

If you did not expect this email, you can safely ignore it.`;

  return { subject, html: htmlWrap(htmlBody), text };
}

// ---------------------------------------------------------------------------
// Signup confirmation email
// ---------------------------------------------------------------------------

export interface ConfirmEmailArgs {
  confirmLink: string;
  expiresAt: string; // ISO
}

export function confirmEmailEmail(args: ConfirmEmailArgs): TemplateResult {
  const { confirmLink, expiresAt } = args;
  const expiry = new Date(expiresAt).toUTCString();

  const subject = "Confirm your email for External Brain";

  const htmlBody = `
<p style="margin:0 0 8px;font-size:18px;font-weight:500;color:#ececf0;">
  Confirm your email
</p>
<p style="margin:0 0 16px;font-size:13px;color:#9a9cab;line-height:1.6;">
  Someone created an External Brain account with this address. Confirm it is
  yours and the account can sign in.
</p>
<p style="margin:0 0 4px;font-size:12px;color:#6b6d7a;">
  The link is valid until ${escHtml(expiry)} and can only be used once.
</p>
${CTABtn(confirmLink, "Confirm my email")}
<p style="margin:18px 0 0;font-size:12px;color:#9a9cab;line-height:1.5;
  padding:12px;background:rgba(217,119,87,0.07);border:1px solid rgba(217,119,87,0.25);
  border-radius:6px;">
  <strong>Did not sign up?</strong> Do not confirm. Without confirmation the account
  cannot sign in, and you can claim the address any time with &ldquo;Forgot password&rdquo;.
</p>
<p style="margin:16px 0 0;font-size:11px;color:#6b6d7a;">
  Or copy this URL into your browser:<br>
  <a href="${confirmLink}" style="color:#7aa2f7;word-break:break-all;">${escHtml(confirmLink)}</a>
</p>`;

  const text = `Confirm your email — External Brain

Someone created an External Brain account with this address. Confirm it is
yours and the account can sign in:

${confirmLink}

Valid until: ${expiry} (one-time use)

DID NOT SIGN UP? Do not confirm. Without confirmation the account cannot sign
in, and you can claim the address any time with "Forgot password".`;

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

  const subject = "Reset your External Brain password";

  const htmlBody = `
<p style="margin:0 0 8px;font-size:18px;font-weight:500;color:#ececf0;">
  Password reset request
</p>
<p style="margin:0 0 16px;font-size:13px;color:#9a9cab;line-height:1.6;">
  Hi <strong style="color:#ececf0;">${escHtml(userName)}</strong>, we received a request to
  reset the password for your External Brain account.
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

  const text = `Password reset request — External Brain

Hi ${userName},

We received a request to reset your External Brain password.

Click the link below (valid for 1 hour, one-time use):

${resetLink}

Expires: ${expiry}

DID NOT REQUEST THIS? Do not click the link. Your password remains unchanged.
Someone may have entered your email address by mistake.

If you did not expect this email, you can safely ignore it.`;

  return { subject, html: htmlWrap(htmlBody), text };
}

// ---------------------------------------------------------------------------
// Service sunset notice (docs/SUNSET.md)
// ---------------------------------------------------------------------------

export interface SunsetEmailArgs {
  stage: "announce" | "week" | "final";
  kind: "trial" | "closure";
  sunsetAt: string; // ISO
  deleteAt: string; // ISO
  webUrl: string;
  guideUrl: string;
}

interface SunsetCopy {
  lang: "en" | "th" | "de";
  title: string;
  lead: string;
  stageLine: string | null;
  points: string[];
  cta: string;
  guide: string;
  questions: string;
}

/**
 * English, Thai and German in one message: accounts carry no language
 * preference (the UI locale is a cookie), and this is the one mail every
 * account gets. English first, since it is the instance's default.
 */
export function serviceSunsetEmail(args: SunsetEmailArgs): TemplateResult {
  const at = new Date(args.sunsetAt);
  const del = new Date(args.deleteAt);
  const host = args.webUrl.replace(/^https?:\/\//, "");
  const dataUrl = `${args.webUrl}/settings/data`;
  const trial = args.kind === "trial";
  const fmt = (locale: string, timeZone: string, d: Date, withTime: boolean, zoneName = true) =>
    new Intl.DateTimeFormat(locale, {
      ...(withTime ? { weekday: "long", hour: "2-digit", minute: "2-digit" } : {}),
      ...(withTime && zoneName ? { timeZoneName: "short" } : {}),
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone,
    } as Intl.DateTimeFormatOptions).format(d);
  const at24 = (timeZone: string) =>
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(at);

  const enDay = fmt("en-GB", "UTC", at, false);
  const thDay = fmt("th-TH", "Asia/Bangkok", at, false);
  const deDay = fmt("de-DE", "Europe/Berlin", at, false);
  const cmd = "claude mcp remove brain";

  const copies: SunsetCopy[] = [
    {
      lang: "en",
      title: trial ? `Your External Brain trial ends on ${enDay}` : `External Brain closes on ${enDay}`,
      lead:
        (trial
          ? `Thank you for trying External Brain. The hosted trial at ${host} ends on `
          : `Thank you for using External Brain. The service at ${host} closes on `) +
        `${fmt("en-GB", "UTC", at, true)} (${at24("Europe/Berlin")} Berlin, ${at24("Asia/Bangkok")} Bangkok).`,
      stageLine:
        args.stage === "week" ? "A reminder: 7 days left."
        : args.stage === "final" ? (trial ? "A last reminder: the trial ends tomorrow." : "A last reminder: the service closes tomorrow.")
        : null,
      points: [
        "Until then, everything works as usual.",
        "Take your knowledge with you: Settings → Your data → Download. Markdown for CLAUDE.md / AGENTS.md, or a JSON backup.",
        "Keep going on your own: External Brain is open source. Run your own Brain with Docker, then import the JSON file under Settings → Your data.",
        `After that, this server no longer answers. Remove it from your AI tool — in Claude Code: ${cmd}`,
        `On ${fmt("en-GB", "UTC", del, false)} all accounts and data are deleted, including backups.`,
      ],
      cta: "Download my data",
      guide: "Run your own Brain",
      questions: "Questions? Just reply to this email.",
    },
    {
      lang: "th",
      title: trial ? `ช่วงทดลองใช้ External Brain จะสิ้นสุดในวันที่ ${thDay}` : `External Brain จะปิดให้บริการในวันที่ ${thDay}`,
      lead:
        (trial
          ? `ขอบคุณที่ร่วมทดลองใช้ External Brain ช่วงทดลองใช้บน ${host} จะสิ้นสุดใน`
          : `ขอบคุณที่ใช้งาน External Brain บริการบน ${host} จะปิดใน`) +
        `${fmt("th-TH", "Asia/Bangkok", at, true, false)} น. (เวลาประเทศไทย)`,
      stageLine:
        args.stage === "week" ? "แจ้งเตือน: เหลืออีก 7 วัน"
        : args.stage === "final" ? (trial ? "แจ้งเตือนครั้งสุดท้าย: ช่วงทดลองใช้จะสิ้นสุดในวันพรุ่งนี้" : "แจ้งเตือนครั้งสุดท้าย: บริการจะปิดในวันพรุ่งนี้")
        : null,
      points: [
        "ระหว่างนี้ทุกอย่างยังใช้งานได้ตามปกติ",
        "นำความรู้ของคุณไปด้วย: ไปที่ ตั้งค่า → ข้อมูลของคุณ → ดาวน์โหลด จะได้ไฟล์ Markdown สำหรับ CLAUDE.md / AGENTS.md หรือไฟล์สำรองแบบ JSON",
        "ใช้งานต่อได้ด้วยตัวเอง: External Brain เป็นโอเพนซอร์ส คุณติดตั้ง Brain ของคุณเองได้ด้วย Docker แล้วนำเข้าไฟล์ JSON ที่ ตั้งค่า → ข้อมูลของคุณ",
        `หลังจากนั้นเซิร์ฟเวอร์นี้จะหยุดให้บริการ โปรดลบออกจากเครื่องมือ AI ของคุณ — ใน Claude Code ใช้คำสั่ง ${cmd}`,
        `ในวันที่ ${fmt("th-TH", "Asia/Bangkok", del, false)} บัญชีและข้อมูลทั้งหมดจะถูกลบ รวมถึงข้อมูลสำรอง`,
      ],
      cta: "ดาวน์โหลดข้อมูลของฉัน",
      guide: "ติดตั้ง Brain ของคุณเอง",
      questions: "มีคำถาม? ตอบกลับอีเมลนี้ได้เลย",
    },
    {
      lang: "de",
      title: trial ? `Deine Testphase von External Brain endet am ${deDay}` : `External Brain wird am ${deDay} eingestellt`,
      lead:
        (trial
          ? `Danke, dass du External Brain ausprobiert hast. Die gehostete Testphase auf ${host} endet am `
          : `Danke, dass du External Brain nutzt. Der Dienst auf ${host} wird eingestellt am `) +
        `${fmt("de-DE", "Europe/Berlin", at, true, false)} Uhr (${new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "MEZ"}).`,
      stageLine:
        args.stage === "week" ? "Erinnerung: noch 7 Tage."
        : args.stage === "final" ? (trial ? "Letzte Erinnerung: Die Testphase endet morgen." : "Letzte Erinnerung: Der Dienst wird morgen eingestellt.")
        : null,
      points: [
        "Bis dahin funktioniert alles wie gewohnt.",
        "Nimm dein Wissen mit: Einstellungen → Deine Daten → Herunterladen. Als Markdown für CLAUDE.md / AGENTS.md oder als JSON-Sicherung.",
        "Mach selbst weiter: External Brain ist Open Source. Betreibe dein eigenes Brain mit Docker und importiere dort die JSON-Datei unter Einstellungen → Deine Daten.",
        `Danach antwortet dieser Server nicht mehr. Entferne ihn aus deinem KI-Werkzeug – in Claude Code: ${cmd}`,
        `Am ${fmt("de-DE", "Europe/Berlin", del, false)} werden alle Konten und Daten gelöscht, auch die Sicherungen.`,
      ],
      cta: "Meine Daten herunterladen",
      guide: "Eigenes Brain betreiben",
      questions: "Fragen? Antworte einfach auf diese E-Mail.",
    },
  ];

  const en = copies[0]!;
  const subject =
    args.stage === "final"
      ? (trial ? "Tomorrow: your External Brain trial ends — download your data" : "Tomorrow: External Brain closes — download your data")
      : args.stage === "week"
        ? `7 days left: ${en.title.charAt(0).toLowerCase()}${en.title.slice(1)}`
        : en.title;

  const htmlSection = (c: SunsetCopy, first: boolean) => `
<div lang="${c.lang}" style="${first ? "" : "margin-top:28px;padding-top:24px;border-top:1px solid #23242c;"}">
<p style="margin:0 0 8px;font-size:18px;font-weight:500;color:#ececf0;">${escHtml(c.title)}</p>
${c.stageLine ? `<p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#d97757;">${escHtml(c.stageLine)}</p>` : ""}
<p style="margin:0 0 12px;font-size:13px;color:#9a9cab;line-height:1.6;">${escHtml(c.lead)}</p>
<ul style="margin:0 0 4px;padding-left:18px;font-size:13px;color:#9a9cab;line-height:1.6;">
${c.points.map((p) => `  <li style="margin-bottom:6px;">${escHtml(p)}</li>`).join("\n")}
</ul>
${CTABtn(dataUrl, escHtml(c.cta))}
<p style="margin:14px 0 0;font-size:12px;"><a href="${args.guideUrl}" style="color:#7aa2f7;">${escHtml(c.guide)} →</a></p>
<p style="margin:14px 0 0;font-size:12px;color:#6b6d7a;">${escHtml(c.questions)}</p>
</div>`;

  const htmlBody = `
<p style="margin:0 0 18px;font-size:11px;color:#6b6d7a;">ภาษาไทยด้านล่าง · Deutsch weiter unten</p>
${copies.map((c, i) => htmlSection(c, i === 0)).join("\n")}`;

  const textSection = (c: SunsetCopy) =>
    [
      c.title,
      ...(c.stageLine ? [c.stageLine] : []),
      "",
      c.lead,
      "",
      ...c.points.map((p) => `- ${p}`),
      "",
      `${c.cta}: ${dataUrl}`,
      `${c.guide}: ${args.guideUrl}`,
      "",
      c.questions,
    ].join("\n");

  const text = copies.map(textSection).join("\n\n----------------------------------------\n\n");

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
