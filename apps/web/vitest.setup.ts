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
