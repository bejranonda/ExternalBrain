/**
 * Close-capture learnings (spec: docs/superpowers/specs/2026-06-09-close-capture-learnings-design.md).
 *
 * Agents submit distilled (trigger, rule, rationale) learnings at session
 * close via `brain_report_session_outcome.learnings`. This module owns the
 * shape + the per-item validation used by BOTH the MCP tool handler (persist
 * as SessionEvents) and KEA's refine mode. Per-item `safeParse` because a
 * malformed learning must never block the outcome report — the feedback loop
 * always closes.
 */
import { z } from "zod";

export const LEARNING_EVENT_TYPE = "learning_captured";
export const MAX_LEARNINGS_PER_SESSION = 5;
/** Agent self-estimates are advisory — never persisted above this. */
export const MAX_SUBMITTED_CONFIDENCE = 0.95;

// Min-length floors mirror applyQualityFilter in kea.ts (trigger ≥10,
// rule ≥20) so structurally-hopeless items die at the door instead of
// burning a refine-LLM slot.
export const LearningSchema = z.object({
  trigger: z.string().min(10).max(500),
  rule: z.string().min(20).max(2000),
  rationale: z.string().min(1).max(2000),
  type: z.enum(["reflex", "recipe", "heuristic", "principle", "anti_principle"]),
  source: z.enum(["user_correction", "decision", "discovery"]),
  confidence: z.number().min(0).max(1).optional(),
});

export type Learning = z.infer<typeof LearningSchema> & { confidence: number };

export interface ValidatedLearnings {
  valid: Learning[];
  droppedInvalid: number;
  droppedOverflow: number;
}

export function validateSubmittedLearnings(raw: unknown[]): ValidatedLearnings {
  const droppedOverflow = Math.max(0, raw.length - MAX_LEARNINGS_PER_SESSION);
  const valid: Learning[] = [];
  let droppedInvalid = 0;
  for (const item of raw.slice(0, MAX_LEARNINGS_PER_SESSION)) {
    const parsed = LearningSchema.safeParse(item);
    if (!parsed.success) {
      droppedInvalid++;
      continue;
    }
    valid.push({
      ...parsed.data,
      confidence: Math.min(parsed.data.confidence ?? 0.7, MAX_SUBMITTED_CONFIDENCE),
    });
  }
  return { valid, droppedInvalid, droppedOverflow };
}
