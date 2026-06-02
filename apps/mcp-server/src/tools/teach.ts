import { z } from "zod";
import { db, toVector } from "@brain/db";
import {
  embedding,
  getUserProjects,
  ensureDefaultProject,
  userCanAccessProject,
  BrainError,
} from "@brain/core";
import type { ToolDef } from "./index.js";

const inputShape = z.object({
  type: z.enum(["reflex", "recipe", "heuristic", "principle", "anti_principle"]),
  trigger: z.string().min(5),
  rule: z.string().min(10),
  rationale: z.string().optional(),
  instead: z.string().optional(),
  scope: z.enum(["global", "user", "project"]).default("user"),
  projectId: z.string().optional(),
  framework: z.string().optional(),
  language: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export const teachKnowledge: ToolDef = {
  name: "brain_teach_knowledge",
  description:
    "Record a piece of knowledge the user explicitly taught. Use when the user says 'remember that I prefer X' or 'always do Y'. User-taught knowledge has highest confidence (1.0) and overrides KEA-extracted siblings.",
  inputSchema: {
    type: "object",
    required: ["type", "trigger", "rule"],
    properties: {
      type: {
        type: "string",
        enum: ["reflex", "recipe", "heuristic", "principle", "anti_principle"],
      },
      trigger: { type: "string" },
      rule: { type: "string" },
      rationale: { type: "string" },
      instead: { type: "string" },
      scope: { type: "string", enum: ["global", "user", "project"], default: "user" },
      projectId: { type: "string" },
      framework: { type: "string" },
      language: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
  },
  handler: async (raw, auth) => {
    const input = inputShape.parse(raw);

    // Phase 3c: if the token is project-scoped, enforce the scope.
    if (auth.projectId !== null) {
      if (input.projectId && input.projectId !== auth.projectId) {
        throw new BrainError({
          message: "Token is scoped to a different project",
          code: "FORBIDDEN_PROJECT",
          category: "auth",
          status: 403,
        });
      }
    }

    // Phase 2b: default ownerProjectId to the token's project (Phase 3c) or the
    // user's first project, so new knowledge is always associated with a project.
    // When the token is unscoped AND the caller supplies an explicit projectId,
    // verify the user has access to it — without this, any authenticated user
    // could tag knowledge against any project ID they know.
    let resolvedProjectId: string | null =
      auth.projectId ?? input.projectId ?? null;
    if (auth.projectId === null && input.projectId) {
      const ok = await userCanAccessProject(db, auth.userId, input.projectId);
      if (!ok) {
        throw new BrainError({
          message: "project not found or access denied",
          code: "FORBIDDEN_PROJECT",
          category: "auth",
          status: 403,
        });
      }
    }
    if (!resolvedProjectId) {
      const projects = await getUserProjects(db, auth.userId);
      if (projects.length > 0) {
        resolvedProjectId = projects[0]!.id;
      } else {
        const { projectId } = await ensureDefaultProject(db, auth.userId);
        resolvedProjectId = projectId;
      }
    }

    const row = await db.knowledge.create({
      data: {
        type: input.type,
        scope: input.scope,
        ownerUserId: auth.userId,
        ownerProjectId: resolvedProjectId,
        triggerText: input.trigger,
        ruleText: input.rule,
        rationale: input.rationale ?? null,
        instead: input.instead ?? null,
        framework: input.framework ?? null,
        language: input.language ?? null,
        tags: input.tags,
        confidence: 1.0,
        confirmedAt: new Date(),
        extractedBy: "user",
        sourceSessionIds: [],
      },
    });

    const vec = await embedding.embed(`${input.trigger}\n${input.rule}`);
    await db.$executeRawUnsafe(
      `UPDATE "Knowledge" SET embedding = $1::vector WHERE id = $2`,
      toVector(vec),
      row.id,
    );

    return { id: row.id, confidence: 1.0 };
  },
};
