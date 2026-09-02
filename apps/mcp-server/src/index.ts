#!/usr/bin/env node
/**
 * External Brain MCP Server.
 *
 * Serves knowledge to any MCP-capable AI client (Claude Code, Cursor,
 * Windsurf, Autobahn, custom agents). Two transports:
 *   - stdio: the default for editor integrations (set MCP_TRANSPORT=stdio or leave unset)
 *   - http:  set MCP_TRANSPORT=http, listens on MCP_SERVER_HTTP_PORT (default 3100)
 *
 * Authentication: token-based. Clients pass `Authorization: Bearer <token>`
 * over HTTP, or export `BRAIN_MCP_TOKEN` for stdio.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { envForMcp, getLogger, withRequest, shortId } from "@brain/core";
import { tools, callTool } from "./tools/index.js";
import { resources, readResource } from "./resources.js";
import { authenticate } from "./auth.js";
import { extractBearer } from "./http-helpers.js";

const env = envForMcp();
// MCP stdio owns stdout for JSON-RPC framing; logs must go to stderr.
const log = getLogger("mcp-server", { stream: "stderr" });
void (async () => {
  const { initSentry } = await import("@brain/core");
  await initSentry("mcp-server");
})();

/**
 * Per-request token store. Populated by the HTTP dispatcher before handing
 * off to the MCP server; for stdio the env var is used directly.
 */
const tokenStore = new AsyncLocalStorage<string | undefined>();
function currentToken(): string | undefined {
  return tokenStore.getStore() ?? process.env.BRAIN_MCP_TOKEN;
}

/**
 * Per-session call counter. We pass a mutable counter object into
 * buildServer() so the tool dispatcher can increment it without holding
 * a reference back to the parent Session record. The Session map keeps
 * the same counter object so the close handler / sweeper can read
 * `counter.n` to decide whether to emit `mcp.session.orphan`.
 */
type CallCounter = { n: number; lists: number };

function buildServer(counter: CallCounter = { n: 0, lists: 0 }): Server {
  const server = new Server(
    { name: "brain-platform", version: "0.1.0" },
    {
      capabilities: { tools: {}, resources: {} },
      // Surfaced to capable clients (Claude Code reads this; some clients
      // ignore it). Encourages the bootstrap pattern that produces a real
      // tool call right after connect — so we can distinguish working
      // clients from probes that only call `initialize` + `tools/list`.
      instructions:
        "External Brain is connected. Run `brain_get_user_style` first to " +
        "verify end-to-end connectivity and bootstrap your peer card. " +
        "Start each coding task with `brain_start_session(prompt: <task " +
        "description>)` — the response carries `relevantKnowledge`, rules " +
        "this Brain already learned that apply to the task; APPLY them and " +
        "pass their IDs back as `knowledgeUsed` when you close. Phrase the " +
        "prompt as technology + repo + task shape (it doubles as the " +
        "retrieval query — 'fix bug' retrieves nothing useful). When " +
        "resuming or continuing earlier work, ask `brain_ask_oracle` " +
        "('what did we decide about X?') before re-deriving decisions. " +
        "End each coding session with `brain_report_session_outcome` so the " +
        "Knowledge Extraction Agent can learn from the outcome — without " +
        "that close call, sessions stay open and the brain doesn't learn. " +
        "When you call it, include `learnings`: 0-5 durable rules you " +
        "distilled from the session — especially user corrections and " +
        "rejected approaches — each as {trigger, rule, rationale, type, " +
        "source}. This is how the Brain learns best; a session closed " +
        "without learnings only gets mined from a thin summary. " +
        "If any tool returns \"Server not initialized\" or the session " +
        "appears stuck, the MCP transport dropped (server restart, " +
        "30-min orphan sweep, or network blip) — the client SDK does NOT " +
        "auto-reconnect. Fix: quit and restart your editor (Claude Code: " +
        "`/mcp` → reconnect, or full restart). Retrying the same tool " +
        "call in a loop will not recover; the session is gone.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Defence in depth. The HTTP dispatcher validates the bearer before it
    // allocates a session, but stdio has no such gate and a future transport
    // might not either — the catalogue (tool names, descriptions, input
    // schemas) is a map of the attack surface and must not be free.
    await authenticate(currentToken());
    counter.lists++;
    // List-only traffic was invisible before — 184 session opens with no
    // visible activity led to a wrong "no clients calling tools" reading
    // when the truth was "clients are listing but never calling". Tag
    // every list so the histogram can distinguish probe shapes.
    log.info({ op: "mcp.tools.list" }, "tools/list");
    return {
      tools: tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const auth = await authenticate(currentToken());
    const start = performance.now();
    counter.n++;
    try {
      const result = await callTool(req.params.name, req.params.arguments ?? {}, auth);
      log.info(
        {
          op: "mcp.tool",
          tool: req.params.name,
          durMs: Math.round(performance.now() - start),
          outcome: "ok",
        },
        "mcp.tool",
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      log.error(
        {
          op: "mcp.tool",
          tool: req.params.name,
          durMs: Math.round(performance.now() - start),
          outcome: "error",
          err,
        },
        "mcp.tool failed",
      );
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${msg}` }],
        isError: true,
      };
    }
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    await authenticate(currentToken());
    return { resources };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const auth = await authenticate(currentToken());
    return readResource(req.params.uri, auth);
  });

  return server;
}

async function runStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("Brain MCP server running on stdio");
}

async function runHttp(): Promise<void> {
  const port = env.MCP_SERVER_HTTP_PORT;

  // Stateful session map: a transport+server pair lives for the duration of a
  // client session and is reused across requests carrying the same
  // `Mcp-Session-Id` header. Required by MCP Streamable HTTP — once
  // `initialize` has run on a transport, follow-up requests (`tools/list`,
  // `tools/call`, `notifications/initialized`) MUST land on the same
  // transport instance, otherwise the SDK returns
  // `-32000 "Server not initialized"`.
  type Session = {
    server: Server;
    transport: StreamableHTTPServerTransport;
    token: string | undefined;
    openedAt: number;
    counter: CallCounter;
  };
  const sessions = new Map<string, Session>();

  // Orphan sweeper. Before this, the sessions Map grew unboundedly:
  // probes that open a session and never send DELETE /mcp leak forever
  // (production showed 184 opens, 0 closes over 7 days). The sweeper
  // catches both the leak AND the diagnostic shape ("token authenticates
  // but never reaches the tool layer") by walking the map every 5 min,
  // emitting `mcp.session.orphan` for any session older than 30 min that
  // has logged zero tool calls, and evicting it. Conservative threshold:
  // a legitimately idle editor connection lives much longer than 30 min,
  // but a legitimate editor would also have called at least `tools/list`
  // and likely one `brain_get_user_style` (per the bootstrap hint above).
  const ORPHAN_MAX_AGE_MS = 30 * 60 * 1000;
  const ORPHAN_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      const ageMs = now - s.openedAt;
      if (ageMs > ORPHAN_MAX_AGE_MS && s.counter.n === 0) {
        log.warn(
          {
            op: "mcp.session.orphan",
            sessionPrefix: id.slice(0, 8),
            ageSec: Math.round(ageMs / 1000),
            lists: s.counter.lists,
            tokenPrefix: s.token?.slice(0, 8) ?? null,
          },
          "session closed with zero tool calls",
        );
        sessions.delete(id);
        void s.server.close();
      }
    }
  }, ORPHAN_SWEEP_INTERVAL_MS);
  // Don't keep the event loop alive just for sweeping — Node will exit
  // when nothing else is pending. The HTTP listener already holds the
  // loop open during normal operation.
  sweeper.unref();

  const http = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          transport: "http",
          sessions: sessions.size,
          // Which tier is this? Mirrors `apps/web/app/api/healthz`'s field of
          // the same name, deliberately down to the fail-safe: **absent when
          // unset**, never guessed. A caller treats a missing value as
          // "cannot verify" rather than "not production".
          //
          // This exists so a destructive check can ask the BOX rather than
          // its own shell. `session-lifecycle.test.ts` writes real rows, and
          // its production guard originally read `BRAIN_DEPLOY_ENV` from the
          // *test process* — which is the wrong place to ask, because the
          // process doing the writing can be anywhere while the thing at risk
          // is the target (`GUIDELINES §4` "identify the target as part of
          // the check", `KNOWN_ISSUES §0ax`).
          //
          // Reports a tier label, never a hostname: this is unauthenticated
          // and the repo does not publish its deployment host.
          environment: process.env.BRAIN_DEPLOY_ENV?.trim() || null,
        }),
      );
      return;
    }
    // Closes ExternalBrain #9 — bare GET / used to return nginx's 9-byte
    // default 404, giving a developer pasting the MCP hostname in a
    // browser no signal what they hit. Now returns a small no-auth
    // landing pointing at /health + the webapp docs. The actual MCP
    // endpoint stays at /mcp and remains bearer-gated.
    if (req.url === "/" || req.url === "") {
      const webHost = process.env.BRAIN_PUBLIC_HOSTNAME?.trim();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          {
            server: "External Brain MCP",
            transport: "http",
            endpoints: {
              mcp: "/mcp (POST, Bearer auth required)",
              health: "/health",
            },
            docs: webHost ? `https://${webHost}/docs` : null,
            welcome: webHost ? `https://${webHost}/welcome` : null,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (req.url !== "/mcp" && req.url !== "/mcp/") {
      res.writeHead(404).end("Not Found");
      return;
    }

    // Operator kill-switch (#56 gap 3). Read at request time so a flip
    // takes effect on the next request without a redeploy. /health stays
    // open above so monitoring + oncall liveness probes still work.
    if ((process.env.MCP_ENABLED ?? "true").toLowerCase() === "false") {
      res.writeHead(503, {
        "content-type": "application/json",
        "retry-after": "60",
      });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32002,
            message: "MCP service is currently paused by the operator. Try again later.",
          },
          id: null,
        }),
      );
      return;
    }

    const token = extractBearer(req);
    const requestId = shortId();
    const sid = (req.headers["mcp-session-id"] as string | undefined)?.trim();

    // Refuse every request without a Bearer token, including `initialize`
    // (#4 option C). The MCP spec permits unauthenticated `initialize` for
    // capability discovery, but that path leaks `serverInfo.name` +
    // `version` to anyone who can reach the endpoint. Since no clients are
    // depending on the discovery path yet, we override the spec in favour
    // of strict defense-in-depth: every method requires auth, returning
    // a JSON-RPC -32001 "Authentication required" before the SDK transport
    // ever sees the request. The token itself is validated against the DB
    // by `authenticate()` when the first authenticated method runs; this
    // gate just refuses the obviously-unauthenticated case cheaply.
    if (!token) {
      res.writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="brain-mcp"',
      });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message:
              "Authentication required: include `Authorization: Bearer <bp_…>`",
          },
          id: null,
        }),
      );
      log.info(
        { op: "mcp.unauth", method: req.method, sessionId: sid ?? null },
        "rejected unauth request",
      );
      return;
    }

    let session = sid ? sessions.get(sid) : undefined;
    // Audit C1 / #104 — bind the session to the bootstrap token. Without
    // this, an attacker who learns a session ID (via logs, traces, or any
    // side-channel) plus possesses ANY valid Bearer can attach to the
    // session and act as the session's owner. Reject mid-session requests
    // whose Bearer doesn't match the session's stored token. Constant-time
    // compare to avoid leaking match progress via timing. Both buffers are
    // raw bp_… tokens of equal length when issued (256-bit), but a short
    // attacker token could still fall through `timingSafeEqual` with a
    // length mismatch — pre-check length to avoid that throw.
    if (sid && session && session.token) {
      const a = Buffer.from(token, "utf8");
      const b = Buffer.from(session.token, "utf8");
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32001,
              message: "Session-token mismatch — re-initialize to bind the session to your token",
            },
            id: null,
          }),
        );
        log.warn(
          { op: "mcp.session.token_mismatch", sessionPrefix: sid.slice(0, 8) },
          "rejected mid-session request whose Bearer doesn't match the bootstrap token",
        );
        return;
      }
    }
    if (!session) {
      // Validate the bearer against the DB BEFORE allocating a transport.
      // The presence-only gate above refuses the no-header case cheaply, but
      // ANY syntactically-valid string used to reach `initialize` and get back
      // serverInfo + the tool catalogue + a live session id — defeating the
      // stated goal of the strict-auth override documented above, and handing
      // an anonymous caller an unbounded way to grow this map (entries are
      // only evicted by the 30-min orphan sweeper).
      //
      // Established sessions are deliberately NOT re-validated here: they are
      // already pinned to this same token by the timingSafeEqual check above,
      // so the per-request cost for real clients is unchanged.
      try {
        await authenticate(token);
      } catch {
        res.writeHead(401, {
          "content-type": "application/json",
          "www-authenticate": 'Bearer realm="brain-mcp"',
        });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Invalid or expired token" },
            id: null,
          }),
        );
        log.warn(
          { op: "mcp.auth.reject", tokenPrefix: token.slice(0, 8) },
          "rejected session bootstrap with an invalid bearer",
        );
        return;
      }

      const counter: CallCounter = { n: 0, lists: 0 };
      const server = buildServer(counter);
      const openedAt = Date.now();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        // Plain JSON responses for unary RPC calls — friendlier to HTTP clients
        // that don't fully implement SSE framing. Server-pushed notifications
        // still upgrade to text/event-stream when the client opens a GET.
        enableJsonResponse: true,
        onsessioninitialized: (newId) => {
          sessions.set(newId, { server, transport, token, openedAt, counter });
          // Don't log the full session UUID — combined with C1 it amounts
          // to a hijack key. Log a short prefix only (W4 in #103).
          log.info(
            { op: "mcp.session.open", sessionPrefix: newId.slice(0, 8), total: sessions.size },
            "mcp session opened",
          );
        },
      });
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id && sessions.has(id)) {
          const s = sessions.get(id)!;
          const ageSec = Math.round((Date.now() - s.openedAt) / 1000);
          sessions.delete(id);
          void server.close();
          if (s.counter.n === 0) {
            log.warn(
              {
                op: "mcp.session.orphan",
                sessionPrefix: id.slice(0, 8),
                ageSec,
                lists: s.counter.lists,
                tokenPrefix: s.token?.slice(0, 8) ?? null,
              },
              "session closed with zero tool calls",
            );
          } else {
            log.info(
              {
                op: "mcp.session.close",
                sessionPrefix: id.slice(0, 8),
                ageSec,
                toolCalls: s.counter.n,
                lists: s.counter.lists,
                total: sessions.size,
              },
              "mcp session closed",
            );
          }
        }
      };
      await server.connect(transport as unknown as Parameters<Server["connect"]>[0]);
      session = { server, transport, token, openedAt, counter };
    }

    await withRequest(requestId, () =>
      tokenStore.run(session!.token ?? token, async () => {
        try {
          await session!.transport.handleRequest(req, res);
        } catch (err) {
          log.error({ err }, "HTTP error");
          if (!res.headersSent) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: String(err) }));
          }
        }
      }),
    );
  });

  http.listen(port, () => {
    log.info({ port }, `Brain MCP server running on http://0.0.0.0:${port}/mcp`);
  });
}

async function main(): Promise<void> {
  const mode =
    env.MCP_TRANSPORT ??
    (process.env.MCP_SERVER_HTTP_PORT ? "http" : "stdio");
  if (mode === "http") {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  log.fatal({ err }, "MCP server fatal error");
  process.exit(1);
});
