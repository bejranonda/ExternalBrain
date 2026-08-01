/**
 * Pure rate-limit primitive. Storage-agnostic — the caller provides any async
 * `Store`, i.e. a single atomic `increment`: an in-memory Map wrapper for
 * single-process dev, a Redis-backed adapter for production.
 *
 * (This header described a `{get, set}` pair until 2026-08-01. That interface
 * was removed on 2026-07-28 because it could not be composed safely — see the
 * `Store` docblock below for what went wrong. Noted rather than silently
 * rewritten: a stale contract in a module header is how the next reader learns
 * the wrong thing first.)
 *
 * The API is async so Redis fits natively. The in-memory wrapper wraps sync Map
 * ops in resolved promises — zero perf cost for the common case.
 *
 * Used by `apps/web/proxy.ts`, which selects between the Map and Redis stores
 * based on the `REDIS_URL` env var. The Redis adapter's pure decision logic
 * lives here (`redisWindowMs`, `bucketFromRedisReply`); only the `client.eval`
 * call itself lives in `apps/web`.
 */

export interface Bucket {
  count: number;
  resetAt: number;
}

export interface Limit {
  name: string;
  /**
   * Requests allowed per window. `0` blocks everything — it is NOT a
   * "disabled" sentinel, and no caller treats it as one. (Before the atomic
   * rewrite the fresh-bucket path returned `ok: true` unconditionally, so
   * `max: 0` leaked one request per window; that inconsistency is gone.) To
   * disable a limit, don't route the path through the limiter.
   */
  max: number;
  windowMs: number;
}

/**
 * Storage contract. A single atomic operation, deliberately: the previous
 * get-then-set pair could not be composed safely. Concurrent callers all
 * observed the same pre-increment count, so a burst advanced the bucket by
 * one no matter how large it was — and a caller who kept requests in flight
 * was never limited at all. Since the gate protects the voucher, register
 * and password-reset endpoints, that is an auth bypass, not a soft cap.
 *
 * `increment` must bump the counter and return the resulting bucket without
 * yielding between read and write, starting a fresh window when the key is
 * absent or its `resetAt` has passed.
 */
export interface Store {
  increment(key: string, windowMs: number, now: number): Promise<Bucket>;
}

export interface CheckResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Increment the bucket and report whether the request is within the limit.
 * `now` is injected so tests can drive deterministic time. Window bookkeeping
 * lives in the store (that is where atomicity has to live); this function
 * only applies the policy.
 */
export async function check(
  store: Store,
  clientKey: string,
  limit: Limit,
  now: number,
): Promise<CheckResult> {
  const bucket = await store.increment(
    `${limit.name}:${clientKey}`,
    limit.windowMs,
    now,
  );
  return {
    ok: bucket.count <= limit.max,
    remaining: Math.max(0, limit.max - bucket.count),
    resetAt: bucket.resetAt,
  };
}

// ---------------------------------------------------------------------------
// Redis adapter pure cores.
//
// The Redis `Store` implementation itself lives in apps/web (it needs a real
// client), but everything except the `eval` call is a pure decision and lives
// here, next to the contract it satisfies — the seam pattern GUIDELINES §4
// prescribes for external clients. These branches only run when Redis
// misbehaves, so production traffic is no evidence that they are correct.
// ---------------------------------------------------------------------------

/**
 * Clamp a window to what Redis `PEXPIRE` accepts: a positive whole number of
 * milliseconds.
 */
export function redisWindowMs(windowMs: number): number {
  return Math.max(1, Math.ceil(windowMs));
}

/**
 * Turn the increment script's `{count, ttl}` reply into a `Bucket`, or `null`
 * when the reply is unusable and the caller must fall back to the in-process
 * limiter. Redis is a system boundary, so the reply is validated, not trusted.
 */
export function bucketFromRedisReply(
  reply: unknown,
  windowMs: number,
  now: number,
): Bucket | null {
  if (!Array.isArray(reply)) return null;

  // `INCR` on a counter this module owns cannot return < 1. A zero, negative
  // or fractional count means something else wrote the key — and trusting it
  // would make `check()` compute `ok` forever, i.e. grant unlimited requests.
  // Falling back to the per-process limiter is the safe reading.
  const count: unknown = reply[0];
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
    return null;
  }

  // `PTTL` answers -1 (key has no expiry) or -2 (key gone) only if something
  // outside the script touched the key. Prefer our own window over surfacing a
  // reset time in the past. Validated as an INTEGER for the same reason `count`
  // is: a bare `typeof === "number"` would admit `Infinity` (making `resetAt`
  // non-finite, so the bucket never appears to reset and the
  // `x-ratelimit-reset` header renders as "Infinity") or a fraction (a
  // sub-millisecond reset time). Real PTTL returns neither — but real INCR
  // never returns 0 either, and this function exists to not trust that.
  const ttl: unknown = reply[1];
  const ttlMs = typeof ttl === "number" && Number.isInteger(ttl) ? ttl : -1;

  return {
    count,
    resetAt: ttlMs > 0 ? now + ttlMs : now + redisWindowMs(windowMs),
  };
}

/**
 * Convenience Store backed by a JS Map. Good for dev or a single-host
 * deploy. Not safe for multi-replica deployments — use a Redis store for
 * those.
 *
 * Expired buckets are overwritten on next touch but never actively swept, so
 * the Map grows with the number of distinct client keys seen. Pre-existing
 * behaviour, bounded in practice by one host's IP/user space.
 */
export function memoryStore(): Store {
  const map = new Map<string, Bucket>();
  return {
    async increment(key, windowMs, now) {
      // Every statement below is synchronous, so the event loop cannot
      // interleave another caller between the read and the write.
      const existing = map.get(key);
      if (!existing || existing.resetAt <= now) {
        const fresh: Bucket = { count: 1, resetAt: now + windowMs };
        map.set(key, fresh);
        return { ...fresh };
      }
      existing.count += 1;
      // Copy out: handing back the stored object would let one caller's
      // later mutation change what an earlier caller already read.
      return { ...existing };
    },
  };
}
