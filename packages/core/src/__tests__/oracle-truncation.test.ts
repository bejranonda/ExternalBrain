/**
 * The Oracle caps output per reasoning level (`minimal` = 256 tokens). When a
 * provider stops on that cap the answer ends mid-sentence; `truncated` is the
 * only thing that tells a reader so. Each provider × {plain, stream} path
 * reads its own stop field — all four are pinned here (KNOWN_ISSUES §0ay).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const anthropic = { stopReason: "end_turn" as string };
const openai = { finishReason: "stop" as string };

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => ({
        model: "claude-test",
        stop_reason: anthropic.stopReason,
        content: [{ type: "text", text: "partial answ" }],
        usage: { input_tokens: 10, output_tokens: 256 },
      }),
      stream: () => {
        const final = {
          model: "claude-test",
          stop_reason: anthropic.stopReason,
          usage: { input_tokens: 10, output_tokens: 256 },
        };
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "content_block_delta", delta: { type: "text_delta", text: "partial" } };
          },
          finalMessage: async () => final,
        };
      },
    };
  },
}));

vi.mock("openai", () => ({
  default: class {
    chat = {
      completions: {
        create: async (req: { stream?: boolean }) => {
          if (!req.stream) {
            return {
              choices: [{ message: { content: "partial answ" }, finish_reason: openai.finishReason }],
              usage: { prompt_tokens: 10, completion_tokens: 256 },
            };
          }
          return (async function* () {
            yield { choices: [{ delta: { content: "partial" }, finish_reason: null }] };
            yield { choices: [{ delta: {}, finish_reason: openai.finishReason }] };
            yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 256 } };
          })();
        },
      },
    };
  },
}));

const { callOracle, callOracleStream } = await import("../oracle.js");

async function streamDone(): Promise<{ truncated: boolean }> {
  let done: { truncated: boolean } | undefined;
  for await (const ev of callOracleStream("q", 256, undefined)) {
    if (ev.kind === "done") done = ev;
  }
  if (!done) throw new Error("stream yielded no done event");
  return done;
}

const savedModel = process.env.ORACLE_MODEL;
const savedBase = process.env.ANTHROPIC_BASE_URL;
beforeEach(() => {
  delete process.env.ANTHROPIC_BASE_URL;
});
afterEach(() => {
  process.env.ORACLE_MODEL = savedModel;
  if (savedBase === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = savedBase;
});

describe("Oracle truncation flag — Anthropic SDK path", () => {
  beforeEach(() => {
    process.env.ORACLE_MODEL = "claude-test";
  });
  it("plain: stop_reason max_tokens → truncated", async () => {
    anthropic.stopReason = "max_tokens";
    expect((await callOracle("q", 256)).truncated).toBe(true);
  });
  it("plain: stop_reason end_turn → not truncated", async () => {
    anthropic.stopReason = "end_turn";
    expect((await callOracle("q", 256)).truncated).toBe(false);
  });
  it("stream: stop_reason max_tokens → truncated", async () => {
    anthropic.stopReason = "max_tokens";
    expect((await streamDone()).truncated).toBe(true);
  });
  it("stream: stop_reason end_turn → not truncated", async () => {
    anthropic.stopReason = "end_turn";
    expect((await streamDone()).truncated).toBe(false);
  });
});

describe("Oracle truncation flag — OpenAI-compatible path", () => {
  beforeEach(() => {
    process.env.ORACLE_MODEL = "gpt-test";
  });
  it("plain: finish_reason length → truncated", async () => {
    openai.finishReason = "length";
    expect((await callOracle("q", 256)).truncated).toBe(true);
  });
  it("plain: finish_reason stop → not truncated", async () => {
    openai.finishReason = "stop";
    expect((await callOracle("q", 256)).truncated).toBe(false);
  });
  it("stream: finish_reason length on a mid-stream chunk → truncated", async () => {
    openai.finishReason = "length";
    expect((await streamDone()).truncated).toBe(true);
  });
  it("stream: finish_reason stop → not truncated", async () => {
    openai.finishReason = "stop";
    expect((await streamDone()).truncated).toBe(false);
  });
});
