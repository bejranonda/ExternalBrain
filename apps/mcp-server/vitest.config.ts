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
    // No DB / network access from these tests — keep them fast.
    testTimeout: 5_000,
  },
});
