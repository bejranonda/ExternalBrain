/**
 * "Is this token still live?" — shared by the token list's Verify button and
 * the install wizard's Test connection, which used to each carry a copy of the
 * fetch and render the server's reason slug (`scheduled-revoke`) or a raw
 * `HTTP 500` straight onto the page.
 */
import { apiErrorMessage, type Translate } from "./api-error";
import type { Lang } from "./i18n-dict";

export type TokenTestResult =
  | { ok: true }
  | {
      ok: false;
      reason?: string;
      expiresAt?: string;
      scheduledRevokeAt?: string;
      status?: number;
      error?: unknown;
      network?: true;
    };

export async function runTokenTest(tokenId: string): Promise<TokenTestResult> {
  try {
    const res = await fetch("/api/tokens/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tokenId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      reason?: string;
      expiresAt?: string;
      scheduledRevokeAt?: string;
      error?: unknown;
    };
    if (!res.ok) return { ok: false, status: res.status, error: data.error };
    if (data.ok) return { ok: true };
    const fail: TokenTestResult = { ok: false };
    if (data.reason) fail.reason = data.reason;
    if (data.expiresAt) fail.expiresAt = data.expiresAt;
    if (data.scheduledRevokeAt) fail.scheduledRevokeAt = data.scheduledRevokeAt;
    return fail;
  } catch {
    return { ok: false, network: true };
  }
}

export function tokenTestMessage(t: Translate, lang: Lang, r: TokenTestResult): string {
  if (r.ok) return t("tokens.test_ok");
  const when = (iso: string) => new Date(iso).toLocaleString(lang);
  if (r.network) return t("apiErrors.network");
  if (r.status) return apiErrorMessage(t, r.error, r.status);
  switch (r.reason) {
    case "revoked":
      return t("tokens.test_revoked");
    case "expired":
      return r.expiresAt
        ? t("tokens.test_expired_at", { date: when(r.expiresAt) })
        : t("tokens.test_expired");
    case "scheduled-revoke":
      return r.scheduledRevokeAt
        ? t("tokens.test_scheduled_at", { date: when(r.scheduledRevokeAt) })
        : t("tokens.test_unknown");
    default:
      return t("tokens.test_unknown");
  }
}
