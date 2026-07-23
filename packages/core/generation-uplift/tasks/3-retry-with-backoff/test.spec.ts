import { describe, expect, it, vi } from "vitest";
import { retryWithBackoff } from "./solution.js";

class MyError extends Error {}

describe("retryWithBackoff", () => {
  it("returns the result immediately if fn resolves on the first try", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(
      retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 1 }),
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("eventually resolves after some failures, retrying up to maxAttempts", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new MyError("transient");
      return "recovered";
    });

    await expect(
      retryWithBackoff(fn, { maxAttempts: 5, baseDelayMs: 1 }),
    ).resolves.toBe("recovered");
    expect(calls).toBe(3);
  });

  it("rejects with the ORIGINAL error class after exhausting all attempts", async () => {
    const original = new MyError("boom");
    const fn = vi.fn().mockRejectedValue(original);

    await expect(
      retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 1 }),
    ).rejects.toBe(original);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
