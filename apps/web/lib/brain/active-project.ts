/**
 * Resolve the "active project" for the current request.
 *
 * Two entry points:
 *
 * `getActiveProject(userId)` — cookie + fallback path used by API routes.
 *   Priority:
 *     1. The `bp_active_project` HTTP-only cookie (set by POST /api/projects/:id/activate
 *        or by the URL-routed page server component).
 *     2. The first project across the user's orgs (alphabetical by org slug then project
 *        slug).
 *     3. A lazily-created "Default" project in the user's personal org
 *        (ensureDefaultProject).
 *
 * `getActiveProjectFromUrl(orgSlug, projectSlug, userId)` — URL-path path used by
 *   the `[orgSlug]/[projectSlug]` page. Validates that the user is a member of the org
 *   and that the project exists within it. Throws `BrainError NOT_FOUND_PROJECT` on any
 *   mismatch so the page can call `notFound()`.
 *
 * Callers should NOT call these on every request — they hit the DB. Cache the result
 * in the React Server Component layer for the duration of a single render.
 */
import { cookies } from "next/headers";
import { db } from "@brain/db";
import { getUserProjects, ensureDefaultProject, BrainError } from "@brain/core";
import type { UserProject } from "@brain/core";

export interface ActiveProject {
  orgId: string;
  orgSlug: string;
  orgName: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
}

export async function getActiveProject(userId: string): Promise<ActiveProject> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get("bp_active_project")?.value;

  let projects = await getUserProjects(db, userId);

  if (projects.length === 0) {
    // No project exists yet — create the default.
    await ensureDefaultProject(db, userId);
    projects = await getUserProjects(db, userId);
  }

  // Re-check after potential creation.
  if (projects.length === 0) {
    throw new Error("Failed to resolve active project: no project found after ensureDefaultProject");
  }

  // Prefer the cookie value if it points to a valid project the user owns.
  const active: UserProject =
    (fromCookie ? projects.find((p) => p.id === fromCookie) : undefined) ??
    projects[0]!;

  return {
    orgId: active.organizationId,
    orgSlug: active.orgSlug,
    orgName: active.orgName,
    projectId: active.id,
    projectSlug: active.slug,
    projectName: active.name,
  };
}

/**
 * Resolve a project from URL path segments.
 *
 * Verifies:
 *   1. The org identified by `orgSlug` exists and the user is a member.
 *   2. A project with `projectSlug` exists within that org.
 *
 * Returns the resolved `ActiveProject` on success. Throws `BrainError` with
 * `code: "NOT_FOUND_PROJECT"` (status 404) when either check fails — the page
 * should call `notFound()` in that case.
 */
export async function getActiveProjectFromUrl(
  orgSlug: string,
  projectSlug: string,
  userId: string,
): Promise<ActiveProject> {
  // getUserProjects already includes org-membership checks implicitly
  // (it only returns projects in orgs the user belongs to).
  const projects = await getUserProjects(db, userId);

  const match = projects.find(
    (p) => p.orgSlug === orgSlug && p.slug === projectSlug,
  );

  if (!match) {
    throw new BrainError({
      code: "NOT_FOUND_PROJECT",
      category: "validation",
      message: `Project "${orgSlug}/${projectSlug}" not found or user is not a member of the org.`,
      remediation:
        "Check the org and project slugs in the URL. The user must be a member of the org.",
      retryable: false,
      status: 404,
    });
  }

  return {
    orgId: match.organizationId,
    orgSlug: match.orgSlug,
    orgName: match.orgName,
    projectId: match.id,
    projectSlug: match.slug,
    projectName: match.name,
  };
}
