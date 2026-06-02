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

export function formatForInjection(bundle: KnowledgeBundle): string {
  const parts: string[] = ["## What I've Learned About You"];

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
  if (bundle.antiPrinciples.length) {
    parts.push("", "### Things You've Asked Me To Avoid");
    for (const r of bundle.antiPrinciples)
      parts.push(
        `- [ANTI-PRINCIPLE] ${r.ruleText}${r.instead ? ` — use ${r.instead} instead.` : ""} (corrected ${r.failureCount}×)`,
      );
  }
  if (bundle.principles.length) {
    parts.push("", "### Your Coding Principles");
    for (const r of bundle.principles) parts.push(`- ${r.ruleText}`);
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
