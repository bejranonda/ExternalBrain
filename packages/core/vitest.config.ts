import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    globals: false,
    // Don't try to spin up a real DB / OpenAI in unit tests; tests that need
    // them belong under __tests__/integration and run in a separate suite.
  },
});
