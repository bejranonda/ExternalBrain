import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@brain/db";

/**
 * Deferred #42 tests — full Streamable-HTTP session lifecycle against a live
 * MCP server. Mints a temporary MCPToken row in whatever `DATABASE_URL`
 * points at so the tests exercise the actual auth path end-to-end (not a
 * mock); cleans the token up in afterAll, even if a test fails mid-suite.
 *
 * Why DB-roundtrip rather than mocked: PR #15 (per-request transport) and
 * #4 (unauth initialize leak) were both bugs in the wiring between the
 * HTTP handler, the SDK transport, and the DB-backed authenticate() —
 * mocked tests of any one piece would have missed them. Live integration
 * is the cheapest net for that class of regression.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * OPT-IN ONLY, and that is a safety property, not a convenience.
 *
 * This suite used to default to `http://localhost:3100` and run against
 * anything that answered. On a developer laptop that is a dev stack. On the
 * deployment host it is the **live production mcp-server**, and this file
 * both writes to the database (minting a real `MCPToken`) and drives real
 * HTTP against it. That collision was silent from 2026-06-02 until
 * 2026-08-30, and was only noticed because the suite's *other* assertion had
 * gone stale — it expected 9 tools while the catalog had moved to 14, so it
 * failed for an unrelated reason and someone finally read it
 * (`KNOWN_ISSUES §0av`).
 *
 * Two guards, in order:
 *   1. `BRAIN_MCP_E2E_URL` must be set explicitly. There is NO default — an
 *      unset variable skips the suite. "Runs against whatever is listening"
 *      is the property that made this dangerous, so it is gone.
 *   2. Even when opted in, the suite REFUSES (loudly, not silently) if
 *      `BRAIN_DEPLOY_ENV` says production. A skip would be the wrong
 *      response: someone who set the variable meant to run something, and
 *      needs telling why it did not. Note this deliberately reads
 *      `BRAIN_DEPLOY_ENV`, not `ENVIRONMENT` — the prod host carries
 *      `ENVIRONMENT=dev` as a leftover label, and trusting it would make
 *      this guard confidently clear production (see the same warning in
 *      `apps/web/app/api/healthz/route.ts`).
 *
 * To run it: point both variables at a disposable stack, e.g.
 *   BRAIN_MCP_E2E_URL=http://localhost:3100 \
 *   DATABASE_URL=postgresql://brain:brain@localhost:15432/brain \
 *   pnpm --filter @brain/mcp-server test
 */
const MCP_URL = process.env.BRAIN_MCP_E2E_URL?.trim();

if (MCP_URL && process.env.BRAIN_DEPLOY_ENV?.trim() === "production") {
  throw new Error(
    "session-lifecycle.test.ts refuses to run against a production deployment: " +
      "it mints a real MCPToken row and drives live HTTP. BRAIN_DEPLOY_ENV=production " +
      "was found in this environment. Point DATABASE_URL and BRAIN_MCP_E2E_URL at a " +
      "disposable stack, or unset BRAIN_MCP_E2E_URL to skip this suite.",
  );
}

async function reachable(): Promise<boolean> {
  if (!MCP_URL) return false;
  try {
    const r = await fetch(`${MCP_URL}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

interface Fixture {
  bearer: string;
  tokenId: string;
  userId: string;
}

async function mintTestToken(): Promise<Fixture | null> {
  // Need any User row to FK against. The dev seed produces "Alex".
  const user = await db.user.findFirst({ select: { id: true } });
  if (!user) return null;

  const raw = `bp_test_${randomBytes(20).toString("hex")}`;
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  const token = await db.mCPToken.create({
    data: {
      userId: user.id,
      tokenHash,
      name: "session-lifecycle-test",
      scope: "personal",
    },
    select: { id: true, userId: true },
  });
  return { bearer: raw, tokenId: token.id, userId: token.userId };
}

const live = await reachable();
let fixture: Fixture | null = null;

const guard = live ? describe : describe.skip;

guard(`MCP session lifecycle (live dev server at ${MCP_URL})`, () => {
  beforeAll(async () => {
    try {
      fixture = await mintTestToken();
    } catch (err) {
      // DB unreachable — every test skips via the inner guards below.
      // eslint-disable-next-line no-console
      console.warn("[session-lifecycle] could not mint test token:", err);
    }
  });

  afterAll(async () => {
    if (fixture) {
      // Always remove the test token, even if a test failed mid-suite.
      await db.mCPToken
        .delete({ where: { id: fixture.tokenId } })
        .catch(() => {
          /* ignore — best-effort cleanup */
        });
    }
    await db.$disconnect().catch(() => {});
  });

  const baseHeaders = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  } as const;

  const initBody = {
    jsonrpc: "2.0" as const,
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "session-lifecycle-test", version: "0.1" },
    },
  };

  it("initialize with valid bearer issues an Mcp-Session-Id", async () => {
    if (!fixture) return; // skipped — DB unavailable
    const res = await fetch(`${MCP_URL}/mcp`, {
      method: "POST",
      headers: { ...baseHeaders, authorization: `Bearer ${fixture.bearer}` },
      body: JSON.stringify(initBody),
    });
    expect(res.status).toBe(200);

    const sid = res.headers.get("mcp-session-id");
    expect(sid, "server did not issue Mcp-Session-Id").toMatch(
      /^[0-9a-f-]{36}$/i,
    );

    const body = (await res.json()) as { result?: { serverInfo?: unknown } };
    expect(body.result?.serverInfo).toBeDefined();
  });

  it("tools/list with a valid session id returns exactly this build's brain_* catalog", async () => {
    if (!fixture) return;
    // Open a fresh session for this test so the assertions are independent.
    const initRes = await fetch(`${MCP_URL}/mcp`, {
      method: "POST",
      headers: { ...baseHeaders, authorization: `Bearer ${fixture.bearer}` },
      body: JSON.stringify(initBody),
    });
    const sid = initRes.headers.get("mcp-session-id");
    expect(sid).toBeTruthy();

    const res = await fetch(`${MCP_URL}/mcp`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        authorization: `Bearer ${fixture.bearer}`,
        "mcp-session-id": sid!,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { tools?: Array<{ name: string }> };
    };
    const names = body.result?.tools?.map((t) => t.name) ?? [];
    // Derived from the catalog in THIS checkout, never a hardcoded count.
    // The literal `9` that used to sit here went stale the moment the catalog
    // grew and stayed wrong for months, which is what a magic number in an
    // assertion always eventually does. A mismatch here now means something
    // real: the server you are pointed at is a different build than this
    // source tree — reload it, or you are testing the wrong box.
    const { tools } = await import("../tools/index.js");
    const expected = tools.map((t) => t.name).sort();
    expect(
      names.slice().sort(),
      "running server's tool catalog differs from this checkout — reload the target stack",
    ).toEqual(expected);
    for (const n of names) expect(n).toMatch(/^brain_/);
  });

  it("tools/list with a forged session id returns -32000 'Server not initialized'", async () => {
    if (!fixture) return;
    const res = await fetch(`${MCP_URL}/mcp`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        authorization: `Bearer ${fixture.bearer}`,
        "mcp-session-id": "00000000-0000-0000-0000-000000000000",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { error?: { code?: number; message?: string } };
    // The SDK transport raises this exact error code for not-yet-initialized
    // sessions; it's the regression net for #15.
    expect(body.error?.code).toBe(-32000);
    expect(body.error?.message).toMatch(/not initialized/i);
  });

  it("DELETE /mcp with a valid session id removes it from the in-memory map", async () => {
    if (!fixture) return;
    // Open a session first.
    const initRes = await fetch(`${MCP_URL}/mcp`, {
      method: "POST",
      headers: { ...baseHeaders, authorization: `Bearer ${fixture.bearer}` },
      body: JSON.stringify(initBody),
    });
    const sid = initRes.headers.get("mcp-session-id")!;
    expect(sid).toBeTruthy();

    // Capture the live session count BEFORE delete.
    const before = await fetch(`${MCP_URL}/health`).then((r) =>
      r.json() as Promise<{ sessions: number }>,
    );

    const delRes = await fetch(`${MCP_URL}/mcp`, {
      method: "DELETE",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${fixture.bearer}`,
        "mcp-session-id": sid,
      },
    });
    // SDK returns 200 on a clean teardown.
    expect(delRes.status).toBeLessThan(300);

    // Counter should drop. Allow a tiny grace period for the onclose callback
    // to fire — the SDK calls it asynchronously.
    await new Promise((r) => setTimeout(r, 50));
    const after = await fetch(`${MCP_URL}/health`).then((r) =>
      r.json() as Promise<{ sessions: number }>,
    );
    expect(after.sessions).toBeLessThan(before.sessions);
  });

  it("a token with the wrong bearer string is rejected by authenticate()", async () => {
    // No fixture needed — this is testing the rejection path.
    const fakeBearer = "bp_definitely_not_a_real_token_xxxxxxxxxxxxxxxxxxxx";
    const res = await fetch(`${MCP_URL}/mcp`, {
      method: "POST",
      headers: { ...baseHeaders, authorization: `Bearer ${fakeBearer}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
    });
    // Could be 400 (transport rejects pre-auth) or a JSON-RPC error post-auth;
    // either way it MUST NOT be 200 + tool list.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("install-ping sequence creates a real Session row with clientType=claude_code and outcome=success", async () => {
    if (!fixture) return;
    // Drive the exact same call sequence the v2 installer does on success.
    // Proves end-to-end that:
    //   (1) the smoke-test path (init + brain_get_user_style) round-trips,
    //   (2) the install-ping (start_session + log_event + report_outcome)
    //       lands a Session row with the right clientType + outcome,
    //   (3) the persisted row carries the installer's metadata payload so
    //       the dashboard can later distinguish probes from real installs.
    // This is the regression net for the "tokens connected but nothing
    // learnt" diagnostic the platform shipped this iteration to fix.
    const init = await fetch(`${MCP_URL}/mcp`, {
      method: "POST",
      headers: { ...baseHeaders, authorization: `Bearer ${fixture.bearer}` },
      body: JSON.stringify(initBody),
    });
    expect(init.status).toBe(200);
    const sid = init.headers.get("mcp-session-id");
    expect(sid).toBeTruthy();

    // I1: smoke-test — brain_get_user_style is the cheapest free-tier tool.
    const styleCall = await fetch(`${MCP_URL}/mcp`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        authorization: `Bearer ${fixture.bearer}`,
        "mcp-session-id": sid!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "brain_get_user_style", arguments: {} },
      }),
    });
    expect(styleCall.status).toBe(200);
    const styleBody = (await styleCall.json()) as { result?: unknown };
    expect(styleBody.result).toBeDefined();

    // I2: install-ping — start_session → log_event(install) → report_outcome.
    const startCall = await fetch(`${MCP_URL}/mcp`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        authorization: `Bearer ${fixture.bearer}`,
        "mcp-session-id": sid!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "brain_start_session",
          arguments: { clientType: "claude_code", prompt: "brain installer ping v2" },
        },
      }),
    });
    expect(startCall.status).toBe(200);
    const startBody = (await startCall.json()) as {
      result?: { content?: Array<{ text?: string }> };
    };
    const text = startBody.result?.content?.[0]?.text ?? "{}";
    const startResult = JSON.parse(text) as { sessionId?: string };
    expect(startResult.sessionId, "start_session must return sessionId").toMatch(/^[a-z0-9-]+$/i);
    const newSessionId = startResult.sessionId!;

    const logCall = await fetch(`${MCP_URL}/mcp`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        authorization: `Bearer ${fixture.bearer}`,
        "mcp-session-id": sid!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "brain_log_event",
          arguments: {
            sessionId: newSessionId,
            eventType: "tool_use",
            payload: { installer_version: 2, claude_version: "test", os: "linux" },
          },
        },
      }),
    });
    expect(logCall.status).toBe(200);

    const reportCall = await fetch(`${MCP_URL}/mcp`, {
      method: "POST",
      headers: {
        ...baseHeaders,
        authorization: `Bearer ${fixture.bearer}`,
        "mcp-session-id": sid!,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "brain_report_session_outcome",
          arguments: { sessionId: newSessionId, success: true },
        },
      }),
    });
    expect(reportCall.status).toBe(200);

    // DB-level assertions — the install ping must land as a real, closed,
    // outcome-bearing Session row. This is the strict signal the
    // dashboard "is the platform learning?" surface reads.
    const row = await db.session.findUnique({
      where: { id: newSessionId },
      select: { clientType: true, endedAt: true, outcome: true, tokenId: true },
    });
    expect(row, "Session row must exist after report_session_outcome").not.toBeNull();
    expect(row!.clientType).toBe("claude_code");
    expect(row!.endedAt, "endedAt must be set — without it KEA never triggers").not.toBeNull();
    expect(row!.outcome).toBeDefined();
    expect(row!.tokenId, "Session must be bound to the installer's token").toBe(fixture.tokenId);

    // Clean up the synthetic install-ping session so the DB stays tidy.
    // Best-effort: failures here don't fail the test.
    await db.sessionEvent.deleteMany({ where: { sessionId: newSessionId } }).catch(() => {});
    await db.session.delete({ where: { id: newSessionId } }).catch(() => {});
  });

  it("session ID + a different valid Bearer is rejected (#104 / audit C1)", async () => {
    if (!fixture) return;
    // Mint a second token (different user) so we can exercise the
    // session-token binding check directly.
    const secondUser = await db.user.findFirst({
      where: { id: { not: fixture.userId } },
      select: { id: true },
    });
    if (!secondUser) {
      // Need at least two users to trigger the cross-user case.
      // The dev seed produces "Alex" only, so this assertion is a no-op
      // in CI/local — but live dev DB usually has more users.
      return;
    }
    const otherRaw = `bp_test_${randomBytes(20).toString("hex")}`;
    const otherHash = createHash("sha256").update(otherRaw).digest("hex");
    const otherToken = await db.mCPToken.create({
      data: {
        userId: secondUser.id,
        tokenHash: otherHash,
        name: "session-binding-test",
        scope: "personal",
      },
      select: { id: true },
    });
    try {
      // Open a session with Alice's bearer.
      const initRes = await fetch(`${MCP_URL}/mcp`, {
        method: "POST",
        headers: { ...baseHeaders, authorization: `Bearer ${fixture.bearer}` },
        body: JSON.stringify(initBody),
      });
      const sid = initRes.headers.get("mcp-session-id");
      expect(sid).toBeTruthy();

      // Attach to Alice's session with Bob's bearer → must be rejected.
      const res = await fetch(`${MCP_URL}/mcp`, {
        method: "POST",
        headers: {
          ...baseHeaders,
          authorization: `Bearer ${otherRaw}`,
          "mcp-session-id": sid!,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error?: { code?: number; message?: string } };
      expect(body.error?.code).toBe(-32001);
      expect(body.error?.message).toMatch(/session-token mismatch/i);
    } finally {
      await db.mCPToken.delete({ where: { id: otherToken.id } }).catch(() => {});
    }
  });
});
