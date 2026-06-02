import { NextResponse } from "next/server";
import { kra, formatter, getAccessibleProjectIds } from "@brain/core";
import { z } from "zod";
import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";
import type { DataScope } from "@brain/core";

const schema = z.object({
  prompt: z.string(),
  context: z
    .object({
      sessionId: z.string().optional(),
      projectId: z.string().optional(),
      framework: z.string().optional(),
      language: z.string().optional(),
      sessionMode: z
        .enum(["building", "debugging", "refactoring", "exploring"])
        .optional(),
    })
    .default({}),
  maxItems: z.number().int().min(1).max(20).default(10),
  scope: z.enum(["project", "all"]).optional(),
});

export async function POST(req: Request) {
  try {
    const userId = await getCurrentUserId();
    const body = schema.parse(await req.json());

    // Resolve scope: body.scope takes priority, then fall back to query param "all"
    const url = new URL(req.url);
    const queryScope = url.searchParams.get("scope");
    const dataScope: DataScope =
      (body.scope ?? (queryScope === "all" ? "all" : "project")) as DataScope;

    // Use the caller's explicit projectId when provided; otherwise resolve the active project.
    const active = await getActiveProject(userId);
    const resolvedProjectId = body.context.projectId ?? active.projectId;
    const orgId = active.orgId;

    // Phase 4: fetch accessible project IDs for org-visibility support
    const accessibleProjectIds = await getAccessibleProjectIds(db, userId, orgId);

    const { bundle, rows } = await kra.retrieveScored(
      body.prompt,
      {
        sessionId: body.context.sessionId ?? "",
        userId,
        projectId: resolvedProjectId,
        framework: body.context.framework,
        language: body.context.language,
        sessionMode: body.context.sessionMode,
        dataScope,
        orgId,
        accessibleProjectIds,
      },
      body.maxItems,
    );
    return NextResponse.json({
      bundle,
      rows,
      injection: formatter.formatForInjection(bundle),
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
