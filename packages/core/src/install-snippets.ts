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
 *   command     — a copy-paste one-liner that performs the install, for the
 *                 clients where one exists (see InstallCommand)
 */

export type SnippetKind = "shell" | "json" | "rest";

export interface ConfigPath {
  darwin: string;
  linux: string;
  win32: string;
}

/**
 * A one-liner the user can paste into a terminal instead of hand-editing a
 * config file.
 *
 * `via` records WHO does the writing, because the failure modes differ:
 *   "native"    — the client ships its own `… mcp add` verb and we shell out
 *                 to it (Claude Code, Copilot CLI, Codex). Survives the
 *                 vendor changing its own config format.
 *   "installer" — no vendor CLI exists, so `/api/onboard.{sh,ps1}` merges the
 *                 entry into the client's config file itself.
 *
 * Clients with neither (no vendor verb AND no fixed config path — the
 * JetBrains/Visual Studio/Eclipse/Xcode family) expose no command at all
 * rather than a command that would guess at a path.
 */
export interface InstallCommand {
  lines: string[];
  via: "native" | "installer";
  note?: string;
}

export interface InstallSnippet {
  kind: SnippetKind;
  lines: string[];
  note?: string;
  configPath?: ConfigPath;
  command?: InstallCommand;
}

export type TargetOS = "darwin" | "linux" | "win32";

/**
 * Stable client identifiers. These are the `--client` / `-Client` values the
 * installers accept, so they are a wire contract: renaming one breaks every
 * command a user has already copied into a runbook.
 */
export type ClientId =
  | "claude-code"
  | "claude-desktop"
  | "cursor"
  | "windsurf"
  | "gemini-cli"
  | "antigravity"
  | "vscode"
  | "jetbrains"
  | "copilot-cli"
  | "codex"
  | "generic"
  | "rest";

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

/**
 * The `/api/onboard.*` one-liner, parameterised by client.
 *
 * Every client routes through the same installer rather than emitting a bare
 * vendor command, because the installer is what proves the token actually
 * works: it runs the MCP `initialize` + `tools/call` round-trip through the
 * user's real network, TLS and auth path before declaring success. A vendor
 * command that writes a config file exits 0 whether or not the bearer will
 * ever be accepted — the same "reported success, produced nothing" trap that
 * KNOWN_ISSUES keeps recording. Clients whose vendor CLI we shell out to are
 * marked `via: "native"` so the UI can name the underlying command.
 */
function installerCommand(
  clientId: ClientId,
  token: string,
  webUrl: string,
  os: TargetOS,
  via: "native" | "installer",
  note?: string,
): InstallCommand {
  const lines =
    os === "win32"
      ? [
          `iwr ${webUrl}/api/onboard.ps1 -UseBasicParsing | iex`,
          `Install-Brain -Token '${token}' -Client ${clientId}`,
        ]
      : [
          `curl -fsSL ${webUrl}/api/onboard.sh | bash -s '${token}' --client ${clientId}`,
        ];
  return note === undefined ? { lines, via } : { lines, via, note };
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
  const command = installerCommand(
    "claude-code",
    token,
    webUrl,
    os,
    "native",
    "Runs `claude mcp add brain --scope user --transport http`, installs the Brain skill, and smoke-tests the round-trip.",
  );

  return {
    kind: "shell",
    // For a shell client the command IS the snippet — one array, two views,
    // so `lines` and `command.lines` cannot drift apart.
    lines: command.lines,
    note: "Run in your terminal.",
    command,
  };
}

/**
 * Claude Desktop config snippet.
 * Paste into `claude_desktop_config.json`.
 */
export function claudeDesktop(
  token: string,
  mcpUrl: string,
  webUrl: string,
  os: TargetOS,
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
    command: installerCommand(
      "claude-desktop",
      token,
      webUrl,
      os,
      "installer",
      "Still requires a FULL quit of Claude Desktop afterwards — it reads this file only at startup.",
    ),
  };
}

/**
 * Cursor MCP config snippet.
 */
export function cursor(
  token: string,
  mcpUrl: string,
  webUrl: string,
  os: TargetOS,
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
    // Cursor ships no `mcp add` verb — only the settings UI and a
    // `cursor://` deeplink, neither of which is pasteable into a terminal.
    command: installerCommand("cursor", token, webUrl, os, "installer"),
  };
}

/**
 * Windsurf MCP config snippet.
 */
export function windsurf(
  token: string,
  mcpUrl: string,
  webUrl: string,
  os: TargetOS,
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
    command: installerCommand("windsurf", token, webUrl, os, "installer"),
  };
}

/**
 * Gemini CLI MCP config snippet.
 * Gemini CLI added MCP support in 2025; its config is settings.json.
 */
export function geminiCli(
  token: string,
  mcpUrl: string,
  webUrl: string,
  os: TargetOS,
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
    command: installerCommand("gemini-cli", token, webUrl, os, "installer"),
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
  webUrl: string,
  os: TargetOS,
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
    command: installerCommand(
      "antigravity",
      token,
      webUrl,
      os,
      "installer",
      "Writes the config both the Antigravity IDE and the CLI read.",
    ),
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
  webUrl: string,
  os: TargetOS,
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
    // Workspace-scoped on purpose: `.vscode/mcp.json` is relative, so the
    // installer writes it under the CURRENT directory. The user-profile path
    // varies by VS Code flavour (Code / Code - Insiders / VSCodium) and
    // profile, and guessing it wrong writes a file nothing reads.
    command: installerCommand(
      "vscode",
      token,
      webUrl,
      os,
      "installer",
      "Run this from your repo root — it writes ./.vscode/mcp.json (workspace scope). VS Code also accepts `code --add-mcp` for a user-profile install.",
    ),
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
  webUrl: string,
  os: TargetOS,
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
    command: installerCommand(
      "copilot-cli",
      token,
      webUrl,
      os,
      "native",
      "Shells out to `copilot mcp add --transport http --header \"Authorization: Bearer …\" brain <url>`, then verifies the round-trip.",
    ),
  };
}

/**
 * OpenAI Codex CLI.
 *
 * The only client here with no JSON to paste: Codex stores servers in
 * `~/.codex/config.toml`, and it deliberately refuses an inline bearer —
 * `codex mcp add` takes the NAME of an environment variable holding the
 * token (`--bearer-token-env-var`) and reads it at connect time. Emitting a
 * JSON snippet for this client would be emitting something Codex never reads,
 * so the command is the whole install.
 */
export function codexCli(
  token: string,
  mcpUrl: string,
  webUrl: string,
  os: TargetOS,
): InstallSnippet {
  const command = installerCommand(
    "codex",
    token,
    webUrl,
    os,
    "native",
    `Shells out to \`codex mcp add brain --url ${mcpUrl} --bearer-token-env-var BRAIN_TOKEN\`. Codex reads the bearer from the environment at connect time, so the installer prints the export line to add to your shell profile — without it Codex starts with no token.`,
  );
  return {
    kind: "shell",
    lines: command.lines,
    note: "Run in your terminal. Codex keeps MCP servers in ~/.codex/config.toml (TOML, not JSON) — let the CLI write it rather than hand-editing.",
    command,
  };
}

/**
 * Generic raw `mcpServers` JSON — fallback for any MCP-aware client.
 */
export function rawMcpServersJson(
  token: string,
  mcpUrl: string,
  webUrl: string,
  os: TargetOS,
): InstallSnippet {
  return {
    kind: "json",
    // Flat `url` is the most widely accepted remote shape; the note names the
    // known deviations so a user on an unlisted client can adapt rather than
    // silently getting an entry their client ignores.
    lines: wrapServerEntry({ url: mcpUrl, headers: bearer(token) }),
    note: "Paste into the client's MCP config — exact path depends on the client. If it doesn't connect, check which field your client expects: `url` (most), `serverUrl` (Windsurf, Antigravity), `httpUrl` (Gemini CLI), or a `servers` wrapper instead of `mcpServers` (VS Code). stdio-only clients need the `mcp-remote` bridge.",
    // No configPath to write into, so the installer takes the target path as
    // an argument instead of guessing one.
    command: installerCommand(
      "generic",
      token,
      webUrl,
      os,
      "installer",
      "Append `--config-path <file>` to merge this entry into a config file the installer doesn't know about; without it the command only prints the JSON and runs the connectivity check.",
    ),
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

// ─── registry ─────────────────────────────────────────────────────────────────

export type SnippetFn = (
  token: string,
  mcpUrl: string,
  webUrl: string,
  os: TargetOS,
) => InstallSnippet;

export interface ClientDescriptor {
  id: ClientId;
  /** Human label for the picker. */
  label: string;
  snippet: SnippetFn;
  /**
   * `clientType` recorded on the install-ping session, so the dashboard can
   * tell a Cursor install from a Copilot one. Must stay inside the enum the
   * MCP `brain_start_session` tool accepts, or the ping is rejected.
   */
  sessionClientType:
    | "claude_code"
    | "cursor"
    | "windsurf"
    | "antigravity"
    | "github_copilot"
    | "custom";
}

/**
 * The single list of supported clients.
 *
 * Every surface that enumerates clients — the token wizard, the /welcome
 * picker, the `--client` table baked into the installers, and the test sweep
 * — derives from this array. That is deliberate: the recurring defect in this
 * repo is a rule applied to some of N surfaces but not all (KNOWN_ISSUES §0u
 * shipped five clients with a config shape no client accepts, each with its
 * own passing test). With one list, adding a client to the picker without
 * teaching the installer about it is a type error, not a silent half-install.
 */
export const CLIENTS: readonly ClientDescriptor[] = [
  {
    id: "claude-code",
    label: "Claude Code (CLI)",
    snippet: claudeCodeCli,
    sessionClientType: "claude_code",
  },
  {
    id: "claude-desktop",
    label: "Claude Desktop",
    snippet: claudeDesktop,
    sessionClientType: "custom",
  },
  { id: "cursor", label: "Cursor", snippet: cursor, sessionClientType: "cursor" },
  {
    id: "windsurf",
    label: "Windsurf",
    snippet: windsurf,
    sessionClientType: "windsurf",
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI (legacy — retired 2026-06-18)",
    snippet: geminiCli,
    sessionClientType: "custom",
  },
  {
    id: "antigravity",
    label: "Google Antigravity (IDE + CLI)",
    snippet: antigravity,
    sessionClientType: "antigravity",
  },
  {
    id: "vscode",
    label: "GitHub Copilot — VS Code",
    snippet: githubCopilotVscode,
    sessionClientType: "github_copilot",
  },
  {
    id: "jetbrains",
    label: "GitHub Copilot — JetBrains / Visual Studio / Eclipse / Xcode",
    snippet: githubCopilotJetbrains,
    sessionClientType: "github_copilot",
  },
  {
    id: "copilot-cli",
    label: "GitHub Copilot — CLI",
    snippet: githubCopilotCli,
    sessionClientType: "github_copilot",
  },
  {
    id: "codex",
    label: "OpenAI Codex (CLI)",
    snippet: codexCli,
    sessionClientType: "custom",
  },
  {
    id: "generic",
    label: "Other MCP-aware client (raw JSON)",
    snippet: rawMcpServersJson,
    sessionClientType: "custom",
  },
  {
    id: "rest",
    label: "Non-MCP tool (REST + cURL)",
    snippet: restApiCurl,
    sessionClientType: "custom",
  },
] as const;

export function clientById(id: string): ClientDescriptor | undefined {
  return CLIENTS.find((c) => c.id === id);
}

/**
 * Whether the OS picker changes anything for this snippet.
 *
 * Derived rather than declared: a snippet varies by OS exactly when it has a
 * per-OS config path or an installer command (bash vs PowerShell). Hand-
 * maintaining this as a flag is how `needsOs` went stale for every client
 * that gained a command.
 */
export function needsOsChoice(snippet: InstallSnippet): boolean {
  return snippet.configPath !== undefined || snippet.command !== undefined;
}
