/**
 * Autoskill signal classifier.
 *
 * Replaces the keyword `routeSignal` type-decision (rules | knowledge | ignore)
 * with one batched LLM call, grounded in the user's own resolved proposals +
 * recent knowledge (few-shot). Runs only on signals that already cleared the
 * cheap deterministic filters (score >= 3, no skill match) — the quality filter
 * stays the recall floor upstream.
 *
 * Design: pure cores (parse / verdict→routed / flag-shadow decision / few-shot
 * ranking / prompt build) are unit-tested without DB or network. The two impure
 * edges (selectFewShot, classifySignals) are fail-soft: any error degrades to
 * gold-only few-shot or an empty verdict map, and the caller falls back to the
 * heuristic per signal. A signal is never dropped by a classifier failure.
 *
 * Spec: docs/superpowers/specs/2026-06-24-autoskill-llm-classifier-design.md
 */
import type { KnowledgeType } from "@brain/types";
import { db } from "@brain/db";
import type { ScoredSignal, Routed } from "./autoskill.js";
import { callLLMText } from "./llm.js";
import { getLogger } from "./logger.js";

const log = getLogger("autoskill.classify");

// ============================================================
// Types
// ============================================================

export type ClassifierTarget = "rules" | "knowledge" | "ignore";

export interface Verdict {
  target: ClassifierTarget;
  confidence: "high" | "medium";
  reasoning: string;
}

const TARGETS = new Set<ClassifierTarget>(["rules", "knowledge", "ignore"]);

// ============================================================
// Knowledge-type / trigger inference (moved here from autoskill.ts so the
// runtime import edge is one-directional: autoskill → classifier).
// ============================================================

export function inferKnowledgeType(s: ScoredSignal): KnowledgeType {
  const t = s.snippet.toLowerCase();
  if (/\b(don'?t|never|avoid|stop)\b/.test(t)) return "anti_principle";
  if (/\balways\b/.test(t)) return "reflex";
  if (/\bprefer|over\b/.test(t)) return "principle";
  if (/\bwhen\b.*\b(then|use|prefer)\b/.test(t)) return "heuristic";
  return "recipe";
}

export function deriveTrigger(snippet: string): string {
  const match = snippet.match(/^when\s+(.+?)[,.;]\s*(.+)$/i);
  if (match) return match[1]!.trim();
  return "when working in this project";
}

// ============================================================
// Pure: parse the model response → verdict map keyed by batch index
// ============================================================

export function parseClassifierResponse(
  text: string,
  batchSize: number,
): Map<number, Verdict> {
  const out = new Map<number, Verdict>();
  try {
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(cleaned) as { verdicts?: unknown };
    if (!Array.isArray(parsed.verdicts)) return out;
    for (const raw of parsed.verdicts as unknown[]) {
      if (raw === null || typeof raw !== "object") continue;
      const v = raw as Record<string, unknown>;
      const index = v.index;
      const target = v.target;
      if (typeof index !== "number" || index < 0 || index >= batchSize) continue;
      if (typeof target !== "string" || !TARGETS.has(target as ClassifierTarget)) {
        continue;
      }
      const confidence = v.confidence === "high" ? "high" : "medium";
      const reasoning = typeof v.reasoning === "string" ? v.reasoning : "";
      out.set(index, {
        target: target as ClassifierTarget,
        confidence,
        reasoning,
      });
    }
  } catch {
    return out;
  }
  return out;
}

// ============================================================
// Pure: verdict → Routed (or null for ignore / anything unroutable)
// ============================================================

export function routedFromVerdict(s: ScoredSignal, v: Verdict): Routed | null {
  if (v.target === "rules") {
    return {
      target: "rules",
      diff: `Add to rules export: ${s.snippet}`,
      patch: {
        op: "append",
        file: ".claude/rules/conventions.md",
        text: s.snippet,
        evidence: s.evidence,
      },
      reasoning: `Classifier (${v.confidence}): ${v.reasoning || "project convention"}.`,
    };
  }
  if (v.target === "knowledge") {
    // Widened path: durability is judged by the LLM, so there is no score>=5
    // gate here (the heuristic fallback keeps that gate).
    const type = inferKnowledgeType(s);
    return {
      target: "knowledge",
      diff: `Create new ${type}: ${s.snippet}`,
      patch: {
        op: "create",
        type,
        trigger: deriveTrigger(s.snippet),
        rule: s.snippet,
        rationale: `Auto-extracted by autoskill classifier (${s.kind}, occurrences=${s.occurrences}).`,
        evidence: s.evidence,
      },
      reasoning: `Classifier (${v.confidence}): ${v.reasoning || "durable atomic knowledge"}.`,
    };
  }
  // "ignore" (or any non-routable target) → no proposal.
  return null;
}

// ============================================================
// Pure: flag/shadow decision
// ============================================================

export interface ShadowRecord {
  heuristic: string | null;
  llm: string | null;
  agree: boolean;
}

export function decideTarget(args: {
  flagOn: boolean;
  heuristic: Routed | null;
  verdict: Verdict | undefined;
  signal: ScoredSignal;
}): { routed: Routed | null; shadow: ShadowRecord } {
  const { flagOn, heuristic, verdict, signal } = args;
  const hTarget = heuristic ? heuristic.target : "ignore";
  const lTarget = verdict ? verdict.target : null;
  const shadow: ShadowRecord = {
    heuristic: hTarget,
    llm: lTarget,
    agree: lTarget === hTarget,
  };
  // Flag off, or no verdict to act on → heuristic drives behaviour (fail-soft).
  if (!flagOn || !verdict) return { routed: heuristic, shadow };
  return { routed: routedFromVerdict(signal, verdict), shadow };
}

// ============================================================
// Pure: few-shot gold set + budgeted ranker + prompt builder
// ============================================================

export interface FewShotExample {
  source: "gold" | "user";
  text: string;
  target: ClassifierTarget;
  /** user only; 0 = most recent */
  recencyRank?: number;
}

export const GOLD_EXAMPLES: FewShotExample[] = [
  {
    source: "gold",
    text: "always import shared types from @brain/types, never via relative ../types paths",
    target: "knowledge",
  },
  {
    source: "gold",
    text: "in this project we use the central logger utility instead of console.log",
    target: "rules",
  },
  {
    source: "gold",
    text: "naming convention: hooks live in components/brain and are prefixed use",
    target: "rules",
  },
  {
    source: "gold",
    text: "never narrate what the code does in comments; only document non-obvious why",
    target: "knowledge",
  },
  { source: "gold", text: "be more careful next time", target: "ignore" },
  { source: "gold", text: "good catch, perfect", target: "ignore" },
  {
    source: "gold",
    text: "prefer websearch_to_tsquery over ILIKE for session search ranking",
    target: "knowledge",
  },
];

const APPROX_CHARS_PER_TOKEN = 4;
const tokenCost = (e: FewShotExample) =>
  Math.ceil(e.text.length / APPROX_CHARS_PER_TOKEN) + 6;

export function rankFewShot(
  gold: FewShotExample[],
  user: FewShotExample[],
  tokenBudget: number,
): FewShotExample[] {
  const ranked = [...user].sort(
    (a, b) => (a.recencyRank ?? 0) - (b.recencyRank ?? 0),
  );
  const out = [...gold];
  let spent = 0;
  for (const e of ranked) {
    const c = tokenCost(e);
    if (spent + c > tokenBudget) break;
    spent += c;
    out.push(e);
  }
  return out;
}

const CLASS_DEFS = `You classify each session signal into exactly one target:
- "rules": a project convention / workflow preference destined for a rules file (e.g. naming, imports, "we use X here").
- "knowledge": a durable, atomic, reusable rule the user should keep (a reflex, principle, anti-principle, heuristic, or recipe).
- "ignore": generic encouragement, transient one-offs, or anything too vague to act on. Use ignore RARELY — when in doubt between capturing and discarding, prefer to capture.`;

export function buildClassifierPrompt(
  signals: ScoredSignal[],
  fewShot: FewShotExample[],
): string {
  const examples = fewShot.map((e) => `- (${e.target}) ${e.text}`).join("\n");
  const items = signals
    .map((s, i) => `[${i}] (${s.kind}, score=${s.score}) ${s.snippet}`)
    .join("\n");
  return `${CLASS_DEFS}

EXAMPLES:
${examples}

SIGNALS TO CLASSIFY:
${items}

Respond with JSON: {"verdicts":[{"index":<n>,"target":"rules|knowledge|ignore","confidence":"high|medium","reasoning":"<short>"}]} — exactly one entry per signal index above.`;
}

// ============================================================
// Config (read directly from process.env, matching KEA_MODEL convention)
// ============================================================

const FEWSHOT_BUDGET = () =>
  Number(process.env.AUTOSKILL_FEWSHOT_TOKEN_BUDGET ?? 1500);
const CLASSIFY_MAX = () => Number(process.env.AUTOSKILL_CLASSIFY_MAX ?? 12);
const MODEL = () =>
  process.env.AUTOSKILL_MODEL ?? process.env.KEA_MODEL ?? "qwen3-coder";

export function classifierEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.AUTOSKILL_LLM_CLASSIFIER ?? "");
}

/**
 * Shadow mode: run the classifier and log agreement without acting on it. Opt-in
 * (default off) so a default-off deploy makes ZERO extra LLM calls — cost-neutral,
 * not just behaviour-neutral. Implied on when the classifier itself is enabled.
 */
export function shadowEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.AUTOSKILL_SHADOW ?? "");
}

// ============================================================
// Impure: user-derived few-shot (scope-filtered, fail-soft → [])
// ============================================================

/**
 * Few-shot grounded in the acting user's own decisions: resolved proposals
 * (accept/reject taste) + recent autoskill knowledge (taxonomy). SCOPE
 * INVARIANT: every query filters by the acting userId / ownerUserId. Any error
 * degrades to [] (gold-only).
 */
async function selectFewShot(userId: string): Promise<FewShotExample[]> {
  try {
    const [proposals, knowledge] = await Promise.all([
      db.autoskillProposal.findMany({
        where: {
          userId,
          status: { in: ["applied", "rejected"] },
          target: { in: ["rules", "knowledge"] },
        },
        orderBy: { resolvedAt: "desc" },
        take: 12,
        select: { target: true, diff: true, status: true },
      }),
      db.knowledge.findMany({
        where: { ownerUserId: userId, tags: { has: "autoskill" } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { ruleText: true, scope: true },
      }),
    ]);
    const out: FewShotExample[] = [];
    proposals.forEach((p, i) => {
      // rejected rows teach the ignore boundary; accepted teach the positive class
      const target: ClassifierTarget =
        p.status === "rejected" ? "ignore" : (p.target as ClassifierTarget);
      out.push({
        source: "user",
        text: p.diff.replace(/^[^:]*:\s*/, "").slice(0, 160),
        target,
        recencyRank: i,
      });
    });
    knowledge.forEach((k, i) => {
      out.push({
        source: "user",
        text: k.ruleText.slice(0, 160),
        target: k.scope === "global" ? "rules" : "knowledge",
        recencyRank: proposals.length + i,
      });
    });
    return out;
  } catch (err) {
    log.warn({ err, userId }, "selectFewShot failed — gold-only fallback");
    return [];
  }
}

// ============================================================
// Impure: one batched classification call (fail-soft → empty map)
// ============================================================

export interface ClassifyDeps {
  call?: typeof callLLMText;
}

/**
 * Classify the surviving signals in ONE batched LLM call. Returns a verdict map
 * keyed by batch index. Empty input → no call. Any error → empty map (caller
 * falls back to the heuristic per signal). Over-cap signals are not classified
 * (their indices are simply absent from the map).
 */
export async function classifySignals(
  signals: ScoredSignal[],
  userId: string,
  deps: ClassifyDeps = {},
): Promise<Map<number, Verdict>> {
  if (signals.length === 0) return new Map();
  // Cost gate: make no LLM call unless the classifier is live OR shadow is opted
  // in. Default deploy (both off) → empty map → pure heuristic, zero spend.
  if (!classifierEnabled() && !shadowEnabled()) return new Map();
  const cap = CLASSIFY_MAX();
  const batch = signals.slice(0, cap);
  if (batch.length < signals.length) {
    log.info(
      { dropped: signals.length - batch.length, cap },
      "classify batch over cap — remainder routes via heuristic",
    );
  }
  const call = deps.call ?? callLLMText;
  try {
    const fewShot = rankFewShot(
      GOLD_EXAMPLES,
      await selectFewShot(userId),
      FEWSHOT_BUDGET(),
    );
    const prompt = buildClassifierPrompt(batch, fewShot);
    const text = await call(prompt, { model: MODEL(), maxTokens: 1024 });
    return parseClassifierResponse(text, batch.length);
  } catch (err) {
    log.warn(
      { err, userId },
      "classifySignals failed — heuristic fallback for all signals",
    );
    return new Map();
  }
}
