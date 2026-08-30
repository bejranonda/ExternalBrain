import { z } from "zod";
import { db, toVector } from "@brain/db";
import {
  embedding,
  getUserProjects,
  ensureDefaultProject,
  userCanAccessProject,
  ensureNamedProject,
  BrainError,
  supersedeKnowledge,
  getLogger,
} from "@brain/core";
import type { ToolDef } from "./index.js";
import { resolveProjectForCall } from "../scope.js";
import { hasLeakedMarkup } from "@brain/core/text-guards";
import { fallbackHint } from "@brain/core/project-fit";
import { requireCapability } from "../capability.js";

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
  projectName: z.string().trim().min(1).max(120).optional(),
});

/**
 * Reject text fields that contain leaked tool-call markup.
 *
 * An agent that writes a closing tag or a further parameter block *inside* a
 * field's value gets the whole tail stored as text in that field, and every
 * parameter after it silently dropped. The call still returns
 * `{ id, confidence: 1 }` — indistinguishable from a clean write.
 *
 * Measured 2026-08-23: two rows landed this way. One was a project DECISION
 * that lost its `decision` tag, which is what promotes a rule to
 * `visibility: "org"` and makes it shared project memory — so it was silently
 * filed as private. The corruption was invisible until a `retrieve_knowledge`
 * dump happened to show the markup.
 *
 * Storing it is worse than refusing it: a corrupted rationale is served back
 * to future agents as fact, and a dropped tag changes who can see the rule.
 * Fail loudly instead, and say exactly what to do about it.
 */
function assertNoLeakedMarkup(field: string, value: string | undefined): void {
  if (!hasLeakedMarkup(value)) return;
  throw new BrainError({
    message:
      `\`${field}\` contains tool-call markup (e.g. a closing tag or a ` +
      `<parameter> block) rather than plain text. This happens when a later ` +
      `parameter is typed inside this field's value: the tail is stored as ` +
      `text here and every parameter after it is dropped — including \`tags\`, ` +
      `which is what makes a decision org-visible. Re-send with each field as ` +
      `its own tool parameter.`,
    code: "INVALID_FIELD_CONTENT",
    category: "validation",
    status: 400,
  });
}

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
      projectName: {
        type: "string",
        description:
          "Human-readable project name, created on demand. Use this when you know the project by name rather than id — without either, the rule is filed under the fallback project and the response says so via `project.source` + `hint`.",
      },
    },
  },
  handler: async (raw, auth) => {
    requireCapability(auth, "knowledge");
    const input = inputShape.parse(raw);

    // Before anything is written or resolved: a malformed call must not reach
    // the database, because once stored it reads exactly like a real rule.
    assertNoLeakedMarkup("rule", input.rule);
    assertNoLeakedMarkup("trigger", input.trigger);
    assertNoLeakedMarkup("rationale", input.rationale);
    assertNoLeakedMarkup("instead", input.instead);

    // One shared rule with brain_start_session and brain_ask_oracle. This used
    // to be a bespoke copy that accepted only `projectId` and reported nothing,
    // which is why EVERY rule ever taught from the External Brain repo landed
    // in the default project without anyone noticing (KNOWN_ISSUES §0ar).
    let resolved: Awaited<ReturnType<typeof resolveProjectForCall>>;
    try {
      resolved = await resolveProjectForCall(
        auth,
        { projectId: input.projectId, projectName: input.projectName },
        {
          userCanAccessProject: (u, p) => userCanAccessProject(db, u, p),
          ensureNamedProject: (u, n) => ensureNamedProject(db, u, n),
          getUserProjects: (u) => getUserProjects(db, u),
          ensureDefaultProject: (u) => ensureDefaultProject(db, u),
        },
        (name, suggestions) => fallbackHint(name, suggestions),
        {
          allowCreate: true,
          // The rule's own text is the ranking signal: a rule that names the
          // project it is about has already said where it belongs.
          signalText: `${input.trigger} ${input.rule}`,
          ...(input.framework ? { framework: input.framework } : {}),
          ...(input.language ? { language: input.language } : {}),
        },
      );
    } catch (err) {
      // ONLY scope failures are 403. Blanket-converting every error meant a
      // Prisma connection drop inside the fallback lookup was reported to the
      // agent as "access denied" — sending it to chase a permissions problem
      // instead of retrying a transient infrastructure one.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("FORBIDDEN_PROJECT") || msg.includes("PROJECT_NOT_FOUND")) {
        throw new BrainError({
          message: msg.includes("PROJECT_NOT_FOUND")
            ? "no project with that name is accessible to this token"
            : "project not found, access denied, or token is scoped to a different project",
          code: "FORBIDDEN_PROJECT",
          category: "auth",
          status: 403,
        });
      }
      throw err;
    }
    const resolvedProjectId: string = resolved.projectId;

    // A project DECISION is a shared team fact by definition — AGENTS.md
    // says so outright ("Decisions are shared project memory: a teammate's
    // next brain_start_session surfaces them") and KNOWLEDGE §12.22 treats
    // them as settled choices the whole project works from.
    //
    // That promise was false in both directions until 2026-08-03. Retrieval
    // never carried org scope over MCP (fixed alongside this), AND the write
    // side left `visibility` at its `'project'` default — which the owner
    // gate deliberately does NOT share across users. Fixing only retrieval
    // would have left the claim just as false, for a subtler reason.
    //
    // Narrow on purpose: ONLY rows the caller explicitly tagged `decision`
    // AND scoped to a project. Everything else keeps the default. A rule you
    // taught for yourself does not become org-visible because you happened to
    // be in a project.
    const isProjectDecision =
      input.scope === "project" &&
      input.tags.some((t) => t.toLowerCase() === "decision") &&
      resolvedProjectId !== null;

    const row = await db.knowledge.create({
      data: {
        type: input.type,
        scope: input.scope,
        ...(isProjectDecision ? { visibility: "org" } : {}),
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

    // Stamp the model that actually served this call. Without it every taught
    // rule lands with embeddingModel NULL, which the backfill treats as stale
    // — so each one is embedded twice (a duplicate paid call, forever) and the
    // `remaining` convergence counter never reaches 0 on a live instance,
    // turning the operator's migration signal into a standing false alarm.
    const { vector: vec, model: embModel } = await embedding.embedWithProvenance(
      `${input.trigger}\n${input.rule}`,
    );
    await db.$executeRawUnsafe(
      `UPDATE "Knowledge" SET embedding = $1::vector, "embeddingModel" = $3 WHERE id = $2`,
      toVector(vec),
      row.id,
      embModel,
    );

    // A decision that reverses a prior one retires + links the predecessor so
    // KRA stops serving a stale decision to the team (spec 2026-06-16 §5).
    // supersedeKnowledge returns false when the target is not found for this
    // user+project — most often because the predecessor lives in a DIFFERENT
    // project. Discarding that boolean made the tool report success while the
    // stale rule stayed ACTIVE and kept being retrieved, which is the worst
    // possible outcome for a supersession: the caller believes the old advice
    // is retired and it is not.
    let superseded: boolean | undefined;
    if (input.supersedesKnowledgeId) {
      superseded = await supersedeKnowledge(db, {
        newId: row.id,
        supersededId: input.supersedesKnowledgeId,
        userId: auth.userId,
        projectId: resolvedProjectId ?? undefined,
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

    return {
      id: row.id,
      confidence: 1.0,
      project: {
        id: resolvedProjectId,
        ...(resolved.projectName ? { name: resolved.projectName } : {}),
        source: resolved.source,
      },
      ...(resolved.hint ? { hint: resolved.hint } : {}),
      // Ranked alternatives, present only on a fallback. Structured as well as
      // in the prose hint so a caller can branch on it rather than parse it.
      ...(resolved.suggestions ? { suggestedProjects: resolved.suggestions } : {}),
      ...(superseded === undefined
        ? {}
        : {
            superseded,
            ...(superseded
              ? {}
              : {
                  supersedeHint:
                    `Supersession did NOT apply: ${input.supersedesKnowledgeId} was not found ` +
                    `for this user in project ${resolvedProjectId}. The old rule is still ACTIVE. ` +
                    `Most likely it lives in a different project — re-run this teach with that ` +
                    `project's projectId/projectName.`,
                }),
          }),
    };
  },
};
