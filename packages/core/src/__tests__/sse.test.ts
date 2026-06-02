import { describe, expect, it } from "vitest";
import { parseSSE } from "../sse.js";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]!));
      i++;
    },
  });
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

describe("parseSSE", () => {
  it("parses a single complete frame", async () => {
    const s = streamOf([`event: delta\ndata: {"text":"hi"}\n\n`]);
    const out = await collect(parseSSE(s));
    expect(out).toEqual([{ event: "delta", data: { text: "hi" } }]);
  });

  it("defaults event to 'message' when absent", async () => {
    const s = streamOf([`data: {"x":1}\n\n`]);
    const out = await collect(parseSSE(s));
    expect(out[0]?.event).toBe("message");
  });

  it("joins multiple data: lines with newline", async () => {
    const s = streamOf([`data: {"t":\ndata: "split"}\n\n`]);
    const out = await collect(parseSSE(s));
    expect(out[0]?.data).toEqual({ t: "split" });
  });

  it("reassembles a frame that spans multiple chunks", async () => {
    const s = streamOf([`event: final\nda`, `ta: {"n":42}\n`, `\n`]);
    const out = await collect(parseSSE(s));
    expect(out).toEqual([{ event: "final", data: { n: 42 } }]);
  });

  it("handles back-to-back frames in one chunk", async () => {
    const s = streamOf([
      `event: delta\ndata: {"t":"a"}\n\nevent: delta\ndata: {"t":"b"}\n\n`,
    ]);
    const out = await collect(parseSSE(s));
    expect(out.map((e) => (e.data as { t: string }).t)).toEqual(["a", "b"]);
  });

  it("drops frames with no data: line", async () => {
    const s = streamOf([`event: ping\n\nevent: delta\ndata: {"ok":true}\n\n`]);
    const out = await collect(parseSSE(s));
    expect(out).toEqual([{ event: "delta", data: { ok: true } }]);
  });

  it("drops malformed JSON silently rather than throwing", async () => {
    const s = streamOf([
      `event: delta\ndata: not-json\n\nevent: final\ndata: {"done":true}\n\n`,
    ]);
    const out = await collect(parseSSE(s));
    expect(out).toEqual([{ event: "final", data: { done: true } }]);
  });
});
