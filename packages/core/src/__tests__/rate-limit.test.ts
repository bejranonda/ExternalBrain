import { describe, expect, it } from "vitest";
import { check, memoryStore, type Limit } from "../rate-limit.js";

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
