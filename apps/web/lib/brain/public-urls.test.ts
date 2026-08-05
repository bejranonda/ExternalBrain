import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { resolvePublicMcpUrl, resolvePublicWebUrl } from "./public-urls";

const WEB_ROOT = path.resolve(__dirname, "../..");

/**
 * Regression guard for the #293 bug CLASS, not the #293 bug.
 *
 * History: install snippets rendered `${hostname}:3100/mcp`, which is
 * unreachable behind Caddy (MCP is its own vhost on :443). It was fixed for
 * /welcome and guarded by an e2e spec named after that page — so the identical
 * defect survived unnoticed in the token install wizard AND the onboarding
 * modal, which are the surfaces operators actually use for first-run setup.
 *
 * A test named after a page proves nothing about its siblings. This one pins
 * the full set of files allowed to mention the port at all: a new surface that
 * hardcodes it fails here immediately, and the fix is to resolve the URL
 * through `public-urls.ts` on the server rather than to extend this list.
 */
const ALLOWED_TO_MENTION_PORT = new Set([
  // Dev fallbacks — each is overridden by a server-injected value in prod.
  "components/brain/onboarding.tsx",
  "components/brain/welcome-flow.tsx",
  "app/settings/tokens/tokens-client.tsx",
  // Comments / documentation of the hazard only.
  "app/settings/tokens/page.tsx",
  "app/welcome/page.tsx",
  "lib/brain/public-urls.ts",
  "lib/brain/public-urls.test.ts",
]);

const SKIP_DIRS = new Set(["node_modules", ".next", "e2e", "tests", ".turbo"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("public URL resolution", () => {
  it("resolves undefined when the deploy env is unset", () => {
    const prevMcp = process.env["BRAIN_MCP_PUBLIC_HOSTNAME"];
    const prevWeb = process.env["BRAIN_PUBLIC_HOSTNAME"];
    delete process.env["BRAIN_MCP_PUBLIC_HOSTNAME"];
    delete process.env["BRAIN_PUBLIC_HOSTNAME"];
    try {
      expect(resolvePublicMcpUrl()).toBeUndefined();
      expect(resolvePublicWebUrl()).toBeUndefined();
    } finally {
      if (prevMcp !== undefined) process.env["BRAIN_MCP_PUBLIC_HOSTNAME"] = prevMcp;
      if (prevWeb !== undefined) process.env["BRAIN_PUBLIC_HOSTNAME"] = prevWeb;
    }
  });

  it("builds https URLs from the deploy hostnames", () => {
    process.env["BRAIN_MCP_PUBLIC_HOSTNAME"] = "mcp.example.com";
    process.env["BRAIN_PUBLIC_HOSTNAME"] = "brain.example.com";
    expect(resolvePublicMcpUrl()).toBe("https://mcp.example.com/mcp");
    expect(resolvePublicWebUrl()).toBe("https://brain.example.com");
  });

  it("trims whitespace and treats a blank hostname as unset", () => {
    process.env["BRAIN_MCP_PUBLIC_HOSTNAME"] = "  mcp.example.com  ";
    expect(resolvePublicMcpUrl()).toBe("https://mcp.example.com/mcp");
    process.env["BRAIN_MCP_PUBLIC_HOSTNAME"] = "   ";
    expect(resolvePublicMcpUrl()).toBeUndefined();
  });
});

describe("#293 bug class — hardcoded MCP port", () => {
  it("no new surface hardcodes :3100", () => {
    const offenders = walk(WEB_ROOT)
      .filter((f) => readFileSync(f, "utf8").includes(":3100"))
      .map((f) => path.relative(WEB_ROOT, f))
      .filter((rel) => !ALLOWED_TO_MENTION_PORT.has(rel))
      .sort();

    expect(
      offenders,
      "These files hardcode the MCP port. Resolve the URL server-side via " +
        "lib/brain/public-urls.ts and pass it down, rather than adding them here.",
    ).toEqual([]);
  });
});
