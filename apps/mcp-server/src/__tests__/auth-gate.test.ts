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
 *
 * KEEPS its localhost default, unlike `session-lifecycle.test.ts` — the two
 * files share a shape but not a risk profile, and the fix was graded on the
 * risk rather than the shape (`KNOWN_ISSUES §0aw`). That suite mints a real
 * `MCPToken` row and drives authenticated traffic, so pointing it at
 * production is a genuine hazard and it is now opt-in with no default. This
 * one imports no database, writes nothing, and sends only UNAUTHENTICATED
 * requests asserting they are refused — the same thing every internet scanner
 * does to a public MCP endpoint hourly. Making it opt-in would cost every
 * developer automatic coverage of a security gate and buy no safety.
 *
 * It still refuses to run against a deployment that declares itself
 * production: harmless is not the same as appropriate, and the `describe`
 * label below would otherwise claim "dev server" while probing prod. Reads
 * `BRAIN_DEPLOY_ENV`, never `ENVIRONMENT` — the prod host carries
 * `ENVIRONMENT=dev` as a leftover label (see `§0al`, and the identical
 * warning in `apps/web/app/api/healthz/route.ts`).
 */
const MCP_URL = process.env.BRAIN_MCP_URL ?? "http://localhost:3100";

if (process.env.BRAIN_DEPLOY_ENV?.trim() === "production") {
  throw new Error(
    "auth-gate.test.ts refuses to run against a production deployment " +
      "(BRAIN_DEPLOY_ENV=production). Point BRAIN_MCP_URL at a disposable stack.",
  );
}

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
