/**
 * V2.0 action items (spec 2026-07-07) — meeting to-dos and open questions
 * stored as Knowledge rows (type "action_item"), addressed via `for:<email>`
 * tags. Deliberately NOT part of semantic retrieval: these are tasks, not
 * rules. Queries are deterministic and project-bounded (assignee ≠ creator,
 * so no ownerUserId filter — the project boundary is the isolation line;
 * callers must have validated project access at the system boundary).
 */
import type { Knowledge } from "@brain/types";
import { db } from "@brain/db";
import { buildKnowledgeWhereV2 } from "./scope-filter.js";

export type ActionItemRow = Pick<
  Knowledge,
  "id" | "ruleText" | "triggerText" | "tags" | "createdAt"
>;

export const ACTION_ITEM_TYPE = "action_item";
const BLOCKER_TAG = "blocker";
const OPEN_QUESTION_TAG = "open-question";

function baseWhere(opts: {
  userId: string;
  projectId: string | null;
  accessibleProjectIds?: string[];
}): object {
  return {
    AND: [
      buildKnowledgeWhereV2({
        userId: opts.userId,
        activeProjectId: opts.projectId,
        activeOrgId: null,
        accessibleProjectIds: opts.accessibleProjectIds ?? [],
        scope: "project",
      }),
      { type: ACTION_ITEM_TYPE },
      // Decay is the abandonment path (spec §3): fully-decayed items are
      // treated as expired, same threshold semantic retrieval uses.
      { decayScore: { gt: 0.3 } },
    ],
  };
}

function blockersFirst(rows: ActionItemRow[]): ActionItemRow[] {
  return [...rows].sort((a, b) => {
    const ab = a.tags.includes(BLOCKER_TAG) ? 0 : 1;
    const bb = b.tags.includes(BLOCKER_TAG) ? 0 : 1;
    if (ab !== bb) return ab - bb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

const SELECT = {
  id: true,
  ruleText: true,
  triggerText: true,
  tags: true,
  createdAt: true,
} as const;

/** Assignee view — items carrying `for:<email>` for the caller. */
export async function listOpenActionItemsFor(opts: {
  userId: string;
  email: string;
  projectId: string | null;
  accessibleProjectIds?: string[];
  limit?: number;
}): Promise<ActionItemRow[]> {
  const rows = await db.knowledge.findMany({
    where: {
      AND: [
        baseWhere(opts),
        { tags: { has: `for:${opts.email.toLowerCase()}` } },
      ],
    },
    select: SELECT,
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 10,
  });
  return blockersFirst(rows);
}

/** Project view — every open item, for the Oracle's deterministic context. */
export async function listProjectActionItems(opts: {
  userId: string;
  projectId: string | null;
  accessibleProjectIds?: string[];
  limit?: number;
}): Promise<ActionItemRow[]> {
  const rows = await db.knowledge.findMany({
    where: baseWhere(opts),
    select: SELECT,
    orderBy: { createdAt: "asc" },
    take: opts.limit ?? 30,
  });
  return blockersFirst(rows);
}

export function formatActionItemsForInjection(items: ActionItemRow[]): string {
  if (items.length === 0) return "";
  const parts = [
    "## Your Open Action Items",
    "_Assigned to you in meetings — resolve done ones via `resolvedActionItemIds` when you close the session._",
  ];
  for (const it of items) {
    const blocker = it.tags.includes(BLOCKER_TAG) ? "[BLOCKER] " : "";
    const question = it.tags.includes(OPEN_QUESTION_TAG)
      ? "[OPEN QUESTION] "
      : "";
    const meeting = it.tags.find((t) => t.startsWith("meeting:"));
    parts.push(
      `- ${blocker}${question}${it.ruleText}${it.triggerText ? ` — ${it.triggerText}` : ""}${meeting ? ` (${meeting})` : ""} [id: ${it.id}]`,
    );
  }
  return parts.join("\n");
}

/**
 * Retire (soft-delete) action items. Reuses `baseWhere`, so only
 * `action_item` rows visible inside the caller's project scope can be
 * retired — never rules, never another project's tasks.
 */
export async function resolveActionItems(opts: {
  ids: string[];
  userId: string;
  projectId: string | null;
  accessibleProjectIds?: string[];
}): Promise<number> {
  if (opts.ids.length === 0) return 0;
  const res = await db.knowledge.updateMany({
    where: {
      AND: [baseWhere(opts), { id: { in: opts.ids } }],
    },
    data: { deletedAt: new Date() },
  });
  return res.count;
}
