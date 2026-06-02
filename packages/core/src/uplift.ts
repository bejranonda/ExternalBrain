/**
 * Generation Uplift v2 — pure helpers.
 *
 * This module contains all stateless helpers for the uplift benchmark:
 *   - judgePromptBuilder  — builds the anonymised judge prompt
 *   - parseJudgeResponse  — parses the JSON judge output safely
 *   - summarize           — computes mean / median / win-rate from results
 *
 * Kept separate from the script so unit tests can import without touching the
 * Oracle pipeline, the DB, or any LLM.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuestionCategory =
  | "react"
  | "auth"
  | "deploy"
  | "testing"
  | "data"
  | "perf"
  | "other";

export interface JudgeScore {
  scoreA: number;
  scoreB: number;
  rationale: string;
}

export interface ScoredResult {
  id: string;
  category: QuestionCategory;
  question: string;
  expectsBrainContent: boolean;
  /** Score for the with-Brain answer (0-3) */
  withBrainScore: number;
  /** Score for the without-Brain answer (0-3) */
  withoutBrainScore: number;
  /** LLM judge's rationale (1-2 sentences) */
  rationale: string;
  /** Whether A was with-Brain (true) or without-Brain (false) — logged for auditing */
  aWasBrain: boolean;
}

export interface UpliftSummary {
  timestamp: string;
  judgeModel: string;
  oracleModel: string;
  fixtureSize: number;
  inDomainCount: number;
  partialCount: number;
  outOfDomainCount: number;

  // Overall (all questions)
  meanWithBrain: number;
  meanWithoutBrain: number;
  medianWithBrain: number;
  medianWithoutBrain: number;
  winRateWithBrain: number;
  winRateWithoutBrain: number;
  tieRate: number;

  // Per-category breakdown (in-domain only)
  perCategory: Record<
    string,
    { meanWithBrain: number; meanWithoutBrain: number; delta: number; n: number }
  >;

  // Out-of-domain sanity check
  outOfDomainMeanWithBrain: number;
  outOfDomainMeanWithoutBrain: number;
  outOfDomainDelta: number;
}

// ---------------------------------------------------------------------------
// Citation-marker stripper
// ---------------------------------------------------------------------------

/**
 * Strip [^K1], [^S1], [^K12], etc. from an answer before sending to the
 * LLM judge.  These markers would reveal which path had Brain context.
 */
export function stripCitationMarkers(answer: string): string {
  return answer.replace(/\[\^[KS]\d+\]/g, "");
}

// ---------------------------------------------------------------------------
// Judge prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the anonymised prompt sent to the LLM judge.
 *
 * A / B mapping is caller-provided (randomised per question in the script).
 * Citation markers are stripped from both answers.
 */
export function judgePromptBuilder(
  question: string,
  answerA: string,
  answerB: string,
): string {
  const cleanA = stripCitationMarkers(answerA);
  const cleanB = stripCitationMarkers(answerB);
  return `You are a blind grader. Two AI assistants answered the same coding question.
Score each on a 0-3 scale:
  3 = grounded, specific, cites project-specific rules / decisions
  2 = correct but generic
  1 = vague / partially wrong
  0 = wrong or hallucinated

Question: ${question}

Assistant A: ${cleanA}

Assistant B: ${cleanB}

Output STRICT JSON only — no markdown, no commentary:
{"scoreA": <0-3>, "scoreB": <0-3>, "rationale": "<1-2 sentences>"}`;
}

// ---------------------------------------------------------------------------
// Judge response parser
// ---------------------------------------------------------------------------

/**
 * Parse the JSON emitted by the LLM judge.
 *
 * Handles:
 * - Valid `{"scoreA": N, "scoreB": N, "rationale": "..."}` objects.
 * - JSON embedded in markdown fences (```json … ```).
 * - Malformed JSON — returns null.
 * - Out-of-range scores are clamped to [0, 3].
 */
export function parseJudgeResponse(raw: string): JudgeScore | null {
  try {
    // Strip markdown code fences if present
    const cleaned = raw
      .replace(/^```(?:json)?\s*/im, "")
      .replace(/\s*```\s*$/im, "")
      .trim();

    const parsed: unknown = JSON.parse(cleaned);
    if (typeof parsed !== "object" || parsed === null) return null;

    const obj = parsed as Record<string, unknown>;
    const scoreA = Number(obj["scoreA"]);
    const scoreB = Number(obj["scoreB"]);
    const rationale = typeof obj["rationale"] === "string" ? obj["rationale"] : "";

    if (isNaN(scoreA) || isNaN(scoreB)) return null;

    return {
      scoreA: Math.max(0, Math.min(3, Math.round(scoreA))),
      scoreB: Math.max(0, Math.min(3, Math.round(scoreB))),
      rationale,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

// ---------------------------------------------------------------------------
// Summarize
// ---------------------------------------------------------------------------

/**
 * Compute the full uplift summary from a list of scored results.
 *
 * Pure function — no side effects.
 */
export function summarize(
  results: ScoredResult[],
  opts: {
    timestamp: string;
    judgeModel: string;
    oracleModel: string;
    inDomainCount: number;
    partialCount: number;
    outOfDomainCount: number;
  },
): UpliftSummary {
  const withBrainScores = results.map((r) => r.withBrainScore);
  const withoutBrainScores = results.map((r) => r.withoutBrainScore);

  const wins = results.filter((r) => r.withBrainScore > r.withoutBrainScore).length;
  const losses = results.filter((r) => r.withBrainScore < r.withoutBrainScore).length;
  const ties = results.length - wins - losses;

  // Per-category breakdown — in-domain + partial questions
  const inDomainResults = results.filter((r) => r.expectsBrainContent);
  const categories = [...new Set(inDomainResults.map((r) => r.category))];
  const perCategory: UpliftSummary["perCategory"] = {};
  for (const cat of categories) {
    const catResults = inDomainResults.filter((r) => r.category === cat);
    const mWith = mean(catResults.map((r) => r.withBrainScore));
    const mWithout = mean(catResults.map((r) => r.withoutBrainScore));
    perCategory[cat] = {
      meanWithBrain: mWith,
      meanWithoutBrain: mWithout,
      delta: mWith - mWithout,
      n: catResults.length,
    };
  }

  // Out-of-domain sanity
  const oodResults = results.filter((r) => !r.expectsBrainContent);
  const oodWith = mean(oodResults.map((r) => r.withBrainScore));
  const oodWithout = mean(oodResults.map((r) => r.withoutBrainScore));

  return {
    timestamp: opts.timestamp,
    judgeModel: opts.judgeModel,
    oracleModel: opts.oracleModel,
    fixtureSize: results.length,
    inDomainCount: opts.inDomainCount,
    partialCount: opts.partialCount,
    outOfDomainCount: opts.outOfDomainCount,

    meanWithBrain: mean(withBrainScores),
    meanWithoutBrain: mean(withoutBrainScores),
    medianWithBrain: median(withBrainScores),
    medianWithoutBrain: median(withoutBrainScores),
    winRateWithBrain: results.length > 0 ? wins / results.length : 0,
    winRateWithoutBrain: results.length > 0 ? losses / results.length : 0,
    tieRate: results.length > 0 ? ties / results.length : 0,

    perCategory,

    outOfDomainMeanWithBrain: oodWith,
    outOfDomainMeanWithoutBrain: oodWithout,
    outOfDomainDelta: oodWith - oodWithout,
  };
}

// ---------------------------------------------------------------------------
// Format helpers (used by the script for stdout)
// ---------------------------------------------------------------------------

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
function fmt1(n: number): string {
  return n.toFixed(1);
}

export function formatSummaryTable(s: UpliftSummary): string {
  const lines: string[] = [];
  lines.push(`=== Generation Uplift v2 — ${s.timestamp} ===`);
  lines.push(
    `Fixture: ${s.fixtureSize} questions (${s.inDomainCount} in-domain, ${s.partialCount} partial, ${s.outOfDomainCount} out-of-domain)`,
  );
  lines.push(`Judge: ${s.judgeModel}`);
  lines.push(`Model under test: ${s.oracleModel}`);
  lines.push(``);
  lines.push(
    `                          With-Brain    Without-Brain    Δ`,
  );
  lines.push(
    `  Mean score              ${fmt1(s.meanWithBrain).padEnd(14)}${fmt1(s.meanWithoutBrain).padEnd(17)}${fmt1(s.meanWithBrain - s.meanWithoutBrain) > "0" ? "+" : ""}${fmt1(s.meanWithBrain - s.meanWithoutBrain)}`,
  );
  lines.push(
    `  Median                  ${fmt1(s.medianWithBrain).padEnd(14)}${fmt1(s.medianWithoutBrain).padEnd(17)}${s.medianWithBrain - s.medianWithoutBrain >= 0 ? "+" : ""}${fmt1(s.medianWithBrain - s.medianWithoutBrain)}`,
  );
  lines.push(
    `  Win rate                ${pct(s.winRateWithBrain).padEnd(14)}${pct(s.winRateWithoutBrain).padEnd(17)}(${pct(s.tieRate)} tie)`,
  );
  lines.push(``);
  lines.push(`Per category (in-domain + partial):`);

  const catEntries = Object.entries(s.perCategory).sort((a, b) => b[1].delta - a[1].delta);
  for (const [cat, m] of catEntries) {
    const sign = m.delta >= 0 ? "+" : "";
    lines.push(
      `  ${cat.padEnd(12)} ${fmt1(m.meanWithBrain).padEnd(6)} vs  ${fmt1(m.meanWithoutBrain)}   ${sign}${fmt1(m.delta)}  (n=${m.n})`,
    );
  }

  lines.push(``);
  lines.push(`Out-of-domain (sanity check):`);
  const oodDelta = s.outOfDomainDelta;
  const oodSign = oodDelta >= 0 ? "+" : "";
  lines.push(
    `  Mean         ${fmt1(s.outOfDomainMeanWithBrain).padEnd(6)} vs  ${fmt1(s.outOfDomainMeanWithoutBrain)}   ${oodSign}${fmt1(oodDelta)}${Math.abs(oodDelta) > 0.3 ? "  ← WARNING: judge may be biased (threshold > 0.3)" : "  (good)"}`,
  );

  return lines.join("\n");
}
