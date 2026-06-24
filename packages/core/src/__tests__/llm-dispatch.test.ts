/**
 * Dispatch parity for the shared LLM seam. No API keys: the SDK impls are
 * injected (`deps`) so we assert only that the right provider is chosen and the
 * right params reach it for a given model family.
 */
import { describe, it, expect } from "vitest";
import { callLLMText, type LLMDeps } from "../llm.js";

function recordingDeps(): { deps: LLMDeps; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      anthropic: async (_p, o) => {
        calls.push(`anthropic:${o.model}`);
        return "A";
      },
      openai: async (_p, m, _s, _mt, json) => {
        calls.push(`openai:${m}:json=${json}`);
        return "O";
      },
      dashscope: async (_p, m) => {
        calls.push(`dashscope:${m}`);
        return "D";
      },
    },
  };
}

describe("callLLMText dispatch", () => {
  it("routes claude* to anthropic", async () => {
    const { deps, calls } = recordingDeps();
    const out = await callLLMText("hi", { model: "claude-haiku-4-5" }, deps);
    expect(out).toBe("A");
    expect(calls).toEqual(["anthropic:claude-haiku-4-5"]);
  });

  it("routes qwen* and glm* to dashscope", async () => {
    const { deps, calls } = recordingDeps();
    await callLLMText("hi", { model: "qwen3-coder" }, deps);
    await callLLMText("hi", { model: "glm-5.1" }, deps);
    expect(calls).toEqual(["dashscope:qwen3-coder", "dashscope:glm-5.1"]);
  });

  it("routes everything else to openai with json_object on", async () => {
    const { deps, calls } = recordingDeps();
    const out = await callLLMText("hi", { model: "gpt-4o-mini" }, deps);
    expect(out).toBe("O");
    expect(calls).toEqual(["openai:gpt-4o-mini:json=true"]);
  });
});
