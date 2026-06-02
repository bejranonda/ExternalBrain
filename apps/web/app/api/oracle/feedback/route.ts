import { db } from "@brain/db";
import { z } from "zod";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";

const schema = z.object({
  question: z.string(),
  answer: z.string(),
  rating: z.enum(["up", "down"]),
  comment: z.string().optional(),
  // Phase MVP: closing the live feedback loop. The frontend now sends the
  // knowledgeIds cited in the answer so a thumb up/down bumps the
  // effectiveness counters of those exact rules in real time. Without this,
  // the only path that updates successCount/failureCount was
  // brain_report_session_outcome (MCP-driven, end-of-session) — a user
  // clicking "Not useful" on an Oracle answer right now had no effect on
  // the Brain's self-tuning loop.
  citedKnowledgeIds: z.array(z.string()).optional(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const body = schema.parse(await req.json());
    await db.feedback.create({
      data: {
        userId,
        rating: body.rating,
        feedbackType: "oracle",
        comment: body.comment ?? `Q: ${body.question}\nA: ${body.answer.slice(0, 400)}`,
      },
    });

    // Bump effectiveness counters on the cited rules. Best-effort: log if it
    // fails but don't surface the error to the user — feedback was recorded.
    if (body.citedKnowledgeIds && body.citedKnowledgeIds.length > 0) {
      const field = body.rating === "up" ? "successCount" : "failureCount";
      try {
        await db.knowledge.updateMany({
          where: { id: { in: body.citedKnowledgeIds }, ownerUserId: userId },
          data: { [field]: { increment: 1 } },
        });
      } catch {
        // intentional: feedback row is the source of truth; counters are
        // best-effort. The decay job re-derives effectiveness from counters.
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    return authErrorResponse(err);
  }
}
