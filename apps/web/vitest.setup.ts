import { vi } from "vitest";

/**
 * Global vitest setup for apps/web route-handler tests.
 *
 * `@/auth` (apps/web/auth.ts) calls `NextAuth(config)` at module scope.
 * Under vitest's plain Node ESM resolution (no Next.js bundler in the loop),
 * next-auth@5's internals (`next-auth/lib/env.js`) import `next/server`,
 * which fails to resolve outside Next's own runtime — see the CI failure
 * this file fixes: "Cannot find module '.../next-auth/.../node_modules/
 * next/server'".
 *
 * Any route test that transitively imports `@/lib/brain/auth` (which
 * imports `auth`, `anySignInConfigured`, `devAuthAllowed` from `@/auth`)
 * therefore fails to even load — 0 tests attempted, not a test failure.
 *
 * Fix: short-circuit the `@/auth` module itself for every test in this
 * package, one layer below `@/lib/brain/auth` (which stays real and
 * testable — route tests spy on its exports, e.g.
 * `vi.spyOn(authLib, "getCurrentUserId")`). Mock the full export surface
 * of apps/web/auth.ts so future route tests that pull in any of it work
 * without needing a per-file incantation.
 */
vi.mock("@/auth", () => ({
  authConfigured: vi.fn(() => false),
  anySignInConfigured: vi.fn(() => true),
  adminCredentialsConfigured: vi.fn(() => false),
  devAuthAllowed: vi.fn(() => false),
  authEnabled: vi.fn(() => true),
  registrationRequiresVoucher: vi.fn(() => true),
  config: {},
  handlers: { GET: vi.fn(), POST: vi.fn() },
  signIn: vi.fn(),
  signOut: vi.fn(),
  auth: vi.fn(async () => null),
}));

/**
 * `next/headers`'s `cookies()` relies on Next's request-scoped
 * AsyncLocalStorage context, which doesn't exist when a route handler is
 * invoked directly as a plain function from a vitest test (as every
 * app/api/**\/*.test.ts file here does) — it throws "cookies was called
 * outside a request scope". `getActiveProject` (apps/web/lib/brain/active-project.ts)
 * calls it unconditionally to check for a `bp_active_project` cookie before
 * falling back to the caller's first/default project — exactly the
 * no-cookie-set path every existing route test already exercises (none of
 * them set that cookie). Mock only `cookies`; every other `next/headers`
 * export (e.g. `headers()`) stays real via `importOriginal`, for any future
 * route test that needs it.
 */
vi.mock("next/headers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/headers")>();
  return {
    ...actual,
    cookies: vi.fn(async () => ({
      get: vi.fn(() => undefined),
    })),
  };
});
