import { redirect } from "next/navigation";
import { auth, anySignInConfigured, devAuthAllowed } from "@/auth";

export const dynamic = "force-dynamic";

/**
 * Server-side auth guard for the whole /settings/* surface. Without this,
 * every settings page is a bare client component: an anonymous visitor gets
 * a 200 and a fully-rendered form whose data fetches all 401 silently,
 * rendering the raw string "HTTP 401" where content should be (found via
 * first-time-user review, 2026-07-10 — the welcome page's own "Get a
 * token →" link walks straight into this).
 *
 * Mirrors app/page.tsx's three-way gate, NOT admin/layout.tsx's — an
 * independent review (2026-07-10) caught that copying admin's bare
 * `anySignInConfigured()` check locks dev-shim (ALLOW_DEV_AUTH=true)
 * deployments out of /settings/tokens entirely (their only path to create
 * an MCP token) even though dev-shim resolves a real user fine downstream.
 * admin's stricter gate is intentional there (no per-user surface exists in
 * single-user dev-shim mode); settings has no such justification.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (anySignInConfigured()) {
    const session = await auth();
    const userId = (session as { userId?: string } | null)?.userId;
    // Known imprecision: layouts don't see the requested sub-path, so this
    // always bounces back to /settings/tokens rather than the specific page
    // (e.g. /settings/org) the visitor tried to reach — one extra click,
    // not a broken state.
    if (!userId) redirect("/signin?callbackUrl=/settings/tokens");
  } else if (!devAuthAllowed()) {
    redirect("/signin?error=auth_not_configured");
  }
  // else: dev-shim only — pass through, matching app/page.tsx.

  return <>{children}</>;
}
