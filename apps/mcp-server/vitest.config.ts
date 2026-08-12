import { defineConfig } from "vitest/config";

// Initial vitest scaffold for @brain/mcp-server (#42). Today's coverage is
// limited to the pure helpers in `http-helpers.ts` and the static `tools`
// catalog — both of which can be tested without standing up Postgres or the
// MCP HTTP transport. Session-lifecycle and auth-roundtrip tests (the
// regression nets for #4 and #15) need an in-process Streamable-HTTP server
// + mocked `@brain/db`; tracked as follow-up in #42.
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
