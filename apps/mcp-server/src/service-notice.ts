/**
 * The sunset notice carried by every MCP response while the instance is
 * closing (docs/SUNSET.md). An MCP user may never open the web app, so the
 * banner never reaches them; their agent reads every tool result, and is
 * asked to pass the notice on once.
 */
import { getLogger, parseServiceSunset, sunsetMcpNotice } from "@brain/core";

const log = getLogger("mcp-server", { stream: "stderr" });
let warned = false;

export function currentServiceNotice(now: Date = new Date()): string | null {
  const parsed = parseServiceSunset();
  if (!parsed.ok) {
    // A typo must not take the server down, but it must not pass silently
    // either: the operator believes users are being told, and they are not.
    if (!warned) log.error({ op: "mcp.service_notice", err: parsed.error }, "sunset setting ignored");
    warned = true;
    return null;
  }
  if (!parsed.sunset) return null;
  const host = process.env.BRAIN_PUBLIC_HOSTNAME?.trim();
  return sunsetMcpNotice(parsed.sunset, { webUrl: host ? `https://${host}` : null, now });
}

/** First key, so it is the first thing an agent reads in the result. */
export function withServiceNotice(result: unknown, notice: string | null): unknown {
  if (!notice) return result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { serviceNotice: notice, ...(result as Record<string, unknown>) };
  }
  return { serviceNotice: notice, result };
}
