import { z } from "zod";
import { db } from "@brain/db";
import { ensureNamedProject, BrainError } from "@brain/core";
import type { ToolDef } from "./index.js";

/**
 * brain_create_project — explicit project-creation entry point for AI agents.
 *
 * Idempotent: if a project with the supplied name already exists in the
 * user's personal org, it returns that project's id/slug + `created: false`.
 * Otherwise it creates a new project and returns `created: true`.
 *
 * This is the audit-friendly path. The lower-friction path is to pass
 * `projectName` to `brain_start_session`, which calls the same helper
 * under the hood.
 *
 * Project-scoped tokens cannot create projects — the token's scope IS the
 * project. Returns 403 FORBIDDEN_PROJECT in that case.
 */
const inputShape = z.object({
  name: z.string().min(1).max(120),
  framework: z.string().max(60).optional(),
  language: z.string().max(60).optional(),
});

export const createProject: ToolDef = {
  name: "brain_create_project",
  description:
    "Create a Brain project by name, or return the existing one if a project with that name already exists in the user's org. Use this when starting work on a distinct codebase or client. Returns { projectId, slug, created }. Project-scoped tokens cannot create projects.",
  inputSchema: {
    type: "object",
    required: ["name"],
    properties: {
      name: {
        type: "string",
        description:
          "Human-readable project name (e.g. 'Acme Robotics', 'mobile-app'). Case-insensitive on lookup.",
        minLength: 1,
        maxLength: 120,
      },
      framework: {
        type: "string",
        examples: ["react", "nextjs", "vue"],
        maxLength: 60,
      },
      language: {
        type: "string",
        examples: ["typescript", "python"],
        maxLength: 60,
      },
    },
  },
  handler: async (raw, auth) => {
    const input = inputShape.parse(raw);

    if (auth.projectId !== null) {
      throw new BrainError({
        message:
          "Project-scoped tokens cannot create projects. Use a user-scoped token, or create the project from the webapp.",
        code: "FORBIDDEN_PROJECT",
        category: "auth",
        status: 403,
      });
    }

    const result = await ensureNamedProject(db, auth.userId, input.name, {
      // Spread-when-defined per tsconfig exactOptionalPropertyTypes.
      ...(input.framework ? { framework: input.framework } : {}),
      ...(input.language ? { language: input.language } : {}),
    });
    return result;
  },
};
