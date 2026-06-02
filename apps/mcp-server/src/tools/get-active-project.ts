import { z } from "zod";
import { db } from "@brain/db";
import { getUserProjects } from "@brain/core";
import type { ToolDef } from "./index.js";

/**
 * brain_get_active_project — returns the project a new session would land
 * in if `brain_start_session` were called RIGHT NOW with no projectId/
 * projectName arguments.
 *
 * Mirrors the resolution logic in start-session.ts:
 *   - project-scoped token → the token's project
 *   - unscoped token → user's first project
 *   - unscoped token + no projects → returns null (caller can create one)
 *
 * AI agents use this to decide whether to ask the user "should I create
 * a new project for this work?" before logging events to a stale default.
 */
const inputShape = z.object({}).strict();

export const getActiveProject: ToolDef = {
  name: "brain_get_active_project",
  description:
    "Return the project a session would default to right now (with no projectId/projectName passed). Returns null when the user has no projects yet. AI agents should call this before starting a session to verify the destination matches the user's intent.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  handler: async (raw, auth) => {
    inputShape.parse(raw ?? {});

    // Token is project-scoped: the token's project is the active one.
    if (auth.projectId !== null) {
      const projects = await getUserProjects(db, auth.userId);
      const found = projects.find((p) => p.id === auth.projectId);
      if (!found) return { project: null };
      return {
        project: {
          id: found.id,
          slug: found.slug,
          name: found.name,
          orgName: found.orgName,
          source: "token_scope" as const,
        },
      };
    }

    // Unscoped token: the user's first project is the default.
    const projects = await getUserProjects(db, auth.userId);
    if (projects.length === 0) {
      return { project: null };
    }
    const first = projects[0]!;
    return {
      project: {
        id: first.id,
        slug: first.slug,
        name: first.name,
        orgName: first.orgName,
        source: "first_project_fallback" as const,
      },
    };
  },
};
