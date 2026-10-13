/**
 * /confirm-email — the signup confirmation link lands here (KNOWN_ISSUES §0bb).
 *
 * Opening the link does NOT confirm: mail scanners and link previewers fetch
 * URLs on their own, and an auto-confirming GET would let someone who
 * registered another person's address get it confirmed by that person's spam
 * filter. Confirmation is a POST that also takes the account's password, so
 * the real owner clicking an unsolicited mail cannot confirm it either.
 *
 * States, by query: `token` (confirm button), `done`, `sent` (just
 * registered), `pending` (sign-in refused), `resent`, `error`.
 */
import { headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { db } from "@brain/db";
import { rateLimitCheck, writeAudit } from "@brain/core";
import { LocalePicker } from "@/components/brain/locale-picker";
import { getServerT } from "@/lib/brain/i18n-server";
import { clientIpFrom } from "@/lib/brain/client-ip";
import { getRateLimitStore } from "@/lib/brain/rate-limit-store";
import {
  confirmEmailToken,
  emailConfirmPending,
  issueEmailConfirmation,
} from "@/lib/brain/email-confirm";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{
    token?: string;
    done?: string;
    sent?: string;
    pending?: string;
    resent?: string;
    error?: string;
  }>;
}

const ERROR_KEYS = new Set(["invalid_token", "expired_token", "invalid_credentials", "login_rate_limited"]);
const RESEND_LIMIT = { name: "confirm_resend", max: 3, windowMs: 60 * 60 * 1000 };
const CONFIRM_LIMIT = { name: "confirm_attempt", max: 10, windowMs: 60 * 60 * 1000 };

async function confirmAction(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!token) redirect("/confirm-email?error=invalid_token");
  const retry = (error: string) =>
    redirect(`/confirm-email?token=${encodeURIComponent(token)}&error=${error}`);
  const store = await getRateLimitStore();
  const gate = await rateLimitCheck(
    store,
    `confirm_attempt:${clientIpFrom(await headers())}`,
    CONFIRM_LIMIT,
    Date.now(),
  );
  if (!gate.ok) retry("login_rate_limited");
  const outcome = await confirmEmailToken(token, password);
  if (!outcome.ok) {
    if (outcome.error === "invalid_credentials") retry("invalid_credentials");
    redirect(`/confirm-email?error=${outcome.error}`);
  }
  await writeAudit({
    actorUserId: outcome.userId,
    action: "user.email_confirm",
    targetType: "user",
    targetId: outcome.userId,
    payload: {},
    ip: clientIpFrom(await headers()),
  });
  redirect("/confirm-email?done=1");
}

async function resendAction(formData: FormData) {
  "use server";
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const hdrs = await headers();
  const ip = clientIpFrom(hdrs);
  const store = await getRateLimitStore();
  const now = Date.now();
  // Per IP and per address: the second stops one inbox being flooded from
  // many addresses. The answer is the same whether or not anything was sent.
  const byIp = await rateLimitCheck(store, `confirm_resend:ip:${ip}`, RESEND_LIMIT, now);
  const byEmail = await rateLimitCheck(store, `confirm_resend:email:${email}`, RESEND_LIMIT, now);
  if (email && byIp.ok && byEmail.ok) {
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true, emailConfirmRequired: true, emailVerifiedAt: true },
    });
    // After the response, so its timing doesn't tell a pending account apart.
    if (user && emailConfirmPending(user)) after(() => issueEmailConfirmation(user.id, user.email));
  }
  redirect("/confirm-email?resent=1");
}

export default async function ConfirmEmailPage({ searchParams }: Props) {
  const t = await getServerT();
  const params = await searchParams;
  const token = params.token ?? "";
  const errorKey = ERROR_KEYS.has(params.error ?? "") ? (params.error as string) : "";
  // A wrong password or a throttle keeps the link usable: stay on its form.
  const linkStillUsable = errorKey === "invalid_credentials" || errorKey === "login_rate_limited";

  const box: React.CSSProperties = {
    fontSize: 13,
    color: "var(--ink-3, #9a9cab)",
    marginBottom: 20,
    padding: "12px 14px",
    background: "rgba(122,162,247,0.07)",
    border: "1px solid rgba(122,162,247,0.25)",
    borderRadius: 6,
    lineHeight: 1.6,
  };
  const warnBox: React.CSSProperties = {
    ...box,
    color: "var(--warn, #d97757)",
    background: "rgba(217,119,87,0.08)",
    border: "1px solid rgba(217,119,87,0.3)",
  };
  const primaryBtn: React.CSSProperties = {
    display: "inline-block",
    padding: "10px 22px",
    background: "var(--accent, #7aa2f7)",
    color: "var(--accent-ink, #0d0e11)",
    border: "none",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 500,
    textDecoration: "none",
    cursor: "pointer",
  };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    fontSize: 13,
    fontFamily: "var(--font-mono, ui-monospace), monospace",
    background: "var(--bg, #0d0e11)",
    color: "var(--ink, #ececf0)",
    border: "1px solid var(--line, #23242c)",
    borderRadius: 6,
    boxSizing: "border-box",
    marginBottom: 12,
  };

  const resendForm = (
    <form action={resendAction}>
      <label style={{ display: "block" }}>
        <span style={{ display: "block", fontSize: 12, color: "var(--ink-4, #6b6d7a)", marginBottom: 6 }}>
          {t("auth.email")}
        </span>
        <input type="email" name="email" required autoComplete="email" style={inputStyle} />
      </label>
      <button type="submit" style={primaryBtn}>
        {t("auth.confirmResend")}
      </button>
    </form>
  );

  let body: React.ReactNode;
  if (params.done === "1") {
    body = (
      <>
        <div role="status" style={box}>
          <strong style={{ color: "var(--ink, #ececf0)" }}>{t("auth.confirmDone")}</strong>
          <br />
          {t("auth.confirmDoneBody")}
        </div>
        <a href="/signin" style={primaryBtn}>{t("auth.goToSignIn")}</a>
      </>
    );
  } else if (token && (!errorKey || linkStillUsable)) {
    body = (
      <>
        <div style={{ fontSize: 13, color: "var(--ink-3, #9a9cab)", marginBottom: 16, lineHeight: 1.6 }}>
          {t("auth.confirmIntro")}
        </div>
        {errorKey && <div role="alert" style={warnBox}>{t(`auth.errors.${errorKey}`)}</div>}
        <form action={confirmAction}>
          <input type="hidden" name="token" value={token} />
          <label style={{ display: "block" }}>
            <span style={{ display: "block", fontSize: 12, color: "var(--ink-4, #6b6d7a)", marginBottom: 6 }}>
              {t("auth.password")}
            </span>
            <input type="password" name="password" required autoComplete="current-password" style={inputStyle} />
          </label>
          <button type="submit" style={primaryBtn}>{t("auth.confirmButton")}</button>
        </form>
      </>
    );
  } else {
    const notice = errorKey
      ? <div role="alert" style={warnBox}>{t(`auth.errors.${errorKey}`)}</div>
      : params.sent === "1"
        ? (
          <div role="status" style={box}>
            <strong style={{ color: "var(--ink, #ececf0)" }}>{t("auth.confirmSentTitle")}</strong>
            <br />
            {t("auth.confirmSentBody")}
          </div>
        )
        : params.resent === "1"
          ? <div role="status" style={box}>{t("auth.confirmResent")}</div>
          : <div style={box}>{t("auth.confirmPendingBody")}</div>;
    body = (
      <>
        {notice}
        {resendForm}
        <div style={{ marginTop: 18, fontSize: 12 }}>
          <a href="/signin" style={{ color: "var(--accent-text, #7aa2f7)", textDecoration: "none" }}>
            {t("auth.backToSignIn")}
          </a>
        </div>
      </>
    );
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--bg, #0d0e11)",
        color: "var(--ink, #ececf0)",
        fontFamily: "system-ui, -apple-system, sans-serif",
        padding: "24px 16px",
      }}
    >
      <LocalePicker />
      <div
        style={{
          width: "min(440px, 92vw)",
          padding: "32px 28px",
          borderRadius: 12,
          background: "var(--bg-elev-1, #171820)",
          border: "1px solid var(--line, #23242c)",
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 500, marginBottom: 6 }}>External Brain</div>
        <h1 style={{ fontSize: 15, fontWeight: 500, margin: "0 0 16px" }}>{t("auth.confirmTitle")}</h1>
        {body}
      </div>
    </main>
  );
}
