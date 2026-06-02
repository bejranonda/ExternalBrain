/**
 * Oracle SSE frame encoder (#240).
 *
 * Lifts the wire-format / payload-schema logic out of
 * `apps/web/app/api/oracle/stream/route.ts` so the framing layer has
 * unit-level coverage independent of the e2e suite (which currently
 * can't reach a live Oracle endpoint — see #240 for the chain of
 * environments where the e2e test silently fails).
 *
 * The encoded format is RFC-conformant SSE:
 *
 *   event: <name>\n
 *   data: <JSON-encoded payload>\n
 *   \n
 *
 * Per-event payload schemas live next to the encoder so a regression
 * (e.g. dropping `tokensUsed` from the final frame, or changing the
 * cost-cap error code) trips a test instead of shipping to prod.
 */
import type { OracleStreamEvent } from "./oracle";

/**
 * Low-level SSE frame writer. Single source of truth for the
 * `event:`/`data:` line shape. Trailing `\n\n` is the SSE
 * record terminator — without it, proxies (Caddy, nginx) won't
 * flush the frame to the client.
 */
export function encodeSSEFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Map an Oracle stream event onto its wire-format SSE frame. The
 * payload shape per event is the public contract the web UI parses
 * (see `apps/web/components/brain/oracle.tsx`) — changing it is a
 * breaking change to the UI even though the type-checker won't catch
 * it across the HTTP boundary.
 */
export function encodeOracleEvent(ev: OracleStreamEvent): string {
  if (ev.kind === "meta") {
    return encodeSSEFrame("meta", {
      groundedness: ev.groundedness,
      retrievedCounts: ev.retrievedCounts,
    });
  }
  if (ev.kind === "delta") {
    return encodeSSEFrame("delta", { text: ev.text });
  }
  return encodeSSEFrame("final", {
    citations: ev.citations,
    confidence: ev.confidence,
    groundedness: ev.groundedness,
    retrievedCounts: ev.retrievedCounts,
    relatedQuestions: ev.relatedQuestions,
    tokensUsed: ev.tokensUsed,
  });
}

/**
 * Cost-cap exceeded — wire-format frame for the OracleCapExceededError
 * case. The UI special-cases `code: "cost_cap_exceeded"` to render the
 * spend/cap copy instead of a generic failure; changing the code string
 * silently breaks that copy path.
 */
export function encodeOracleCapError(err: {
  spentUsd: number;
  capUsd: number;
  message: string;
}): string {
  return encodeSSEFrame("error", {
    code: "cost_cap_exceeded",
    message: err.message,
    spentUsd: err.spentUsd,
    capUsd: err.capUsd,
  });
}

/**
 * Generic stream-failed error frame. Used for any non-cap error that
 * surfaces during the askStream generator (network blip, LLM 5xx, etc.).
 */
export function encodeGenericError(message: string): string {
  return encodeSSEFrame("error", { message });
}

/**
 * Terminal frame written in the `finally` block of the SSE stream so the
 * client knows the server closed the stream on purpose (vs. an
 * unexpected socket reset). The body is `{}` — the client only checks
 * the event name.
 */
export const ORACLE_SSE_DONE_FRAME = "event: done\ndata: {}\n\n";
