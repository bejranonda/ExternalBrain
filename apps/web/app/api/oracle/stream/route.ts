import {
  oracle,
  getAccessibleProjectIds,
  bulkBumpKnowledgeUsage,
  getLogger,
  encodeOracleEvent,
  encodeOracleCapError,
  encodeGenericError,
  ORACLE_SSE_DONE_FRAME,
} from "@brain/core";
import { OracleCapExceededError } from "@brain/core/oracle";
import { z } from "zod";
import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";
import type { DataScope } from "@brain/core";

const log = getLogger("oracle-stream-route");

const schema = z.object({
  question: z.string().min(1),
  reasoningLevel: z
    .enum(["minimal", "low", "medium", "high", "max"])
    .default("medium"),
  conversationId: z.string().optional(),
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // Operator kill-switch (#56 gap 3). Same gate as the unary /api/oracle
  // endpoint. Read at request time so an env change is picked up without
  // a redeploy — `reload.sh` is enough.
  if ((process.env.ORACLE_ENABLED ?? "true").toLowerCase() === "false") {
    return Response.json(
      { error: "oracle_paused", message: "Oracle is currently paused by the operator. Try again later." },
      { status: 503, headers: { "retry-after": "60" } },
    );
  }
  let userId: string;
  try {
    userId = await getCurrentUserId();
  } catch (err) {
    return authErrorResponse(err);
  }

  const url = new URL(req.url);
  const dataScope: DataScope =
    url.searchParams.get("scope") === "all" ? "all" : "project";

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "bad_request" }, { status: 400 });
  }

  let projectId: string;
  let orgId: string;
  let accessibleProjectIds: string[];
  try {
    const active = await getActiveProject(userId);
    projectId = active.projectId;
    orgId = active.orgId;
    accessibleProjectIds = await getAccessibleProjectIds(db, userId, orgId);
  } catch (err) {
    return authErrorResponse(err);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (frame: string) => controller.enqueue(encoder.encode(frame));
      try {
        for await (const ev of oracle.askStream(userId, body, {
          signal: req.signal,
          projectId,
          dataScope,
          visibilityArgs: {
            activeProjectId: projectId,
            activeOrgId: orgId,
            accessibleProjectIds,
          },
        })) {
          write(encodeOracleEvent(ev));
          if (ev.kind === "final") {
            const knowledgeIds = ev.citations
              .map((c) => c.knowledgeId)
              .filter((id): id is string => typeof id === "string" && id.length > 0);
            if (knowledgeIds.length > 0) {
              bulkBumpKnowledgeUsage(db, knowledgeIds).catch((err) => {
                log.warn({ err }, "bulkBumpKnowledgeUsage (stream) failed (best-effort)");
              });
            }
          }
        }
      } catch (err) {
        if (err instanceof OracleCapExceededError) {
          write(
            encodeOracleCapError({
              spentUsd: err.spentUsd,
              capUsd: err.capUsd,
              message: err.message,
            }),
          );
        } else {
          write(encodeGenericError(err instanceof Error ? err.message : "stream_failed"));
        }
      } finally {
        write(ORACLE_SSE_DONE_FRAME);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
