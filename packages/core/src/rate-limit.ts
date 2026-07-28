/**
 * Pure rate-limit primitive. Storage-agnostic — the caller provides any
 * async `{get, set}` implementation: an in-memory Map wrapper for
 * single-process dev, a Redis client for multi-replica production.
 *
 * The API is async so Redis fits natively. The in-memory wrapper wraps
 * sync Map ops in resolved promises — zero perf cost for the common case.
 *
 * Used by `apps/web/proxy.ts` — Wave 1 used an in-process Map; Wave 2
 * selects between Map and Redis based on the `REDIS_URL` env var.
 */

export interface Bucket {
  count: number;
  resetAt: number;
}

export interface Limit {
  name: string;
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
