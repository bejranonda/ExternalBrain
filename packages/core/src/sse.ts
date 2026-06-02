/**
 * Minimal Server-Sent Events parser. Consumes a `ReadableStream<Uint8Array>`
 * and yields one `{ event, data }` per complete frame.
 *
 * Frame rules (per the EventSource spec subset we ship):
 *   - Frames are separated by a blank line (`\n\n`).
 *   - `event:` sets the event name (default `"message"`).
 *   - `data:` lines accumulate; multiple `data:` lines in the same frame
 *     are joined with `\n` before JSON-parsing.
 *   - Frames with no `data:` lines are dropped.
 *   - Frames whose data is not valid JSON are dropped (no throw) — the
 *     producer is buggy, the UI should stay alive.
 *
 * Used by `apps/web/lib/brain/use-oracle.ts` to consume `/api/oracle/stream`.
 */
export async function* parseSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = "message";
        const dataLines: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        try {
          yield { event, data: JSON.parse(dataLines.join("\n")) };
        } catch {
          /* drop malformed */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
