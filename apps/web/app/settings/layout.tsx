import { redirect } from "next/navigation";
import { auth, anySignInConfigured } from "@/auth";

export const dynamic = "force-dynamic";

/**
 * Server-side auth guard for the whole /settings/* surface. Without this,
 * every settings page is a bare client component: an anonymous visitor gets
 * a 200 and a fully-rendered form whose data fetches all 401 silently,
 * rendering the raw string "HTTP 401" where content should be (found via
 * first-time-user review, 2026-07-10 — the welcome page's own "Get a
 * token →" link walks straight into this). Mirrors admin/layout.tsx minus
 * the admin-role check: any signed-in user may see their own settings.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!anySignInConfigured()) {
    redirect("/signin?error=auth_not_configured");
  }
  const session = await auth();
  const userId = (session as { userId?: string } | null)?.userId;
  // Known imprecision: layouts don't see the requested sub-path, so this
  // always bounces back to /settings/tokens rather than the specific page
  // (e.g. /settings/org) the visitor tried to reach — one extra click, not
  // a broken state. A middleware.ts reading the real pathname would fix it
  // exactly; not worth introducing for this narrow case.
  if (!userId) redirect("/signin?callbackUrl=/settings/tokens");

  return <>{children}</>;
}
