/**
 * Brute-force limit for password sign-in.
 *
 * The credentials sign-in runs as a server action on `/signin` — outside the
 * `/api/*` proxy matcher — and its direct callback `/api/auth/*` is exempted
 * from the proxy on purpose (an OAuth callback must not 429 on a cold
 * deploy). So password guessing was paced only by bcrypt cost (KNOWN_ISSUES
 * §0ay). Two buckets, both checked on every attempt:
 *
 *  - per IP — stops one address spraying many accounts;
 *  - per account — stops many addresses (a botnet) guessing one account.
 *    It also lets an attacker lock a known account out for one window; at
 *    15 minutes that is the accepted trade against unlimited guessing.
 */
import type { Limit } from "@brain/core";

export const LOGIN_IP_LIMIT: Limit = { name: "login-ip", max: 30, windowMs: 15 * 60 * 1000 };
export const LOGIN_ACCOUNT_LIMIT: Limit = { name: "login-account", max: 10, windowMs: 15 * 60 * 1000 };

/** Error code the sign-in page maps to its own message. */
export const LOGIN_RATE_LIMITED = "login_rate_limited";

export async function checkLoginRateLimit(ip: string, username: string): Promise<boolean> {
  // Dynamic import keeps Redis out of any client bundle that touches auth.ts.
  const [{ rateLimitCheck }, { getRateLimitStore }] = await Promise.all([
    import("@brain/core"),
    import("./rate-limit-store.js"),
  ]);
  const store = await getRateLimitStore();
  const now = Date.now();
  const [byIp, byAccount] = await Promise.all([
    rateLimitCheck(store, `login-ip:${ip}`, LOGIN_IP_LIMIT, now),
    rateLimitCheck(store, `login-account:${username.trim().toLowerCase()}`, LOGIN_ACCOUNT_LIMIT, now),
  ]);
  return byIp.ok && byAccount.ok;
}
