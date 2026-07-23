import { describe, expect, it } from "vitest";
import { LRUCache } from "./solution.js";

describe("LRUCache", () => {
  it("stores and retrieves values", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts the least-recently-used entry when over capacity", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // over capacity -> evicts "a" (never touched since)

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  it("get() refreshes recency, protecting a key from eviction", () => {
    const cache = new LRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a"); // touch "a" -> "b" is now the least-recently-used
    cache.set("c", 3); // over capacity -> should evict "b", not "a"

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });
});
