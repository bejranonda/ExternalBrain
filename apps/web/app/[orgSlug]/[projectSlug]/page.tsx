/**
 * /[orgSlug]/[projectSlug] — canonical per-project URL.
 *
 * This is the URL-routed entry point for the SPA shell. It:
 *   1. Authenticates the request (same rules as the bare `/` page).
 *   2. Resolves org + project from the URL segments via
 *      `getActiveProjectFromUrl`. Returns 404 if the user is not a member of
 *      the org or the project doesn't exist in that org.
 *   3. Sets the `bp_active_project` cookie server-side so subsequent API calls
 *      made from the client (which carry the cookie) all scope to this project.
 *   4. Renders `<BrainApp />` — the SPA shell that handles surface switching
 *      client-side (surface is NOT encoded in the URL; that's Phase 3c).
 */
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth, anySignInConfigured, devAuthAllowed } from "@/auth";
import { BrainApp } from "@/components/brain/app";
import { getActiveProjectFromUrl } from "@/lib/brain/active-project";
import { getCurrentUserId } from "@/lib/brain/auth";
import { resolvePublicMcpUrl, resolvePublicWebUrl } from "@/lib/brain/public-urls";
import { BrainError } from "@brain/core";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ orgSlug: string; projectSlug: string }>;
}

export default async function OrgProjectPage({ params }: Props) {
  // Resolve URL params first (Next.js 15 params is a Promise).
  const { orgSlug, projectSlug } = await params;

  // ── Auth gate (mirrors apps/web/app/page.tsx) ──────────────────────────
  if (anySignInConfigured()) {
    const session = await auth();
    if (!(session as { userId?: string } | null)?.userId) {
      redirect(`/signin?callbackUrl=/${encodeURIComponent(orgSlug)}/${encodeURIComponent(projectSlug)}`);
    }
  } else if (!devAuthAllowed()) {
    redirect("/signin?error=auth_not_configured");
  }

  // ── Resolve user ────────────────────────────────────────────────────────
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch {
    redirect("/signin");
  }

  // ── Resolve org + project from URL slugs ────────────────────────────────

  let projectId: string;
  try {
    const resolved = await getActiveProjectFromUrl(orgSlug, projectSlug, userId);
    projectId = resolved.projectId;
  } catch (err) {
    if (err instanceof BrainError && err.status === 404) {
      notFound();
    }
    // Unexpected error — surface as 404 to avoid leaking internals.
    notFound();
  }

  // ── Sync cookie so API routes resolve the same project ──────────────────
  // Setting the cookie here keeps subsequent fetch() calls from the client
  // scoped to this project without an extra round-trip. Next 16 forbids
  // cookie writes from a Server Component (only Server Actions / Route
  // Handlers are allowed), so the write is best-effort: if Next refuses,
  // we log and continue. The URL is the source of truth — API routes
  // already resolve project from the URL when the cookie is absent or
  // stale (see apps/web/lib/brain/active-project.ts::getActiveProject's
  // "first project" fallback). The cookie is purely a perf shortcut.
  try {
    const cookieStore = await cookies();
    cookieStore.set("bp_active_project", projectId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  } catch (err) {
    // Next 16: "Cookies can only be modified in a Server Action or Route
    // Handler." That's expected — the SPA's URL is the source of truth, so
    // the cookie staleness is recoverable. Log once for ops visibility.
    try {
      const { getLogger } = await import("@brain/core");
      getLogger("web").child({ subsystem: "page-org-project" }).warn(
        { err, op: "cookies.set", projectId },
        "skipping bp_active_project cookie sync (Next 16 RSC restriction)",
      );
    } catch {
      /* ignore logger import failure */
    }
  }

  // ── Render the SPA shell ─────────────────────────────────────────────────
  // mcpUrl is threaded down to the onboarding modal, whose mcp.json snippet
  // otherwise falls back to the local dev endpoint and asks the operator to
  // hand-edit it. See lib/brain/public-urls.ts.
  return <BrainApp mcpUrl={resolvePublicMcpUrl()} webUrl={resolvePublicWebUrl()} />;
}
