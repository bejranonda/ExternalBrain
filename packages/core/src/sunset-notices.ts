/**
 * `service.sunset_notices` — email every account that the instance is closing
 * (docs/SUNSET.md). Hourly; three stages (announce → 7 days → 1 day), each
 * sent to an account at most once.
 *
 * "At most once" is recorded as an AuditLog row per account and stage
 * (`service.sunset_notice.<stage>`), written only after the provider accepted
 * the message — so a failed send is retried next hour, and a crash between
 * send and record can duplicate one email but never skip a stage. AuditLog is
 * append-only, which is exactly the property a send log needs.
 *
 * Off unless `SERVICE_SUNSET_EMAILS` says otherwise: `dry_run` logs who would
 * get which stage and sends nothing, `send` sends. The operator looks at the
 * dry run before turning it on — an email cannot be recalled.
 */
import { promises as dns } from "node:dns";
import { db } from "@brain/db";
import { getLogger } from "./logger.js";
import { isEmailConfigured, sendEmail } from "./email.js";
import { serviceSunsetEmail } from "./email-templates.js";
import {
  parseServiceSunset,
  sunsetEmailStage,
  SELF_HOST_GUIDE_URL,
  type SunsetEmailStage,
} from "./sunset.js";

const log = getLogger("sunset-notices");

export type SunsetEmailMode = "off" | "dry_run" | "send";

export function sunsetEmailMode(env: Record<string, string | undefined> = process.env): SunsetEmailMode {
  const v = env.SERVICE_SUNSET_EMAILS?.trim().toLowerCase();
  return v === "send" || v === "dry_run" ? v : "off";
}

export const SUNSET_NOTICE_ACTION = (stage: SunsetEmailStage) => `service.sunset_notice.${stage}`;

/** true / false, or "unknown" for a DNS failure that may clear by next hour. */
export type MailHostCheck = (domain: string) => Promise<boolean | "unknown">;

const NO_RECORD = new Set(["ENOTFOUND", "ENODATA", "ENONAME"]);

export const resolveMailHost: MailHostCheck = async (domain) => {
  // RFC 5321 §5.1: no MX record means the A/AAAA host itself takes mail.
  for (const lookup of [() => dns.resolveMx(domain), () => dns.resolve4(domain), () => dns.resolve6(domain)]) {
    try {
      if ((await lookup()).length > 0) return true;
    } catch (err) {
      if (!NO_RECORD.has((err as NodeJS.ErrnoException).code ?? "")) return "unknown";
    }
  }
  return false;
};

export interface SunsetNoticeDeps {
  now?: Date;
  mode?: SunsetEmailMode;
  send?: typeof sendEmail;
  mailHost?: MailHostCheck;
  pauseMs?: number;
}

export type SunsetNoticeResult =
  | { skipped: "no_sunset" | "emails_off" | "after_sunset" }
  | {
      stage: SunsetEmailStage;
      mode: Exclude<SunsetEmailMode, "off">;
      due: number;
      sent: number;
      alreadySent: number;
      noMailHost: number;
      failed: number;
    };

const mask = (email: string) => {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 3)}…@${domain}`;
};

export async function runSunsetNotices(deps: SunsetNoticeDeps = {}): Promise<SunsetNoticeResult> {
  const now = deps.now ?? new Date();
  const mode = deps.mode ?? sunsetEmailMode();
  const send = deps.send ?? sendEmail;
  const mailHost = deps.mailHost ?? resolveMailHost;
  const pauseMs = deps.pauseMs ?? 600;

  const parsed = parseServiceSunset();
  // Thrown, not skipped: the operator believes users are being told.
  if (!parsed.ok) throw new Error(`sunset setting invalid: ${parsed.error}`);
  const sunset = parsed.sunset;
  if (!sunset) return { skipped: "no_sunset" };
  if (mode === "off") return { skipped: "emails_off" };
  const stage = sunsetEmailStage(sunset, now);
  if (!stage) return { skipped: "after_sunset" };

  const host = process.env.BRAIN_PUBLIC_HOSTNAME?.trim();
  const webUrl = host ? `https://${host}` : process.env.AUTH_URL?.trim().replace(/\/$/, "");
  if (!webUrl) throw new Error("sunset notices need BRAIN_PUBLIC_HOSTNAME or AUTH_URL for their links");
  if (mode === "send" && !isEmailConfigured()) throw new Error("sunset notices: email delivery is not configured");

  const tpl = serviceSunsetEmail({
    stage,
    kind: sunset.kind,
    sunsetAt: sunset.at.toISOString(),
    deleteAt: sunset.deleteAt.toISOString(),
    webUrl,
    guideUrl: SELF_HOST_GUIDE_URL,
  });

  const users = await db.user.findMany({
    // Erased accounts keep their row with a placeholder address (PRIVACY §5).
    where: { NOT: { email: { endsWith: "@deleted.local" } } },
    select: { id: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  const done = new Set(
    (
      await db.auditLog.findMany({
        where: { action: SUNSET_NOTICE_ACTION(stage), targetType: "user" },
        select: { targetId: true },
      })
    ).map((r) => r.targetId),
  );

  const result = { stage, mode, due: 0, sent: 0, alreadySent: 0, noMailHost: 0, failed: 0 };
  const mailHostOf = new Map<string, boolean | "unknown">();
  for (const user of users) {
    if (done.has(user.id)) {
      result.alreadySent++;
      continue;
    }
    const domain = user.email.split("@")[1]?.toLowerCase() ?? "";
    if (!mailHostOf.has(domain)) mailHostOf.set(domain, domain ? await mailHost(domain) : false);
    const reachable = mailHostOf.get(domain);
    if (reachable === false) {
      result.noMailHost++;
      log.info({ op: "service.sunset_notices", userId: user.id, domain, outcome: "no_mail_host" }, "sunset notice skipped");
      continue;
    }
    if (reachable === "unknown") {
      result.failed++;
      continue;
    }
    result.due++;
    if (mode === "dry_run") {
      log.info({ op: "service.sunset_notices", stage, userId: user.id, to: mask(user.email), outcome: "dry_run" }, "sunset notice (dry run)");
      continue;
    }
    const res = await send({ to: user.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    if (!res.ok) {
      result.failed++;
      log.warn({ op: "service.sunset_notices", stage, userId: user.id, reason: res.reason }, "sunset notice failed");
    } else {
      await db.auditLog.create({
        data: {
          action: SUNSET_NOTICE_ACTION(stage),
          targetType: "user",
          targetId: user.id,
          payload: { stage, messageId: res.messageId ?? null, sunsetAt: sunset.at.toISOString() },
        },
      });
      result.sent++;
    }
    // Resend's default ceiling is 2 requests per second.
    if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return result;
}
