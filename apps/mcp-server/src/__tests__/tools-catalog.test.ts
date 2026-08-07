import { describe, expect, it } from "vitest";

// The 13 brain_* tools the MCP server is contracted to expose to clients.
// If any tool is renamed, removed, or a new one is added, this list must
// be updated in lock-step — the test then doubles as a guard against
// accidental surface-area drift (the kind of change that should break
// every connected Claude Code / Cursor / Windsurf installation in
// recognisable ways, not silently).
const EXPECTED_TOOL_NAMES = [
  "brain_start_session",
  "brain_create_project",
  "brain_list_projects",
  "brain_get_active_project",
  "brain_retrieve_knowledge",
  "brain_report_session_outcome",
  "brain_teach_knowledge",
  "brain_get_user_style",
  "brain_ask_oracle",
  "brain_log_event",
  "brain_find_skill",
  "brain_session_search",
  "brain_whoami",
] as const;

describe("tools catalog", () => {
  it("exposes the 13 brain_* tools as a stable contract", async () => {
    // Importing tools/index.js pulls in @brain/core (env validation) and
    // @brain/db (Prisma client). Both are happy with a dummy DATABASE_URL
    // here — they don't open a connection at import time, only on first
    // use. Setting it before import keeps env.ts's zod validation green.
    process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

    const { tools } = await import("../tools/index.js");
    const names = tools.map((t) => t.name);

    expect(names).toHaveLength(EXPECTED_TOOL_NAMES.length);
    expect(new Set(names)).toEqual(new Set(EXPECTED_TOOL_NAMES));
  });

  it("every tool has name + description + inputSchema", async () => {
    process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
    const { tools } = await import("../tools/index.js");

    for (const tool of tools) {
      expect(tool.name, "missing name").toBeTruthy();
      expect(tool.name).toMatch(/^brain_[a-z_]+$/);
      expect(tool.description, `${tool.name} missing description`).toBeTruthy();
      expect(tool.inputSchema, `${tool.name} missing inputSchema`).toBeDefined();
      expect(typeof tool.handler, `${tool.name} handler not a function`).toBe(
        "function",
      );
    }
  });

  it("has no duplicate tool names", async () => {
    process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
    const { tools } = await import("../tools/index.js");
    const names = tools.map((t) => t.name);
    expect(names).toHaveLength(new Set(names).size);
  });
});
