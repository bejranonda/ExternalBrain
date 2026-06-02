import { describe, expect, it } from "vitest";
import { check, memoryStore, type Bucket, type Limit, type Store } from "../rate-limit.js";

function inspectingStore(): Store & { map: Map<string, Bucket> } {
  const map = new Map<string, Bucket>();
  return {
    map,
    get: async (k) => map.get(k),
    set: async (k, b) => {
      map.set(k, b);
    },
  };
}

const LIMIT: Limit = { name: "oracle", max: 3, windowMs: 60_000 };

describe("rate-limit check", () => {
  it("allows the first request and remaining = max - 1", async () => {
    const store = inspectingStore();
    const r = await check(store, "ip1", LIMIT, 1_000);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(2);
    expect(r.resetAt).toBe(61_000);
  });

  it("blocks the (max+1)th request in the same window", async () => {
    const store = inspectingStore();
    for (let i = 0; i < 3; i++) await check(store, "ip1", LIMIT, 1_000);
    const blocked = await check(store, "ip1", LIMIT, 1_500);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("scopes buckets by (limit.name, client key)", async () => {
    const store = inspectingStore();
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
    const store = inspectingStore();
    await check(store, "ip1", LIMIT, 0);
    await check(store, "ip1", LIMIT, 0);
    await check(store, "ip1", LIMIT, 0);
    const afterReset = await check(store, "ip1", LIMIT, 60_001);
    expect(afterReset.ok).toBe(true);
    expect(afterReset.remaining).toBe(2);
    expect(afterReset.resetAt).toBe(60_001 + 60_000);
  });

  it("clamps remaining to 0 when over the limit", async () => {
    const store = inspectingStore();
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
});
