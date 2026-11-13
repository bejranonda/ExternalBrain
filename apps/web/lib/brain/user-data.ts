/**
 * A user's data, out and back in (docs/SUNSET.md, PRIVACY §5).
 *
 * `buildUserDataBundle` is the full GDPR bundle — the operator's
 * `/api/admin/gdpr/export/[userId]` and the user's own `/api/me/export` serve
 * the same document, so what a user downloads is exactly what the operator
 * would hand them on request.
 *
 * `importUserData` reads that bundle back into another instance. Only
 * knowledge crosses over: sessions, tokens and ledgers describe the old
 * instance and mean nothing on a new one. Before this existed, telling users
 * "run your own Brain" when a hosted instance closed was hollow — their rules
 * had no way in.
 */
import { z } from "zod";
import { db, type Prisma } from "@brain/db";
import { ensureDefaultProject, ensureNamedProject, ensurePersonalOrg, normalizeProjectName } from "@brain/core";

export const EXPORT_FORMAT = "external-brain-export";
export const EXPORT_VERSION = 1;

export async function buildUserDataBundle(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  const [
    knowledge,
    sessions,
    sessionEvents,
    skills,
    peerCards,
    autoskillProposals,
    feedback,
    mcpTokens,
    costLedger,
    sessionKnowledgeApplications,
  ] = await Promise.all([
    db.knowledge.findMany({
      where: { ownerUserId: userId },
      // No embedding: a vector derived from the text, not independently
      // personal, and it would dominate the file.
      select: {
        id: true, type: true, scope: true, ownerUserId: true, ownerProjectId: true,
        triggerText: true, ruleText: true, rationale: true, instead: true,
        tags: true, confidence: true, successCount: true,
        failureCount: true, usageCount: true, decayScore: true,
        framework: true, language: true, visibility: true, createdAt: true,
        confirmedAt: true, lastUsedAt: true, deletedAt: true,
        parentKnowledgeId: true, extractedBy: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    db.session.findMany({ where: { userId } }),
    db.sessionEvent.findMany({ where: { session: { userId } } }),
    db.skill.findMany({ where: { ownerUserId: userId } }),
    db.peerCard.findMany({ where: { ownerUserId: userId } }),
    db.autoskillProposal.findMany({ where: { userId } }),
    db.feedback.findMany({ where: { userId } }),
    db.mCPToken.findMany({
      where: { userId },
      // No tokenHash: a one-way hash of a credential holds no personal data
      // and would hand out a brute-force target.
      select: {
        id: true, name: true, scope: true, teamId: true,
        createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true,
      },
    }),
    db.oracleCostLedger.findMany({ where: { userId } }),
    db.sessionKnowledgeApplication.findMany({ where: { session: { userId } } }),
  ]);

  const projectIds = [...new Set(knowledge.map((k) => k.ownerProjectId).filter((id): id is string => !!id))];
  const projects = projectIds.length
    ? await db.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } })
    : [];

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    source: process.env.BRAIN_PUBLIC_HOSTNAME?.trim() || null,
    user,
    projects,
    knowledge,
    sessions,
    sessionEvents,
    skills,
    peerCards,
    autoskillProposals,
    feedback,
    mcpTokens,
    costLedger,
    sessionKnowledgeApplications,
  };
}

export type UserDataBundle = NonNullable<Awaited<ReturnType<typeof buildUserDataBundle>>>;

/**
 * The live rules as Markdown, grouped by project — for pasting into
 * CLAUDE.md / AGENTS.md. Retired rows are left out; they are in the JSON.
 */
export function renderKnowledgeMarkdown(bundle: UserDataBundle): string {
  const live = bundle.knowledge.filter((k) => k.deletedAt === null);
  const projectName = new Map(bundle.projects.map((p) => [p.id, p.name]));
  const groups = new Map<string, typeof live>();
  for (const k of live) {
    const name = (k.ownerProjectId && projectName.get(k.ownerProjectId)) || "Personal";
    groups.set(name, [...(groups.get(name) ?? []), k]);
  }
  const indent = (s: string) => s.trim().replace(/\n/g, "\n    ");
  const lines = [
    "# External Brain — knowledge export",
    "",
    `Exported ${bundle.exportedAt.slice(0, 10)}${bundle.source ? ` from ${bundle.source}` : ""} for ${bundle.user.email} — ${live.length} rules.`,
    "",
    "Paste what you want to keep into CLAUDE.md or AGENTS.md. To move the rules into another",
    "External Brain, download the JSON export instead and use Settings → Your data → Import there.",
  ];
  for (const [name, rows] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push("", `## ${name}`, "");
    for (const k of [...rows].sort((a, b) => b.confidence - a.confidence)) {
      const verb = k.type === "anti_principle" ? "Avoid" : "When";
      lines.push(`- **${verb}** ${indent(k.triggerText)}: ${indent(k.ruleText)}`);
      if (k.rationale) lines.push(`  - Why: ${indent(k.rationale)}`);
      if (k.instead) lines.push(`  - Instead: ${indent(k.instead)}`);
      lines.push(`  - _${k.type} · confidence ${k.confidence.toFixed(2)}${k.tags.length ? ` · ${k.tags.join(", ")}` : ""}_`);
    }
  }
  return lines.join("\n") + "\n";
}

const IMPORTABLE_TYPES = new Set(["reflex", "recipe", "heuristic", "principle", "anti_principle"]);
export const MAX_IMPORT_ROWS = 10_000;
export const MAX_IMPORT_PROJECTS = 50;
const MAX_COUNT = 1_000_000;
const MAX_TEXT = 20_000;

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = z.string().max(MAX_TEXT).nullish();

const importSchema = z.object({
  format: z.literal(EXPORT_FORMAT).optional(),
  projects: z.array(z.object({ id: z.string(), name: z.string().trim().min(1).max(120) })).default([]),
  knowledge: z
    .array(
      z.object({
        type: z.string(),
        scope: z.string().optional(),
        ownerProjectId: z.string().nullish(),
        triggerText: text(MAX_TEXT),
        ruleText: text(MAX_TEXT),
        rationale: optText,
        instead: optText,
        framework: z.string().max(80).nullish(),
        language: z.string().max(80).nullish(),
        tags: z.array(z.string().max(120)).max(50).default([]),
        confidence: z.number().finite().optional(),
        successCount: z.number().int().nonnegative().max(MAX_COUNT).optional(),
        failureCount: z.number().int().nonnegative().max(MAX_COUNT).optional(),
        deletedAt: z.union([z.string(), z.null()]).optional(),
      }).passthrough(),
    )
    .max(MAX_IMPORT_ROWS),
});

export type ImportOutcome =
  | { ok: true; imported: number; duplicates: number; skipped: number; projects: string[] }
  | { ok: false; error: "invalid_export" | "import_too_many_projects" };

// A project's identity for matching. normalizeProjectName is "" for an
// all-punctuation name; fall back to the trimmed lowercase name rather than
// letting every such name collide.
const projectKey = (name: string) => normalizeProjectName(name) || name.trim().toLowerCase();

export async function importUserData(userId: string, input: unknown): Promise<ImportOutcome> {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_export" };
  const { projects, knowledge } = parsed.data;
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));

  // Bounded before anything is written: each new project is a create plus a
  // slug probe, and a crafted file could otherwise name ten thousand.
  const wanted = new Set<string>();
  for (const k of knowledge) {
    const n = k.ownerProjectId ? nameOf.get(k.ownerProjectId) : undefined;
    if (n && !k.deletedAt && IMPORTABLE_TYPES.has(k.type)) wanted.add(projectKey(n));
  }
  if (wanted.size > MAX_IMPORT_PROJECTS) return { ok: false, error: "import_too_many_projects" };

  // The personal org's projects, read once and matched by key.
  const { orgId } = await ensurePersonalOrg(db, userId);
  const own = await db.project.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } });
  const byKey = new Map(own.map((p) => [projectKey(p.name), p.id]));
  const usedNames = new Map<string, string>();
  const display = new Set<string>();
  const resolveProject = async (name: string | undefined): Promise<string> => {
    display.add(name ?? "Default");
    const key = name ? projectKey(name) : "";
    const hit = byKey.get(key) ?? usedNames.get(key);
    if (hit) {
      usedNames.set(key, hit);
      return hit;
    }
    const id = name
      ? (await ensureNamedProject(db, userId, name)).projectId
      : (await ensureDefaultProject(db, userId)).projectId;
    byKey.set(key, id);
    usedNames.set(key, id);
    return id;
  };

  // A rule the account already holds is a duplicate wherever it is filed — so
  // re-importing a file adds nothing even when a project name does not match
  // (an org project's rule re-imported into the personal org, say).
  const existing = await db.knowledge.findMany({
    where: { ownerUserId: userId, deletedAt: null },
    select: { triggerText: true, ruleText: true },
  });
  const seen = new Set(existing.map((k) => `${k.triggerText.trim()}\u0000${k.ruleText.trim()}`));

  let duplicates = 0;
  let skipped = 0;
  const rows: Prisma.KnowledgeCreateManyInput[] = [];
  for (const k of knowledge) {
    if (k.deletedAt || !IMPORTABLE_TYPES.has(k.type)) {
      skipped++;
      continue;
    }
    const projectId = await resolveProject((k.ownerProjectId && nameOf.get(k.ownerProjectId)) || undefined);
    const key = `${k.triggerText}\u0000${k.ruleText}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    rows.push({
      type: k.type,
      scope: k.scope === "project" ? "project" : "user",
      ownerUserId: userId,
      ownerProjectId: projectId,
      triggerText: k.triggerText,
      ruleText: k.ruleText,
      rationale: k.rationale ?? null,
      instead: k.instead ?? null,
      framework: k.framework ?? null,
      language: k.language ?? null,
      tags: [...new Set([...k.tags, "imported"])],
      confidence: Math.min(1, Math.max(0, k.confidence ?? 0.7)),
      // Outcome counts are the rule's evidence (KNOWLEDGE.md invariants 6
      // and 12) and travel with it.
      successCount: k.successCount ?? 0,
      failureCount: k.failureCount ?? 0,
      // Embeddings are left NULL for the worker's backfill to fill in: the
      // source instance may have used a different model or dimension.
      extractedBy: "imported",
      sourceSessionIds: [],
    });
  }

  // All or nothing: a failure part-way must not leave half a file imported.
  await db.$transaction(
    Array.from({ length: Math.ceil(rows.length / 500) }, (_, i) =>
      db.knowledge.createMany({ data: rows.slice(i * 500, i * 500 + 500) }),
    ),
  );
  return {
    ok: true,
    imported: rows.length,
    duplicates,
    skipped,
    projects: [...display],
  };
}
