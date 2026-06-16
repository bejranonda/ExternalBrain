/**
 * Formatters — turn a KnowledgeBundle into strings for different consumers.
 *
 * Design note: the MCP client decides *where* to inject — user message,
 * system prompt, tool result. Our job is to produce content that reads well
 * in any of those positions. Hermes prefers injection as a user message to
 * preserve Anthropic prefix caching; we support that by keeping the output
 * self-contained.
 */
import type { Knowledge, KnowledgeBundle } from "@brain/types";
import { DECISION_TAG } from "./learnings.js";

const isDecision = (k: Knowledge): boolean => k.tags?.includes(DECISION_TAG) ?? false;

export function formatForInjection(bundle: KnowledgeBundle): string {
  const parts: string[] = ["## What I've Learned About You"];

  // Decisions lead — settled project choices a teammate should treat as given
  // (spec 2026-06-16). They live as principle/anti_principle rows carrying the
  // decision tag, so pull them out of those buckets and render them distinctly.
  const decisions = [...bundle.principles, ...bundle.antiPrinciples].filter(isDecision);
  if (decisions.length) {
    parts.push(
      "",
      "## Decisions in this project",
      "_Settled choices — treat as given, don't re-litigate._",
    );
    for (const d of decisions) {
      parts.push(
        `- ${d.ruleText}${d.instead ? ` (not ${d.instead})` : ""}${d.rationale ? ` — ${d.rationale}` : ""}`,
      );
    }
  }

  if (bundle.reflexes.length) {
    parts.push("", "### Unconditional Rules (always apply)");
    for (const r of bundle.reflexes) parts.push(line("REFLEX", r));
  }
  if (bundle.recipes.length) {
    parts.push("", "### Recipes You've Used Successfully");
    for (const r of bundle.recipes) parts.push(line("RECIPE", r));
  }
  if (bundle.heuristics.length) {
    parts.push("", "### Your Preferred Approaches");
    for (const r of bundle.heuristics) parts.push(line("HEURISTIC", r));
  }
  const antiNonDecision = bundle.antiPrinciples.filter((r) => !isDecision(r));
  if (antiNonDecision.length) {
    parts.push("", "### Things You've Asked Me To Avoid");
    for (const r of antiNonDecision)
      parts.push(
        `- [ANTI-PRINCIPLE] ${r.ruleText}${r.instead ? ` — use ${r.instead} instead.` : ""} (corrected ${r.failureCount}×)`,
      );
  }
  const principlesNonDecision = bundle.principles.filter((r) => !isDecision(r));
  if (principlesNonDecision.length) {
    parts.push("", "### Your Coding Principles");
    for (const r of principlesNonDecision) parts.push(`- ${r.ruleText}`);
  }
  if (bundle.skill) {
    parts.push("", `### A Skill That Might Apply`, bundle.skill.content);
  }

  return parts.join("\n");
}

function line(label: string, k: Knowledge): string {
  const rate =
    k.successCount + k.failureCount > 0
      ? ` (${Math.round(
          (k.successCount / (k.successCount + k.failureCount)) * 100,
        )}% success)`
      : ` (confidence ${k.confidence.toFixed(2)})`;
  return `- [${label}] ${k.ruleText}${rate}`;
}
