/**
 * The client IP every per-IP limiter and audit row keys on — one rule, here.
 *
 * Each call site used to take the FIRST `X-Forwarded-For` entry. That entry is
 * whatever the client sent: Caddy overwrites the header (`header_up
 * X-Forwarded-For {remote_host}`), but the nginx fronting production appends
 * (`$proxy_add_x_forwarded_for`), so on prod any visitor could pick their own
 * bucket by sending the header — register, forgot-password, voucher and the
 * `/api/*` limiter were all bypassable (KNOWN_ISSUES §0ay).
 *
 * Trust order:
 *  1. `X-Real-IP` — both supported proxies SET it to the socket address, and
 *     the login-page server actions set it on their loopback fetch.
 *  2. The LAST `X-Forwarded-For` entry — the hop our own proxy appended.
 *  3. `"local"` — no proxy in front (dev, or a direct loopback call).
 *
 * Pure and dependency-free so `proxy.ts` (middleware) can import it.
 */
export function clientIpFrom(h: Headers): string {
  const real = h.get("x-real-ip")?.trim();
  if (real) return real;
  const hops = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return hops.at(-1) ?? "local";
}

/** Audit-log flavour: `null` instead of the `"local"` sentinel. */
export function auditIpFrom(h: Headers): string | null {
  const ip = clientIpFrom(h);
  return ip === "local" ? null : ip;
}

/**
 * Headers a server action must put on its loopback `fetch` to an API route so
 * the route's limiter sees the visitor, not the web container. Without them
 * every login-page submission shared one `"local"` bucket: three password-
 * reset requests an hour, from anyone, blocked everyone's.
 */
export function forwardClientIp(h: Headers): Record<string, string> {
  const ip = clientIpFrom(h);
  return ip === "local" ? {} : { "x-real-ip": ip };
}
