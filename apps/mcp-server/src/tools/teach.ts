import { z } from "zod";
import { db, toVector } from "@brain/db";
import {
  embedding,
  getUserProjects,
  ensureDefaultProject,
  userCanAccessProject,
  BrainError,
  supersedeKnowledge,
  getLogger,
} from "@brain/core";
import type { ToolDef } from "./index.js";

const inputShape = z.object({
  type: z.enum([
    "reflex",
    "recipe",
    "heuristic",
    "principle",
    "anti_principle",
    "action_item",
  ]),
  trigger: z.string().min(5),
  rule: z.string().min(10),
  rationale: z.string().optional(),
  instead: z.string().optional(),
  scope: z.enum(["global", "user", "project"]).default("user"),
  projectId: z.string().optional(),
  framework: z.string().optional(),
  language: z.string().optional(),
  tags: z.array(z.string()).default([]),
  supersedesKnowledgeId: z.string().optional(),
});

export const teachKnowledge: ToolDef = {
  name: "brain_teach_knowledge",
  description:
    "Record a piece of knowledge the user explicitly taught, OR a project DECISION / status change ('we'll use X', 'deprecate Y', 'Z owns auth'). For a decision: set scope:'project', put the rejected alternative in `instead`, add 'decision' to `tags`, and — if it reverses a prior decision — pass that decision's id as `supersedesKnowledgeId` (it is retired and replaced). Decisions become shared project memory: a teammate's next brain_start_session surfaces them. For a meeting ACTION ITEM or OPEN QUESTION: type:'action_item', scope:'project', tags ['action-item'|'open-question', 'for:<assignee-email-lowercase>', 'meeting:<YYYY-MM-DD-slug>', plus 'blocker' when it blocks other work]; it is surfaced to the assignee at session start and via the Oracle, never as a rule. User-taught knowledge has highest confidence (1.0) and overrides KEA-extracted siblings.",
  inputSchema: {
    type: "object",
    required: ["type", "trigger", "rule"],
    properties: {
      type: {
        type: "string",
        enum: [
          "reflex",
          "recipe",
          "heuristic",
          "principle",
          "anti_principle",
          "action_item",
        ],
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
      supersedesKnowledgeId: { type: "string" },
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

    // A decision that reverses a prior one retires + links the predecessor so
    // KRA stops serving a stale decision to the team (spec 2026-06-16 §5).
    if (input.supersedesKnowledgeId) {
      await supersedeKnowledge(db, {
        newId: row.id,
        supersededId: input.supersedesKnowledgeId,
        userId: auth.userId,
      });
    }
    // Measurement (APPROACH §1.3): split decision capture out of generic teach.
    if (input.tags.includes("decision")) {
      getLogger("mcp", { stream: "stdout" }).info(
        {
          op: "decision.captured",
          knowledgeId: row.id,
          scope: input.scope,
          channel: "teach",
          superseded: input.supersedesKnowledgeId ?? null,
        },
        "decision.captured",
      );
    }

    return { id: row.id, confidence: 1.0 };
  },
};
