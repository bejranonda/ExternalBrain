import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { getActiveProject } from "@/lib/brain/active-project";
import { buildSessionWhere } from "@brain/core";
import type { DataScope } from "@brain/core";

export interface LiveEvent {
  t: number; // ms offset from session start
  type: "extract" | "autoskill" | "event";
  text: string;
  conf?: number;
}

export interface LivePayload {
  session: string | null;
  sessionShort: string;
  client: "claude" | "cursor" | "windsurf" | "mcp";
  events: LiveEvent[];
}

function clientIcon(c: string): LivePayload["client"] {
  if (c === "claude_code") return "claude";
  if (c === "cursor") return "cursor";
  if (c === "windsurf") return "windsurf";
  return "mcp";
}

export async function GET(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const url = new URL(req.url);
    const scope: DataScope = url.searchParams.get("scope") === "all" ? "all" : "project";

    const { projectId } = await getActiveProject(userId);
     
    const sw = buildSessionWhere(userId, projectId, scope) as any;

    const session = await db.session.findFirst({
      where: { ...sw, endedAt: null },
      orderBy: { startedAt: "desc" },
    });

    if (!session) {
      // No live session — return the most recent completed session's tail.
      const recent = await db.session.findFirst({
        where: sw,
        orderBy: { startedAt: "desc" },
      });
      if (!recent) {
        return Response.json({
          session: null,
          sessionShort: "—",
          client: "mcp",
          events: [],
        } satisfies LivePayload);
      }
      const events = await buildEvents(recent.id, recent.startedAt);
      return Response.json({
        session: recent.id,
        sessionShort: `s_${recent.id.slice(-4)}`,
        client: clientIcon(recent.clientType),
        events,
      } satisfies LivePayload);
    }
    const events = await buildEvents(session.id, session.startedAt);
    return Response.json({
      session: session.id,
      sessionShort: `s_${session.id.slice(-4)}`,
      client: clientIcon(session.clientType),
      events,
    } satisfies LivePayload);
  } catch (err) {
    return authErrorResponse(err);
  }
}

async function buildEvents(
  sessionId: string,
  startedAt: Date,
): Promise<LiveEvent[]> {
  const events = await db.sessionEvent.findMany({
    where: { sessionId },
    orderBy: { timestamp: "desc" },
    take: 12,
  });
  type RowShape = (typeof events)[number];
  return events
    .reverse()
    .map((e: RowShape) => {
      const payload = (e.payload ?? {}) as Record<string, unknown>;
      const text =
        pickString(payload, "text") ??
        pickString(payload, "message") ??
        pickString(payload, "rule") ??
        e.eventType;
      const conf = pickNumber(payload, "confidence");
      const type: LiveEvent["type"] =
        e.eventType === "knowledge_extracted"
          ? "extract"
          : e.eventType === "autoskill_proposed"
            ? "autoskill"
            : "event";
      return {
        t: e.timestamp.getTime() - startedAt.getTime(),
        type,
        text,
        ...(conf != null ? { conf } : {}),
      };
    });
}

function pickString(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" ? v : null;
}

function pickNumber(o: Record<string, unknown>, k: string): number | undefined {
  const v = o[k];
  return typeof v === "number" ? v : undefined;
}
