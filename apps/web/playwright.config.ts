import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// E2E_BASE_URL lets CI or a dev override the target.
// Defaults to local dev server for the legacy `./e2e` suite; the newer
// `./tests/e2e` suite (roadmap-3) is written against the deployed dev brain
// and is opt-in via E2E_AUTH_COOKIE + E2E_BASE_URL=https://brain-dev.example.com.
const baseURL = process.env["E2E_BASE_URL"] ?? "http://localhost:3000";

// Authenticated-suite gate. When E2E_ADMIN_PASSWORD is present, an auth
// "setup" project signs in once (e2e/auth.setup.ts) and persists the
// session to AUTH_FILE; the browser projects then depend on it and load
// that storageState, so specs reach the app shell instead of bouncing to
// /signin. When the password is absent, the config behaves exactly as
// before (empty cookie jar + bp_onboarded localStorage) — keeping the
// public specs (healthz, security, …) runnable without credentials.
const AUTH_FILE = path.join(__dirname, "e2e", ".auth", "admin.json");
const hasAuth = Boolean(process.env["E2E_ADMIN_PASSWORD"]);

export default defineConfig({
  // Two suites coexist:
  //   - e2e/         legacy specs targeting a locally-running stack
  //   - tests/e2e/   roadmap-3 specs targeting a deployed brain w/ auth cookie
  testDir: ".",
  testMatch: ["e2e/**/*.spec.ts", "tests/e2e/**/*.spec.ts"],
  // Run tests serially — avoids flakiness from shared DB state on a single-host stack.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    headless: true,
    ignoreHTTPSErrors: true,
    // Generous timeout: container startup can be slow.
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Suppress the first-run Onboarding modal globally. It auto-opens when
    // knowledgeCount === 0 (which can be true transiently during the initial
    // counts fetch OR permanently for the dev user in a fresh-seeded DB), and
    // its scrim intercepts every pointer event in the shell. Specs that are
    // explicitly about onboarding behaviour override this in their own
    // beforeEach (e.g. onboarding.spec.ts).
    storageState: {
      cookies: [],
      origins: [
        {
          origin: baseURL,
          localStorage: [{ name: "bp_onboarded", value: "true" }],
        },
      ],
    },
  },
  projects: [
    // Auth setup runs first (only when credentials are provided) and writes
    // the shared session to AUTH_FILE for the browser projects to consume.
    ...(hasAuth
      ? [{ name: "setup", testMatch: /auth\.setup\.ts/ }]
      : []),
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Authenticated session (cookies + bp_onboarded) when available;
        // otherwise the top-level empty-cookie storageState stands.
        ...(hasAuth ? { storageState: AUTH_FILE } : {}),
      },
      ...(hasAuth ? { dependencies: ["setup"] } : {}),
    },
    {
      // Pixel 5 is chromium-based — keeps mobile coverage without
      // pulling webkit into CI (the runner only installs chromium).
      // Subagent C originally used iPhone 13 here but that requires
      // webkit which broke CI.
      name: "mobile",
      use: {
        ...devices["Pixel 5"],
        ...(hasAuth ? { storageState: AUTH_FILE } : {}),
      },
      ...(hasAuth ? { dependencies: ["setup"] } : {}),
    },
  ],
  // Don't start a dev server automatically — the caller is expected to have the
  // stack running before invoking `pnpm e2e` (see docs/GUIDELINES.md §4).
});
