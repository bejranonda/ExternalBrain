import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

/**
 * `/api/healthz` is not just a liveness probe — the `prod-drift` workflow
 * reads it to decide (a) whether the deployment is behind `main` and
 * (b) whether it is even looking at the right deployment.
 *
 * That second guard is why this file exists. `BRAIN_DEPLOY_URL` pointed at
 * the dev host for months, so the watchdog reported dev's version under a
 * "Production is running X" title and the stale-deploy gap it exists to
 * close stayed open while appearing covered (KNOWN_ISSUES §0al). The fix
 * is the `environment` field asserted by the workflow — which means quietly
 * dropping or renaming that field silently restores the original bug, with
 * the workflow degrading to "cannot verify" and nobody noticing.
 *
 * A contract read by something outside this repo needs a test inside it.
 */

const ORIGINAL = process.env.BRAIN_DEPLOY_ENV;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BRAIN_DEPLOY_ENV;
  else process.env.BRAIN_DEPLOY_ENV = ORIGINAL;
});

async function body(): Promise<Record<string, unknown>> {
  return (await GET().json()) as Record<string, unknown>;
}

describe("/api/healthz contract (read by the prod-drift workflow)", () => {
  it("reports ok + a version field", async () => {
    const json = await body();
    expect(json.ok).toBe(true);
    expect(json).toHaveProperty("version");
  });

  it("echoes BRAIN_DEPLOY_ENV as `environment` so the watchdog can verify its target", async () => {
    process.env.BRAIN_DEPLOY_ENV = "production";
    expect((await body()).environment).toBe("production");
  });

  it("does not conflate tiers — a dev deployment reports dev", async () => {
    // The whole point: pointing the watchdog at dev must be detectable.
    process.env.BRAIN_DEPLOY_ENV = "dev";
    expect((await body()).environment).toBe("dev");
  });

  it("reports null when unset rather than defaulting to production", async () => {
    // Fail-safe, not fail-silent. A default of "production" would let an
    // unconfigured host certify itself as prod — restoring the false
    // confidence this field was added to remove. The workflow maps null to
    // "cannot verify" and refuses to report drift.
    delete process.env.BRAIN_DEPLOY_ENV;
    expect((await body()).environment).toBeNull();
  });

  it("trims whitespace so a stray newline in .env can't break the comparison", async () => {
    process.env.BRAIN_DEPLOY_ENV = "  production\n";
    expect((await body()).environment).toBe("production");
  });
});
