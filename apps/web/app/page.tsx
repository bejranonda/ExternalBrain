/**
 * Bare `/` route — public landing for anonymous visitors, router for everyone
 * else.
 *
 * For a signed-in user this resolves the active project (cookie → first
 * project → create default) and 307s to `/[orgSlug]/[projectSlug]`, which is
 * the canonical URL for the SPA shell.
 *
 * For an anonymous visitor it used to `redirect("/signin")`, which meant the
 * platform had no public face at all: a stranger's first impression of a
 * deployment was a login form. It now renders `<Landing />`. Only that one
 * branch changed — signed-in users never see the landing, so it costs them
 * nothing, and the unconfigured-deployment branch below still fails loudly
 * rather than showing a marketing page for an instance nobody can sign in to.
 *
 * `anySignInConfigured()` covers BOTH Credentials mode (ADMIN_USERNAME +
 * ADMIN_PASSWORD_HASH) and OAuth mode (AUTH_GITHUB_*). An earlier version
 * checked GitHub-only via `authConfigured()`, so a Credentials-only
 * deployment took the Unconfigured branch and bounced every anonymous
 * caller to `/signin?error=auth_not_configured` even though /signin
 * itself rendered a usable form.
 */
import { redirect } from "next/navigation";
import { auth, anySignInConfigured, devAuthAllowed } from "@/auth";
import { getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";
import { Landing } from "@/components/brain/landing";
import { LocalePicker } from "@/components/brain/locale-picker";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (anySignInConfigured()) {
    const session = await auth();
    if (!(session as { userId?: string } | null)?.userId) {
      return (
        <>
          <LocalePicker />
          <Landing />
        </>
      );
    }
  } else if (!devAuthAllowed()) {
    // Unconfigured deployment — refuse the request loudly instead of leaking
    // access. Previously this path silently fell through to the dev shim.
    redirect("/signin?error=auth_not_configured");
  }

  // Resolve the active project and redirect to its canonical URL.
  // The try/catch wraps BOTH getCurrentUserId AND getActiveProject because
  // a session cookie can outlive the user row it points at — for example,
  // an operator wiped + reseeded the dev DB, the seed produced a different
  // cuid for the User, but the browser still holds the old session. The
  // result is `prisma.user.findUniqueOrThrow` deep inside ensurePersonalOrg
  // throwing P2025. Bouncing to /signin clears the stale session and lets
  // the user re-auth cleanly. Logged at warn-level so the same problem
  // recurring in prod is visible without paging.
  //
  // Note: `redirect()` itself throws a `NEXT_REDIRECT` error that the
  // framework intercepts to issue the 307. We must NOT catch that — only
  // the `getActiveProject` failures. The flow keeps `redirect()` outside
  // the try block so the framework's control-flow exception propagates.
  let orgSlug: string | undefined;
  let projectSlug: string | undefined;
  try {
    const userId = await getCurrentUserId();
    const active = await getActiveProject(userId);
    orgSlug = active.orgSlug;
    projectSlug = active.projectSlug;
  } catch (err) {
    // Best-effort logging — don't let logger import failure block recovery.
    try {
      const { getLogger } = await import("@brain/core");
      getLogger("web").child({ subsystem: "page-/" }).warn(
        { err, op: "page.home" },
        "stale session or missing user row — bouncing to /signin",
      );
    } catch {
      /* ignore logger import failures */
    }
  }
  if (orgSlug && projectSlug) {
    redirect(`/${orgSlug}/${projectSlug}`);
  }
  redirect("/signin");
}
