import { describe, expect, it } from "vitest";

/**
 * Regression net for #4 option C: every method, including `initialize`,
 * must require a Bearer. The HTTP server in `src/index.ts::runHttp`
 * gates this BEFORE the SDK transport sees the request — short-circuiting
 * with 401 + a JSON-RPC `-32001` body and no serverInfo leak.
 *
 * These tests run against a live dev MCP HTTP server on $BRAIN_MCP_URL
 * (default http://localhost:3100). They're skipped when the server isn't
 * reachable, so CI without the dev stack still passes — but the moment a
 * developer reloads `mcp-server` and runs `pnpm --filter @brain/mcp-server
 * test`, the gate is exercised. A future PR can mock the HTTP server in-
 * process so the skip is no longer needed.
 */
const MCP_URL = process.env.BRAIN_MCP_URL ?? "http://localhost:3100";

async function reachable(): Promise<boolean> {
  try {
    const r = await fetch(`${MCP_URL}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const live = await reachable();
const guard = live ? describe : describe.skip;

guard("MCP auth gate (live dev server at " + MCP_URL + ")", () => {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  } as const;

  it("rejects unauth `initialize` with 401 + no serverInfo (#4)", async () => {
    const res = await fetch(`${MCP_URL}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "auth-gate-test", version: "0.1" },
        },
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).not.toMatch(/serverInfo/i);
    expect(body).not.toMatch(/brain-platform/i);
    expect(body).toMatch(/-32001/);
  });

  it("rejects unauth `tools/list` with 401", async () => {
    const res = await fetch(`${MCP_URL}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("/health stays open without auth (oncall liveness)", async () => {
    const res = await fetch(`${MCP_URL}/health`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; transport: string };
    expect(json.ok).toBe(true);
    expect(json.transport).toBe("http");
  });

  it("emits a www-authenticate header pointing at the bp_ scheme", async () => {
    const res = await fetch(`${MCP_URL}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.headers.get("www-authenticate")).toMatch(/bearer/i);
  });
});
