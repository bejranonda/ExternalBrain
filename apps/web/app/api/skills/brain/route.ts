/**
 * GET /api/skills/brain.md  →  the Brain SKILL.md, with this deployment's
 *                              MCP/Web URLs substituted in.
 *
 * Public (no auth). The skill content reveals capability names that are
 * already publicly listed in `docs/MCP_TOOLS.md`, so there's nothing more
 * to leak by serving it unauthenticated. Auth on the MCP endpoint itself
 * remains the security boundary.
 *
 * The route file lives at `/api/skills/brain/route.ts`, so the URL is
 * `/api/skills/brain`. Operators may also `curl /api/skills/brain.md` —
 * the trailing `.md` is ignored by Next.js routing here, which is fine.
 *
 * Response: text/markdown. The webapp's mint screen shows a download
 * command pointing at this URL.
 */
import { NextResponse } from "next/server";
import { renderBrainSkill, publicUrlsFromEnv } from "@/lib/brain/skill-template";

export const dynamic = "force-dynamic";

export function GET(): Response {
  const { mcpUrl, webUrl } = publicUrlsFromEnv();
  const body = renderBrainSkill({ mcpUrl, webUrl });
  return new NextResponse(body, {
    status: 200,
    headers: {
      // text/markdown so curl-saving + most editors recognise it. charset
      // is utf-8 — the skill contains "→" / "✓" / "❌" Unicode glyphs.
      "content-type": "text/markdown; charset=utf-8",
      // Cache for an hour: skill content rarely changes, and
      // BRAIN_MCP_PUBLIC_HOSTNAME is a deploy-time variable. Operators
      // who edit it should bounce the web container anyway.
      "cache-control": "public, max-age=3600",
      // Hint to curl/browsers that this is downloadable as a .md file.
      "content-disposition": 'inline; filename="SKILL.md"',
    },
  });
}
