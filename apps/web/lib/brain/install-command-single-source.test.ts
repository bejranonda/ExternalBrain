import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { renderBrainBootstrap, renderBrainSkill } from "./skill-template";

/**
 * One value, rendered by several surfaces, corrected in some of them.
 *
 * That sentence describes most of the shipped defects in KNOWN_ISSUES: the
 * hardcoded-MCP-port install snippet fixed on /welcome but not on
 * /settings/tokens or the onboarding modal; five client generators emitting a
 * config shape no client accepts, each with its own passing test. The install
 * command is the highest-traffic instance of that value — it now appears on
 * /start, in the agent bootstrap document, in the claim response, in the token
 * wizard, and on /welcome.
 *
 * So this test does not check that the surfaces agree today. It checks that
 * only one place is *able* to construct the command, which is the property
 * that keeps them agreeing tomorrow.
 */

const REPO = join(__dirname, "..", "..", "..", "..");

/**
 * The literal shapes of a runnable installer invocation. Anything containing
 * these is building an install command rather than deriving one.
 */
const INSTALLER_INVOCATION = [
  "/api/onboard.sh | bash",
  "/api/onboard.ps1 -UseBasicParsing | iex",
];

/**
 * Files allowed to contain them, and why:
 *  - install-snippets.ts authors the command; it is the single source.
 *  - installer-templates.ts authors the installer *script itself*, whose own
 *    header comments document how it is invoked. That is the script's usage
 *    text, not a command rendered for a user's token.
 *  - tutorial-content.generated.ts is baked from docs/tutorials/00-quick-start.md
 *    (scripts/generate-tutorial-content.mjs), which shows the command as
 *    documentation prose inside a fenced code block — the same reason
 *    installer-templates.ts is exempt. Generated, not hand-written; the
 *    actual source of the literal text is the tutorial markdown, which this
 *    sweep doesn't scan (docs/ isn't under apps/web).
 */
const ALLOWED = new Set([
  "packages/core/src/install-snippets.ts",
  "apps/web/lib/brain/installer-templates.ts",
  "apps/web/lib/brain/tutorial-content.generated.ts",
]);

const SEARCH_ROOTS = [
  join(REPO, "apps", "web", "app"),
  join(REPO, "apps", "web", "components"),
  join(REPO, "apps", "web", "lib"),
  join(REPO, "packages", "core", "src"),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // .next holds generated route types that mention every path in the app.
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("install command has exactly one source", () => {
  const sources = SEARCH_ROOTS.flatMap((r) => walk(r)).map((f) => ({
    rel: relative(REPO, f),
    src: readFileSync(f, "utf8"),
  }));

  it("sweeps a non-trivial number of files (guard against a vacuous pass)", () => {
    // A walk that silently matched nothing would satisfy every assertion
    // below while checking zero files — the failure mode KNOWN_ISSUES §0r
    // records for the e2e workflows.
    expect(sources.length).toBeGreaterThan(50);
  });

  it("still finds the invocation somewhere (guard against a stale pattern)", () => {
    // If install-snippets.ts is refactored and these literals stop appearing
    // anywhere, the test above would pass forever while guarding nothing.
    const anywhere = sources.filter(({ src }) =>
      INSTALLER_INVOCATION.some((p) => src.includes(p)),
    );
    expect(anywhere.length).toBeGreaterThan(0);
  });

  it("is constructed only in the allow-listed files", () => {
    const offenders = sources
      .filter(({ src }) => INSTALLER_INVOCATION.some((p) => src.includes(p)))
      .map(({ rel }) => rel)
      .filter((rel) => !ALLOWED.has(rel));

    expect(
      offenders,
      "These files hand-build an installer invocation instead of deriving it " +
        "from @brain/core/install-snippets. Use clientById(id).snippet(...) — " +
        "or bootstrapInstallCommand() in the agentic path.",
    ).toEqual([]);
  });
});

describe("rendered agent-facing documents carry no unsubstituted placeholders", () => {
  const urls = { mcpUrl: "https://mcp.example.com/mcp", webUrl: "https://brain.example.com" };

  for (const [name, render] of [
    ["SKILL.md", renderBrainSkill],
    ["bootstrap agent.md", renderBrainBootstrap],
  ] as const) {
    it(`${name} substitutes every {{PLACEHOLDER}}`, () => {
      const out = render(urls);
      // A surviving {{WEB_URL}} ships an agent a literal, unfetchable URL —
      // and the agent will try it.
      expect(out).not.toMatch(/\{\{[A-Z_]+\}\}/);
      expect(out).toContain("https://brain.example.com");
    });
  }
});

describe("the bootstrap document tells the agent to stop", () => {
  const doc = renderBrainBootstrap({
    mcpUrl: "https://mcp.example.com/mcp",
    webUrl: "https://brain.example.com",
  });

  it("names the claim endpoint and nothing broader", () => {
    expect(doc).toContain("/api/onboard/claim");
  });

  it("forbids continuing in the same session", () => {
    // KNOWN_ISSUES: Claude Code binds its MCP configuration at session start.
    // An agent that has just rewritten that config and keeps going will either
    // fail or silently write to the previously-bound Brain while reporting
    // success — which has really happened, costing six knowledge writes.
    expect(doc).toMatch(/STOP/);
    expect(doc.toLowerCase()).toContain("restart");
  });

  it("forbids inventing an email address", () => {
    expect(doc).toMatch(/Do NOT invent one/i);
  });

  it("forbids retrying under a different email after email_taken", () => {
    expect(doc).toMatch(/Do NOT retry with a different email/i);
  });
});
