import { z } from "zod";
import { db } from "@brain/db";
import {
  getUserProjects,
  ensureDefaultProject,
  ensureNamedProject,
  userCanAccessProject,
  BrainError,
  kra,
  formatter,
  actionItems,
  envForMcp,
  getLogger,
} from "@brain/core";
import type { ToolDef } from "./index.js";
import { resolveOrgScope } from "../org-scope.js";
import { resolveProjectForCall } from "../scope.js";

const log = getLogger("start-session");

const inputShape = z.object({
  clientType: z
    .enum([
      "claude_code",
      "cursor",
      "windsurf",
      "autobahn",
      "antigravity",
      "github_copilot",
      "custom",
      "webapp",
    ])
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
    "Open a new coding session. Call once at the start of a coding task, save the returned `sessionId`, and pass it to every subsequent `brain_log_event` and `brain_report_session_outcome`. ALWAYS include `prompt` (the task description): the response then carries `relevantKnowledge` — rules this Brain already learned that apply to the task. APPLY them, and pass `relevantKnowledge.knowledgeIds` back as `knowledgeUsed` when you close, so the Brain learns which rules paid off. When meeting intelligence is enabled the response may also carry `openActionItems` — your open meeting to-dos; act on or resolve them via `resolvedActionItemIds` at close. Idempotent clients should issue a fresh session per user-visible task. Project scoping is per-call, not persisted — there is no 'active project' remembered between calls, so pass `projectId`/`projectName` on EVERY call for work that belongs outside the default project; the response's `project.source` tells you whether this call landed in a real project or fell back to 'Default', and a `hint` appears when it did.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      clientType: {
        type: "string",
        enum: [
          "claude_code",
          "cursor",
          "windsurf",
          "autobahn",
          "antigravity",
          "github_copilot",
          "custom",
          "webapp",
        ],
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

    // Precedence comes from the SHARED resolver so this tool cannot drift from
    // brain_teach_knowledge and brain_ask_oracle — the drift between three
    // copies is what KNOWN_ISSUES §0ar cost. Only the *reporting* stays local:
    // this tool distinguishes "we created a project for you" from "we picked
    // your existing one", and hints selectively rather than on every fallback.
    let resolved;
    try {
      resolved = await resolveProjectForCall(
        auth,
        { projectId: input.projectId, projectName: input.projectName },
        {
          userCanAccessProject: (u, pid) => userCanAccessProject(db, u, pid),
          ensureNamedProject: (u, n, o) => ensureNamedProject(db, u, n, o),
          getUserProjects: (u) => getUserProjects(db, u),
          ensureDefaultProject: (u) => ensureDefaultProject(db, u),
        },
        // Unused: this tool builds its own selective hint below.
        () => "",
        {
          allowCreate: true,
          ...(input.framework ? { framework: input.framework } : {}),
          ...(input.language ? { language: input.language } : {}),
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("FORBIDDEN_PROJECT") || msg.includes("PROJECT_NOT_FOUND")) {
        throw new BrainError({
          message: "project not found or access denied",
          code: "FORBIDDEN_PROJECT",
          category: "auth",
          status: 403,
        });
      }
      throw err;
    }

    const resolvedProjectId: string = resolved.projectId;
    let projectName: string | undefined = resolved.projectName;
    // Map the shared vocabulary onto this tool's existing, richer one. Its
    // `source` values are a published contract (brain_get_active_project uses
    // the same words), so translate rather than break callers.
    const projectSource: "token_scope" | "explicit" | "first_project_fallback" | "default_created" =
      resolved.source === "token_scope"
        ? "token_scope"
        : resolved.source === "default_fallback"
          ? resolved.created
            ? "default_created"
            : "first_project_fallback"
          : "explicit";
    const ambiguousChoice = resolved.ambiguous ?? false;

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

    // Inject-at-open (spec 2026-06-11, #64): the prompt is the retrieval
    // query, and this call is the one touchpoint every client reliably hits
    // — measured before this change: 0% of knowledge ever retrieved across
    // 22 sessions because the separate brain_retrieve_knowledge call never
    // happens in practice. kra.retrieve records the
    // SessionKnowledgeApplication(role:"injected") rows, which report.ts
    // step 3b already turns into success/failure feedback on close.
    // FAIL-SOFT: opening a session must never block on retrieval — any
    // error (no embedding provider, vector blip) logs and omits the field.
    let relevantKnowledge:
      | { knowledgeIds: string[]; injection: string }
      | undefined;
    if (input.prompt && input.prompt.trim().length > 0) {
      try {
        // Inject-at-open is the path AGENTS.md points at when it says a
        // teammate's decisions surface at session start — so this is the
        // call that has to carry org scope, not just brain_retrieve_knowledge.
        const orgScope = await resolveOrgScope(auth.userId, resolvedProjectId ?? undefined);
        const bundle = await kra.retrieve(
          input.prompt,
          {
            sessionId: session.id,
            userId: auth.userId,
            ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
            ...orgScope,
            ...(input.framework ? { framework: input.framework } : {}),
            ...(input.language ? { language: input.language } : {}),
          },
          5,
        );
        if (bundle.injectedIds.length > 0) {
          relevantKnowledge = {
            knowledgeIds: bundle.injectedIds,
            injection: formatter.formatForInjection(bundle),
          };
        }
        log.info(
          {
            op: "start.inject",
            sessionId: session.id,
            injected: bundle.injectedIds.length,
          },
          "start.inject",
        );
      } catch (err) {
        log.warn(
          {
            op: "start.inject_failed",
            sessionId: session.id,
            err: err instanceof Error ? err.message : String(err),
          },
          "start.inject_failed (session opens without knowledge)",
        );
      }
    }

    // V2.0 (spec 2026-07-07 §4b): deterministic, addressed open-action-item
    // block — separate from semantic relevantKnowledge, and deliberately NOT
    // recorded as SessionKnowledgeApplication "injected" rows (tasks would
    // pollute the injection→used loop-health metric, gate #149).
    // FAIL-SOFT like relevantKnowledge: never block session open.
    let openActionItems:
      | { knowledgeIds: string[]; injection: string }
      | undefined;
    if (envForMcp().V2_ACTION_ITEMS) {
      try {
        const me = await db.user.findUnique({
          where: { id: auth.userId },
          select: { email: true },
        });
        if (me?.email) {
          const items = await actionItems.listOpenActionItemsFor({
            userId: auth.userId,
            email: me.email,
            projectId: resolvedProjectId,
          });
          if (items.length > 0) {
            openActionItems = {
              knowledgeIds: items.map((i) => i.id),
              injection: actionItems.formatActionItemsForInjection(items),
            };
          }
        }
      } catch (err) {
        log.warn(
          {
            op: "start.action_items_failed",
            sessionId: session.id,
            err: err instanceof Error ? err.message : String(err),
          },
          "start.action_items_failed (session opens without task block)",
        );
      }
    }

    // Surface which project the session landed in, and — only when it's a
    // silent fallback rather than a deliberate choice — nudge the caller
    // toward brain_create_project / projectName instead of letting every
    // untagged session quietly pile up in "Default". Mirrors the `hint`
    // convention from brain_report_session_outcome (report.ts).
    //
    // FAIL-SOFT, like relevantKnowledge/openActionItems above: the session
    // row already exists, so a throw here would deny the caller the
    // sessionId for a session it can never close — the unclosed-session
    // failure the whole loop is built to avoid. The name is only missing on
    // the token-scoped / explicit-projectId paths, which emit no hint, so a
    // failed lookup costs a display field and nothing else.
    if (projectName === undefined) {
      try {
        const row = await db.project.findUnique({
          where: { id: resolvedProjectId },
          select: { name: true },
        });
        projectName = row?.name;
      } catch (err) {
        log.warn(
          {
            op: "start.project_name_failed",
            sessionId: session.id,
            err: err instanceof Error ? err.message : String(err),
          },
          "start.project_name_failed (session opens without project.name)",
        );
      }
    }

    const project = {
      id: resolvedProjectId,
      source: projectSource,
      ...(projectName !== undefined ? { name: projectName } : {}),
    };

    // Nudge only when it carries information: the session landed on the
    // catch-all "Default" project, or the fallback had to guess between
    // several. A one-project user who never passes projectName is not
    // making a mistake, and a hint on every session is just noise.
    let hint: string | undefined;
    const landedOnDefault =
      projectSource === "default_created" || projectName === "Default";
    if (
      (projectSource === "first_project_fallback" ||
        projectSource === "default_created") &&
      (landedOnDefault || ambiguousChoice)
    ) {
      hint =
        `This session is filed under the "${projectName ?? "Default"}" project because no ` +
        "projectId/projectName was given. If this work belongs to a specific project, " +
        "call brain_create_project or pass projectName on this call — project scoping is " +
        "per-call, not persisted, so pass it again on future brain_start_session calls too.";
    }

    return {
      sessionId: session.id,
      startedAt: session.startedAt.toISOString(),
      project,
      ...(hint ? { hint } : {}),
      ...(relevantKnowledge ? { relevantKnowledge } : {}),
      ...(openActionItems ? { openActionItems } : {}),
    };
  },
};
