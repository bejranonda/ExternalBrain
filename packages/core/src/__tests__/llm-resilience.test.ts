/**
 * Resilience contract for the shared LLM seam.
 *
 * Every KEA, autoskill and meeting-extract call goes through `callLLMText`.
 * Before this suite it had no timeout, no retry and no error classification,
 * while its sibling `embedding.ts` had all three — so a provider 429 during
 * post-session extraction propagated out and cost that session its knowledge.
 *
 * These tests pin the behaviour that fixes it. No API keys: the SDK impls are
 * injected via `deps`, and the timeout is driven to a few milliseconds so the
 * suite stays fast.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  callLLMText,
  isTransientLLMError,
  DEFAULT_LLM_TIMEOUT_MS,
  useAnthropicSdk,
  type LLMDeps,
} from "../llm.js";

/** deps whose anthropic impl runs `impl`; the other two should never fire. */
function anthropicDeps(impl: () => Promise<string>): LLMDeps {
  return {
    anthropic: impl,
    openai: async () => {
      throw new Error("openai must not be called for a claude* model");
    },
    dashscope: async () => {
      throw new Error("dashscope must not be called for a claude* model");
    },
  };
}

const CLAUDE = { model: "claude-sonnet-4-6" } as const;

describe("isTransientLLMError", () => {
  it.each([
    ["429 Too Many Requests", true],
    ["rate limit exceeded, retry later", true],
    ["Rate_limit reached for model", true],
    ["quota exhausted for this key", true],
    ["upstream timeout", true],
    ["503 Service Unavailable", true],
    ["server is temporarily overloaded", true],
    ["Overloaded", true],
    ["502 Bad Gateway", true],
    ["504 Gateway Timeout", true],
  ])("classifies %j as transient", (msg, expected) => {
    expect(isTransientLLMError(new Error(msg))).toBe(expected);
  });

  it.each([
    ["401 invalid api key", false],
    ["model not found: gpt-99", false],
    ["invalid request: max_tokens must be > 0", false],
    ["context length exceeded for this model", true], // "exceeded" — deliberately transient-ish
  ])("classifies %j as transient=%s", (msg, expected) => {
    expect(isTransientLLMError(new Error(msg))).toBe(expected);
  });

  it("handles non-Error throwables without blowing up", () => {
    expect(isTransientLLMError("429 slow down")).toBe(true);
    expect(isTransientLLMError(null)).toBe(false);
    expect(isTransientLLMError(undefined)).toBe(false);
  });
});

describe("callLLMText retry", () => {
  it("retries once after a transient failure and returns the second result", async () => {
    let attempts = 0;
    const deps = anthropicDeps(async () => {
      attempts++;
      if (attempts === 1) throw new Error("429 rate limit exceeded");
      return "recovered";
    });

    await expect(callLLMText("p", CLAUDE, deps)).resolves.toBe("recovered");
    expect(attempts).toBe(2);
  });

  it("does NOT retry a non-transient failure — a bad key must fail fast", async () => {
    let attempts = 0;
    const deps = anthropicDeps(async () => {
      attempts++;
      throw new Error("401 invalid api key");
    });

    await expect(callLLMText("p", CLAUDE, deps)).rejects.toThrow("401 invalid api key");
    // Retrying a credential error just doubles the latency of a guaranteed
    // failure and doubles the noise in the provider's logs.
    expect(attempts).toBe(1);
  });

  it("gives up after exactly one retry — two transient failures surface", async () => {
    let attempts = 0;
    const deps = anthropicDeps(async () => {
      attempts++;
      throw new Error("503 unavailable");
    });

    await expect(callLLMText("p", CLAUDE, deps)).rejects.toThrow("503 unavailable");
    // Anything beyond one in-process retry belongs to pg-boss (retryLimit 3
    // + backoff), which can wait minutes without holding a worker slot.
    expect(attempts).toBe(2);
  });

  it("passes a first-attempt success straight through without retrying", async () => {
    let attempts = 0;
    const deps = anthropicDeps(async () => {
      attempts++;
      return "ok";
    });

    await expect(callLLMText("p", CLAUDE, deps)).resolves.toBe("ok");
    expect(attempts).toBe(1);
  });
});

describe("callLLMText timeout", () => {
  it("rejects a hung provider call once the budget elapses", async () => {
    // Never settles — models a provider that accepted the connection and
    // then stopped responding, which is the case the SDK default (10 min,
    // >= the 600 s job expiry) failed to bound.
    const deps = anthropicDeps(() => new Promise<string>(() => {}));

    await expect(
      callLLMText("p", { ...CLAUDE, timeoutMs: 20 }, deps),
    ).rejects.toThrow(/llm timeout after 20ms/);
  });

  it("names the model in the timeout message so the log line is actionable", async () => {
    const deps = anthropicDeps(() => new Promise<string>(() => {}));

    await expect(
      callLLMText("p", { model: "claude-opus-4", timeoutMs: 10 }, deps),
    ).rejects.toThrow(/model=claude-opus-4/);
  });

  it("treats its own timeout as transient, so a slow first attempt is retried", async () => {
    let attempts = 0;
    const deps = anthropicDeps(async () => {
      attempts++;
      if (attempts === 1) return new Promise<string>(() => {}); // hang once
      return "second attempt was fast";
    });

    await expect(
      callLLMText("p", { ...CLAUDE, timeoutMs: 20 }, deps),
    ).resolves.toBe("second attempt was fast");
    expect(attempts).toBe(2);
  });

  it("defaults to a budget below the 600 s job expiry on kea.extract", () => {
    // The invariant that matters: if this ever exceeds expireInSeconds on the
    // kea.extract / autoskill.run queues (apps/worker/src/index.ts), pg-boss
    // can hand the job to a second worker while the first call is still open
    // and still spending tokens.
    expect(DEFAULT_LLM_TIMEOUT_MS).toBeLessThan(600_000);
  });
});

describe("callLLMText dispatch is preserved by the retry wrapper", () => {
  it("still routes qwen*/glm* to dashscope and gpt* to openai", async () => {
    const seen: string[] = [];
    const deps: LLMDeps = {
      anthropic: async (_p, o) => {
        seen.push(`anthropic:${o.model}`);
        return "A";
      },
      openai: async (_p, m) => {
        seen.push(`openai:${m}`);
        return "O";
      },
      dashscope: async (_p, m) => {
        seen.push(`dashscope:${m}`);
        return "D";
      },
    };

    await callLLMText("p", { model: "claude-sonnet-4-6" }, deps);
    await callLLMText("p", { model: "qwen-max" }, deps);
    await callLLMText("p", { model: "glm-4" }, deps);
    await callLLMText("p", { model: "gpt-4o-mini" }, deps);

    expect(seen).toEqual([
      "anthropic:claude-sonnet-4-6",
      "dashscope:qwen-max",
      "dashscope:glm-4",
      "openai:gpt-4o-mini",
    ]);
  });

  it("does not leave a pending timer holding the event loop after success", async () => {
    // Regression guard for the naive Promise.race: without clearTimeout in a
    // finally block, every call leaves a live 120 s timer behind.
    const spy = vi.spyOn(globalThis, "clearTimeout");
    const deps = anthropicDeps(async () => "ok");

    await callLLMText("p", CLAUDE, deps);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("provider routing — the gateway rule (the 8-night silent failure)", () => {
  const orig = process.env.ANTHROPIC_BASE_URL;
  afterEach(() => {
    if (orig === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = orig;
  });

  it("routes glm-* to DashScope when NO gateway is configured", async () => {
    delete process.env.ANTHROPIC_BASE_URL;
    const seen: string[] = [];
    const deps: LLMDeps = {
      anthropic: async () => { seen.push("anthropic"); return "A"; },
      openai: async () => { seen.push("openai"); return "O"; },
      dashscope: async () => { seen.push("dashscope"); return "D"; },
    };
    await callLLMText("p", { model: "glm-5.1" }, deps);
    expect(seen).toEqual(["dashscope"]);
  });

  it("routes glm-* through the ANTHROPIC gateway when one IS configured", async () => {
    // The regression: with ANTHROPIC_BASE_URL set, oracle.ts sent glm-5.1 to
    // the gateway and worked, while callLLMText sent the same string to
    // DashScope and died on a missing key — so kea.cross_extract failed
    // every night from 2026-07-28 while the Oracle looked healthy.
    process.env.ANTHROPIC_BASE_URL = "https://gateway.example/v1";
    const seen: string[] = [];
    const deps: LLMDeps = {
      anthropic: async () => { seen.push("anthropic"); return "A"; },
      openai: async () => { seen.push("openai"); return "O"; },
      dashscope: async () => { seen.push("dashscope"); return "D"; },
    };
    await callLLMText("p", { model: "glm-5.1" }, deps);
    expect(seen).toEqual(["anthropic"]);
  });

  it("agrees with oracle.ts's predicate for every case that matters", () => {
    delete process.env.ANTHROPIC_BASE_URL;
    expect(useAnthropicSdk("claude-sonnet-4-6")).toBe(true);
    expect(useAnthropicSdk("glm-5.1")).toBe(false);
    expect(useAnthropicSdk("gpt-4o")).toBe(false);
    process.env.ANTHROPIC_BASE_URL = "https://gateway.example/v1";
    // The gateway fronts everything — that is the whole point of the var.
    expect(useAnthropicSdk("claude-sonnet-4-6")).toBe(true);
    expect(useAnthropicSdk("glm-5.1")).toBe(true);
    expect(useAnthropicSdk("gpt-4o")).toBe(true);
  });

  it("still sends claude-* to Anthropic with no gateway set", async () => {
    delete process.env.ANTHROPIC_BASE_URL;
    const seen: string[] = [];
    const deps: LLMDeps = {
      anthropic: async () => { seen.push("anthropic"); return "A"; },
      openai: async () => { seen.push("openai"); return "O"; },
      dashscope: async () => { seen.push("dashscope"); return "D"; },
    };
    await callLLMText("p", { model: "claude-haiku-4-5" }, deps);
    expect(seen).toEqual(["anthropic"]);
  });
});
