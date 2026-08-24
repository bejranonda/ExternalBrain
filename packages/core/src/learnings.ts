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
import { hasLeakedMarkup } from "./text-guards.js";

export const LEARNING_EVENT_TYPE = "learning_captured";
export const MAX_LEARNINGS_PER_SESSION = 5;
/** Agent self-estimates are advisory — never persisted above this. */
export const MAX_SUBMITTED_CONFIDENCE = 0.95;
/** Tag marking a Knowledge row as a user-stated project decision (spec 2026-06-16). */
export const DECISION_TAG = "decision";

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
  /**
   * Items whose text carried leaked tool-call markup (KNOWN_ISSUES §0as).
   * Counted separately from `droppedInvalid` because the remedies differ:
   * an invalid item has the wrong shape, a markup item is a mis-typed tool
   * call whose later parameters were probably swallowed — the agent should
   * re-send it, not shrug.
   */
  droppedMarkup: number;
}

export function validateSubmittedLearnings(raw: unknown[]): ValidatedLearnings {
  const droppedOverflow = Math.max(0, raw.length - MAX_LEARNINGS_PER_SESSION);
  const valid: Learning[] = [];
  let droppedInvalid = 0;
  let droppedMarkup = 0;
  for (const item of raw.slice(0, MAX_LEARNINGS_PER_SESSION)) {
    const parsed = LearningSchema.safeParse(item);
    if (!parsed.success) {
      droppedInvalid++;
      continue;
    }
    // Same door-check as brain_teach_knowledge, same shared predicate. This
    // path persists into Knowledge via KEA refine, so corrupted text here is
    // served back to future agents as fact exactly as a corrupted teach was.
    // Dropped rather than rejected because this module's contract is that a
    // malformed learning must never block the outcome report.
    if (
      hasLeakedMarkup(parsed.data.trigger) ||
      hasLeakedMarkup(parsed.data.rule) ||
      hasLeakedMarkup(parsed.data.rationale)
    ) {
      droppedMarkup++;
      continue;
    }
    valid.push({
      ...parsed.data,
      confidence: Math.min(parsed.data.confidence ?? 0.7, MAX_SUBMITTED_CONFIDENCE),
    });
  }
  return { valid, droppedInvalid, droppedOverflow, droppedMarkup };
}
