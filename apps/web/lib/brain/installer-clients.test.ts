import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENTS } from "@brain/core/install-snippets";
import { bashInstaller, powershellInstaller } from "./installer-templates";

/**
 * The install command shown in the web UI must be a command the installer
 * actually accepts.
 *
 * These are two files that never import each other at runtime — the wizard
 * renders `--client cursor`, the installer decides what `cursor` means — so
 * nothing but a test connects them. Get it wrong and the failure is the worst
 * kind: the user copies a command that runs, prints an error they did not
 * cause, and concludes the product is broken.
 *
 * The same gap in the other direction is what KNOWN_ISSUES §0u records: five
 * clients shipped a config shape no client accepts, each with its own passing
 * test, because every test asserted "valid JSON containing the token" — true
 * of any shape at all.
 */

const OPTS = {
  mcpUrl: "https://brain.example.com/mcp",
  webUrl: "https://brain.example.com",
};

const BASH = bashInstaller(OPTS);
const PS1 = powershellInstaller(OPTS);
const TOKEN = "bp_testtoken1234567890ABCDEF";

/** Client ids whose command the installer promises to handle. */
const COMMANDED = CLIENTS.filter(
  (c) => c.snippet(TOKEN, OPTS.mcpUrl, OPTS.webUrl, "linux").command,
);

/** Pull each `client_config_json` heredoc body out of the generated script. */
function embeddedJson(script: string): Map<string, string> {
  const out = new Map<string, string>();
  const re =
    /^\s{4}([a-z0-9-]+)\)\n\s+cat <<'BRAIN_CFG_JSON'\n([\s\S]*?)\nBRAIN_CFG_JSON$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script)) !== null) out.set(m[1]!, m[2]!);
  return out;
}

describe("installer client coverage", () => {
  it("has clients to check (guard against a vacuous sweep)", () => {
    expect(COMMANDED.length).toBeGreaterThanOrEqual(9);
  });

  for (const client of COMMANDED) {
    const snippet = client.snippet(TOKEN, OPTS.mcpUrl, OPTS.webUrl, "linux");
    const via = snippet.command!.via;

    it(`bash installer accepts --client ${client.id}`, () => {
      // Either a native dispatch arm, or an entry in the generated config
      // table that the default arm routes to.
      const hasDispatchArm = new RegExp(
        `^\\s*(${client.id}|[a-z-]*\\|)*${client.id}[|)]`,
        "m",
      ).test(BASH);
      const hasTableEntry = embeddedJson(BASH).has(client.id);
      expect(hasDispatchArm || hasTableEntry).toBe(true);
    });

    it(`bash installer maps ${client.id} to a session clientType`, () => {
      expect(BASH).toContain(
        `${client.id}) printf '%s' '${client.sessionClientType}' ;;`,
      );
    });

    it(`powershell installer accepts -Client ${client.id}`, () => {
      const hasArm = new RegExp(`'${client.id}'\\s*\\{`).test(PS1);
      expect(hasArm).toBe(true);
    });

    if (via === "installer") {
      it(`bash installer embeds ${client.id}'s config, byte-identical to the wizard's`, () => {
        const embedded = embeddedJson(BASH).get(client.id);
        expect(embedded).toBeDefined();
        // The exact document the wizard renders, with the bearer replaced by
        // the placeholder the installer substitutes at run time. Comparing
        // the whole document (not "it parses and has the token") is what
        // catches a shape that drifted.
        const expected = client
          .snippet("__BRAIN_TOKEN__", OPTS.mcpUrl, OPTS.webUrl, "linux")
          .lines.join("\n");
        expect(embedded).toBe(expected);
      });

      it(`${client.id}'s embedded config is valid JSON carrying the placeholder`, () => {
        const embedded = embeddedJson(BASH).get(client.id)!;
        const parsed = JSON.parse(embedded) as Record<string, unknown>;
        expect(Object.keys(parsed)).toHaveLength(1);
        expect(embedded).toContain("__BRAIN_TOKEN__");
      });

      it(`${client.id} has a POSIX-resolvable config path (no bare ~)`, () => {
        // `~` is expanded by the shell, not by python's open() — a path
        // written as "~/.cursor/mcp.json" creates a literal "~" directory.
        const pathArm = new RegExp(
          `^\\s{4}${client.id}\\)[\\s\\S]*?;;`,
          "m",
        ).exec(BASH)?.[0];
        expect(pathArm).toBeDefined();
        expect(pathArm).not.toMatch(/'~\//);
        expect(pathArm).not.toMatch(/"~\//);
      });
    }
  }

  it("refuses the clients that cannot be installed from a command line", () => {
    expect(BASH).toContain("jetbrains|rest)");
    expect(PS1).toContain("@('jetbrains','rest')");
  });

  it("defaults to claude-code so the pre-existing one-liner still works", () => {
    expect(BASH).toContain('CLIENT="claude-code"');
    expect(PS1).toContain("[string] $Client = 'claude-code'");
  });

  it("never bakes a real-looking bearer into the cacheable script", () => {
    // /api/onboard.sh is served with `cache-control: public` — a token in the
    // body would be cached by every intermediary between here and the user.
    expect(BASH).not.toMatch(/bp_[A-Za-z0-9_-]{20,}/);
    expect(PS1).not.toMatch(/bp_[A-Za-z0-9_-]{20,}/);
  });
});

describe("generated installer syntax", () => {
  it("bash installer parses (bash -n)", () => {
    const dir = mkdtempSync(join(tmpdir(), "brain-installer-"));
    const file = join(dir, "onboard.sh");
    writeFileSync(file, BASH);
    // A template-literal escaping slip produces a script that is only
    // discovered to be broken by the first user who runs it.
    expect(() =>
      execFileSync("bash", ["-n", file], { stdio: "pipe" }),
    ).not.toThrow();
  });
});

/**
 * Execute the merge for real.
 *
 * `bash -n` above is necessary and NOT sufficient: to bash, the embedded
 * Python is heredoc *data*, so a syntax error inside it parses clean and
 * fails only at run time. That is not hypothetical — the first version of
 * this installer shipped `\n` inside the Python error strings, which the
 * TypeScript template literal turned into real newlines, producing
 * `SyntaxError: unterminated string literal` on the very first merge. Every
 * static check passed. Only running it found the bug.
 *
 * `curl` is stubbed to fail instantly so the post-install smoke test cannot
 * reach the network (and cannot spend 15s per client timing out). The config
 * write happens before the smoke test, so the artifact is there to inspect —
 * which is the property that actually matters.
 */
function runMerge(clientId: string, sandbox: string): void {
  const script = join(sandbox, "onboard.sh");
  writeFileSync(script, BASH);
  const stubBin = join(sandbox, "stubbin");
  mkdirSync(stubBin, { recursive: true });
  writeFileSync(join(stubBin, "curl"), "#!/bin/sh\nexit 7\n", { mode: 0o755 });

  try {
    execFileSync("bash", [script, TOKEN, "--client", clientId], {
      cwd: sandbox,
      env: { ...process.env, HOME: sandbox, PATH: `${stubBin}:${process.env["PATH"]}` },
      stdio: "pipe",
    });
  } catch {
    // Expected: the stubbed curl makes the smoke test fail. The config write
    // already happened, and that is what the caller asserts on.
  }
}

describe("installer merge, executed", () => {
  const MERGE_CLIENTS = COMMANDED.filter((c) => {
    const s = c.snippet(TOKEN, OPTS.mcpUrl, OPTS.webUrl, "linux");
    return s.command?.via === "installer" && s.configPath !== undefined;
  });

  it("has merge clients to exercise", () => {
    expect(MERGE_CLIENTS.length).toBeGreaterThanOrEqual(5);
  });

  for (const client of MERGE_CLIENTS) {
    const snippet = client.snippet(TOKEN, OPTS.mcpUrl, OPTS.webUrl, "linux");
    const rel = snippet.configPath!.linux.replace(/^~\//, "");

    it(`${client.id}: writes its config and preserves other servers`, () => {
      const sandbox = mkdtempSync(join(tmpdir(), `brain-merge-${client.id}-`));
      const target = join(sandbox, rel);
      mkdirSync(dirname(target), { recursive: true });

      // A user with existing MCP servers is the case that must not regress:
      // clobbering them is silent, and they only find out when a different
      // tool stops working.
      const wrapper = Object.keys(
        JSON.parse(snippet.lines.join("\n")) as Record<string, unknown>,
      )[0]!;
      writeFileSync(
        target,
        JSON.stringify(
          { [wrapper]: { existing: { url: "https://other.example/mcp" } } },
          null,
          2,
        ),
      );

      runMerge(client.id, sandbox);

      const after = JSON.parse(readFileSync(target, "utf8")) as Record<
        string,
        Record<string, unknown>
      >;
      expect(Object.keys(after[wrapper]!).sort()).toEqual(["brain", "existing"]);
      expect(after[wrapper]!["existing"]).toEqual({
        url: "https://other.example/mcp",
      });

      // The written entry must be exactly the entry the wizard shows.
      const expected = JSON.parse(snippet.lines.join("\n")) as Record<
        string,
        Record<string, unknown>
      >;
      expect(after[wrapper]!["brain"]).toEqual(expected[wrapper]!["brain"]);

      // …including a usable bearer, not the substitution placeholder.
      expect(JSON.stringify(after)).toContain(`Bearer ${TOKEN}`);
      expect(JSON.stringify(after)).not.toContain("__BRAIN_TOKEN__");

      // And the original must still be recoverable.
      const backups = readdirSync(dirname(target)).filter((f) =>
        f.includes(".bak."),
      );
      expect(backups).toHaveLength(1);
    });

    it(`${client.id}: creates the config when none exists`, () => {
      const sandbox = mkdtempSync(join(tmpdir(), `brain-fresh-${client.id}-`));
      runMerge(client.id, sandbox);
      const target = join(sandbox, rel);
      // A first-time user has no config file and no parent directory; the
      // installer must create both rather than fail on a missing dir.
      const parsed = JSON.parse(readFileSync(target, "utf8")) as unknown;
      expect(JSON.stringify(parsed)).toContain(`Bearer ${TOKEN}`);
    });
  }

  it("refuses to overwrite a config it cannot parse", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "brain-badjson-"));
    const target = join(sandbox, ".cursor", "mcp.json");
    mkdirSync(dirname(target), { recursive: true });
    // VS Code and friends tolerate comments in mcp.json; JSON.parse does not.
    // Destroying a config we merely failed to understand is the worst
    // possible outcome, so the installer must stop.
    const original = '{\n  // my servers\n  "mcpServers": {}\n}';
    writeFileSync(target, original);

    runMerge("cursor", sandbox);

    expect(readFileSync(target, "utf8")).toBe(original);
  });
});
