/**
 * Server-side resolution of the deployment's public URLs.
 *
 * SERVER ONLY — reads `process.env`. Import from server components and route
 * handlers; never from a `"use client"` module (the value would be inlined as
 * `undefined` at build time, which is exactly the #293 failure).
 *
 * Any surface that renders a copy-pasteable config snippet must resolve its
 * URLs through here rather than guessing from `window.location`. Behind the
 * canonical Caddy topology the MCP server is its own vhost on :443
 * (deploy/Caddyfile), so a `${hostname}:3100` guess points at a closed port.
 *
 * Callers must also set `export const dynamic = "force-dynamic"`: the Docker
 * image is built with dummy env, so a pre-rendered page would freeze an empty
 * hostname at build time (#293 round 2).
 */

export function resolvePublicMcpUrl(): string | undefined {
  const host = process.env.BRAIN_MCP_PUBLIC_HOSTNAME?.trim();
  if (!host) return undefined;
  return `https://${host}/mcp`;
}

export function resolvePublicWebUrl(): string | undefined {
  const host = process.env.BRAIN_PUBLIC_HOSTNAME?.trim();
  if (!host) return undefined;
  return `https://${host}`;
}
