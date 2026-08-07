/**
 * Email-sending utility — Resend HTTP API via fetch().
 *
 * Reads env at call time (not module-load) so test environments stay isolated.
 *
 * ENV vars:
 *   EMAIL_PROVIDER   — "resend" | "disabled" (default "disabled")
 *   EMAIL_API_KEY    — Resend API key (required when provider = "resend")
 *   EMAIL_FROM       — From address, e.g. "External Brain <noreply@brain-dev.example.com>"
 *   EMAIL_REPLY_TO   — Optional; defaults to EMAIL_FROM
 *
 * When EMAIL_PROVIDER is "disabled" (or unset) sendEmail() returns
 * { ok: false, reason: "disabled" } with NO http call. Callers should
 * fall back to the manual-link pattern.
 */

export type EmailProvider = "resend" | "disabled";

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string; // plaintext fallback
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  reason?: string;
}

const RESEND_API = "https://api.resend.com/emails";

/**
 * Send a transactional email through the configured provider.
 * Never throws — all errors are returned as { ok: false, reason }.
 */
/**
 * Is outbound email actually deliverable right now?
 *
 * Exported because callers were each deciding this for themselves with
 * `process.env.EMAIL_PROVIDER === "resend"`, which ignores the auto-detect
 * below — so an operator who set only the API key (the ergonomic this module
 * deliberately provides, and the one .env.example documents) got a system
 * where sendEmail() would have worked but nothing ever called it. One rule,
 * three implementations, silently disagreeing. See KNOWN_ISSUES §0y.
 */
export function isEmailConfigured(): boolean {
  return resolveProvider().provider === "resend";
}

/** Single source of truth for provider + key resolution. */
function resolveProvider(): { provider: EmailProvider; apiKey: string } {
  // Auto-detect: if EMAIL_PROVIDER is unset but a key is populated, treat as
  // Resend. Operators commonly drop a key into .env without remembering the
  // EMAIL_PROVIDER toggle, and .env.example documents that path — so the
  // fallback prevents a silent "disabled".
  const explicitProvider = process.env.EMAIL_PROVIDER ?? "";
  const apiKey =
    process.env.EMAIL_API_KEY ||
    process.env.RESEND_API ||
    process.env.RESEND_API_KEY ||
    "";
  const provider: EmailProvider =
    explicitProvider === "resend" || (!explicitProvider && apiKey)
      ? "resend"
      : "disabled";
  return { provider, apiKey };
}

export async function sendEmail(args: SendEmailArgs): Promise<SendResult> {
  const { provider, apiKey } = resolveProvider();

  if (provider !== "resend") {
    return { ok: false, reason: "disabled" };
  }

  if (!apiKey) {
    return { ok: false, reason: "missing_api_key" };
  }

  const from =
    process.env.EMAIL_FROM ?? "External Brain <noreply@brain-dev.example.com>";
  const replyTo = process.env.EMAIL_REPLY_TO ?? from;

  const payload: Record<string, unknown> = {
    from,
    to: [args.to],
    reply_to: replyTo,
    subject: args.subject,
    html: args.html,
  };
  if (args.text) {
    payload.text = args.text;
  }

  let res: Response;
  try {
    res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `fetch_error:${msg}` };
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string; name?: string };
      detail = body.message ?? body.name ?? "";
    } catch {
      // ignore parse errors
    }
    return {
      ok: false,
      reason: detail ? `http_${res.status}:${detail}` : `http_${res.status}`,
    };
  }

  let data: { id?: string } = {};
  try {
    data = (await res.json()) as { id?: string };
  } catch {
    // non-fatal; message sent but we just can't log the ID
  }

  return { ok: true, ...(data.id !== undefined ? { messageId: data.id } : {}) };
}
