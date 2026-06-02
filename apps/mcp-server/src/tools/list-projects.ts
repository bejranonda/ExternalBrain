import { z } from "zod";
import { db } from "@brain/db";
import { getUserProjects } from "@brain/core";
import type { ToolDef } from "./index.js";

/**
 * brain_list_projects — read-only enumeration of projects the user can see.
 *
 * Returns one row per project across every org the user is a member of.
 * AI agents call this to decide whether the project they need already
 * exists (avoiding duplicate-create) or to surface a "switch project?"
 * prompt to the user.
 *
 * For project-scoped tokens, only the token's project is returned — the
 * scope rule (the token IS the boundary) applies symmetrically to reads.
 */
const inputShape = z.object({}).strict();

export const listProjects: ToolDef = {
  name: "brain_list_projects",
  description:
    "List every Brain project the authenticated user can see. Returns project id, name, slug, org, framework, and language. Useful to check whether a project already exists before calling brain_create_project. Project-scoped tokens see only their bound project.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
  },
  handler: async (raw, auth) => {
    inputShape.parse(raw ?? {});
    const projects = await getUserProjects(db, auth.userId);

    // Project-scoped tokens: narrow the result to just the token's project.
    // Same semantics as the rest of the MCP — the token's scope wins.
    const visible =
      auth.projectId === null
        ? projects
        : projects.filter((p) => p.id === auth.projectId);

    return {
      projects: visible.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        orgId: p.organizationId,
        orgSlug: p.orgSlug,
        orgName: p.orgName,
        framework: p.framework,
        language: p.language,
        isOwn: p.isOwn,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  },
};
