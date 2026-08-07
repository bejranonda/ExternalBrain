/**
 * Install-snippet generators for the post-mint token wizard.
 *
 * All functions are pure (no I/O, no process.env reads) so they can be
 * imported from both server routes and client components safely.
 *
 * The returned shape is deliberately uniform so the UI can render every
 * snippet variant without special-casing:
 *
 *   kind        — "shell" for terminal commands, "json" for config-file paste,
 *                 "rest" for HTTP-client snippets
 *   lines       — the raw snippet lines (join with "\n" to get the full body)
 *   note        — optional short guidance shown below the snippet
 *   configPath  — per-OS path where the snippet should be pasted (omitted for
 *                 snippets that don't map to a config file, e.g. shell or REST)
 */

export type SnippetKind = "shell" | "json" | "rest";

export interface ConfigPath {
  darwin: string;
  linux: string;
  win32: string;
}

export interface InstallSnippet {
  kind: SnippetKind;
  lines: string[];
  note?: string;
  configPath?: ConfigPath;
}

export type TargetOS = "darwin" | "linux" | "win32";

// ─── shared helper ────────────────────────────────────────────────────────────

/**
 * Serialise `{ "<wrapper>": { "brain": <entry> } }` as lines.
 *
 * There is deliberately NO shared "standard" entry shape. Every client keys
 * its remote-server URL off a different field, and a config in the wrong
 * shape does not error — the client ignores the entry, or (Claude Desktop)
 * discards the whole block. Until 2026-08-06 all five JSON clients here
 * emitted one invented `transport: { type, url }` shape that no client
 * documents; the tests passed because they only asserted the body was valid
 * JSON containing the token, which is true of any shape. See KNOWN_ISSUES §0u.
 */
function wrapServerEntry(
  entry: object,
  wrapper: "mcpServers" | "servers" = "mcpServers",
): string[] {
  return JSON.stringify({ [wrapper]: { brain: entry } }, null, 2).split("\n");
}

/** Bearer header object, shared by every client that takes static headers. */
function bearer(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

// ─── generators ───────────────────────────────────────────────────────────────

/**
 * Claude Code CLI one-liner.
 * darwin/linux → bash pipe; win32 → PowerShell iwr|iex.
 */
export function claudeCodeCli(
  token: string,
  _mcpUrl: string,
  webUrl: string,
  os: TargetOS,
): InstallSnippet {
  const lines =
    os === "win32"
      ? [
          `iwr ${webUrl}/api/onboard.ps1 -UseBasicParsing | iex`,
          `Install-Brain -Token '${token}'`,
        ]
      : [`curl -fsSL ${webUrl}/api/onboard.sh | bash -s '${token}'`];

  return {
    kind: "shell",
    lines,
    note: "Run in your terminal.",
  };
}

/**
 * Claude Desktop config snippet.
 * Paste into `claude_desktop_config.json`.
 */
export function claudeDesktop(
  token: string,
  mcpUrl: string,
  _webUrl: string,
  _os: TargetOS,
): InstallSnippet {
  return {
    kind: "json",
    // stdio bridge, NOT a direct HTTP entry. `claude_desktop_config.json`
    // validates stdio servers only: a `url`-shaped entry is at best ignored
    // and at worst causes Desktop to drop the entire `mcpServers` block on
    // its next save — taking the user's OTHER servers with it
    // (anthropics/claude-code#37286). `mcp-remote` bridges stdio↔HTTP and is
    // what docs/CLIENTS.md has always specified; only this generator
    // disagreed. Header is passed as one `Name:Value` argument.
    lines: wrapServerEntry({
      command: "npx",
      args: [
        "-y",
        "mcp-remote",
        mcpUrl,
        "--header",
        `Authorization:Bearer ${token}`,
      ],
    }),
    // Every other client carries a note; this one shipped without one, so the
    // user got a wall of JSON and a path with no instruction (caught by the
    // cross-client sweep in install-snippets.test.ts). The restart clause is
    // load-bearing, not politeness: Claude Desktop reads this file only at
    // startup, so editing it in a running app changes nothing and looks like
    // a bad token — the same "config on disk is not the live connection"
    // trap as KNOWN_ISSUES §0t.
    note: "Requires Node (npx) — Claude Desktop speaks stdio only, so mcp-remote bridges it to HTTP. Claude Desktop → Settings → Developer → Edit Config, then FULLY quit from the menu bar / system tray (closing the window is not enough) and reopen. It reads this config only at startup.",
    configPath: {
      darwin:
        "~/Library/Application Support/Claude/claude_desktop_config.json",
      linux: "~/.config/Claude/claude_desktop_config.json",
      win32: "%APPDATA%\\Claude\\claude_desktop_config.json",
    },
  };
}

/**
 * Cursor MCP config snippet.
 */
export function cursor(
  token: string,
  mcpUrl: string,
  _webUrl: string,
  _os: TargetOS,
): InstallSnippet {
  return {
    kind: "json",
    // Cursor takes a FLAT `url` (native streamable-HTTP since 2025 — the
    // `mcp-remote` shim docs/CLIENTS.md once required is no longer needed).
    lines: wrapServerEntry({ url: mcpUrl, headers: bearer(token) }),
    note: "Cursor → Settings → MCP Servers → +Add → paste this. Project-scope alternative: <repo>/.cursor/mcp.json.",
    configPath: {
      darwin: "~/.cursor/mcp.json",
      linux: "~/.cursor/mcp.json",
      win32: "%USERPROFILE%\\.cursor\\mcp.json",
    },
  };
}

/**
 * Windsurf MCP config snippet.
 */
export function windsurf(
  token: string,
  mcpUrl: string,
  _webUrl: string,
  _os: TargetOS,
): InstallSnippet {
  return {
    kind: "json",
    // Windsurf keys remote servers off `serverUrl`, not `url` — the same
    // quirk Antigravity has. A `url` entry is silently ignored.
    lines: wrapServerEntry({ serverUrl: mcpUrl, headers: bearer(token) }),
    note: "Windsurf → Settings → Cascade → MCP Servers → +Add → paste this. Note: Windsurf uses `serverUrl` (not `url`) for HTTP servers.",
    configPath: {
      darwin: "~/.codeium/windsurf/mcp_config.json",
      linux: "~/.codeium/windsurf/mcp_config.json",
      win32: "%USERPROFILE%\\.codeium\\windsurf\\mcp_config.json",
    },
  };
}

/**
 * Gemini CLI MCP config snippet.
 * Gemini CLI added MCP support in 2025; its config is settings.json.
 */
export function geminiCli(
  token: string,
  mcpUrl: string,
  _webUrl: string,
  _os: TargetOS,
): InstallSnippet {
  return {
    kind: "json",
    // Gemini CLI names the streamable-HTTP endpoint `httpUrl` (it reserves
    // `url` for SSE). A `url` entry connects over the wrong transport or not
    // at all.
    lines: wrapServerEntry({ httpUrl: mcpUrl, headers: bearer(token) }),
    note: "LEGACY — Gemini CLI was retired for consumer accounts on 2026-06-18 and folded into Antigravity CLI; enterprise access continues. If you are on a current install, pick \"Google Antigravity\" instead. Gemini CLI uses `httpUrl` (not `url`) for streamable-HTTP servers.",
    configPath: {
      darwin: "~/.gemini/settings.json",
      linux: "~/.gemini/settings.json",
      win32: "%USERPROFILE%\\.gemini\\settings.json",
    },
  };
}

/**
 * Google Antigravity MCP config snippet.
 * Antigravity is the odd one out: it keys remote servers off `serverUrl`
 * (flat — no nested `transport`/`type`), not `url`. Pasting a `url`-shaped
 * entry silently does nothing.
 */
export function antigravity(
  token: string,
  mcpUrl: string,
  _webUrl: string,
  _os: TargetOS,
): InstallSnippet {
  const body = JSON.stringify(
    {
      mcpServers: {
        brain: {
          serverUrl: mcpUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
  return {
    kind: "json",
    lines: body.split("\n"),
    note: "Shared by the Antigravity IDE and the Antigravity CLI — one file serves both. IDE: Settings → Customizations → Open MCP Config. CLI: edit the path below directly, or use .agents/mcp_config.json for a workspace-local server. Note: Antigravity uses `serverUrl` (not `url`) for HTTP servers.",
    // Path changed when Gemini CLI folded into Antigravity (2026-05-19): the
    // IDE and the new Go-based CLI now share ~/.gemini/config/mcp_config.json.
    // The old ~/.gemini/antigravity/ location silently loads nothing.
    configPath: {
      darwin: "~/.gemini/config/mcp_config.json",
      linux: "~/.gemini/config/mcp_config.json",
      win32: "%USERPROFILE%\\.gemini\\config\\mcp_config.json",
    },
  };
}

/**
 * GitHub Copilot — VS Code MCP config snippet.
 * VS Code keys servers under `servers` (not `mcpServers`) and accepts the
 * static header directly under `headers` with `type:"http"`.
 */
export function githubCopilotVscode(
  token: string,
  mcpUrl: string,
  _webUrl: string,
  _os: TargetOS,
): InstallSnippet {
  const body = JSON.stringify(
    {
      servers: {
        brain: {
          type: "http",
          url: mcpUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
  return {
    kind: "json",
    lines: body.split("\n"),
    note: 'VS Code → command palette → "MCP: Open User Configuration" for a global install, or commit `.vscode/mcp.json` to share it with a repo.',
    configPath: {
      darwin: ".vscode/mcp.json",
      linux: ".vscode/mcp.json",
      win32: ".vscode\\mcp.json",
    },
  };
}

/**
 * GitHub Copilot — JetBrains / Visual Studio / Eclipse / Xcode MCP config.
 * These surfaces share one shape: `servers` + bare `url`, but the header
 * goes under `requestInit.headers` (not a top-level `headers`). No fixed
 * config path — each IDE opens its own `mcp.json` editor.
 */
export function githubCopilotJetbrains(
  token: string,
  mcpUrl: string,
  _webUrl: string,
  _os: TargetOS,
): InstallSnippet {
  const body = JSON.stringify(
    {
      servers: {
        brain: {
          url: mcpUrl,
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        },
      },
    },
    null,
    2,
  );
  return {
    kind: "json",
    lines: body.split("\n"),
    note: "Same JSON for JetBrains IDEs, Visual Studio, Eclipse, and Xcode — open each one's MCP config (mcp.json) and paste. On these surfaces the bearer goes under `requestInit.headers`.",
  };
}

/**
 * GitHub Copilot — CLI MCP config snippet.
 * The `copilot` CLI keys servers under `mcpServers` with `type:"http"`.
 */
export function githubCopilotCli(
  token: string,
  mcpUrl: string,
  _webUrl: string,
  _os: TargetOS,
): InstallSnippet {
  const body = JSON.stringify(
    {
      mcpServers: {
        brain: {
          type: "http",
          url: mcpUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
  return {
    kind: "json",
    lines: body.split("\n"),
    note: "Or run `copilot` then `/mcp add` for the interactive form. Set COPILOT_HOME to relocate the config dir.",
    configPath: {
      darwin: "~/.copilot/mcp-config.json",
      linux: "~/.copilot/mcp-config.json",
      win32: "%USERPROFILE%\\.copilot\\mcp-config.json",
    },
  };
}

/**
 * Generic raw `mcpServers` JSON — fallback for any MCP-aware client.
 */
export function rawMcpServersJson(
  token: string,
  mcpUrl: string,
  _webUrl: string,
  _os: TargetOS,
): InstallSnippet {
  return {
    kind: "json",
    // Flat `url` is the most widely accepted remote shape; the note names the
    // known deviations so a user on an unlisted client can adapt rather than
    // silently getting an entry their client ignores.
    lines: wrapServerEntry({ url: mcpUrl, headers: bearer(token) }),
    note: "Paste into the client's MCP config — exact path depends on the client. If it doesn't connect, check which field your client expects: `url` (most), `serverUrl` (Windsurf, Antigravity), `httpUrl` (Gemini CLI), or a `servers` wrapper instead of `mcpServers` (VS Code). stdio-only clients need the `mcp-remote` bridge.",
  };
}

/**
 * REST + cURL example for non-MCP tools.
 */
export function restApiCurl(
  token: string,
  _mcpUrl: string,
  webUrl: string,
  _os: TargetOS,
): InstallSnippet {
  return {
    kind: "rest",
    lines: [
      `curl -N -X POST ${webUrl}/api/oracle/stream \\`,
      `  -H "Authorization: Bearer ${token}" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"query":"Hello, Brain"}'`,
    ],
    note: "Use this only if your tool can't speak MCP. Slower (no session reuse) but works for any HTTP client.",
  };
}
