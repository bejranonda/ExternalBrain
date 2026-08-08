import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A fresh deployment must be LOCKED, not open.
 *
 * `CLAUDE.md` and `apps/web/lib/brain/auth.ts` both promise the same posture:
 * "a freshly-deployed instance is intentionally locked until you pick an auth
 * mode … better to be locked shut than serve every visitor as the first User
 * row." `.env.example` sets both dev-auth flags to `"false"`, and
 * `scripts/deploy.sh` reads them as `${VAR:-false}`.
 *
 * `deploy/docker-compose.yml` defaulted both to `"true"` — and compose is the
 * surface that actually runs. With no auth vars in `.env`, a fresh
 * `docker compose up` produced ADMIN_USERNAME="", AUTH_GITHUB_ID="",
 * ALLOW_DEV_AUTH="true", NODE_ENV=production, ALLOW_DEV_AUTH_IN_PRODUCTION=
 * "true" — every branch of `getCurrentUserId()` needed for the dev shim, so
 * every anonymous request resolved to the first User row.
 *
 * `verify-lockdown.sh` structurally cannot catch this: it probes a running
 * instance, and any instance configured enough to be probed has already set
 * these in `.env`. The defect only exists in the gap between "what the
 * template says" and "what an unconfigured deploy resolves to" — so this test
 * resolves the compose file against a deliberately minimal env file and reads
 * the ANSWER, not the template.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const COMPOSE = join(REPO_ROOT, "deploy", "docker-compose.yml");

/** The env a forker has after `cp .env.example .env` and filling in the minimum. */
const MINIMAL_ENV = [
  "POSTGRES_PASSWORD=x",
  "DATABASE_URL=postgresql://brain:x@db:5432/brain",
  "ANTHROPIC_API_KEY=sk-placeholder",
  "",
].join("\n");

function resolvedWebEnv(): Map<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "brain-compose-"));
  const envFile = join(dir, "fresh.env");
  writeFileSync(envFile, MINIMAL_ENV);

  const out = execFileSync(
    "docker",
    ["compose", "-f", COMPOSE, "--env-file", envFile, "config"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: REPO_ROOT },
  );

  // Take the `web` service's environment block. Compose emits normalised
  // YAML, so a simple indent-aware scan is enough and avoids a yaml dep.
  const lines = out.split("\n");
  const env = new Map<string, string>();
  let inWeb = false;
  let inEnv = false;
  for (const line of lines) {
    if (/^ {2}[a-z0-9_-]+:\s*$/.test(line)) {
      inWeb = line.trim() === "web:";
      inEnv = false;
      continue;
    }
    if (!inWeb) continue;
    if (/^ {4}[a-z]+:/.test(line)) {
      inEnv = line.trim().startsWith("environment:");
      continue;
    }
    if (!inEnv) continue;
    const m = line.match(/^ {6}([A-Z0-9_]+):\s*(.*)$/);
    if (m) env.set(m[1]!, (m[2] ?? "").replace(/^"|"$/g, "").trim());
  }
  return env;
}

describe("compose secure defaults (fresh deploy)", () => {
  // Docker is present in CI and on any host that can run this stack, but skip
  // rather than fail red on a machine without it — a false red here would
  // train people to ignore this file.
  let env: Map<string, string> | null = null;
  try {
    env = resolvedWebEnv();
  } catch {
    env = null;
  }
  const maybe = env === null ? it.skip : it;

  maybe("resolved something (guard against a vacuous sweep)", () => {
    // If the parse silently returned an empty map, every assertion below
    // would pass while checking nothing.
    expect(env!.size).toBeGreaterThan(10);
    expect(env!.has("ALLOW_DEV_AUTH")).toBe(true);
  });

  maybe("does not enable the dev-auth shim by default", () => {
    expect(env!.get("ALLOW_DEV_AUTH")).toBe("false");
  });

  maybe("does not disable the production dev-auth guard by default", () => {
    expect(env!.get("ALLOW_DEV_AUTH_IN_PRODUCTION")).toBe("false");
  });

  maybe("leaves a fresh deploy with no configured sign-in path", () => {
    // Not a bug — this is the locked state. Asserted so the test documents
    // WHY the two flags above must stay false: with these empty and the shim
    // enabled, getCurrentUserId() returns the first User row to anyone.
    expect(env!.get("ADMIN_USERNAME") ?? "").toBe("");
    expect(env!.get("AUTH_GITHUB_ID") ?? "").toBe("");
  });

  maybe("keeps the voucher gate on by default", () => {
    expect(env!.get("REGISTRATION_REQUIRES_VOUCHER")).toBe("true");
  });

  maybe("agrees with .env.example, which is what operators copy", () => {
    // The original defect was these two files disagreeing. Pin them together
    // so a future edit to one fails until the other follows.
    const example = execFileSync(
      "grep",
      ["-E", "^ALLOW_DEV_AUTH(_IN_PRODUCTION)?=", join(REPO_ROOT, ".env.example")],
      { encoding: "utf8" },
    );
    for (const line of example.trim().split("\n")) {
      const [key, raw] = line.split("=");
      const value = (raw ?? "").replace(/"/g, "").trim();
      expect(env!.get(key!.trim()), `${key} disagrees with .env.example`).toBe(
        value,
      );
    }
  });
});
