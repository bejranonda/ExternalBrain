/**
 * Rate-limit proxy (Next.js 16 renamed `middleware.ts` → `proxy.ts`) for `/api/*`.
 *
 * Store selection:
 *   - `REDIS_URL` set → Redis-backed store (multi-replica safe). Wave 2.
 *   - `REDIS_URL` unset → in-process Map (single-host dev / Wave 1).
 *
 * Next 16 proxy always runs on Node.js — no `runtime` override needed,
 * and declaring one is a build error. The `redis` client's TCP socket
 * API works here natively.
 *
 * Limits per endpoint class (env-overridable):
 *   - oracle:   RATE_LIMIT_ORACLE_PER_DAY   (default 100/day)
 *   - kea:      RATE_LIMIT_KEA_PER_HOUR     (default 60/hour)  — unused via REST today
 *   - default:  RATE_LIMIT_MCP_PER_MINUTE   (default 200/min)
 */
import { NextResponse, type NextRequest } from "next/server";
import { rateLimitCheck, type Limit } from "@brain/core";
import { getRateLimitStore } from "@/lib/brain/rate-limit-store";

export const config = { matcher: ["/api/:path*"] };

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function classify(pathname: string): Limit {
  if (pathname.startsWith("/api/oracle")) {
    return {
      name: "oracle",
      max: envInt("RATE_LIMIT_ORACLE_PER_DAY", 100),
      windowMs: 24 * 60 * 60 * 1000,
    };
  }
  if (pathname.startsWith("/api/kea")) {
    return {
      name: "kea",
      max: envInt("RATE_LIMIT_KEA_PER_HOUR", 60),
      windowMs: 60 * 60 * 1000,
    };
  }
  return {
    name: "default",
    max: envInt("RATE_LIMIT_MCP_PER_MINUTE", 200),
    windowMs: 60 * 1000,
  };
}

function clientKey(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  const ip = xff ? xff.split(",")[0]!.trim() : "local";
  return ip || "local";
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/")) return NextResponse.next();
  if (
    pathname === "/api/me" ||
    pathname === "/api/healthz" ||
    pathname === "/api/readyz" ||
    pathname.startsWith("/api/auth/")
  ) {
    // NextAuth's /api/auth/* routes must not be rate-limited here — the
    // OAuth callback would get 429'd on a cold deploy and leave the user
    // unable to complete sign-in.
    return NextResponse.next();
  }

  const limit = classify(pathname);
  const store = await getRateLimitStore();
  const result = await rateLimitCheck(store, clientKey(req), limit, Date.now());

  const headers = new Headers({
    "x-ratelimit-limit": String(limit.max),
    "x-ratelimit-remaining": String(result.remaining),
    "x-ratelimit-reset": String(Math.floor(result.resetAt / 1000)),
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        error: "rate_limited",
        limit: limit.name,
        retryAfterSeconds: Math.ceil((result.resetAt - Date.now()) / 1000),
      },
      { status: 429, headers },
    );
  }

  const res = NextResponse.next();
  headers.forEach((v, k) => res.headers.set(k, v));
  return res;
}
