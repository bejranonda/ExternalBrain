import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * First vitest config for this package (2026-07-14) — apps/web previously had
 * zero unit-test coverage, only Playwright e2e. Scoped narrowly to API route
 * handlers, which are plain async functions over Web-standard Request/Response
 * (no React rendering involved), so a bare Node environment suffices —
 * mirrors packages/core/vitest.config.ts. Do NOT expand `include` to cover
 * React components without also adding a DOM environment + testing-library;
 * that's a different, bigger lift this config deliberately doesn't take on.
 */
export default defineConfig({
  test: {
    include: ["app/api/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
