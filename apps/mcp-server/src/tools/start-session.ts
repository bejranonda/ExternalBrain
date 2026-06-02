import { z } from "zod";
import { db } from "@brain/db";
import {
  getUserProjects,
  ensureDefaultProject,
  ensureNamedProject,
  userCanAccessProject,
  BrainError,
} from "@brain/core";
import type { ToolDef } from "./index.js";

const inputShape = z.object({
  clientType: z
    .enum(["claude_code", "cursor", "windsurf", "autobahn", "custom", "webapp"])
    .default("custom"),
  projectId: z.string().optional(),
  /**
   * Bug-1 / ROADMAP §1 — auto-create-on-name path. If supplied (and no
   * `projectId` overrides it), the session is tagged to a project with
   * this name, creating one if it doesn't exist yet in the user's org.
   * Case-insensitive lookup. Ignored if the token is project-scoped.
   */
  projectName: z.string().min(1).max(120).optional(),
  framework: z.string().optional(),
  language: z.string().optional(),
  prompt: z.string().optional(),
});

export const startSession: ToolDef = {
  name: "brain_start_session",
  description:
    "Open a new coding session. Call once at the start of a coding task, save the returned `sessionId`, and pass it to every subsequent `brain_log_event` and `brain_report_session_outcome`. Idempotent clients should issue a fresh session per user-visible task.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      clientType: {
        type: "string",
        enum: ["claude_code", "cursor", "windsurf", "autobahn", "custom", "webapp"],
      },
      projectId: { type: "string" },
      projectName: {
        type: "string",
        description:
          "Human-readable project name. If supplied (and no projectId overrides it), the session is filed under a project with this name — created on demand if one doesn't exist in the user's org. Case-insensitive. Ignored for project-scoped tokens.",
        minLength: 1,
        maxLength: 120,
      },
      framework: { type: "string", examples: ["react", "nextjs", "vue"] },
      language: { type: "string", examples: ["typescript", "python"] },
      prompt: {
        type: "string",
        description:
          "The user-facing task description — used later by the Oracle and session search.",
      },
    },
  },
  handler: async (raw, auth) => {
    const input = inputShape.parse(raw);

    // Phase 3c: if the token is project-scoped, enforce the scope.
    // - If caller specifies a different projectId → reject FORBIDDEN_PROJECT.
    // - If caller doesn't specify → default to the token's projectId.
    // Phase 2b fallback (user's first project) applies only when token.projectId is null.
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

    // When the token is unscoped AND the caller supplies an explicit
    // projectId, verify the user has access to it — without this, any
    // authenticated user could tag a session against any project ID they
    // happen to know.
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

    let resolvedProjectId: string | null =
      auth.projectId ?? input.projectId ?? null;

    // Bug-1: if the caller supplied a projectName AND no explicit projectId
    // already won the resolution, look up (or create) a project with that
    // name. Project-scoped tokens take precedence over projectName — the
    // token IS the scope and we don't let the caller redirect.
    if (
      !resolvedProjectId &&
      input.projectName &&
      auth.projectId === null
    ) {
      const { projectId } = await ensureNamedProject(
        db,
        auth.userId,
        input.projectName,
        {
          ...(input.framework ? { framework: input.framework } : {}),
          ...(input.language ? { language: input.language } : {}),
        },
      );
      resolvedProjectId = projectId;
    }

    if (!resolvedProjectId) {
      const projects = await getUserProjects(db, auth.userId);
      if (projects.length > 0) {
        resolvedProjectId = projects[0]!.id;
      } else {
        // Lazily create the default project if none exists yet.
        const { projectId } = await ensureDefaultProject(db, auth.userId);
        resolvedProjectId = projectId;
      }
    }

    const session = await db.session.create({
      data: {
        userId: auth.userId,
        projectId: resolvedProjectId,
        // Issue #166: persist which token authenticated the call so the
        // Connection status card can show real per-token session counts
        // instead of a user-wide aggregate.
        tokenId: auth.tokenId,
        clientType: input.clientType,
        metadata: {
          ...(input.prompt ? { prompt: input.prompt } : {}),
          ...(input.framework ? { framework: input.framework } : {}),
          ...(input.language ? { language: input.language } : {}),
        },
      },
    });
    await db.sessionEvent.create({
      data: {
        sessionId: session.id,
        eventType: "session_started",
        payload: {
          clientType: input.clientType,
          ...(input.framework ? { framework: input.framework } : {}),
          ...(input.language ? { language: input.language } : {}),
          ...(input.prompt ? { prompt: input.prompt } : {}),
        },
      },
    });
    return { sessionId: session.id, startedAt: session.startedAt.toISOString() };
  },
};
