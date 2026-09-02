import { defineConfig } from "vitest/config";

// Vitest config for @brain/mcp-server. 14 suites, most of them pure (helpers,
// the tools catalog, scope resolution, input validation) and runnable with no
// Postgres and no HTTP transport.
//
// Two suites DO talk to a live server, and they are the reason to read this
// file before adding a third: `auth-gate.test.ts` (read-only — probes that
// unauthenticated requests are refused, keeps its localhost default) and
// `session-lifecycle.test.ts` (WRITES — mints a real MCPToken, so it is
// opt-in via `BRAIN_MCP_E2E_URL` with no default and refuses a target that
// reports `environment: "production"`). See `KNOWN_ISSUES §0aw`/`§0ax`.
//
// This comment previously said coverage was "limited to http-helpers and the
// tools catalog", with the live-server suites "tracked as follow-up" — both
// had shipped long before, and the description sat wrong for months. Adding a
// suite means editing this paragraph.
export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    environment: "node",
    // No DB / network access from these tests. The assertions are instant,
    // but `tools-catalog.test.ts` does `await import("../tools/index.js")`
    // inside the test body — and that pulls @brain/core's env validation
    // plus @brain/db's generated Prisma client, a large module graph whose
    // transform+import cost lands against the *test* timeout rather than a
    // separate import budget. Idle that costs ~2s; under a parallel
    // `turbo run typecheck test build --force` (15 tasks competing for CPU)
    // it has twice blown a 5s limit and failed the whole gate — while the
    // same suite passes standalone in 2s. Raised to 30s: still far below
    // anything that would hide a genuine hang, high enough that CPU
    // contention alone can't turn a green suite red.
    testTimeout: 30_000,
  },
});
