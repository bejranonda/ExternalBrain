/**
 * Stateless meeting-transcript extraction (spec 2026-07-13). Pure
 * prompt-build / response-parse core, mirroring kea.ts's runLLM/parseFindings
 * pattern — the LLM call itself goes through the shared callLLMText seam so
 * this stays unit-testable without a provider key (GUIDELINES §4, "Testing
 * LLM-backed units").
 *
 * Deliberately does NOT write to the database. The caller (the
 * /api/meetings/extract route) owns turning confirmed items into Knowledge
 * rows via the existing teach path — this module only extracts + parses.
 */
import { callLLMText, type LLMDeps } from "./llm.js";

export interface ExtractedDecision {
  triggerText: string;
  ruleText: string;
  rationale: string;
  instead: string;
}

export interface ExtractedActionItem {
  triggerText: string;
  ruleText: string;
  assigneeGuessEmail: string | null;
  blocker: boolean;
  kind: "action-item" | "open-question";
}

export interface ExtractedMeeting {
  decisions: ExtractedDecision[];
  actionItems: ExtractedActionItem[];
}

const SYSTEM_PROMPT = `You are extracting structured content from a meeting transcript for a team knowledge base.

Extract two kinds of things:
1. DECISIONS — settled choices the team made ("we'll use X", "not Y").
2. ACTION ITEMS and OPEN QUESTIONS — concrete to-dos with an owner, or
   unresolved questions raised in the meeting.

Do NOT invent content. If the transcript has no decisions, return an empty
decisions array. If it has no action items or open questions, return an
empty actionItems array. Only extract what is actually stated.

Respond with ONLY a JSON object, no prose, no markdown fences:
{
  "decisions": [
    { "trigger": "when this decision applies", "rule": "the decision as stated", "rationale": "why, as argued in the meeting", "instead": "the rejected alternative, if any, else empty string" }
  ],
  "actionItems": [
    { "trigger": "context or deadline", "rule": "the task or question, imperative", "assigneeGuessEmail": "best-guess email if the transcript states one, else null", "blocker": true or false, "kind": "action-item" or "open-question" }
  ]
}`;

export function buildExtractionPrompt(transcript: string): string {
  return `MEETING TRANSCRIPT:\n${transcript}\n\nExtract now.`;
}

// CodeRabbit finding (valid, fixed here): the original predicates only
// checked trigger/rule, while their TYPE claimed rationale/instead/
// assigneeGuessEmail/blocker/kind were validated too — a malformed LLM
// response (e.g. assigneeGuessEmail: 123) would pass isValidActionItem,
// then `.toLowerCase()` on that number inside the webapp's teachActionItem
// (Task 8) would throw. Every optional field's runtime type is now checked
// before the predicate returns true, matching what the type signature claims.
function isValidDecision(d: unknown): d is { trigger: string; rule: string; rationale?: string; instead?: string } {
  if (typeof d !== "object" || d === null) return false;
  const r = d as Record<string, unknown>;
  if (typeof r["trigger"] !== "string" || typeof r["rule"] !== "string") return false;
  if (r["rationale"] !== undefined && typeof r["rationale"] !== "string") return false;
  if (r["instead"] !== undefined && typeof r["instead"] !== "string") return false;
  return true;
}

function isValidActionItem(
  a: unknown,
): a is { trigger: string; rule: string; assigneeGuessEmail?: string | null; blocker?: boolean; kind?: string } {
  if (typeof a !== "object" || a === null) return false;
  const r = a as Record<string, unknown>;
  if (typeof r["trigger"] !== "string" || typeof r["rule"] !== "string") return false;
  if (r["assigneeGuessEmail"] !== undefined && r["assigneeGuessEmail"] !== null && typeof r["assigneeGuessEmail"] !== "string") return false;
  if (r["blocker"] !== undefined && typeof r["blocker"] !== "boolean") return false;
  if (r["kind"] !== undefined && typeof r["kind"] !== "string") return false;
  return true;
}

export function parseExtractionResponse(raw: string): ExtractedMeeting {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const parsed: unknown = JSON.parse(cleaned);
    if (typeof parsed !== "object" || parsed === null) return { decisions: [], actionItems: [] };
    const p = parsed as Record<string, unknown>;

    const decisions: ExtractedDecision[] = Array.isArray(p["decisions"])
      ? p["decisions"]
          .filter(isValidDecision)
          .map((d) => ({
            triggerText: d.trigger,
            ruleText: d.rule,
            rationale: d.rationale ?? "",
            instead: d.instead ?? "",
          }))
      : [];

    const actionItems: ExtractedActionItem[] = Array.isArray(p["actionItems"])
      ? p["actionItems"]
          .filter(isValidActionItem)
          .map((a) => ({
            triggerText: a.trigger,
            ruleText: a.rule,
            assigneeGuessEmail: a.assigneeGuessEmail ?? null,
            blocker: a.blocker === true,
            kind: a.kind === "open-question" ? "open-question" : "action-item",
          }))
      : [];

    return { decisions, actionItems };
  } catch {
    return { decisions: [], actionItems: [] };
  }
}

export async function extractMeeting(
  transcript: string,
  model: string,
  deps?: LLMDeps,
): Promise<ExtractedMeeting> {
  const userPrompt = buildExtractionPrompt(transcript);
  const text = await callLLMText(
    userPrompt,
    { model, systemPrompt: SYSTEM_PROMPT, maxTokens: 2048 },
    deps as LLMDeps, // callLLMText's default param covers the production (deps=undefined) call site
  );
  return parseExtractionResponse(text);
}
