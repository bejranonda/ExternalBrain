/**
 * Rules exporter — materialize `Knowledge` rows tagged `rules-export`
 * into the editor-agent rulefile formats the user has configured.
 *
 * Each row carries a `target:<path>` tag written by
 * `autoskill.applyRulesAppend`. This module groups rows by target,
 * maps targets to a file format, and renders the combined content.
 *
 * Outputs can be consumed by:
 *   - `/api/export/rules` → webapp download
 *   - a CLI/worker task that writes to the user's local repo
 *
 * The exporter is deliberately filesystem-free. Callers do the write.
 */
import { db } from "@brain/db";
import { buildKnowledgeWhere } from "./scope-filter.js";
import type { DataScope } from "./scope-filter.js";

export type RulesFormat = "claude" | "cursor" | "windsurf" | "agents" | "markdown";

export interface RulesFile {
  path: string;
  format: RulesFormat;
  content: string;
  sourceIds: string[];
}

export interface RulesBundle {
  generatedAt: string;
  userId: string;
  files: RulesFile[];
}

/** Group an incoming row set by `target:*` tag. Falls back to "AGENTS.md". */
interface Row {
  id: string;
  triggerText: string;
  ruleText: string;
  rationale: string | null;
  confidence: number;
  tags: string[];
  lastUsedAt: Date | null;
  createdAt: Date;
}

const DEFAULT_TARGET = "AGENTS.md";

export function detectTarget(tags: string[]): string {
  const hit = tags.find((t) => t.startsWith("target:"));
  return hit ? hit.slice("target:".length) : DEFAULT_TARGET;
}

export function detectFormat(target: string): RulesFormat {
  const t = target.toLowerCase();
  if (t.includes(".claude/") || t.endsWith("claude.md")) return "claude";
  if (t.includes(".cursor/") || t.endsWith(".cursorrules")) return "cursor";
  if (t.endsWith(".windsurfrules")) return "windsurf";
  if (t.endsWith("agents.md")) return "agents";
  return "markdown";
}

function renderHeader(format: RulesFormat, target: string, count: number): string {
  const banner = `<!-- brain-platform · rules export · ${count} rule${count === 1 ? "" : "s"} · do not edit below this line -->`;
  switch (format) {
    case "claude":
      return `# ${target}\n\n${banner}\n`;
    case "cursor":
      return `# Cursor rules — ${target}\n${banner}\n`;
    case "windsurf":
      return `${banner}\n`;
    case "agents":
      return `# AGENTS.md\n\n${banner}\n`;
    default:
      return `${banner}\n`;
  }
}

function renderRule(r: Row): string {
  const lines: string[] = [];
  lines.push(`- **${r.ruleText.trim()}**`);
  if (r.rationale) lines.push(`  _why:_ ${r.rationale.trim()}`);
  lines.push(
    `  _confidence ${r.confidence.toFixed(2)} · updated ${
      (r.lastUsedAt ?? r.createdAt).toISOString().slice(0, 10)
    }_`,
  );
  return lines.join("\n");
}

export async function buildRulesBundle(
  userId: string,
  projectId?: string,
  dataScope: DataScope = "project",
): Promise<RulesBundle> {
  // #174 — always admit the caller's own `scope: 'user' | 'global'` rows, whichever
  // project taught them. A rules bundle is the agent's configuration, so it has to
  // contain the rules the agent is actually served: kra.ts injects user-scoped rules
  // across projects, and before this the project-scoped default exported a strictly
  // narrower set than the Brain was applying (KNOWN_ISSUES §0p). Not exposed as a
  // parameter — there is no reading of "export my rules" that wants less than you
  // are given. Stays owner-anchored: V1 pins ownerUserId on every branch, which is
  // why this went here rather than migrating to V2 (whose project arm does not).
  const baseWhere = buildKnowledgeWhere(userId, projectId ?? "", dataScope, undefined, true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await db.knowledge.findMany({
    where: {
      ...(baseWhere as object),
      tags: { has: "rules-export" },
    } as any,
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      triggerText: true,
      ruleText: true,
      rationale: true,
      confidence: true,
      tags: true,
      lastUsedAt: true,
      createdAt: true,
    },
  })) as Row[];

  const byTarget = new Map<string, Row[]>();
  for (const r of rows) {
    const target = detectTarget(r.tags);
    const bucket = byTarget.get(target) ?? [];
    bucket.push(r);
    byTarget.set(target, bucket);
  }

  const files: RulesFile[] = [];
  for (const [target, bucket] of byTarget) {
    const format = detectFormat(target);
    const content =
      renderHeader(format, target, bucket.length) +
      "\n" +
      bucket.map(renderRule).join("\n\n") +
      "\n";
    files.push({
      path: target,
      format,
      content,
      sourceIds: bucket.map((r) => r.id),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    userId,
    files,
  };
}

/**
 * Render the bundle as a single manifest string — useful for debugging or
 * CLI consumers that prefer one artifact.
 */
export function renderManifest(bundle: RulesBundle): string {
  const sep = "\n\n" + "=".repeat(72) + "\n";
  return bundle.files
    .map(
      (f) =>
        `### FILE: ${f.path} (${f.format}, ${f.sourceIds.length} rule${
          f.sourceIds.length === 1 ? "" : "s"
        })${sep}${f.content}`,
    )
    .join("\n\n");
}
