/**
 * GET /api/onboard/agent.md  →  bootstrap instructions for an AI agent whose
 *                               user holds a voucher code.
 *
 * Public, unauthenticated, and contains no per-user secrets — it is the same
 * document for every visitor. The voucher supplies the authorisation, and it
 * is supplied by the user in their prompt, not by this page.
 *
 * Kept separate from `/api/skills/brain` on purpose. That one teaches Brain
 * usage to an already-connected client; this one is read by an agent with no
 * token, no account, and no Brain skill installed — a strictly pre-auth
 * audience whose only safe instruction set is "call this one endpoint, run
 * what it returns, then stop". See `renderBrainBootstrap` for why that
 * narrowness is a security property and not just brevity.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  renderBrainBootstrap,
  renderBrainBootstrapForToken,
  publicUrlsFromEnv,
} from "@/lib/brain/skill-template";

export const dynamic = "force-dynamic";

/**
 * `?mode=token` serves the sibling doc for a user who already has an
 * account and pasted a minted token into their agent prompt (see
 * /settings/tokens' "Paste a prompt" tab) — skips the voucher-claim step
 * entirely. Default (no param) stays the voucher flow, unchanged.
 */
export function GET(req: NextRequest): Response {
  const { mcpUrl, webUrl } = publicUrlsFromEnv();
  const mode = req.nextUrl.searchParams.get("mode");
  const body =
    mode === "token"
      ? renderBrainBootstrapForToken({ mcpUrl, webUrl })
      : renderBrainBootstrap({ mcpUrl, webUrl });
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "content-disposition": 'inline; filename="brain-bootstrap.md"',
    },
  });
}
