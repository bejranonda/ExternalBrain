# Design: Antigravity + GitHub Copilot in the Brain install wizard

**Date:** 2026-06-18
**Status:** Approved (pending spec review)
**Ships as:** v1.7.0 (minor — new user-facing feature)

## Problem

The token-install wizard (`apps/web/components/brain/token-install-wizard.tsx`) and
`docs/CLIENTS.md` cover Claude Code, Claude Desktop, Cursor, Windsurf, Gemini CLI,
raw-JSON, and REST. Two widely-used MCP clients are missing:

- **Google Antigravity** — Google's agentic IDE.
- **GitHub Copilot** — across all its MCP surfaces (VS Code, Visual Studio /
  JetBrains / Eclipse / Xcode, the `copilot` CLI, and the cloud coding agent).

The Brain exposes a **remote streamable-HTTP MCP endpoint** (`/mcp`) authed by a
static `Authorization: Bearer <token>` header on every method including
`initialize`. Both clients support exactly this transport — so the work is purely
emitting the correct copy-paste config per client, matching the wizard's existing
JSON-snippet pattern. **No new installer script** (only Claude Code has the
bespoke one-liner; neither new client has a universal `mcp add` worth scripting).

## Verified config matrix

Each cell is the on-disk shape the user pastes. `<url>` = the deployed `/mcp`
endpoint; `<token>` = the freshly minted bearer.

| Client / surface | Config file | Top key | URL field | Header location |
|---|---|---|---|---|
| Antigravity | `~/.gemini/antigravity/mcp_config.json` | `mcpServers` | **`serverUrl`** | `headers` |
| Copilot — VS Code | `.vscode/mcp.json` (or user cfg) | `servers` | `url` + `type:"http"` | `headers` |
| Copilot — JetBrains / Visual Studio / Eclipse / Xcode | `mcp.json` | `servers` | `url` | **`requestInit.headers`** |
| Copilot — CLI | `~/.copilot/mcp-config.json` | `mcpServers` | `url` + `type:"http"` | `headers` |
| Copilot — coding agent | repo **Settings UI** (not a file) | `mcpServers` + `tools[]` | `url` | secrets via `COPILOT_MCP_*` |

Sources: antigravity.google/docs/mcp; github/github-mcp-server install guides;
code.visualstudio.com/docs/agent-customization/mcp-servers;
docs.github.com Copilot CLI + IDE MCP docs (fetched 2026-06-18).

## Components

### 1. Snippet generators — `packages/core/src/install-snippets.ts`

The shared `brainMcpEntry` helper emits `{transport:{type,url},headers}` and is
**not reusable** here — each new shape gets its own pure generator returning the
existing `InstallSnippet` interface (`kind`/`lines`/`note`/`configPath`).

- `antigravity(token, mcpUrl)` → `kind:"json"`,
  `{ mcpServers: { brain: { serverUrl, headers: { Authorization } } } }`,
  `configPath` = `~/.gemini/antigravity/mcp_config.json` (win:
  `%USERPROFILE%\.gemini\antigravity\mcp_config.json`).
  Note: "Antigravity → Settings → Customizations → Open MCP Config."
- `githubCopilotVscode(token, mcpUrl)` → `kind:"json"`,
  `{ servers: { brain: { type:"http", url, headers: { Authorization } } } }`,
  `configPath` = `.vscode/mcp.json` (same on all OS — workspace-relative).
  Note: "VS Code → command palette → 'MCP: Open User Configuration' for a global
  install, or commit `.vscode/mcp.json` for a workspace install."
- `githubCopilotJetbrains(token, mcpUrl)` → `kind:"json"`,
  `{ servers: { brain: { url, requestInit: { headers: { Authorization } } } } }`,
  no `configPath` (varies: JetBrains/VS/Eclipse/Xcode each surface their own
  `mcp.json` editor). Note names the four IDEs + that they share this format.
- `githubCopilotCli(token, mcpUrl)` → `kind:"json"`,
  `{ mcpServers: { brain: { type:"http", url, headers: { Authorization } } } }`,
  `configPath` = `~/.copilot/mcp-config.json` (win:
  `%USERPROFILE%\.copilot\mcp-config.json`).
  Note: "Or run `copilot` then `/mcp add` for the interactive form."

### 2. Wizard registration — `token-install-wizard.tsx`

- Extend the `ClientId` union, `CLIENT_OPTIONS`, the import from
  `@brain/core/install-snippets`, and the `snippetFns` map with the four new ids.
- All four are `needsOs: false` (config paths are fixed or noted inline; the
  win32 path variance is handled inside the generator's `configPath`, not the OS
  picker). Labels: "Google Antigravity", "GitHub Copilot — VS Code",
  "GitHub Copilot — JetBrains / Visual Studio / Eclipse / Xcode",
  "GitHub Copilot — CLI".
- Insert the new entries after `geminiCli`, before `rawMcpServersJson`, so the
  fallbacks stay last.

### 3. Telemetry (migration-free — `clientType` is a `String` column, schema.prisma:319)

- `packages/types/src/index.ts` — add `"antigravity"` and `"github_copilot"` to
  the `SessionClientType` union.
- `apps/mcp-server/src/tools/start-session.ts` — add both to the zod `.enum(...)`
  **and** the JSON-schema `enum` array (two spots, kept in sync).
- `apps/web/components/brain/dashboard.tsx` — add `case "antigravity"` →
  "Antigravity" and `case "github_copilot"` → "GitHub Copilot" to `clientLabel`.

### 4. Docs — `docs/CLIENTS.md`

New subsections under "Other MCP clients":
- **Google Antigravity** — config path + `serverUrl` JSON + the trap call-out
  (`serverUrl`, not `url`).
- **GitHub Copilot (all surfaces)** — a small table mirroring the matrix above,
  with the per-surface JSON, plus a **coding-agent caveat**: it runs in GitHub's
  cloud, so it can only reach a Brain that is internet-reachable (not localhost),
  is configured in repository Settings → Copilot rather than a local file, and
  needs the token stored as a `COPILOT_MCP_*` secret.

### 5. Tests — `packages/core/src/__tests__/install-snippets.test.ts`

One case per new generator asserting: top-level key (`mcpServers` vs `servers`),
URL field name (`serverUrl` vs `url`), header placement (`headers` vs
`requestInit.headers`), the bearer value, the config path per OS where present,
and that `lines.join("\n")` is valid parseable JSON.

## Known risk (documented, not blocking)

Both clients have had bugs where a `401` from an HTTP MCP server triggers an
OAuth-discovery flow *instead of* sending the configured static header
(antigravity-cli #25; copilot-cli #3100). The Brain uses a static bearer and does
**not** advertise OAuth metadata, and statically-configured `headers` are sent on
every request including `initialize` — the happy path. Documented in CLIENTS.md;
flagged for the live validation pass. If a client is observed doing OAuth
discovery against `/mcp`, that is a separate follow-up (not in this scope).

## Out of scope

- Touching the existing generators or the `brainMcpEntry` helper.
- A bespoke installer script for the new clients.
- The Copilot coding agent beyond documentation (cloud-config, not a paste flow).

## Validation → deploy → release

1. **Unit tests** (above) + CI `typecheck` / `test` / `build` — the hard gates.
2. **Live browser check** on a clearly-marked throwaway account (review
   carve-out): open the token wizard, select each of the four new clients, and
   confirm the rendered snippet matches the matrix (esp. `serverUrl`,
   `requestInit.headers`). Screenshot evidence; no "tested" claim without it.
3. **Independent code review** (code-reviewer agent — CodeRabbit green ≠ a real
   review here).
4. **Deploy**: migration-free + green CI → autonomous-CD policy B. Merge, verify
   `gh pr view <n> --json state` = `MERGED`, run `./scripts/deploy.sh`, then the
   post-deploy smoke.
5. **Release `v1.7.0`** via `./scripts/release.sh v1.7.0` (tags `main`, drafts the
   GitHub release; operator publishes).

## Files touched

- `packages/core/src/install-snippets.ts` (+4 generators)
- `packages/core/src/__tests__/install-snippets.test.ts` (+4 cases)
- `apps/web/components/brain/token-install-wizard.tsx` (registration)
- `packages/types/src/index.ts` (union)
- `apps/mcp-server/src/tools/start-session.ts` (zod + JSON-schema enums)
- `apps/web/components/brain/dashboard.tsx` (`clientLabel`)
- `docs/CLIENTS.md` (two sections)
