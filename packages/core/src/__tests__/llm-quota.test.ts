/**
 * Quota refusals must be distinguishable from other transient failures.
 *
 * On a flat subscription (prod runs the GLM Coding Plan by operator decision,
 * 2026-08-22) the failure that actually bites is not cost, it is running out
 * of the usage window: prompts are metered per 5-hour window with a 3x
 * multiplier at peak. A burst exhausts it and extraction simply stops.
 *
 * `isTransientLLMError` already retried 429s, which is right — but it lumped
 * them in with timeouts and 5xx, so a retry that succeeded hid the event and a
 * retry that failed looked like a network blip. The operator's only symptom
 * was "the Brain stopped learning", with no cause attached.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isQuotaError,
  isTransientLLMError,
  reportQuotaError,
  seenQuotaModels,
} from "../llm.js";
import { getLogger } from "../logger.js";

describe("isQuotaError", () => {
  it("recognises the shapes providers actually send", () => {
    for (const msg of [
      "429 Too Many Requests",
      "rate limit exceeded for this model",
      "Rate-limited: try again later",
      "quota exhausted for the current window",
      "Error: TOO MANY REQUESTS",
    ]) {
      expect(isQuotaError(new Error(msg)), msg).toBe(true);
    }
  });

  it("is NARROWER than isTransientLLMError — timeouts and 5xx are not quota", () => {
    // Both get retried; only one means "you have run out of allowance". If
    // this predicate widened to match everything transient, the audit trail
    // would fill with network blips and stop meaning anything.
    for (const msg of [
      "llm timeout after 120000ms (model=glm-4.7)",
      "503 Service Unavailable",
      "upstream temporarily unavailable",
    ]) {
      expect(isTransientLLMError(new Error(msg)), msg).toBe(true);
      expect(isQuotaError(new Error(msg)), msg).toBe(false);
    }
  });

  it("does not fire on ordinary failures", () => {
    for (const msg of ["invalid api key", "model not found", "bad request"]) {
      expect(isQuotaError(new Error(msg)), msg).toBe(false);
    }
  });

  it("accepts non-Error values without throwing", () => {
    expect(isQuotaError("429 too many requests")).toBe(true);
    expect(isQuotaError(undefined)).toBe(false);
  });
});

describe("reportQuotaError", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    seenQuotaModels.clear();
    warn = vi.spyOn(getLogger("core"), "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("warns with the model and the provider message", () => {
    reportQuotaError("glm-4.7", new Error("429 rate limit exceeded"));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({ model: "glm-4.7" });
  });

  it("reports once per model, so a sustained throttle cannot flood the log", () => {
    reportQuotaError("glm-4.7", new Error("429"));
    reportQuotaError("glm-4.7", new Error("429"));
    reportQuotaError("glm-4.7", new Error("429"));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("still reports a DIFFERENT model separately", () => {
    // Two models hitting the window is a materially different situation from
    // one, and collapsing them would hide it.
    reportQuotaError("glm-4.7", new Error("429"));
    reportQuotaError("glm-5.2", new Error("429"));
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
