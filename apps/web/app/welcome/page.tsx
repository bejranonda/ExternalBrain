import { WelcomeFlow } from "@/components/brain/welcome-flow";
import { LocalePicker } from "@/components/brain/locale-picker";

export const metadata = {
  title: "Welcome — External Brain",
  description:
    "First-run guided tour: connect an AI tool to Brain in three steps.",
};

// Force SSR at request time. The Dockerfile builds with dummy env vars
// (see deploy/Dockerfile — "Dummy env so env validation at top-level
// doesn't crash the build"), so any page that reads BRAIN_*_PUBLIC_HOSTNAME
// would otherwise be pre-rendered with an empty value and the
// server-injected URLs would never reach the client. #293 round 2.
export const dynamic = "force-dynamic";

// Resolve the public URLs server-side from the deploy env so the JSON
// snippets shown to Cursor/Windsurf/Other users point at the real
// TLS-fronted endpoints (e.g. https://mcp.brain.example.com/mcp), not
// at `${host}:3100` which is the internal host port behind nginx.
// Falls back to undefined for local dev (welcome-flow then uses the
// client-side `${origin}:3100` heuristic). Closes #293.
function resolvePublicMcpUrl(): string | undefined {
  const host = process.env.BRAIN_MCP_PUBLIC_HOSTNAME?.trim();
  if (!host) return undefined;
  return `https://${host}/mcp`;
}

function resolvePublicWebUrl(): string | undefined {
  const host = process.env.BRAIN_PUBLIC_HOSTNAME?.trim();
  if (!host) return undefined;
  return `https://${host}`;
}

export default function WelcomePage() {
  return (
    <>
      <LocalePicker />
      <WelcomeFlow
        mcpUrl={resolvePublicMcpUrl()}
        webUrl={resolvePublicWebUrl()}
      />
    </>
  );
}
