import { describe, expect, it } from "vitest";
import {
  check,
  memoryStore,
  redisWindowMs,
  bucketFromRedisReply,
  type Limit,
} from "../rate-limit.js";

const LIMIT: Limit = { name: "oracle", max: 3, windowMs: 60_000 };

describe("rate-limit check", () => {
  it("allows the first request and remaining = max - 1", async () => {
    const store = memoryStore();
    const r = await check(store, "ip1", LIMIT, 1_000);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(2);
    expect(r.resetAt).toBe(61_000);
  });

  it("blocks the (max+1)th request in the same window", async () => {
    const store = memoryStore();
    for (let i = 0; i < 3; i++) await check(store, "ip1", LIMIT, 1_000);
    const blocked = await check(store, "ip1", LIMIT, 1_500);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("scopes buckets by (limit.name, client key)", async () => {
    const store = memoryStore();
    await check(store, "ip1", LIMIT, 0);
    await check(store, "ip1", LIMIT, 0);
    const otherIp = await check(store, "ip2", LIMIT, 0);
    expect(otherIp.ok).toBe(true);
    expect(otherIp.remaining).toBe(2);

    const otherLimit: Limit = { ...LIMIT, name: "default" };
    const otherName = await check(store, "ip1", otherLimit, 0);
    expect(otherName.remaining).toBe(2);
  });

  it("resets the bucket once the window elapses", async () => {
    const store = memoryStore();
    await check(store, "ip1", LIMIT, 0);
    await check(store, "ip1", LIMIT, 0);
    await check(store, "ip1", LIMIT, 0);
    const afterReset = await check(store, "ip1", LIMIT, 60_001);
    expect(afterReset.ok).toBe(true);
    expect(afterReset.remaining).toBe(2);
    expect(afterReset.resetAt).toBe(60_001 + 60_000);
  });

  it("clamps remaining to 0 when over the limit", async () => {
    const store = memoryStore();
    for (let i = 0; i < 5; i++) await check(store, "ip1", LIMIT, 0);
    const last = await check(store, "ip1", LIMIT, 0);
    expect(last.ok).toBe(false);
    expect(last.remaining).toBe(0);
  });

  it("memoryStore() satisfies the Store contract", async () => {
    const store = memoryStore();
    const r = await check(store, "ip1", LIMIT, 0);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it("counts every request in a concurrent burst, not just one", async () => {
    // The abuse case: an attacker keeps requests in flight so no write lands
    // before the next read. A get-then-set store lets all six observe the same
    // pre-increment count, so the bucket advances by one and the burst is
    // repeatable forever. Only `max` may pass.
    const store = memoryStore();
    const burst = await Promise.all(
      Array.from({ length: 6 }, () => check(store, "ip1", LIMIT, 0)),
    );
    expect(burst.filter((r) => r.ok)).toHaveLength(LIMIT.max);
  });

  it("keeps the window closed across successive bursts", async () => {
    const store = memoryStore();
    await Promise.all(Array.from({ length: 6 }, () => check(store, "ip1", LIMIT, 0)));
    const second = await Promise.all(
      Array.from({ length: 6 }, () => check(store, "ip1", LIMIT, 100)),
    );
    expect(second.filter((r) => r.ok)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Redis adapter pure core.
//
// The Store implementation backing production lives in apps/web (it needs a
// real redis client), but everything except the `eval` call itself is a pure
// decision. Per GUIDELINES §4 those cores live here so they can be tested
// without the client — the same seam pattern the autoskill classifier uses for
// its LLM call. These branches only run when Redis misbehaves, so production
// traffic is no evidence about them.
// ---------------------------------------------------------------------------

describe("redisWindowMs", () => {
  it("clamps to a positive whole number of milliseconds", () => {
    expect(redisWindowMs(60_000)).toBe(60_000);
    expect(redisWindowMs(1000.2)).toBe(1001); // PEXPIRE takes integers
    expect(redisWindowMs(0.5)).toBe(1);
    expect(redisWindowMs(0)).toBe(1);
    expect(redisWindowMs(-5)).toBe(1);
  });
});

describe("bucketFromRedisReply", () => {
  const NOW = 1_000_000;
  const WINDOW = 60_000;

  it("reads count and derives resetAt from the returned TTL", () => {
    expect(bucketFromRedisReply([3, 45_000], WINDOW, NOW)).toEqual({
      count: 3,
      resetAt: NOW + 45_000,
    });
  });

  // PTTL answers -1 (key has no expiry) or -2 (key gone) only if something
  // outside the script touched the key. Trust our own window over a nonsense
  // resetAt rather than surfacing a reset in the past.
  it.each([[-1], [-2], [0]])("falls back to our own window when PTTL is %i", (ttl) => {
    expect(bucketFromRedisReply([2, ttl], WINDOW, NOW)).toEqual({
      count: 2,
      resetAt: NOW + WINDOW,
    });
  });

  it("uses our own window when the TTL element is missing or non-numeric", () => {
    expect(bucketFromRedisReply([2], WINDOW, NOW)?.resetAt).toBe(NOW + WINDOW);
    expect(bucketFromRedisReply([2, "soon"], WINDOW, NOW)?.resetAt).toBe(NOW + WINDOW);
  });

  // Real PTTL returns an integer — but so does real INCR, and the count guard
  // above exists precisely because this function does not trust that. Infinity
  // would make resetAt non-finite (the bucket never appears to reset, and
  // x-ratelimit-reset renders as "Infinity"); a fraction is a sub-millisecond
  // reset time. Both fall back to our own window.
  it.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
    ["a fractional TTL", 5.5],
  ])("uses our own window for %s", (_label, ttl) => {
    const bucket = bucketFromRedisReply([2, ttl], WINDOW, NOW);
    expect(bucket?.resetAt).toBe(NOW + WINDOW);
    expect(Number.isFinite(bucket?.resetAt)).toBe(true);
  });

  // null means "unusable — caller must fall back to the in-process limiter".
  it.each([
    ["a non-array reply", "OK"],
    ["null", null],
    ["an empty array", []],
    ["a non-numeric count", ["3", 1000]],
    ["a null count", [null, 1000]],
  ])("returns null for %s", (_label, reply) => {
    expect(bucketFromRedisReply(reply, WINDOW, NOW)).toBeNull();
  });

  // INCR cannot return <1 for a counter this code owns. A zero or negative
  // count would make check() compute ok=true forever, so treat it as a
  // corrupted key and fall back rather than granting unlimited requests.
  it.each([[0], [-4], [1.5]])("returns null for an impossible count %p", (count) => {
    expect(bucketFromRedisReply([count, 1000], WINDOW, NOW)).toBeNull();
  });
});
