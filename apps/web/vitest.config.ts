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
    // `@/auth` calls NextAuth(...) at module scope, and next-auth@5's
    // internals import `next/server` — unresolvable under vitest's plain
    // Node ESM resolution (no Next.js bundler in the loop). Every route
    // test that transitively imports `@/lib/brain/auth` (which imports
    // from `@/auth`) needs this short-circuited, so it's global setup
    // rather than a per-file incantation. See vitest.setup.ts.
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
