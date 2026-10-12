import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { auditIpFrom, clientIpFrom, forwardClientIp } from "./client-ip";

const h = (init: Record<string, string>) => new Headers(init);

describe("clientIpFrom", () => {
  it("ignores a client-supplied first X-Forwarded-For hop (nginx appends)", () => {
    // `$proxy_add_x_forwarded_for` turns a spoofed header into "spoof, real".
    expect(clientIpFrom(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("prefers X-Real-IP, which both proxies set from the socket", () => {
    expect(
      clientIpFrom(h({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6, 203.0.113.9" })),
    ).toBe("203.0.113.9");
  });

  it("reads Caddy's overwritten single-hop header", () => {
    expect(clientIpFrom(h({ "x-forwarded-for": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it('falls back to "local" with no proxy headers, and tolerates junk', () => {
    expect(clientIpFrom(h({}))).toBe("local");
    expect(clientIpFrom(h({ "x-forwarded-for": " , " }))).toBe("local");
    expect(clientIpFrom(h({ "x-real-ip": "  " }))).toBe("local");
  });

  it("gives audit rows null rather than the sentinel", () => {
    expect(auditIpFrom(h({}))).toBeNull();
    expect(auditIpFrom(h({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("forwards the visitor's address on a loopback call, and nothing when unknown", () => {
    expect(forwardClientIp(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toEqual({
      "x-real-ip": "203.0.113.9",
    });
    expect(forwardClientIp(h({}))).toEqual({});
  });
});

/**
 * One rule, read in one place. Twenty call sites each parsed the header
 * themselves and all of them took the spoofable first hop; this sweep fails
 * the moment a twenty-first does.
 */
describe("every client-IP read goes through client-ip.ts", () => {
  const WEB = resolve(__dirname, "..", "..");
  const SKIP = new Set(["node_modules", ".next", "e2e", "tests", "test-results", "playwright-report"]);

  function* sources(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) yield* sources(p);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield p;
    }
  }

  it("no other source file reads x-forwarded-for", () => {
    const offenders = [...sources(WEB)]
      .filter((f) => !f.endsWith(join("lib", "brain", "client-ip.ts")))
      .filter((f) => /x-forwarded-for/i.test(readFileSync(f, "utf8")))
      .map((f) => relative(WEB, f));
    expect(offenders).toEqual([]);
  });
});
