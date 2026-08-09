import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every operator flag the web app reads must be named in the compose web
 * service, because **compose forwards only what it names**.
 *
 * This has now bitten three times. `ALLOW_RESET_LINK_IN_LOGS` (#211) — the
 * operator sets it, no reset link appears, and nothing indicates the flag
 * never reached the container. Every `EMAIL_*` variable before 2026-08-07, so
 * `sendEmail()` returned `{ok:false, reason:"disabled"}` on every containerised
 * deployment while the docs told operators to configure it. And
 * `AGENTIC_ONBOARDING` in the very PR that introduced it: `.env` said `true`,
 * `.env.example` documented it, and `POST /api/onboard/claim` answered
 * `403 agentic_onboarding_disabled` in production because the compose file had
 * never heard of it.
 *
 * The failure mode is identical each time and it is the nastiest kind: the
 * feature is *off*, the config says *on*, and no error is raised anywhere. It
 * is invisible to `verify-lockdown.sh` (which probes a running instance) and
 * to every unit test (which reads `process.env` directly, where the value is
 * present).
 *
 * Each previous fix added one line to the compose file. This test asserts the
 * property across all N instead — the §2.6 discipline this repo keeps
 * relearning.
 */

const REPO = join(__dirname, "..", "..", "..", "..");
const COMPOSE = join(REPO, "deploy", "docker-compose.yml");

/**
 * The whole app, not a list of subdirectories.
 *
 * The first version of this file enumerated `app`, `lib`, `components` and
 * `auth.ts` — which is precisely the mistake `env-flag.test.ts` had made the
 * day before (it omitted `auth.ts` and so never checked the file its change
 * was about). Writing a sweep and then hand-listing its inputs re-creates the
 * gap the sweep exists to close: a new `envFlag` call anywhere else in
 * `apps/web` would silently bypass this gate.
 */
const WEB_ROOT = join(REPO, "apps", "web");

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "generated", "e2e", ".turbo"]);

function walk(target: string, out: string[] = []): string[] {
  let st;
  try {
    st = statSync(target);
  } catch {
    return out;
  }
  if (st.isFile()) {
    if (/\.tsx?$/.test(target) && !/\.test\.tsx?$/.test(target)) out.push(target);
    return out;
  }
  for (const e of readdirSync(target)) {
    if (SKIP_DIRS.has(e)) continue;
    walk(join(target, e), out);
  }
  return out;
}

/**
 * The web service's `environment:` block — from the start of the `web:` service
 * to the start of the next top-level service. Parsed rather than searched
 * whole-file so a variable forwarded to `worker` or `mcp-server` (but not
 * `web`) still counts as missing, which is the actual bug shape.
 */
function webServiceEnvBlock(): string {
  const src = readFileSync(COMPOSE, "utf8");
  const start = src.indexOf("\n  web:");
  expect(start, "could not locate the `web:` service in docker-compose.yml").toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n {2}[a-z][a-z0-9-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("compose forwards every flag the web app reads", () => {
  const files = walk(WEB_ROOT).map((f) => ({
    rel: relative(REPO, f),
    src: readFileSync(f, "utf8"),
  }));

  // `envFlag("NAME", …)` is the single sanctioned way to read a boolean
  // operator flag (see GUIDELINES §7), which makes it a reliable index of
  // what the web app expects the operator to be able to set.
  const referenced = new Map<string, string>();
  for (const { rel, src } of files) {
    for (const m of src.matchAll(/envFlag\(\s*["']([A-Z_0-9]+)["']/g)) {
      if (!referenced.has(m[1]!)) referenced.set(m[1]!, rel);
    }
  }

  it("finds the flags at all (guard against a vacuous sweep)", () => {
    // A regex that silently matched nothing would satisfy the assertion below
    // while checking zero flags — the §0r failure this repo keeps hitting.
    expect(referenced.size).toBeGreaterThanOrEqual(3);
  });

  it("names each one in the web service environment", () => {
    const envBlock = webServiceEnvBlock();
    const missing = [...referenced.entries()]
      .filter(([name]) => !new RegExp(`^\\s*${name}:`, "m").test(envBlock))
      .map(([name, rel]) => `${name} (read in ${rel})`);

    expect(
      missing,
      "These flags are read by the web app but never forwarded into the " +
        "container. Compose passes ONLY what it names, so the operator sets " +
        "them in .env, sees no effect, and gets no error. Add each to the " +
        "`web:` service's `environment:` block as NAME: ${NAME:-<default>}.",
    ).toEqual([]);
  });

  it("forwards each one from its OWN variable, with an explicit default", () => {
    // Being named is not enough. All three of these are named and all three
    // are broken:
    //   AGENTIC_ONBOARDING: false                 — hardcoded, ignores .env
    //   AGENTIC_ONBOARDING: ${OTHER_FLAG:-false}  — forwards the wrong variable
    //   AGENTIC_ONBOARDING: ${AGENTIC_ONBOARDING} — no visible default
    // The first two silently disconnect the operator's .env from the container
    // while looking correct in review, which is the same "config says on,
    // feature is off" shape this whole file exists to prevent.
    const envBlock = webServiceEnvBlock();
    const wrong: string[] = [];

    for (const name of referenced.keys()) {
      const line = envBlock.match(new RegExp(`^\\s*${name}:.*$`, "m"))?.[0];
      if (!line) continue; // absence is the previous test's job
      const wellFormed = new RegExp(
        `^\\s*${name}:\\s*\\$\\{${name}:-[^}]*\\}\\s*$`,
      ).test(line);
      if (!wellFormed) wrong.push(line.trim());
    }

    expect(
      wrong,
      "Each flag must be forwarded as NAME: ${NAME:-<default>} — same variable " +
        "on both sides, and a default that a reader can see without opening " +
        ".env.example.",
    ).toEqual([]);
  });
});
