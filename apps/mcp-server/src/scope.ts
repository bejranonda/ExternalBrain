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
 * Thrown when a READ names a project that does not exist.
 *
 * Reads must never create: a typo in `projectName` on `brain_ask_oracle`
 * would otherwise conjure an empty project and answer from it, which reads as
 * "you have no knowledge about that" — the most misleading possible reply.
 */
export const PROJECT_NOT_FOUND =
  "PROJECT_NOT_FOUND: no project with that name; reads never create projects";

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

/**
 * One project-resolution rule for every tool that takes a project.
 *
 * Three tools disagreed about what "the project" means, and each disagreement
 * was invisible because all three returned success (KNOWN_ISSUES §0ar):
 *
 *   - `brain_start_session` accepted `projectName` and reported
 *     `project.source` + a `hint` when it fell back.
 *   - `brain_teach_knowledge` accepted only `projectId`, reported nothing, and
 *     silently filed every rule under the default project — which is where
 *     *every* rule ever taught from the External Brain repo actually landed.
 *   - `brain_ask_oracle` accepted neither and read the token's default project
 *     only, so knowledge filed under a named project became invisible to it.
 *
 * The combination was pathological: following the documented "pass the project
 * on every call" discipline moved knowledge somewhere the Oracle could not
 * read. Giving the three one implementation is the fix; per GUIDELINES §4,
 * a rule with siblings gets one implementation rather than three copies.
 */
export type ProjectSource =
  | "token_scope"
  | "explicit_id"
  | "explicit_name"
  | "default_fallback";

export interface ResolvedProject {
  projectId: string;
  /** Present when resolution knew the name without an extra query. */
  projectName?: string;
  source: ProjectSource;
  /** Set only when the call fell back — the caller named no project. */
  hint?: string;
}

/**
 * Resolve the project for a call that may name one by id or by name.
 *
 * Precedence mirrors `brain_start_session` exactly: a project-scoped token
 * wins outright (the token IS the scope and a caller must not redirect it),
 * then an explicit id, then a name (created on demand), then the fallback.
 *
 * `deps` is injected so this stays unit-testable without a database.
 */
export async function resolveProjectForCall(
  auth: AuthContext,
  input: { projectId?: string | undefined; projectName?: string | undefined },
  deps: {
    userCanAccessProject: (userId: string, projectId: string) => Promise<boolean>;
    ensureNamedProject: (
      userId: string,
      name: string,
    ) => Promise<{ projectId: string }>;
    getUserProjects: (userId: string) => Promise<Array<{ id: string; name: string }>>;
    ensureDefaultProject: (userId: string) => Promise<{ projectId: string; name: string }>;
  },
  hintFor: (projectName: string) => string,
  /**
   * `allowCreate` distinguishes writes from reads. Only a write may bring a
   * project into existence by naming it; a read that does so turns a typo into
   * a plausible-looking empty answer.
   */
  opts: { allowCreate: boolean } = { allowCreate: false },
): Promise<ResolvedProject> {
  // A scoped token cannot be redirected. Reject a mismatch loudly rather than
  // narrowing silently — a caller that asked for B and got A has wrong data.
  // This must cover `projectName` too: rejecting a mismatched id while
  // ignoring a mismatched name would leave exactly the silent-wrong-project
  // hole this whole change exists to close.
  if (auth.projectId !== null) {
    if (input.projectId && input.projectId !== auth.projectId) {
      throw new Error(FORBIDDEN_PROJECT);
    }
    if (input.projectName) {
      const bound = await deps.getUserProjects(auth.userId);
      const named = bound.find(
        (p) => p.name.toLowerCase() === input.projectName!.trim().toLowerCase(),
      );
      if (!named || named.id !== auth.projectId) {
        throw new Error(FORBIDDEN_PROJECT);
      }
    }
    return { projectId: auth.projectId, source: "token_scope" };
  }

  if (input.projectId) {
    // Without this an authenticated user could file against any project id
    // they happened to know.
    const ok = await deps.userCanAccessProject(auth.userId, input.projectId);
    if (!ok) throw new Error(FORBIDDEN_PROJECT);
    return { projectId: input.projectId, source: "explicit_id" };
  }

  if (input.projectName) {
    if (!opts.allowCreate) {
      const readable = await deps.getUserProjects(auth.userId);
      const match = readable.find(
        (p) => p.name.toLowerCase() === input.projectName!.trim().toLowerCase(),
      );
      if (!match) throw new Error(PROJECT_NOT_FOUND);
      return { projectId: match.id, projectName: match.name, source: "explicit_name" };
    }
    // Match an EXISTING accessible project first. ensureNamedProject resolves
    // and creates only within the caller's personal org, whereas projectId and
    // the fallback span every org they belong to — so naming a shared-org
    // project went straight past it and forged an empty personal-org duplicate,
    // reported as `explicit_name` with no hint. A decision teach then wrote
    // visibility:"org" into the PERSONAL org, where no teammate could ever read
    // it, and the Oracle answered from the empty duplicate.
    const accessible = await deps.getUserProjects(auth.userId);
    const existing = accessible.find(
      (p) => p.name.toLowerCase() === input.projectName!.trim().toLowerCase(),
    );
    if (existing) {
      return { projectId: existing.id, projectName: existing.name, source: "explicit_name" };
    }
    const { projectId } = await deps.ensureNamedProject(auth.userId, input.projectName);
    return { projectId, projectName: input.projectName, source: "explicit_name" };
  }

  const projects = await deps.getUserProjects(auth.userId);
  if (projects.length > 0) {
    const first = projects[0]!;
    return {
      projectId: first.id,
      projectName: first.name,
      source: "default_fallback",
      hint: hintFor(first.name),
    };
  }
  const { projectId, name } = await deps.ensureDefaultProject(auth.userId);
  return { projectId, projectName: name, source: "default_fallback", hint: hintFor(name) };
}
