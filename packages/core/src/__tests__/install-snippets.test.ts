/**
 * Unit tests for install-snippet generators.
 *
 * Tests cover:
 *   - correct shape returned for each generator
 *   - token appears verbatim in the output
 *   - configPath values are correct per OS
 *   - JSON snippets parse as valid JSON
 *   - OS-differentiated shell snippets (darwin/linux vs win32)
 */

import { describe, expect, it } from "vitest";
import {
  claudeCodeCli,
  claudeDesktop,
  cursor,
  windsurf,
  geminiCli,
  antigravity,
  githubCopilotVscode,
  githubCopilotJetbrains,
  githubCopilotCli,
  codexCli,
  rawMcpServersJson,
  restApiCurl,
  CLIENTS,
  clientById,
  needsOsChoice,
  type ClientId,
} from "../install-snippets.js";

const TOKEN = "bp_testtoken1234567890ABCDEF";
const MCP_URL = "https://brain.example.com/mcp";
const WEB_URL = "https://brain.example.com";

// ─── helpers ─────────────────────────────────────────────────────────────────

function joinLines(lines: string[]): string {
  return lines.join("\n");
}

// ─── claudeCodeCli ────────────────────────────────────────────────────────────

describe("claudeCodeCli", () => {
  it("returns shell kind", () => {
    const s = claudeCodeCli(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.kind).toBe("shell");
  });

  it("darwin/linux: curl pipe command contains token", () => {
    for (const os of ["darwin", "linux"] as const) {
      const s = claudeCodeCli(TOKEN, MCP_URL, WEB_URL, os);
      const body = joinLines(s.lines);
      expect(body).toContain(TOKEN);
      expect(body).toContain(`${WEB_URL}/api/onboard.sh`);
      expect(body).toContain("bash -s");
    }
  });

  it("win32: PowerShell iwr command contains token", () => {
    const s = claudeCodeCli(TOKEN, MCP_URL, WEB_URL, "win32");
    const body = joinLines(s.lines);
    expect(body).toContain(TOKEN);
    expect(body).toContain(`${WEB_URL}/api/onboard.ps1`);
    expect(body).toContain("Install-Brain");
  });

  it("has a note", () => {
    const s = claudeCodeCli(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.note).toBeTruthy();
  });

  it("does not have configPath (shell command, not a file)", () => {
    const s = claudeCodeCli(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.configPath).toBeUndefined();
  });
});

// ─── claudeDesktop ────────────────────────────────────────────────────────────

describe("claudeDesktop", () => {
  it("returns json kind", () => {
    const s = claudeDesktop(TOKEN, MCP_URL, WEB_URL, "darwin");
    expect(s.kind).toBe("json");
  });

  it("lines parse as valid JSON", () => {
    const s = claudeDesktop(TOKEN, MCP_URL, WEB_URL, "linux");
    const parsed: unknown = JSON.parse(joinLines(s.lines));
    expect(parsed).toBeTruthy();
  });

  /**
   * Claude Desktop validates STDIO servers only. A `url`/`transport` entry is
   * ignored, and per anthropics/claude-code#37286 can make Desktop discard the
   * whole `mcpServers` block on its next save — destroying the user's other
   * servers. These assertions pin the mcp-remote bridge shape so nobody
   * "simplifies" it back to a direct HTTP entry.
   */
  it("uses the mcp-remote stdio bridge, NOT a direct HTTP entry", () => {
    const s = claudeDesktop(TOKEN, MCP_URL, WEB_URL, "darwin");
    const parsed = JSON.parse(joinLines(s.lines)) as {
      mcpServers: { brain: Record<string, unknown> };
    };
    const brain = parsed.mcpServers.brain;
    expect(brain["command"]).toBe("npx");
    expect(brain["url"]).toBeUndefined();
    expect(brain["serverUrl"]).toBeUndefined();
    expect(brain["httpUrl"]).toBeUndefined();
    expect(brain["transport"]).toBeUndefined();
  });

  it("passes the MCP URL and bearer through mcp-remote args", () => {
    const s = claudeDesktop(TOKEN, MCP_URL, WEB_URL, "darwin");
    const parsed = JSON.parse(joinLines(s.lines)) as {
      mcpServers: { brain: { args: string[] } };
    };
    const args = parsed.mcpServers.brain.args;
    expect(args).toContain("mcp-remote");
    expect(args).toContain(MCP_URL);
    expect(args).toContain("--header");
    expect(args).toContain(`Authorization:Bearer ${TOKEN}`);
  });

  it("note warns that Node/npx is required and Desktop must be fully quit", () => {
    const s = claudeDesktop(TOKEN, MCP_URL, WEB_URL, "darwin");
    expect(s.note).toMatch(/npx/i);
    expect(s.note).toMatch(/quit/i);
  });

  it("configPath.darwin contains Library/Application Support/Claude", () => {
    const s = claudeDesktop(TOKEN, MCP_URL, WEB_URL, "darwin");
    expect(s.configPath!.darwin).toContain(
      "Library/Application Support/Claude",
    );
  });

  it("configPath.linux is ~/.config/Claude/...", () => {
    const s = claudeDesktop(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.configPath!.linux).toContain("~/.config/Claude");
  });

  it("configPath.win32 uses %APPDATA%", () => {
    const s = claudeDesktop(TOKEN, MCP_URL, WEB_URL, "win32");
    expect(s.configPath!.win32).toContain("%APPDATA%");
    expect(s.configPath!.win32).toContain("Claude");
  });
});

// ─── cursor ──────────────────────────────────────────────────────────────────

describe("cursor", () => {
  it("returns json kind", () => {
    expect(cursor(TOKEN, MCP_URL, WEB_URL, "linux").kind).toBe("json");
  });

  it("keys the endpoint off a flat url, not a nested transport", () => {
    const s = cursor(TOKEN, MCP_URL, WEB_URL, "darwin");
    const parsed = JSON.parse(joinLines(s.lines)) as {
      mcpServers: { brain: Record<string, unknown> };
    };
    const brain = parsed.mcpServers.brain;
    expect(brain["url"]).toBe(MCP_URL);
    expect(brain["transport"]).toBeUndefined();
    expect(brain["serverUrl"]).toBeUndefined();
  });

  it("lines parse as valid JSON with correct token", () => {
    const s = cursor(TOKEN, MCP_URL, WEB_URL, "darwin");
    const parsed = JSON.parse(joinLines(s.lines)) as {
      mcpServers: { brain: { headers: { Authorization: string } } };
    };
    expect(parsed.mcpServers.brain.headers.Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("configPath uses ~/.cursor/mcp.json on unix OSes", () => {
    const s = cursor(TOKEN, MCP_URL, WEB_URL, "darwin");
    expect(s.configPath!.darwin).toBe("~/.cursor/mcp.json");
    expect(s.configPath!.linux).toBe("~/.cursor/mcp.json");
  });

  it("configPath uses %USERPROFILE% on win32", () => {
    const s = cursor(TOKEN, MCP_URL, WEB_URL, "win32");
    expect(s.configPath!.win32).toContain("%USERPROFILE%");
    expect(s.configPath!.win32).toContain(".cursor");
  });

  it("note mentions Cursor Settings", () => {
    const s = cursor(TOKEN, MCP_URL, WEB_URL, "darwin");
    expect(s.note).toContain("Cursor");
  });
});

// ─── windsurf ────────────────────────────────────────────────────────────────

describe("windsurf", () => {
  it("keys the endpoint off serverUrl, not url (Windsurf's quirk)", () => {
    const s = windsurf(TOKEN, MCP_URL, WEB_URL, "darwin");
    const parsed = JSON.parse(joinLines(s.lines)) as {
      mcpServers: { brain: Record<string, unknown> };
    };
    const brain = parsed.mcpServers.brain;
    expect(brain["serverUrl"]).toBe(MCP_URL);
    expect(brain["url"]).toBeUndefined();
    expect(brain["transport"]).toBeUndefined();
  });

  it("returns json kind with valid JSON body", () => {
    const s = windsurf(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.kind).toBe("json");
    const parsed: unknown = JSON.parse(joinLines(s.lines));
    expect(parsed).toBeTruthy();
  });

  it("configPath uses .codeium/windsurf on unix", () => {
    const s = windsurf(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.configPath!.linux).toContain(".codeium/windsurf");
    expect(s.configPath!.darwin).toContain(".codeium/windsurf");
  });

  it("configPath uses %USERPROFILE%\\.codeium on win32", () => {
    const s = windsurf(TOKEN, MCP_URL, WEB_URL, "win32");
    expect(s.configPath!.win32).toContain("%USERPROFILE%");
    expect(s.configPath!.win32).toContain(".codeium");
  });

  it("note mentions Windsurf", () => {
    const s = windsurf(TOKEN, MCP_URL, WEB_URL, "darwin");
    expect(s.note).toContain("Windsurf");
  });
});

// ─── geminiCli ───────────────────────────────────────────────────────────────

describe("geminiCli", () => {
  it("returns json kind with valid JSON body", () => {
    const s = geminiCli(TOKEN, MCP_URL, WEB_URL, "darwin");
    expect(s.kind).toBe("json");
    const parsed: unknown = JSON.parse(joinLines(s.lines));
    expect(parsed).toBeTruthy();
  });

  it("configPath is ~/.gemini/settings.json on unix", () => {
    const s = geminiCli(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.configPath!.linux).toBe("~/.gemini/settings.json");
    expect(s.configPath!.darwin).toBe("~/.gemini/settings.json");
  });

  it("configPath uses %USERPROFILE% on win32", () => {
    const s = geminiCli(TOKEN, MCP_URL, WEB_URL, "win32");
    expect(s.configPath!.win32).toContain("%USERPROFILE%");
    expect(s.configPath!.win32).toContain(".gemini");
  });

  it("note names the httpUrl field quirk", () => {
    const s = geminiCli(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.note).toContain("Gemini CLI");
    expect(s.note).toContain("httpUrl");
  });

  it("keys the endpoint off httpUrl, not url (Gemini reserves url for SSE)", () => {
    const s = geminiCli(TOKEN, MCP_URL, WEB_URL, "linux");
    const parsed = JSON.parse(joinLines(s.lines)) as {
      mcpServers: { brain: Record<string, unknown> };
    };
    const brain = parsed.mcpServers.brain;
    expect(brain["httpUrl"]).toBe(MCP_URL);
    expect(brain["url"]).toBeUndefined();
    expect(brain["transport"]).toBeUndefined();
    expect((brain["headers"] as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${TOKEN}`,
    );
  });
});

// ─── antigravity ─────────────────────────────────────────────────────────────

describe("antigravity", () => {
  it("returns json kind with valid JSON body", () => {
    const s = antigravity(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.kind).toBe("json");
    const parsed: unknown = JSON.parse(joinLines(s.lines));
    expect(parsed).toBeTruthy();
  });

  it("keys the remote server off serverUrl (not url) with the bearer header", () => {
    const s = antigravity(TOKEN, MCP_URL, WEB_URL, "darwin");
    const parsed = JSON.parse(joinLines(s.lines)) as {
      mcpServers: {
        brain: { serverUrl: string; headers: { Authorization: string } };
      };
    };
    expect(parsed.mcpServers.brain.serverUrl).toBe(MCP_URL);
    expect(parsed.mcpServers.brain.headers.Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
    // The Antigravity trap: it must NOT emit a `url` key.
    expect(joinLines(s.lines)).not.toContain('"url"');
  });

  it("configPath is the SHARED ~/.gemini/config/mcp_config.json (IDE + CLI)", () => {
    const s = antigravity(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.configPath!.linux).toBe("~/.gemini/config/mcp_config.json");
    expect(s.configPath!.darwin).toBe("~/.gemini/config/mcp_config.json");
  });

  it("configPath uses %USERPROFILE%\\.gemini\\config on win32", () => {
    const s = antigravity(TOKEN, MCP_URL, WEB_URL, "win32");
    expect(s.configPath!.win32).toContain("%USERPROFILE%");
    // Was ...\.gemini\antigravity\ before the 2026-05-19 merge; the IDE and
    // CLI now share ...\.gemini\config\. Asserting the segment (not just
    // "antigravity") is what makes this catch a regression to the dead path.
    expect(s.configPath!.win32).toContain("\\.gemini\\config\\");
  });

  it("note flags the serverUrl quirk and covers both surfaces", () => {
    const s = antigravity(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.note).toContain("serverUrl");
  });
});

// ─── githubCopilotVscode ─────────────────────────────────────────────────────

describe("githubCopilotVscode", () => {
  it("returns json kind with valid JSON body", () => {
    const s = githubCopilotVscode(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.kind).toBe("json");
    const parsed: unknown = JSON.parse(joinLines(s.lines));
    expect(parsed).toBeTruthy();
  });

  it("uses the servers wrapper with type:http, url, and a direct headers bearer", () => {
    const s = githubCopilotVscode(TOKEN, MCP_URL, WEB_URL, "darwin");
    const parsed = JSON.parse(joinLines(s.lines)) as {
      servers: {
        brain: {
          type: string;
          url: string;
          headers: { Authorization: string };
        };
      };
    };
    expect(parsed.servers.brain.type).toBe("http");
    expect(parsed.servers.brain.url).toBe(MCP_URL);
    expect(parsed.servers.brain.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("configPath is .vscode/mcp.json", () => {
    const s = githubCopilotVscode(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.configPath!.linux).toBe(".vscode/mcp.json");
    expect(s.configPath!.win32).toContain(".vscode");
  });
});

// ─── githubCopilotJetbrains ──────────────────────────────────────────────────

describe("githubCopilotJetbrains", () => {
  it("returns json kind with valid JSON body", () => {
    const s = githubCopilotJetbrains(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.kind).toBe("json");
    const parsed: unknown = JSON.parse(joinLines(s.lines));
    expect(parsed).toBeTruthy();
  });

  it("puts the bearer under requestInit.headers (not a top-level headers)", () => {
    const s = githubCopilotJetbrains(TOKEN, MCP_URL, WEB_URL, "darwin");
    const parsed = JSON.parse(joinLines(s.lines)) as {
      servers: {
        brain: {
          url: string;
          requestInit: { headers: { Authorization: string } };
          headers?: unknown;
        };
      };
    };
    expect(parsed.servers.brain.url).toBe(MCP_URL);
    expect(parsed.servers.brain.requestInit.headers.Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(parsed.servers.brain.headers).toBeUndefined();
  });

  it("has no fixed configPath (per-IDE editor)", () => {
    const s = githubCopilotJetbrains(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.configPath).toBeUndefined();
  });

  it("note names the IDE family", () => {
    const s = githubCopilotJetbrains(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.note).toContain("JetBrains");
  });
});

// ─── githubCopilotCli ────────────────────────────────────────────────────────

describe("githubCopilotCli", () => {
  it("returns json kind with valid JSON body", () => {
    const s = githubCopilotCli(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.kind).toBe("json");
    const parsed: unknown = JSON.parse(joinLines(s.lines));
    expect(parsed).toBeTruthy();
  });

  it("uses mcpServers with type:http, url, and a direct headers bearer", () => {
    const s = githubCopilotCli(TOKEN, MCP_URL, WEB_URL, "darwin");
    const parsed = JSON.parse(joinLines(s.lines)) as {
      mcpServers: {
        brain: {
          type: string;
          url: string;
          headers: { Authorization: string };
        };
      };
    };
    expect(parsed.mcpServers.brain.type).toBe("http");
    expect(parsed.mcpServers.brain.url).toBe(MCP_URL);
    expect(parsed.mcpServers.brain.headers.Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("configPath is ~/.copilot/mcp-config.json on unix", () => {
    const s = githubCopilotCli(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.configPath!.linux).toBe("~/.copilot/mcp-config.json");
    expect(s.configPath!.win32).toContain(".copilot");
  });
});

// ─── codexCli ────────────────────────────────────────────────────────────────

describe("codexCli", () => {
  it("returns shell kind — Codex has no JSON to paste", () => {
    const s = codexCli(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.kind).toBe("shell");
    expect(s.configPath).toBeUndefined();
  });

  it("names the env-var handoff Codex requires", () => {
    // Codex takes the NAME of an env var, not the bearer. A note that omits
    // this leaves the user with a registered server that 401s forever.
    const s = codexCli(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.command!.note).toContain("--bearer-token-env-var");
    expect(s.command!.note).toContain("BRAIN_TOKEN");
  });

  it("routes through the installer so the round-trip is still proven", () => {
    const s = codexCli(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.command!.via).toBe("native");
    expect(s.lines.join("\n")).toContain("--client codex");
  });
});

// ─── rawMcpServersJson ────────────────────────────────────────────────────────

describe("rawMcpServersJson", () => {
  it("returns json kind", () => {
    expect(rawMcpServersJson(TOKEN, MCP_URL, WEB_URL, "linux").kind).toBe(
      "json",
    );
  });

  it("lines parse as valid JSON", () => {
    const s = rawMcpServersJson(TOKEN, MCP_URL, WEB_URL, "win32");
    const parsed: unknown = JSON.parse(joinLines(s.lines));
    expect(parsed).toBeTruthy();
  });

  it("uses the flat url shape (widest client support) with the bearer", () => {
    const s = rawMcpServersJson(TOKEN, MCP_URL, WEB_URL, "darwin");
    const parsed = JSON.parse(joinLines(s.lines)) as {
      mcpServers: { brain: Record<string, unknown> };
    };
    const brain = parsed.mcpServers.brain;
    expect(brain["url"]).toBe(MCP_URL);
    expect(brain["transport"]).toBeUndefined();
    expect((brain["headers"] as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("note enumerates the per-client field deviations", () => {
    const s = rawMcpServersJson(TOKEN, MCP_URL, WEB_URL, "darwin");
    // A generic fallback that does not say how clients differ sends the user
    // away with one shape and no way to tell why it silently did nothing.
    expect(s.note).toContain("serverUrl");
    expect(s.note).toContain("httpUrl");
    expect(s.note).toContain("mcp-remote");
  });

  it("does not have a configPath (generic fallback)", () => {
    const s = rawMcpServersJson(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.configPath).toBeUndefined();
  });

  it("note mentions MCP config", () => {
    const s = rawMcpServersJson(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.note).toContain("MCP config");
  });
});

// ─── restApiCurl ─────────────────────────────────────────────────────────────

describe("restApiCurl", () => {
  it("returns rest kind", () => {
    expect(restApiCurl(TOKEN, MCP_URL, WEB_URL, "linux").kind).toBe("rest");
  });

  it("contains the Authorization header with token", () => {
    const s = restApiCurl(TOKEN, MCP_URL, WEB_URL, "darwin");
    const body = joinLines(s.lines);
    expect(body).toContain(`Bearer ${TOKEN}`);
  });

  it("uses the webUrl for the API endpoint", () => {
    const s = restApiCurl(TOKEN, MCP_URL, WEB_URL, "linux");
    const body = joinLines(s.lines);
    expect(body).toContain(`${WEB_URL}/api/oracle/stream`);
  });

  it("does not have a configPath", () => {
    const s = restApiCurl(TOKEN, MCP_URL, WEB_URL, "win32");
    expect(s.configPath).toBeUndefined();
  });

  it("note mentions MCP", () => {
    const s = restApiCurl(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.note).toContain("MCP");
  });
});

// ─── cross-client invariant sweep ────────────────────────────────────────────

/**
 * The per-client blocks above each assert about ONE generator, which is
 * exactly why a drift between them can hide: a property every client should
 * satisfy is only checked where someone remembered to check it. This table
 * walks all 11 clients × 3 target OSes and asserts the invariants that make a
 * snippet safe to paste, so adding a 12th client fails here until it conforms
 * rather than shipping a half-configured option.
 */

// Derived from the registry, not hand-listed: a hand-listed sweep only sweeps
// the clients someone remembered to add to it, which is the same failure the
// sweep exists to catch one level down.
const ALL_CLIENTS = CLIENTS.map(
  (c) => [c.id, c.snippet] as const,
);

const ALL_OSES = ["darwin", "linux", "win32"] as const;

describe("every client × OS combination", () => {
  for (const [name, fn] of ALL_CLIENTS) {
    for (const os of ALL_OSES) {
      describe(`${name} / ${os}`, () => {
        const snippet = fn(TOKEN, MCP_URL, WEB_URL, os);
        const body = joinLines(snippet.lines);

        it("produces a non-empty body", () => {
          expect(snippet.lines.length).toBeGreaterThan(0);
          expect(body.trim()).not.toBe("");
        });

        it("carries the real token, not a placeholder", () => {
          expect(body).toContain(TOKEN);
          // Guard against a template that interpolated the wrong variable and
          // left instructions the user would paste verbatim.
          expect(body).not.toMatch(/<token>|YOUR_TOKEN|\{\{|\$\{/i);
        });

        it("declares a known kind", () => {
          expect(["shell", "json", "rest"]).toContain(snippet.kind);
        });

        it("has a note telling the user what to do with it", () => {
          // A snippet without a note is a wall of JSON and no instruction —
          // the user is left to guess whether it is a command or a file.
          expect(snippet.note?.trim()).toBeTruthy();
        });

        if (true) {
          it("exposes the bearer exactly once", () => {
            const occurrences = body.split(`Bearer ${TOKEN}`).length - 1;
            if (snippet.kind === "shell") {
              // Shell installers pass the token as an argument, not a header.
              expect(body).toContain(TOKEN);
            } else {
              expect(occurrences).toBe(1);
            }
          });
        }

        it("quotes the token when it lands on a shell command line", () => {
          if (snippet.kind !== "shell" && snippet.kind !== "rest") return;
          // Unquoted, a token containing shell metacharacters would be split
          // or interpreted. Quoting is what makes copy-paste safe regardless
          // of what the generator ever emits.
          expect(body).toMatch(
            new RegExp(`['"]${TOKEN}['"]|Bearer ${TOKEN}["']`),
          );
        });

        if (true) {
          it("parses as JSON when it claims to be JSON", () => {
            if (snippet.kind !== "json") return;
            expect(() => JSON.parse(body)).not.toThrow();
          });
        }

        it("points at the configured endpoint, not a hardcoded host", () => {
          expect(body).toMatch(/brain\.example\.com/);
          expect(body).not.toMatch(/localhost|127\.0\.0\.1|:3100/);
        });

        it("gives a complete configPath when it gives one at all", () => {
          if (!snippet.configPath) return;
          for (const key of ALL_OSES) {
            expect(snippet.configPath[key]?.trim()).toBeTruthy();
          }
          // A Windows path written with forward slashes is a copy-paste
          // failure on the one OS that cannot fix it by habit.
          expect(snippet.configPath.win32).not.toMatch(/\//);
        });

        // ── install-command invariants ──────────────────────────────────
        // The whole point of the command is that a user pastes it and is
        // done. Each assertion below corresponds to a way that silently
        // fails to be true.

        it("emits a runnable command for the target shell", () => {
          if (!snippet.command) return;
          const cmd = snippet.command.lines.join("\n");
          expect(cmd.trim()).not.toBe("");
          if (os === "win32") {
            // A bash pipe pasted into PowerShell fails with a syntax error
            // that names nothing the user can act on.
            expect(cmd).toContain("Install-Brain");
            expect(cmd).not.toContain("curl -fsSL");
          } else {
            expect(cmd).toContain("curl -fsSL");
            expect(cmd).not.toContain("Install-Brain");
          }
        });

        it("names its own client id in the command", () => {
          if (!snippet.command) return;
          const cmd = snippet.command.lines.join("\n");
          const flag = os === "win32" ? "-Client" : "--client";
          expect(cmd).toContain(`${flag} ${name}`);
        });

        it("quotes the token inside the command", () => {
          if (!snippet.command) return;
          const cmd = snippet.command.lines.join("\n");
          expect(cmd).toContain(TOKEN);
          expect(cmd).toMatch(new RegExp(`'${TOKEN}'`));
        });

        it("targets the configured host in the command", () => {
          if (!snippet.command) return;
          const cmd = snippet.command.lines.join("\n");
          expect(cmd).toContain(WEB_URL);
          expect(cmd).not.toMatch(/localhost|127\.0\.0\.1/);
        });

        it("declares how the command installs", () => {
          if (!snippet.command) return;
          expect(["native", "installer"]).toContain(snippet.command.via);
        });

        it("needsOsChoice agrees with what the snippet actually varies by", () => {
          expect(needsOsChoice(snippet)).toBe(
            snippet.configPath !== undefined || snippet.command !== undefined,
          );
        });
      });
    }
  }
});

// ─── registry invariants ──────────────────────────────────────────────────────

/**
 * Clients that legitimately expose NO one-line install, and why. Listing them
 * explicitly is the point: a new client that forgets its command fails here
 * instead of quietly shipping as a paste-only option, which is how five
 * clients once shipped a config shape no client accepts (KNOWN_ISSUES §0u).
 */
const NO_COMMAND_EXPECTED = new Set<ClientId>([
  // JetBrains / Visual Studio / Eclipse / Xcode each open their own mcp.json
  // editor — there is no stable path on disk to write to.
  "jetbrains",
  // Not an install at all: an example REST call for non-MCP tools.
  "rest",
]);

describe("client registry", () => {
  it("has unique, stable ids", () => {
    const ids = CLIENTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is resolvable by id", () => {
    for (const c of CLIENTS) {
      expect(clientById(c.id)).toBe(c);
    }
    expect(clientById("no-such-client")).toBeUndefined();
  });

  it("exposes an install command for every client except the declared exceptions", () => {
    const missing = CLIENTS.filter(
      (c) =>
        c.snippet(TOKEN, MCP_URL, WEB_URL, "linux").command === undefined &&
        !NO_COMMAND_EXPECTED.has(c.id),
    ).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it("does not emit a command for the clients that cannot have one", () => {
    for (const id of NO_COMMAND_EXPECTED) {
      const client = clientById(id);
      expect(client).toBeDefined();
      expect(
        client!.snippet(TOKEN, MCP_URL, WEB_URL, "linux").command,
      ).toBeUndefined();
    }
  });

  it("gives every installer-written client a config path to write", () => {
    // `generic` is the documented exception — it takes --config-path instead,
    // and its note says so.
    for (const c of CLIENTS) {
      const s = c.snippet(TOKEN, MCP_URL, WEB_URL, "linux");
      if (s.command?.via !== "installer") continue;
      if (c.id === "generic") {
        expect(s.configPath).toBeUndefined();
        expect(s.command.note).toContain("--config-path");
        continue;
      }
      expect(s.configPath).toBeDefined();
    }
  });

  it("records a clientType the MCP start_session tool accepts", () => {
    // The install ping is posted with this value; an out-of-enum string is
    // rejected and the install silently records nothing.
    const allowed = new Set([
      "claude_code",
      "cursor",
      "windsurf",
      "antigravity",
      "github_copilot",
      "custom",
    ]);
    for (const c of CLIENTS) {
      expect(allowed.has(c.sessionClientType)).toBe(true);
    }
  });

  it("covers every generator exported from the module", () => {
    // A generator that exists but is in no registry entry is invisible to the
    // picker, the installer, and the sweep above.
    const registered = new Set(CLIENTS.map((c) => c.snippet));
    for (const fn of [
      claudeCodeCli,
      claudeDesktop,
      cursor,
      windsurf,
      geminiCli,
      antigravity,
      githubCopilotVscode,
      githubCopilotJetbrains,
      githubCopilotCli,
      codexCli,
      rawMcpServersJson,
      restApiCurl,
    ]) {
      expect(registered.has(fn)).toBe(true);
    }
  });
});
