import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every script that can trigger a Docker build must stamp `APP_VERSION`.
 *
 * `deploy/docker-compose.yml` passes `APP_VERSION: ${APP_VERSION:-dev}` as a
 * build arg, which the Dockerfile turns into `NEXT_PUBLIC_APP_VERSION` —
 * inlined into the client bundle at BUILD time, so it cannot be corrected by
 * restarting the container. A build entrypoint that forgets the export bakes
 * the literal string "dev" into a tagged release, permanently, and the only
 * symptom is a version label nobody trusts.
 *
 * That is exactly what happened: `deploy.sh` and `dev-up.sh` both exported it,
 * `reload.sh` — the script that handles most rebuilds — did not. Prod served
 * `{"ok":true,"version":"dev"}` from /api/healthz on a v2.13.0 checkout.
 *
 * Per-script review cannot see this (each script is self-consistent), so this
 * ranges over ALL of them and fails when a new one is added without the stamp.
 */

const SCRIPTS_DIR = join(__dirname, "..", "..", "..", "..", "scripts");

const BUILD_CMD = /\$COMPOSE\s+build\b|compose[^\n]*\sbuild\b|up\b[^\n]*--build\b/;

/**
 * Comment lines are documentation, not behaviour. Every one of these scripts
 * documents its own `docker compose build` invocation in its header block, so
 * matching raw source finds the comment ~2500 chars before the real command
 * and makes the ordering assertion nonsense.
 */
function stripComments(body: string): string {
  return body
    .split("\n")
    .map((line) => (/^\s*#/.test(line) ? "" : line))
    .join("\n");
}

/** A script builds images if it runs `compose build` or `up --build`. */
function triggersDockerBuild(code: string): boolean {
  return BUILD_CMD.test(code);
}

function buildScripts(): { name: string; code: string }[] {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".sh"))
    .map((name) => ({
      name,
      code: stripComments(readFileSync(join(SCRIPTS_DIR, name), "utf8")),
    }))
    .filter(({ code }) => triggersDockerBuild(code));
}

describe("build version stamping", () => {
  it("finds the build entrypoints (guard against a vacuous sweep)", () => {
    // If the detector silently matched nothing, every assertion below would
    // pass while checking zero scripts — the failure mode that let the
    // original snippet tests pass against a shape no client accepts.
    const names = buildScripts().map((s) => s.name);
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(names).toContain("reload.sh");
  });

  for (const { name, code } of buildScripts()) {
    it(`${name} exports APP_VERSION before building`, () => {
      expect(code).toMatch(/export\s+APP_VERSION=/);
    });

    it(`${name} derives APP_VERSION from git describe, not a literal`, () => {
      // A hardcoded version is worse than "dev": it looks authoritative and
      // is wrong on every build after the one it was written for.
      const line = code
        .split("\n")
        .find((l) => /export\s+APP_VERSION=/.test(l));
      expect(line).toBeDefined();
      expect(line).toContain("git");
      expect(line).toContain("describe");
    });

    it(`${name} exports APP_VERSION before the build command runs`, () => {
      // Exporting after the build is a no-op that still passes a naive
      // "contains export APP_VERSION" check.
      const exportAt = code.search(/export\s+APP_VERSION=/);
      const buildAt = code.search(BUILD_CMD);
      expect(exportAt).toBeGreaterThanOrEqual(0);
      expect(buildAt).toBeGreaterThanOrEqual(0);
      expect(exportAt).toBeLessThan(buildAt);
    });
  }
});
