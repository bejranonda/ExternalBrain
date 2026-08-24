import { z } from "zod";
import { db } from "@brain/db";
import {
  evaluation,
  bulkBumpKnowledgeOutcome,
  getLogger,
  BrainError,
  validateSubmittedLearnings,
  LEARNING_EVENT_TYPE,
  MAX_LEARNINGS_PER_SESSION,
  actionItems,
} from "@brain/core";
import { enqueueJob } from "../jobs.js";
import type { ToolDef } from "./index.js";

const log = getLogger("report-session-outcome");

const inputShape = z.object({
  sessionId: z.string(),
  success: z.boolean(),
  filesCreated: z.array(z.string()).default([]),
  filesModified: z.array(z.string()).default([]),
  filesRejected: z.array(z.string()).default([]),
  knowledgeUsed: z.array(z.string()).default([]),
  buildAttempts: z.number().int().min(0).default(1),
  errors: z.array(z.string()).default([]),
  userFeedback: z.enum(["up", "down"]).optional(),
  userFeedbackComment: z.string().optional(),
  durationMs: z.number().int().min(0).default(0),
  tokensUsed: z.number().int().min(0).default(0),
  // Deliberately loose: per-item validation happens in
  // validateSubmittedLearnings so one malformed learning can never fail
  // the whole outcome report (spec 2026-06-09).
  learnings: z.array(z.unknown()).optional(),
  // V2.0 (spec 2026-07-07 §4a): action items completed/obsoleted during this
  // session — retired (soft-deleted) at close, the loop's accountability moment.
  resolvedActionItemIds: z.array(z.string()).max(50).default([]),
});

export const reportSessionOutcome: ToolDef = {
  name: "brain_report_session_outcome",
  description:
    "Report the outcome of a coding session after completion. Must be called after the user accepts/rejects generated code. Include `learnings` (0-5): the durable rules you discovered this session — ESPECIALLY anything the user corrected or rejected ('we use X not Y here'). Distill each as {trigger, rule, rationale}. Enables the Brain's feedback loop (confidence updates + autoskill proposals).",
  inputSchema: {
    type: "object",
    required: ["sessionId", "success"],
    properties: {
      sessionId: { type: "string" },
      success: { type: "boolean" },
      filesCreated: { type: "array", items: { type: "string" } },
      filesModified: { type: "array", items: { type: "string" } },
      filesRejected: { type: "array", items: { type: "string" } },
      knowledgeUsed: {
        type: "array",
        items: { type: "string" },
        description: "IDs of knowledge items injected at session start",
      },
      buildAttempts: { type: "integer" },
      errors: { type: "array", items: { type: "string" } },
      userFeedback: { type: "string", enum: ["up", "down"] },
      userFeedbackComment: { type: "string" },
      durationMs: { type: "integer" },
      tokensUsed: { type: "integer" },
      learnings: {
        type: "array",
        maxItems: 5,
        description:
          "0-5 durable learnings you distilled from this session — ESPECIALLY user corrections and rejected approaches. Invalid items are dropped without failing the call.",
        items: {
          type: "object",
          required: ["trigger", "rule", "rationale", "type", "source"],
          properties: {
            trigger: {
              type: "string",
              description:
                "When does this apply? e.g. 'when scaffolding a React form in this repo'",
            },
            rule: { type: "string", description: "The rule to follow, specific to this codebase/team" },
            rationale: { type: "string", description: "Why — what happens otherwise" },
            type: {
              type: "string",
              enum: ["reflex", "recipe", "heuristic", "principle", "anti_principle"],
            },
            source: { type: "string", enum: ["user_correction", "decision", "discovery"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      resolvedActionItemIds: {
        type: "array",
        items: { type: "string" },
        maxItems: 50,
        description:
          "IDs from openActionItems that are now DONE or obsolete — they are retired (soft-deleted) so they stop appearing.",
      },
    },
  },
  handler: async (raw, auth) => {
    const input = inputShape.parse(raw);
    let learningsDropped:
      | { invalid: number; overflow: number; markup: number }
      | undefined;

    // Ownership scope: only the session's owner may report its outcome.
    // Without this, any authenticated user could close another user's
    // running session and tamper with its outcome/SQS.
    const ownedSession = await db.session.findUnique({
      where: { id: input.sessionId },
      select: { userId: true, projectId: true },
    });
    if (!ownedSession || ownedSession.userId !== auth.userId) {
      throw new BrainError({
        message: "session not found",
        code: "NOT_FOUND",
        category: "validation",
        status: 404,
      });
    }

    // 1. Close the session
    // Close-capture (spec 2026-06-09): persist agent-submitted learnings as
    // events so KEA's refine mode can validate them. Written BEFORE the
    // kea.extract enqueue below — the worker rebuilds its payload from the
    // DB, so the events must exist when the job runs. Per-item validation:
    // a malformed learning must never block the outcome report.
    if (input.learnings && input.learnings.length > 0) {
      const { valid, droppedInvalid, droppedOverflow, droppedMarkup } = validateSubmittedLearnings(
        input.learnings,
      );
      if (droppedInvalid > 0 || droppedOverflow > 0 || droppedMarkup > 0) {
        learningsDropped = {
          invalid: droppedInvalid,
          overflow: droppedOverflow,
          markup: droppedMarkup,
        };
      }
      if (valid.length > 0) {
        await db.sessionEvent.createMany({
          data: valid.map((l) => ({
            sessionId: input.sessionId,
            eventType: LEARNING_EVENT_TYPE,
            payload: l,
          })),
        });
      }
      log.info(
        {
          op: "report.learnings_captured",
          sessionId: input.sessionId,
          submitted: input.learnings.length,
          captured: valid.length,
          droppedInvalid,
          droppedOverflow,
          droppedMarkup,
          cap: MAX_LEARNINGS_PER_SESSION,
        },
        "report.learnings_captured",
      );
    }

    const outcome = input.success
      ? "success"
      : input.errors.length > 0
        ? "failed"
        : "partial";
    await db.session.update({
      where: { id: input.sessionId },
      data: { endedAt: new Date(), outcome },
    });

    // 2. Compute SQS
    const sqs = await evaluation.computeAndStoreSQS(input.sessionId, {
      filesCreated: input.filesCreated,
      filesModified: input.filesModified,
      filesRejected: input.filesRejected,
      knowledgeUsed: input.knowledgeUsed,
      buildAttempts: input.buildAttempts,
      errors: input.errors,
      userFeedback: input.userFeedback,
      userFeedbackComment: input.userFeedbackComment,
      durationMs: input.durationMs,
      tokensUsed: input.tokensUsed,
      outcome,
    });

    // 3. Update knowledge confidence (closed feedback loop via explicit knowledgeUsed list).
    // Scoped to ownerUserId so a caller can't inflate/deflate counters on
    // another user's Knowledge by passing their IDs. Non-owned IDs are
    // silently ignored (best-effort, matches the bulkBumpKnowledgeOutcome
    // semantic below).
    if (input.knowledgeUsed.length > 0) {
      const counterField = input.success ? "successCount" : "failureCount";
      await db.knowledge.updateMany({
        where: { id: { in: input.knowledgeUsed }, ownerUserId: auth.userId },
        data: { [counterField]: { increment: 1 } },
      });

      // 3a. Persist which knowledge the agent reported as actually applied,
      // as SessionKnowledgeApplication role "used_reported". This is the raw
      // signal behind the loop-health injection→used rate (flywheel-repair
      // spec §4.2) — counters alone can't answer it per-session. Owned rows
      // only (same containment as the counter bump above); FK-safe because
      // the id list is re-derived from the DB. Best-effort: never fail the
      // close over telemetry.
      try {
        const owned = await db.knowledge.findMany({
          where: { id: { in: input.knowledgeUsed }, ownerUserId: auth.userId },
          select: { id: true },
        });
        if (owned.length > 0) {
          await db.sessionKnowledgeApplication.createMany({
            data: owned.map((k) => ({
              sessionId: input.sessionId,
              knowledgeId: k.id,
              role: "used_reported",
            })),
            skipDuplicates: true,
          });
        }
      } catch (err) {
        log.warn({ err, sessionId: input.sessionId }, "used_reported persist failed (best-effort)");
      }
    }

    // 3b. Also bump successCount/failureCount for Knowledge rows discovered via
    //     SessionKnowledgeApplication (injected during this session). Best-effort.
    bulkBumpKnowledgeOutcome(db, input.sessionId, input.success).catch((err) => {
      log.warn({ err, sessionId: input.sessionId }, "bulkBumpKnowledgeOutcome failed (best-effort)");
    });

    // 3c. V2.0 (spec 2026-07-07): retire action items reported done. Bounded
    //     to the session's project scope — resolveActionItems can only touch
    //     type=action_item rows visible there, never rules.
    let resolvedActionItems = 0;
    if (input.resolvedActionItemIds.length > 0) {
      try {
        resolvedActionItems = await actionItems.resolveActionItems({
          ids: input.resolvedActionItemIds,
          userId: auth.userId,
          projectId: ownedSession.projectId,
        });
      } catch (err) {
        log.warn(
          { err, sessionId: input.sessionId },
          "resolveActionItems failed (best-effort — close proceeds)",
        );
      }
    }

    // 4. Enqueue KEA + autoskill jobs via pg-boss boss.send() (audit C7).
    //    Previously raw-SQL INSERT against pgboss.job, which silently
    //    failed when the v12 schema dropped/renamed columns. Now uses the
    //    public API with retry/backoff defaults from `jobs.ts`.
    const queued: string[] = [];
    for (const [name, payload] of [
      ["kea.extract", { sessionId: input.sessionId, userId: auth.userId }],
      ["autoskill.run", { sessionId: input.sessionId, userId: auth.userId }],
    ] as const) {
      try {
        await enqueueJob(name, payload, {
          singletonKey: `${name}:${input.sessionId}`,
        });
        queued.push(name);
      } catch (err) {
        log.warn(
          { err, jobName: name, sessionId: input.sessionId },
          "enqueueJob failed (job dropped — KEA/autoskill won't run for this session)",
        );
      }
    }

    // Ask-back (#64 follow-up): a close without learnings is the moment the
    // highest-value knowledge evaporates — especially after a failure or a
    // thumbs-down, where the user's correction is fresh in the agent's
    // context. The close is already committed, so the nudge points at
    // brain_teach_knowledge (still callable) rather than a re-close.
    let hint: string | undefined;
    const noLearnings = !input.learnings || input.learnings.length === 0;
    if (noLearnings && (!input.success || input.userFeedback === "down")) {
      hint =
        "This session ended unsuccessfully and no learnings were submitted. " +
        "If the user corrected or rejected an approach, capture it NOW with " +
        "brain_teach_knowledge ({trigger, rule, rationale}) — corrections are " +
        "the highest-value knowledge and they evaporate when the session ends.";
    } else if (noLearnings) {
      hint =
        "No learnings submitted. If anything durable came out of this session " +
        "(a correction, a decision, a discovered pitfall), record it with " +
        "brain_teach_knowledge so the next session starts smarter.";
    }

    return {
      sqs,
      queued,
      ...(input.resolvedActionItemIds.length > 0 ? { resolvedActionItems } : {}),
      // Dropped learnings were previously visible only in a worker log line,
      // so the agent that submitted them believed all were captured. A drop
      // the submitter cannot see is the same silent-loss shape as §0as —
      // markup drops especially, since those mean a mis-typed call whose
      // remaining parameters were probably swallowed and should be re-sent.
      ...(learningsDropped
        ? {
            learningsDropped,
            ...(learningsDropped.markup > 0
              ? {
                  learningsHint:
                    `${learningsDropped.markup} learning(s) were dropped because a text field ` +
                    `contained tool-call markup — a later parameter was probably typed inside ` +
                    `an earlier field's value. Re-send them with each field as its own parameter.`,
                }
              : {}),
          }
        : {}),
      ...(hint ? { hint } : {}),
    };
  },
};
