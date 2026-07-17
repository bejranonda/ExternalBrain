import { describe, expect, it } from "vitest";
import type { LLMDeps } from "../llm.js";
import {
  buildExtractionPrompt,
  parseExtractionResponse,
  extractMeeting,
} from "../meeting-extract.js";

describe("buildExtractionPrompt", () => {
  it("embeds the transcript verbatim", () => {
    const prompt = buildExtractionPrompt("Anna: staging DB is broken.");
    expect(prompt).toContain("Anna: staging DB is broken.");
  });
});

describe("parseExtractionResponse", () => {
  it("parses a well-formed response", () => {
    const raw = JSON.stringify({
      decisions: [{ trigger: "reporting store", rule: "use postgres+timescale", rationale: "time-bucketed queries", instead: "plain postgres" }],
      actionItems: [{ trigger: "sprint planning", rule: "fix staging db", assigneeGuessEmail: "ben@test.local", blocker: true, kind: "action-item" }],
    });
    const out = parseExtractionResponse(raw);
    expect(out.decisions).toHaveLength(1);
    expect(out.decisions[0]!.ruleText).toBe("use postgres+timescale");
    expect(out.actionItems).toHaveLength(1);
    expect(out.actionItems[0]!.blocker).toBe(true);
  });

  it("strips markdown fences", () => {
    const raw = "```json\n" + JSON.stringify({ decisions: [], actionItems: [] }) + "\n```";
    const out = parseExtractionResponse(raw);
    expect(out.decisions).toEqual([]);
    expect(out.actionItems).toEqual([]);
  });

  it("fails soft to empty arrays on malformed JSON", () => {
    const out = parseExtractionResponse("not json at all");
    expect(out).toEqual({ decisions: [], actionItems: [] });
  });

  it("fails soft when a field is the wrong shape", () => {
    const raw = JSON.stringify({ decisions: "not an array", actionItems: [] });
    const out = parseExtractionResponse(raw);
    expect(out.decisions).toEqual([]);
  });

  it("drops individual malformed items without dropping the whole batch", () => {
    const raw = JSON.stringify({
      decisions: [],
      actionItems: [
        { trigger: "t", rule: "valid one", assigneeGuessEmail: null, blocker: false, kind: "action-item" },
        { trigger: "t" }, // missing rule — invalid
      ],
    });
    const out = parseExtractionResponse(raw);
    expect(out.actionItems).toHaveLength(1);
    expect(out.actionItems[0]!.ruleText).toBe("valid one");
  });
});

describe("extractMeeting", () => {
  function recordingDeps(response: string): { deps: LLMDeps; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        anthropic: async (p, opts) => { calls.push(`anthropic:${p.length}`); return response; },
        openai: async (p, model, systemPrompt, maxTokens, jsonObject) => { calls.push(`openai:${p.length}`); return response; },
        dashscope: async (p, model, systemPrompt, maxTokens) => { calls.push(`dashscope:${p.length}`); return response; },
      },
    };
  }

  it("dispatches to the given model family and returns parsed output", async () => {
    const response = JSON.stringify({ decisions: [], actionItems: [] });
    const { deps, calls } = recordingDeps(response);
    const out = await extractMeeting("a transcript", "qwen3-coder", deps);
    expect(calls[0]).toMatch(/^dashscope:/);
    expect(out).toEqual({ decisions: [], actionItems: [] });
  });
});
