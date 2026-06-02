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
  rawMcpServersJson,
  restApiCurl,
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

  it("JSON contains the token in Authorization header", () => {
    const s = claudeDesktop(TOKEN, MCP_URL, WEB_URL, "darwin");
    const parsed = JSON.parse(joinLines(s.lines)) as {
      mcpServers: { brain: { headers: { Authorization: string } } };
    };
    expect(parsed.mcpServers.brain.headers.Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it("JSON contains the MCP URL", () => {
    const s = claudeDesktop(TOKEN, MCP_URL, WEB_URL, "darwin");
    const parsed = JSON.parse(joinLines(s.lines)) as {
      mcpServers: { brain: { transport: { url: string } } };
    };
    expect(parsed.mcpServers.brain.transport.url).toBe(MCP_URL);
  });

  it("JSON transport.type is http", () => {
    const s = claudeDesktop(TOKEN, MCP_URL, WEB_URL, "darwin");
    const parsed = JSON.parse(joinLines(s.lines)) as {
      mcpServers: { brain: { transport: { type: string } } };
    };
    expect(parsed.mcpServers.brain.transport.type).toBe("http");
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

  it("note mentions Gemini CLI and 2025", () => {
    const s = geminiCli(TOKEN, MCP_URL, WEB_URL, "linux");
    expect(s.note).toContain("Gemini CLI");
    expect(s.note).toContain("2025");
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

  it("JSON has the expected shape with token interpolated", () => {
    const s = rawMcpServersJson(TOKEN, MCP_URL, WEB_URL, "darwin");
    const parsed = JSON.parse(joinLines(s.lines)) as {
      mcpServers: {
        brain: {
          transport: { type: string; url: string };
          headers: { Authorization: string };
        };
      };
    };
    expect(parsed.mcpServers.brain.transport.type).toBe("http");
    expect(parsed.mcpServers.brain.transport.url).toBe(MCP_URL);
    expect(parsed.mcpServers.brain.headers.Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
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
