import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tools } from "../tools/index.js";

/**
 * brain_whoami — the diagnostic that makes KNOWN_ISSUES §0t self-serviceable.
 *
 * The incident: six rules taught over MCP, every call returning a real id,
 * all of it landing on the wrong instance. The only conclusive diagnosis was
 * a SELECT against Postgres — unavailable to a self-hoster on a managed host
 * and to every non-admin, i.e. to exactly the people it fails for.
 *
 * These tests pin the two properties that make it useful and safe:
 *   1. It is registered and takes no argument (a diagnostic you must
 *      configure is one more thing that can be configured wrongly).
 *   2. It never returns secret material. The token is identified by name and
 *      id; echoing the stored hash back over the wire would hand a caller the
 *      exact lookup key the database matches on.
 */

/**
 * Source with comments stripped.
 *
 * The first version of this test searched the raw file and failed on its own
 * doc comment, which explains WHY the hash is excluded — the same defect
 * CodeRabbit found in page-home-link.test.ts, where `// href="/"` counted as
 * a rendered link. A test that reads prose is asserting something other than
 * the property it is named after.
 */
const SRC = readFileSync(join(__dirname, "..", "tools", "whoami.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("brain_whoami", () => {
  const tool = tools.find((t) => t.name === "brain_whoami");

  it("is registered in the tool catalogue", () => {
    expect(tool).toBeDefined();
  });

  it("takes no input — nothing to misconfigure", () => {
    expect(tool!.inputSchema).toMatchObject({
      type: "object",
      properties: {},
      required: [],
    });
  });

  it("tells the caller when to reach for it", () => {
    // The description is the only thing an agent sees before choosing a tool.
    // If it does not name the symptom, the tool is unreachable in practice.
    const d = tool!.description.toLowerCase();
    expect(d).toContain("instance");
    expect(d).toMatch(/session start|repoint/);
  });

  it("never selects or returns secret material", () => {
    // Guards the whole file, not one return path: a later field addition that
    // pulls tokenHash would fail here even if it is never asserted elsewhere.
    expect(SRC).not.toMatch(/tokenHash/);
    expect(SRC).not.toMatch(/passwordHash/);
    expect(SRC).not.toMatch(/\bsecret\b(?!-)/i);
  });

  it("reads the instance identity from the SERVER's env, not from input", () => {
    // The point of the tool is to report a fact the client cannot know and
    // cannot get wrong. Deriving it from anything the caller sent would make
    // it echo the caller's own assumption back at them.
    expect(SRC).toMatch(/process\.env\.BRAIN_MCP_PUBLIC_HOSTNAME/);
    expect(SRC).not.toMatch(/raw\.(host|url|instance)/);
  });

  it("FLAGS the web-hostname fallback instead of passing it off as the answer", () => {
    // Measured on the reference deployment 2026-09-02: BRAIN_MCP_PUBLIC_HOSTNAME
    // was never passed to the mcp-server container, so this fell through to the
    // WEB hostname and reported `brain.autobahn.bot` for an endpoint served at
    // `mcp.brain.autobahn.bot`. The tool exists to answer "which Brain am I
    // talking to?" — a silent guess there is worse than an admitted gap,
    // because it is indistinguishable from a real answer (KNOWN_ISSUES §0ax).
    expect(SRC).toMatch(/mcpPublicHostnameIsFallback/);
    expect(SRC).toMatch(/mcpPublicHostnameNote/);
  });

  it("reports the tier from BRAIN_DEPLOY_ENV, never the stale ENVIRONMENT label", () => {
    // The reference prod host carries `ENVIRONMENT=dev` as a leftover, so
    // reading it would report a production Brain as dev — the exact failure
    // apps/web/app/api/healthz/route.ts was given a separate variable to
    // avoid, and it had been reproduced here in the tool meant to catch it.
    expect(SRC).toMatch(/process\.env\.BRAIN_DEPLOY_ENV/);
    expect(SRC).not.toMatch(/process\.env\.ENVIRONMENT/);
  });

  it("is deliberately not capability-gated", () => {
    // A restricted token must still be able to ask what it is — that is
    // exactly the situation where the caller is most confused.
    expect(SRC).not.toMatch(/requireCapability/);
  });
});
