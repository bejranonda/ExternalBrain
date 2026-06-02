/**
 * Graph engine — Obsidian-style linking between skills and knowledge.
 *
 * Primary operations:
 *   - resolveWikilinks(text, scope) → Map<"[[name]]", resolvedId | null>
 *   - backlinks(targetId) → incoming edges
 *   - dependents(sourceId) → outgoing edges
 *   - orphans(scope) → skills with no incoming edges
 *   - deadends(scope) → skills with no outgoing edges
 *
 * Edges are materialized in `GraphEdge` on every skill/knowledge write.
 * Unresolved wikilinks are tracked so the UI can surface "skills to create".
 */
import type { GraphEdge, GraphRelation, KnowledgeScope } from "@brain/types";
import { db } from "@brain/db";

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export interface WikilinkResolution {
  raw: string;
  name: string;
  alias?: string | undefined;
  resolvedId: string | null; // null = unresolved (skill to create)
}

export async function resolveWikilinks(
  text: string,
  scope: { userId?: string | undefined; teamId?: string | undefined },
): Promise<WikilinkResolution[]> {
  const out: WikilinkResolution[] = [];
  const matches = [...text.matchAll(WIKILINK_RE)];
  if (matches.length === 0) return out;

  const names = [...new Set(matches.map((m) => m[1]!.trim()))];
  const skills = await db.skill.findMany({
    where: {
      OR: [
        { skillId: { in: names } },
        { title: { in: names, mode: "insensitive" } },
      ],
      ...(scope.userId ? { ownerUserId: scope.userId } : {}),
      ...(scope.teamId ? { ownerTeamId: scope.teamId } : {}),
    },
    select: { id: true, skillId: true, title: true },
  });

  const lookup = new Map<string, string>();
  for (const s of skills) {
    lookup.set(s.skillId.toLowerCase(), s.id);
    lookup.set(s.title.toLowerCase(), s.id);
  }

  for (const m of matches) {
    const name = m[1]!.trim();
    out.push({
      raw: m[0]!,
      name,
      alias: m[2]?.trim(),
      resolvedId: lookup.get(name.toLowerCase()) ?? null,
    });
  }
  return out;
}

// ============================================================
// Edge materialization on skill write
// ============================================================

export async function rebuildEdgesForSkill(skillId: string): Promise<void> {
  const skill = await db.skill.findUniqueOrThrow({ where: { id: skillId } });
  // Clear old outgoing edges authored by this skill
  await db.graphEdge.deleteMany({ where: { sourceId: skillId } });

  // Wikilinks in content → related_to edges
  const wiki = await resolveWikilinks(skill.content, {
    userId: skill.ownerUserId ?? undefined,
    teamId: skill.ownerTeamId ?? undefined,
  });

  for (const w of wiki) {
    if (!w.resolvedId) continue;
    await db.graphEdge.upsert({
      where: {
        sourceId_targetId_relation: {
          sourceId: skillId,
          targetId: w.resolvedId,
          relation: "related_to",
        },
      },
      create: {
        sourceId: skillId,
        targetId: w.resolvedId,
        relation: "related_to",
        scope: skill.scope,
        weight: 0.5,
        createdBy: "graph",
        evidence: [],
      },
      update: {},
    });
  }

  // Explicit dependencies from frontmatter → depends_on
  for (const dep of skill.dependencies) {
    const target = await db.skill.findFirst({
      where: { skillId: dep },
      select: { id: true },
    });
    if (!target) continue;
    await db.graphEdge.upsert({
      where: {
        sourceId_targetId_relation: {
          sourceId: skillId,
          targetId: target.id,
          relation: "depends_on",
        },
      },
      create: {
        sourceId: skillId,
        targetId: target.id,
        relation: "depends_on",
        scope: skill.scope,
        weight: 1.0,
        createdBy: "graph",
        evidence: [],
      },
      update: {},
    });
  }
}

// ============================================================
// Query helpers
// ============================================================

export async function backlinks(
  targetId: string,
  scope?: KnowledgeScope,
): Promise<GraphEdge[]> {
  return (await db.graphEdge.findMany({
    where: { targetId, ...(scope ? { scope } : {}) },
  })) as unknown as GraphEdge[];
}

export async function dependents(sourceId: string): Promise<GraphEdge[]> {
  return (await db.graphEdge.findMany({
    where: { sourceId },
  })) as unknown as GraphEdge[];
}

export async function orphans(ownerUserId: string): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(`
    SELECT s.id FROM "Skill" s
    LEFT JOIN "GraphEdge" e ON e."targetId" = s.id
    WHERE s."ownerUserId" = $1
      AND e.id IS NULL
  `, ownerUserId);
  return rows.map((r) => r.id);
}

export async function deadends(ownerUserId: string): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(`
    SELECT s.id FROM "Skill" s
    LEFT JOIN "GraphEdge" e ON e."sourceId" = s.id
    WHERE s."ownerUserId" = $1
      AND e.id IS NULL
  `, ownerUserId);
  return rows.map((r) => r.id);
}

export async function addEdge(
  sourceId: string,
  targetId: string,
  relation: GraphRelation,
  opts: {
    scope: KnowledgeScope;
    createdBy: string;
    weight?: number;
    evidence?: string[];
  },
): Promise<void> {
  await db.graphEdge.upsert({
    where: {
      sourceId_targetId_relation: { sourceId, targetId, relation },
    },
    create: {
      sourceId,
      targetId,
      relation,
      scope: opts.scope,
      weight: opts.weight ?? 1.0,
      createdBy: opts.createdBy,
      evidence: opts.evidence ?? [],
    },
    update: {
      weight: opts.weight ?? 1.0,
      evidence: opts.evidence ?? [],
    },
  });
}
