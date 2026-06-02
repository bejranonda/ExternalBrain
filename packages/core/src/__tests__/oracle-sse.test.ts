/**
 * Unit coverage for the Oracle SSE encoder (#240).
 *
 * Why this exists: `apps/web/e2e/streaming.spec.ts` is the only e2e
 * spec that exercises the SSE protocol, but as documented in #240 it
 * has never run successfully in any reachable environment. The encoder
 * module gives us a fast, deterministic gate on the wire-format
 * contract — frame shape (`event: foo\ndata: ...\n\n`), per-event
 * payload schema, error-frame codes, and the terminal `done` frame —
 * without needing a live LLM or even a running server. A regression
 * here would otherwise only be caught by a real user noticing the UI
 * stopped rendering.
 *
 * Pair with `sse.test.ts` (parser) for round-trip confidence:
 * encoder output is consumed by parseSSE on the client.
 */
import { describe, expect, it } from "vitest";
import {
  encodeSSEFrame,
  encodeOracleEvent,
  encodeOracleCapError,
  encodeGenericError,
  ORACLE_SSE_DONE_FRAME,
} from "../oracle-sse";
import { parseSSE } from "../sse";
import type { OracleStreamEvent } from "../oracle";

describe("encodeSSEFrame", () => {
  it("produces RFC-conformant `event:` + `data:` + blank-line shape", () => {
    expect(encodeSSEFrame("ping", { ok: true })).toBe(
      'event: ping\ndata: {"ok":true}\n\n',
    );
  });

  it("JSON-encodes nested objects without escaping pitfalls", () => {
    const frame = encodeSSEFrame("x", { a: { b: ["c", 1] } });
    expect(frame).toBe('event: x\ndata: {"a":{"b":["c",1]}}\n\n');
  });

  it("terminates each frame with exactly two newlines (no extra padding)", () => {
    const frame = encodeSSEFrame("e", { v: 1 });
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(frame.endsWith("\n\n\n")).toBe(false);
  });
});

describe("encodeOracleEvent — meta", () => {
  it("emits meta payload with groundedness + retrievedCounts only", () => {
    const ev: OracleStreamEvent = {
      kind: "meta",
      groundedness: "moderate",
      retrievedCounts: { knowledge: 3, sessions: 2 },
    };
    const frame = encodeOracleEvent(ev);
    expect(frame.startsWith("event: meta\n")).toBe(true);
    const payload = parseDataLine(frame);
    expect(payload).toEqual({
      groundedness: "moderate",
      retrievedCounts: { knowledge: 3, sessions: 2 },
    });
  });

  it("never leaks `kind` into the wire payload", () => {
    const ev: OracleStreamEvent = {
      kind: "meta",
      groundedness: "strong",
      retrievedCounts: { knowledge: 6, sessions: 0 },
    };
    const payload = parseDataLine(encodeOracleEvent(ev)) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("kind");
  });
});

describe("encodeOracleEvent — delta", () => {
  it("emits delta payload with text only", () => {
    const ev: OracleStreamEvent = { kind: "delta", text: "hello " };
    const frame = encodeOracleEvent(ev);
    expect(frame.startsWith("event: delta\n")).toBe(true);
    expect(parseDataLine(frame)).toEqual({ text: "hello " });
  });

  it("preserves unicode and embedded newlines via JSON encoding", () => {
    const ev: OracleStreamEvent = { kind: "delta", text: "α\nβ\t漢" };
    const payload = parseDataLine(encodeOracleEvent(ev)) as { text: string };
    expect(payload.text).toBe("α\nβ\t漢");
  });
});

describe("encodeOracleEvent — final", () => {
  it("emits the full final-frame schema with all required fields", () => {
    const ev: OracleStreamEvent = {
      kind: "final",
      citations: [
        { marker: 1, knowledgeId: "k_1", excerpt: "rule one" },
      ],
      confidence: "high",
      groundedness: "strong",
      retrievedCounts: { knowledge: 6, sessions: 1 },
      relatedQuestions: ["What about edge case X?", "How does Y interact?"],
      tokensUsed: 1234,
    };
    const frame = encodeOracleEvent(ev);
    expect(frame.startsWith("event: final\n")).toBe(true);
    const payload = parseDataLine(frame) as Record<string, unknown>;

    // The UI parses these exact keys — locking them prevents silent UI breakage.
    expect(Object.keys(payload).sort()).toEqual(
      [
        "citations",
        "confidence",
        "groundedness",
        "relatedQuestions",
        "retrievedCounts",
        "tokensUsed",
      ].sort(),
    );
    expect(payload['confidence']).toBe("high");
    expect(payload['tokensUsed']).toBe(1234);
    expect(payload['relatedQuestions']).toEqual([
      "What about edge case X?",
      "How does Y interact?",
    ]);
  });

  it("never leaks `kind` into the final-frame wire payload", () => {
    const ev: OracleStreamEvent = {
      kind: "final",
      citations: [],
      confidence: "low",
      groundedness: "none",
      retrievedCounts: { knowledge: 0, sessions: 0 },
      relatedQuestions: [],
      tokensUsed: 0,
    };
    const payload = parseDataLine(encodeOracleEvent(ev)) as Record<string, unknown>;
    expect(payload).not.toHaveProperty("kind");
  });
});

describe("encodeOracleCapError", () => {
  it("emits `code: cost_cap_exceeded` so the UI can branch on it", () => {
    const frame = encodeOracleCapError({
      spentUsd: 0.95,
      capUsd: 1.0,
      message: "Daily cap reached",
    });
    expect(frame.startsWith("event: error\n")).toBe(true);
    expect(parseDataLine(frame)).toEqual({
      code: "cost_cap_exceeded",
      message: "Daily cap reached",
      spentUsd: 0.95,
      capUsd: 1.0,
    });
  });

  it("includes the spend + cap values so the UI can render the budget copy", () => {
    const payload = parseDataLine(
      encodeOracleCapError({ spentUsd: 1.23, capUsd: 5, message: "x" }),
    ) as Record<string, number>;
    expect(payload['spentUsd']).toBe(1.23);
    expect(payload['capUsd']).toBe(5);
  });
});

describe("encodeGenericError", () => {
  it("emits an error event with just a message field (no code)", () => {
    const frame = encodeGenericError("upstream 500");
    expect(frame.startsWith("event: error\n")).toBe(true);
    const payload = parseDataLine(frame) as Record<string, unknown>;
    expect(payload).toEqual({ message: "upstream 500" });
    expect(payload).not.toHaveProperty("code");
  });
});

describe("ORACLE_SSE_DONE_FRAME", () => {
  it("is the terminal `event: done` frame with an empty JSON body", () => {
    expect(ORACLE_SSE_DONE_FRAME).toBe("event: done\ndata: {}\n\n");
  });
});

describe("encoder → parser round-trip", () => {
  // The parser (sse.ts) is what apps/web/lib/brain/use-oracle.ts uses
  // to consume our stream. Round-tripping through it catches any
  // encoding choice that would be silently dropped by the parser
  // (e.g. an extra `\r`, a missing `data:` prefix, non-JSON payloads).
  it("parses meta + delta + final + done emitted by the encoder", async () => {
    const events: OracleStreamEvent[] = [
      {
        kind: "meta",
        groundedness: "moderate",
        retrievedCounts: { knowledge: 4, sessions: 1 },
      },
      { kind: "delta", text: "Hello " },
      { kind: "delta", text: "world." },
      {
        kind: "final",
        citations: [],
        confidence: "medium",
        groundedness: "moderate",
        retrievedCounts: { knowledge: 4, sessions: 1 },
        relatedQuestions: [],
        tokensUsed: 42,
      },
    ];
    const body = streamFrames([
      ...events.map(encodeOracleEvent),
      ORACLE_SSE_DONE_FRAME,
    ]);
    const received: Array<{ event: string; data: unknown }> = [];
    for await (const frame of parseSSE(body)) {
      received.push(frame);
    }
    expect(received.map((r) => r.event)).toEqual([
      "meta",
      "delta",
      "delta",
      "final",
      "done",
    ]);
    expect((received[1]!.data as { text: string }).text).toBe("Hello ");
    expect((received[3]!.data as { tokensUsed: number }).tokensUsed).toBe(42);
  });
});

// ---------- helpers ----------

const FRAME_RE = /^event: [^\n]+\ndata: (.*)\n\n$/;

function parseDataLine(frame: string): unknown {
  const m = frame.match(FRAME_RE);
  if (!m) throw new Error(`malformed frame: ${JSON.stringify(frame)}`);
  return JSON.parse(m[1]!);
}

function streamFrames(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
}
