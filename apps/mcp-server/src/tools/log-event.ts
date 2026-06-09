import { z } from "zod";
import { db } from "@brain/db";
import { BrainError } from "@brain/core";
import type { ToolDef } from "./index.js";

const inputShape = z.object({
  sessionId: z.string(),
  eventType: z.enum([
    "session_started",
    "tool_use",
    "file_created",
    "file_modified",
    "file_rejected",
    "build_attempt",
    "build_success",
    "build_failure",
    "user_clarification",
    "user_correction",
    "knowledge_injected",
    "knowledge_rejected",
  ]),
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.string().datetime().optional(),
});

export const logEvent: ToolDef = {
  name: "brain_log_event",
  description:
    "Log an event during a coding session. Events feed KEA and autoskill. Call frequently — do NOT batch. ALWAYS log user_correction (the user changed your approach) and knowledge_rejected (an injected skill didn't apply) the moment they happen — these drive the Brain's confidence loop. Safe to call from a background thread.",
  inputSchema: {
    type: "object",
    required: ["sessionId", "eventType", "payload"],
    properties: {
      sessionId: { type: "string" },
      eventType: {
        type: "string",
        enum: [
          "session_started",
          "tool_use",
          "file_created",
          "file_modified",
          "file_rejected",
          "build_attempt",
          "build_success",
          "build_failure",
          "user_clarification",
          "user_correction",
          "knowledge_injected",
          "knowledge_rejected",
        ],
      },
      payload: { type: "object" },
      timestamp: { type: "string", format: "date-time" },
    },
  },
  handler: async (raw, auth) => {
    const input = inputShape.parse(raw);
    // Ownership scope: only the session's owner may log events into it.
    // Without this, any authenticated user could pollute another user's
    // KEA pipeline by passing their sessionId.
    const session = await db.session.findUnique({
      where: { id: input.sessionId },
      select: { userId: true },
    });
    if (!session || session.userId !== auth.userId) {
      throw new BrainError({
        message: "session not found",
        code: "NOT_FOUND",
        category: "validation",
        status: 404,
      });
    }
    const event = await db.sessionEvent.create({
      data: {
        sessionId: input.sessionId,
        eventType: input.eventType,
        payload: input.payload as object,
        timestamp: input.timestamp ? new Date(input.timestamp) : new Date(),
      },
    });
    return { id: event.id, accepted: true };
  },
};
