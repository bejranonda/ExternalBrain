import { z } from "zod";
import { db } from "@brain/db";
import { evaluation, bulkBumpKnowledgeOutcome, getLogger, BrainError } from "@brain/core";
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
});

export const reportSessionOutcome: ToolDef = {
  name: "brain_report_session_outcome",
  description:
    "Report the outcome of a coding session after completion. Must be called after the user accepts/rejects generated code. Enables the Brain's feedback loop (confidence updates + autoskill proposals).",
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
    },
  },
  handler: async (raw, auth) => {
    const input = inputShape.parse(raw);

    // Ownership scope: only the session's owner may report its outcome.
    // Without this, any authenticated user could close another user's
    // running session and tamper with its outcome/SQS.
    const ownedSession = await db.session.findUnique({
      where: { id: input.sessionId },
      select: { userId: true },
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
    }

    // 3b. Also bump successCount/failureCount for Knowledge rows discovered via
    //     SessionKnowledgeApplication (injected during this session). Best-effort.
    bulkBumpKnowledgeOutcome(db, input.sessionId, input.success).catch((err) => {
      log.warn({ err, sessionId: input.sessionId }, "bulkBumpKnowledgeOutcome failed (best-effort)");
    });

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

    return { sqs, queued };
  },
};
