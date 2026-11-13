/**
 * `sunset.sh responses` renders through deploy/sunset/responses.py
 * (docs/SUNSET.md). Run against a stand-in for Resend: the first live run of
 * this script reported every message as "lookup failed (HTTP 403)" because
 * Resend's edge refuses urllib's default User-Agent, which only a real HTTP
 * round trip shows.
 */
import { execFile } from "node:child_process";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = join(__dirname, "..", "..", "..", "..", "deploy", "sunset", "responses.py");

// user_id email role notices first_notice first_export exports mcp_last
const ROWS = [
  ["u1", "ada@example.com", "admin", "announce:m-del", "2026-11-13 07:38", "2026-11-14 10:00", "2", "2026-11-15 09:00"],
  ["u2", "bob@example.org", "user", "announce:m-bnc", "2026-11-13 07:38", "", "0", "2026-08-15 19:05"],
  ["u3", "cyd@example.net", "user", "announce:m-429", "2026-11-13 07:39", "", "0", ""],
  ["u4", "dee@nomx.invalid", "user", "", "", "", "0", ""],
  ["u5", "eve@example.com", "user", "announce:m-fail", "2026-11-13 07:40", "", "0", ""],
].map((r) => r.join("\t")).join("\n");

const seen: { url: string; headers: IncomingHttpHeaders }[] = [];
let throttled = false;
let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? "", headers: req.headers });
    const id = (req.url ?? "").split("/").pop();
    if (req.headers["user-agent"]?.startsWith("Python-urllib")) return res.writeHead(403).end();
    if (id === "m-429" && !throttled) {
      throttled = true;
      return res.writeHead(429).end();
    }
    const last_event = { "m-del": "delivered", "m-bnc": "bounced", "m-429": "delivered", "m-fail": "failed" }[id ?? ""];
    res.writeHead(last_event ? 200 : 404, { "content-type": "application/json" }).end(JSON.stringify({ last_event }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function run(env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "python3",
      ["-I", SCRIPT],
      { encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", SUNSET_AT: "2099-12-14T12:00:00Z", SUNSET_PAUSE_MS: "0", ...env } },
      (err, stdout, stderr) => (err ? reject(new Error(`${err.message}\n${stderr}`)) : resolve(stdout)),
    );
    child.stdin?.end(ROWS);
  });
}

describe("sunset responses report", () => {
  it("looks up each notice at the provider and tallies what users did", async () => {
    const out = await run({
      SUNSET_EMAIL_PROVIDER: "resend",
      SUNSET_EMAIL_API_KEY: "test-key",
      SUNSET_RESEND_API: base,
      SUNSET_CONTACT: "hello@example.com",
    });
    expect(seen.length).toBe(5); // four notices, one retried after a 429
    for (const s of seen) {
      expect(s.headers.authorization).toBe("Bearer test-key");
      expect(s.headers["user-agent"]).not.toMatch(/^Python-urllib/);
    }
    expect(out).toContain("5  (4 notified, 1 never notified)");
    expect(out).toMatch(/announce\s+4 sent\s+2 delivered\s+1 bounced\s+1 failed/);
    expect(out).toMatch(/downloaded their data\s+1 of 4/);
    expect(out).toMatch(/used MCP \(their AI was told\)\s+1 of 4/);
    expect(out).toContain("2026-11-14 10:00 (×2)");
    expect(out).toContain("2026-11-15 09:00 ✓");
    expect(out).toMatch(/bounced, complained, failed.*\n\s+bob…@example\.org\n\s+eve…@example\.com/);
    expect(out).toContain("1 account(s) were sent the email but have neither downloaded nor used MCP");
    expect(out).toContain("Replies go to hello@example.com");
    expect(out).not.toContain("ada@example.com");
  });

  it("without a provider key it reports sends only and makes no requests", async () => {
    const before = seen.length;
    const out = await run({ SUNSET_EMAIL_PROVIDER: "disabled", SUNSET_SHOW_EMAILS: "1" });
    expect(seen.length).toBe(before);
    expect(out).toContain("no delivery lookup");
    expect(out).toMatch(/announce\s+4 sent\s+4 sent/);
    expect(out).toContain("ada@example.com");
  });
});
