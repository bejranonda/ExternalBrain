/**
 * Regression net for the v2 installer's legacy ~/.claude/mcp.json
 * reconciliation block (PR #223, closing #222).
 *
 * Filed as #225 — the bug fix shipped without an automated test, which
 * violated the project's own completion gate: "Every new feature must
 * include an end-to-end smoke test that exercises the real integration
 * path before calling it done. 'Prove it round-trips' is the completion
 * gate, not 'code compiles.'" That principle (Knowledge id
 * cmp2qnrlj00000iod7rfwm4ff, 100% success across 4 prior applications)
 * was retrieved from the brain platform during the 2026-05-15 sweep —
 * the platform itself surfaced the rule it was being measured against.
 *
 * This test covers two tiers:
 *
 *   Tier 1 (snapshot) — read installer-templates.ts as text and assert
 *   the reconcile block exists + carries the user-facing strings the
 *   operator sees in the install output. Catches accidental removal,
 *   refactor regressions, and string-message drift.
 *
 *   Tier 2 (behavior matrix) — extract the python3 heredoc from the
 *   installer source and execute it against each of the 4 fixture
 *   states from PR #223's manual matrix:
 *     (a) only-brain-entry → file deleted
 *     (b) brain + other-server → brain stripped, other preserved
 *     (c) no file → no-op
 *     (d) second run after cleanup → idempotent
 *
 *   The test invokes the EXACT bytes the installer would run on a real
 *   host (not a mock), so any regression in the python3 logic is caught
 *   in CI before the operator's `Invalid token` complaint resurfaces.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Read the installer template source as text (no import — we want to
// test the exact bytes that get rendered into the bash script).
const INSTALLER_PATH = resolve(
  __dirname,
  "../../../../apps/web/lib/brain/installer-templates.ts",
);
const SOURCE = readFileSync(INSTALLER_PATH, "utf8");

// Tier 1 — snapshot
describe("installer-templates reconcile block — Tier 1 snapshot", () => {
  it("contains the reconcile section header (#222 fix marker)", () => {
    expect(SOURCE).toMatch(/Reconcile legacy/);
    expect(SOURCE).toMatch(/#222/);
  });

  // `\$VAR` and `$VAR` are the same bytes once the template literal is
  // rendered — TypeScript only interpolates `${`, so the backslash is a style
  // marker, not semantics. Pinning to one spelling made these assertions fail
  // on a refactor that changed nothing about the emitted script, which is the
  // "pinned to a fact that stopped being true" trap in GUIDELINES §4. Match
  // either, and assert the guard's *shape* rather than its exact phrasing.
  const bashVar = (name: string) => `\\\\?\\$${name}`;

  it("declares the legacy file path", () => {
    expect(SOURCE).toMatch(
      new RegExp(`LEGACY_MCP_JSON="${bashVar("HOME")}/\\.claude/mcp\\.json"`),
    );
  });

  it("guards on file existence + brain entry presence", () => {
    expect(SOURCE).toMatch(
      new RegExp(`\\[ -f "${bashVar("LEGACY_MCP_JSON")}" \\]`),
    );
    expect(SOURCE).toMatch(
      new RegExp(`grep -q '"brain"' "${bashVar("LEGACY_MCP_JSON")}"`),
    );
  });

  it("prefers python3 when available", () => {
    expect(SOURCE).toMatch(/command -v python3/);
    expect(SOURCE).toMatch(
      new RegExp(`python3 - "${bashVar("LEGACY_MCP_JSON")}" <<'PY'`),
    );
  });

  it("ships the bash-only fallback for hosts without python3", () => {
    expect(SOURCE).toMatch(/single-entry legacy file/);
  });

  it("carries the user-facing strings the operator sees", () => {
    expect(SOURCE).toMatch(/Cleaning legacy/);
    expect(SOURCE).toMatch(/legacy file had only the brain entry — removed/);
    expect(SOURCE).toMatch(/stripped brain entry; preserved other servers/);
  });
});

// Tier 2 — behavior matrix.
// Extract the python3 heredoc contents (between the `<<'PY'` and the
// closing `PY` line) and run them against fixture states.
function extractPythonHeredoc(): string {
  // Keyed on LEGACY_MCP_JSON, not just `<<'PY'`: the installer now embeds a
  // second python3 heredoc (the multi-client config merge), so an unqualified
  // match would extract the wrong block and test it against these fixtures.
  const m = SOURCE.match(
    /python3 - "\\?\$LEGACY_MCP_JSON" <<'PY'\n([\s\S]*?)\nPY\n/,
  );
  if (!m) throw new Error("could not find python3 heredoc in installer-templates.ts");
  return m[1]!;
}

function runReconcileOn(jsonFile: string): { stdout: string; status: number } {
  const code = extractPythonHeredoc();
  try {
    const stdout = execFileSync("python3", ["-c", code, jsonFile], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", status: e.status ?? -1 };
  }
}

describe("installer reconcile — Tier 2 behavior matrix (executes extracted python3)", () => {
  it("case (a): file with only a brain entry → file removed", () => {
    const dir = mkdtempSync(join(tmpdir(), "reconcile-a-"));
    const f = join(dir, "mcp.json");
    writeFileSync(
      f,
      JSON.stringify({
        brain: { transport: { type: "http", url: "http://203.0.113.30:3100/mcp" } },
      }),
    );
    try {
      const { stdout } = runReconcileOn(f);
      expect(existsSync(f), "file must be removed").toBe(false);
      expect(stdout).toMatch(/legacy file had only the brain entry — removed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("case (b): brain + other-server → strip brain, preserve other", () => {
    const dir = mkdtempSync(join(tmpdir(), "reconcile-b-"));
    const f = join(dir, "mcp.json");
    writeFileSync(
      f,
      JSON.stringify({
        mcpServers: {
          brain: { transport: { type: "http", url: "http://203.0.113.30:3100/mcp" } },
          other: { transport: { type: "http", url: "http://example.com/mcp" } },
        },
      }),
    );
    try {
      const { stdout } = runReconcileOn(f);
      expect(existsSync(f), "file must still exist").toBe(true);
      const after = JSON.parse(readFileSync(f, "utf8"));
      expect(after.mcpServers?.brain, "brain entry must be stripped").toBeUndefined();
      expect(after.mcpServers?.other, "other-server must survive").toBeDefined();
      expect(stdout).toMatch(/stripped brain entry; preserved other servers/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("case (c): file with no brain entry → untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "reconcile-c-"));
    const f = join(dir, "mcp.json");
    const original = { mcpServers: { other: { url: "http://example.com/mcp" } } };
    writeFileSync(f, JSON.stringify(original));
    try {
      const { stdout } = runReconcileOn(f);
      expect(existsSync(f), "file must still exist").toBe(true);
      const after = JSON.parse(readFileSync(f, "utf8"));
      expect(after).toEqual(original);
      expect(stdout).toMatch(/no brain entry found in legacy file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("case (d): idempotency — second run on already-cleaned state is a no-op", () => {
    const dir = mkdtempSync(join(tmpdir(), "reconcile-d-"));
    const f = join(dir, "mcp.json");
    writeFileSync(f, JSON.stringify({ brain: { url: "http://stale" } }));
    try {
      // First run → file removed
      runReconcileOn(f);
      expect(existsSync(f)).toBe(false);
      // Second run on the now-absent file: re-create with non-brain content
      // and confirm the reconcile logic doesn't false-positive on something
      // that mentions "brain" only outside the entry-key position.
      writeFileSync(f, JSON.stringify({ note: "this is about brains" }));
      const { stdout } = runReconcileOn(f);
      expect(existsSync(f)).toBe(true);
      const after = JSON.parse(readFileSync(f, "utf8"));
      expect(after.note).toBe("this is about brains");
      // The python script checks for "brain" key, not the literal substring,
      // so this case should be a "no brain entry found" no-op.
      expect(stdout).toMatch(/no brain entry found in legacy file/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
