/**
 * GET /api/me/export?format=json|md — the signed-in user's own data.
 *
 * `json` is the full bundle the operator's GDPR export produces (and what
 * `/api/me/import` reads on another instance); `md` is the live rules as
 * Markdown for CLAUDE.md / AGENTS.md. Before this, a user could only get their
 * data by asking the operator — which a closing instance cannot promise to
 * answer for long (docs/SUNSET.md).
 */
import { rateLimitCheck, writeAudit } from "@brain/core";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { auditIpFrom } from "@/lib/brain/client-ip";
import { getRateLimitStore } from "@/lib/brain/rate-limit-store";
import { buildUserDataBundle, renderKnowledgeMarkdown } from "@/lib/brain/user-data";

export const dynamic = "force-dynamic";

const LIMIT = { name: "me_export", max: 20, windowMs: 60 * 60 * 1000 };

export async function GET(req: Request): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const format = new URL(req.url).searchParams.get("format") === "md" ? "md" : "json";

    const gate = await rateLimitCheck(await getRateLimitStore(), `me_export:${userId}`, LIMIT, Date.now());
    if (!gate.ok) return Response.json({ error: "rate_limited" }, { status: 429 });

    const bundle = await buildUserDataBundle(userId);
    if (!bundle) return Response.json({ error: "not_found" }, { status: 404 });

    void writeAudit({
      actorUserId: userId,
      action: "user.data_export",
      targetType: "user",
      targetId: userId,
      payload: { format },
      ip: auditIpFrom(req.headers),
      userAgent: req.headers.get("user-agent") ?? null,
    });

    const stamp = bundle.exportedAt.slice(0, 10);
    const headers = {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="external-brain-${stamp}.${format}"`,
    };
    if (format === "md") {
      return new Response(renderKnowledgeMarkdown(bundle), {
        headers: { ...headers, "content-type": "text/markdown; charset=utf-8" },
      });
    }
    return new Response(JSON.stringify(bundle, null, 2), {
      headers: { ...headers, "content-type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
