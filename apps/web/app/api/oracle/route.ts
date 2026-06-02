import { NextResponse } from "next/server";
import { oracle, getAccessibleProjectIds, bulkBumpKnowledgeUsage } from "@brain/core";
import { OracleCapExceededError } from "@brain/core/oracle";
import { z } from "zod";
import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";
import { getLogger } from "@brain/core";
import type { DataScope } from "@brain/core";

const log = getLogger("oracle-route");

const schema = z.object({
  question: z.string().min(1),
  reasoningLevel: z
    .enum(["minimal", "low", "medium", "high", "max"])
    .default("medium"),
  conversationId: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    // Operator kill-switch (#56 gap 3). Read at request time so an env
    // change is picked up without a redeploy — `reload.sh` is enough.
    if ((process.env.ORACLE_ENABLED ?? "true").toLowerCase() === "false") {
      return NextResponse.json(
        { error: "oracle_paused", message: "Oracle is currently paused by the operator. Try again later." },
        { status: 503, headers: { "retry-after": "60" } },
      );
    }
    const userId = await getCurrentUserId();
    const url = new URL(req.url);
    const dataScope: DataScope =
      url.searchParams.get("scope") === "all" ? "all" : "project";

    const body = schema.parse(await req.json());
    const { projectId, orgId } = await getActiveProject(userId);
    const accessibleProjectIds = await getAccessibleProjectIds(db, userId, orgId);

    const res = await oracle.ask(userId, body, projectId, dataScope, {
      activeProjectId: projectId,
      activeOrgId: orgId,
      accessibleProjectIds,
    });

    // Best-effort: bump usageCount + lastUsedAt for Knowledge rows cited in the answer.
    const knowledgeIds = res.citations
      .map((c) => c.knowledgeId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (knowledgeIds.length > 0) {
      bulkBumpKnowledgeUsage(db, knowledgeIds).catch((err) => {
        log.warn({ err }, "bulkBumpKnowledgeUsage failed (best-effort)");
      });
    }

    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof OracleCapExceededError) {
      return NextResponse.json(
        {
          error: "cost_cap_exceeded",
          spentUsd: err.spentUsd,
          capUsd: err.capUsd,
          hint: "Daily Oracle spend limit reached. Raise MAX_ORACLE_COST_USD_PER_DAY or try again tomorrow.",
        },
        { status: 429 },
      );
    }
    return authErrorResponse(err);
  }
}
