import { TokensClient } from "./tokens-client";
import { resolvePublicMcpUrl, resolvePublicWebUrl } from "@/lib/brain/public-urls";

// Force SSR at request time. The Dockerfile builds with dummy env vars, so a
// pre-rendered page would bake in an empty BRAIN_*_PUBLIC_HOSTNAME and the
// server-injected URLs would never reach the client. Same reason /welcome is
// force-dynamic — #293 round 2.
export const dynamic = "force-dynamic";

// The install snippets shown after creating a token must point at the real
// TLS-fronted endpoints. The client-side `${origin}:3100` heuristic is only
// correct for local dev: behind Caddy the MCP server is a separate vhost on
// :443, so the guessed URL handed the operator a token wired to a port that
// isn't open. /welcome already resolved this correctly; this page did not.
export default function TokensPage() {
  return <TokensClient mcpUrl={resolvePublicMcpUrl()} webUrl={resolvePublicWebUrl()} />;
}
