/**
 * GET /api/dashboard/top-rules
 *
 * Returns the top-5 Knowledge rows by effectiveness score, filtered to rows
 * with ≥5 recorded outcomes. Used by the "Most useful rules" dashboard card.
 *
 * Query params:
 *   scope   — "project" (default) | "all"
 *   limit   — max rows to return (default 5)
 *   minOutcomes — min (successCount + failureCount) required (default 5)
 */
import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";
import { getTopRules } from "@brain/core";
import type { TopRuleRow } from "@brain/core";

export interface TopRulesPayload {
  rules: TopRuleRow[];
}

export async function GET(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") === "all" ? "all" : "project";
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "5", 10), 20);
    const minOutcomes = Math.max(parseInt(url.searchParams.get("minOutcomes") ?? "5", 10), 1);

    const { projectId } = await getActiveProject(userId);

    const topRulesOpts: Parameters<typeof getTopRules>[1] = {
      userId,
      limit,
      minOutcomes,
      ...(scope === "project" ? { projectId } : {}),
    };
    const rules = await getTopRules(db, topRulesOpts);

    return Response.json({ rules } satisfies TopRulesPayload);
  } catch (err) {
    return authErrorResponse(err);
  }
}
