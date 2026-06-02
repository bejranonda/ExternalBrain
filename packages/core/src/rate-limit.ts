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
 * Storage contract. `get` returns the current bucket or `undefined` when
 * none exists. `set` persists a bucket; callers are responsible for
 * expiring stale entries if the backing store doesn't (TTL for Redis is
 * managed below; in-memory stores rely on the reset-past-now guard in
 * `check()` so dead entries cost one extra read until overwritten).
 */
export interface Store {
  get(key: string): Promise<Bucket | undefined>;
  set(key: string, bucket: Bucket, ttlMs: number): Promise<void>;
}

export interface CheckResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Increment the bucket and report whether the request is within the limit.
 * `now` is injected so tests can drive deterministic time.
 *
 * Race note: this implementation is not atomic across concurrent callers.
 * Two requests that arrive simultaneously can both read `existing.count`
 * and both write `count + 1` rather than `count + 2`. Acceptable at the
 * scale we're protecting against (human / IP rate limiting, not
 * cent-accurate metering). For strict atomicity move to a Lua script on
 * the Redis side.
 */
export async function check(
  store: Store,
  clientKey: string,
  limit: Limit,
  now: number,
): Promise<CheckResult> {
  const bucketKey = `${limit.name}:${clientKey}`;
  const existing = await store.get(bucketKey);
  if (!existing || existing.resetAt <= now) {
    const fresh: Bucket = { count: 1, resetAt: now + limit.windowMs };
    await store.set(bucketKey, fresh, limit.windowMs);
    return { ok: true, remaining: limit.max - 1, resetAt: fresh.resetAt };
  }
  existing.count += 1;
  await store.set(bucketKey, existing, Math.max(0, existing.resetAt - now));
  const ok = existing.count <= limit.max;
  return {
    ok,
    remaining: Math.max(0, limit.max - existing.count),
    resetAt: existing.resetAt,
  };
}

/**
 * Convenience Store backed by a JS Map. Good for dev or a single-host
 * deploy. Not safe for multi-replica deployments — use a Redis store for
 * those.
 */
export function memoryStore(): Store {
  const map = new Map<string, Bucket>();
  return {
    get: async (key) => map.get(key),
    set: async (key, bucket) => {
      map.set(key, bucket);
    },
  };
}
