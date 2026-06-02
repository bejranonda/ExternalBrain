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

/** Build the standard `mcpServers.brain` JSON object (un-indented leaf). */
function brainMcpEntry(token: string, mcpUrl: string): object {
  return {
    transport: { type: "http", url: mcpUrl },
    headers: { Authorization: `Bearer ${token}` },
  };
}

/** Serialise a full `{ "mcpServers": { "brain": … } }` wrapper as lines. */
function mcpServersLines(token: string, mcpUrl: string): string[] {
  const body = JSON.stringify(
    { mcpServers: { brain: brainMcpEntry(token, mcpUrl) } },
    null,
    2,
  );
  return body.split("\n");
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
    lines: mcpServersLines(token, mcpUrl),
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
    lines: mcpServersLines(token, mcpUrl),
    note: "Cursor → Settings → MCP Servers → +Add → paste this.",
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
    lines: mcpServersLines(token, mcpUrl),
    note: "Windsurf → Settings → Cascade → MCP Servers → +Add → paste this.",
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
    lines: mcpServersLines(token, mcpUrl),
    note: "Gemini CLI added MCP support in 2025; works the same as Claude Code's MCP.",
    configPath: {
      darwin: "~/.gemini/settings.json",
      linux: "~/.gemini/settings.json",
      win32: "%USERPROFILE%\\.gemini\\settings.json",
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
    lines: mcpServersLines(token, mcpUrl),
    note: "Paste into the client's MCP config — exact path depends on the client.",
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
