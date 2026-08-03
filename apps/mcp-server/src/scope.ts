/**
 * Token project-scope resolution for READ paths.
 *
 * `MCPToken.projectId` binds a token to one project. The write side has
 * enforced that since Phase 3c (`brain_start_session`, `brain_teach_knowledge`,
 * `brain_create_project`, `brain_list_projects`, `brain_get_active_project`),
 * but every read tool ignored it — `brain_retrieve_knowledge` took the project
 * from *client input* and never compared it, and the Oracle, skill search,
 * session search and all four `brain://` resources never consulted it at all.
 *
 * That was never a cross-tenant hole — `kra.ts` and `oracle.ts` hard-pin
 * `"ownerUserId" = $2` outside the visibility filter — but it made the scope a
 * promise the product only half kept: a token handed to a contractor and
 * labelled "scoped to project X" could read every project its owner had.
 * Since the reason to mint a scoped token is almost always to bound what
 * something else can *see*, the read half is the half that mattered.
 * (Pre-release audit P2-H2, KNOWN_ISSUES §0q.)
 *
 * This module exists so the four read sites cannot drift apart the way they
 * did from the write sites. Per GUIDELINES §4: when a rule has siblings, give
 * them one implementation rather than four copies.
 */
import type { AuthContext } from "./auth.js";

/**
 * Thrown when a scoped token asks for a project it is not bound to. Mirrors
 * the write-side error string so clients see one vocabulary for one rule.
 */
export const FORBIDDEN_PROJECT =
  "FORBIDDEN_PROJECT: this token is scoped to a different project";

/**
 * Resolve which project a read should run against.
 *
 * - Scoped token + no request      → the token's project.
 * - Scoped token + matching request → the token's project.
 * - Scoped token + foreign request  → throws. Failing loudly beats silently
 *   narrowing, because a caller that asked for project B and got project A's
 *   answers has been given wrong data, not less data.
 * - Unscoped token                  → whatever the caller asked for (may be
 *   undefined; downstream applies the usual first-project fallback).
 *
 * Note the asymmetry with the write path: writes *default* to the token's
 * project, and so does this — but reads additionally have to reject a
 * mismatch rather than quietly substitute, since a read's whole value is that
 * its scope matches what the caller believes it asked for.
 */
export function resolveReadProjectId(
  auth: AuthContext,
  requested?: string,
): string | undefined {
  if (auth.projectId === null) return requested;
  if (requested && requested !== auth.projectId) {
    throw new Error(FORBIDDEN_PROJECT);
  }
  return auth.projectId;
}

/**
 * `true` when the token is bound to a single project, so a read that cannot
 * express a project filter in SQL must still confine itself some other way.
 * Used by the `brain://` resources, which have no project dimension of their
 * own and therefore narrow by joining through one.
 */
export function isProjectScoped(auth: AuthContext): boolean {
  return auth.projectId !== null;
}
