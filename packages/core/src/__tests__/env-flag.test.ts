import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFlag } from "../env.js";

/**
 * One flag, one parser.
 *
 * Boolean env vars were being turned into booleans four different ways: the
 * `boolish` zod helper in this file (case-insensitive, `1|true|yes|on`),
 * `.toLowerCase() === "true"` in `apps/web/auth.ts`, a case-SENSITIVE
 * `=== "true"` in the password-reset route, and a case-sensitive `!== "false"`
 * in `robots.ts`.
 *
 * `ALLOW_RESET_LINK_IN_LOGS` had two of them at once — declared `boolish(false)`
 * in the schema and read raw at the point that actually decided whether a
 * password-reset link goes into the logs. `=yes` parsed true in one and false
 * in the other. That is the §0y shape ("one rule, three implementations,
 * silently disagreeing") on a flag that controls secret logging.
 */

describe("parseFlag semantics", () => {
  it("accepts the affirmatives operators actually write", () => {
    for (const v of ["1", "true", "TRUE", "True", "yes", "YES", "on", " true "]) {
      expect(parseFlag(v, false), v).toBe(true);
    }
  });

  it("accepts the negatives operators actually write", () => {
    for (const v of ["0", "false", "FALSE", "no", "off", " false "]) {
      expect(parseFlag(v, true), v).toBe(false);
    }
  });

  it("returns the default for absent or blank values", () => {
    for (const v of [undefined, null, "", "   "]) {
      expect(parseFlag(v, true), String(v)).toBe(true);
      expect(parseFlag(v, false), String(v)).toBe(false);
    }
  });

  it("returns the DEFAULT for unrecognised values, not false", () => {
    // The half that matters for security. Under the previous regex-only
    // implementation, `REGISTRATION_REQUIRES_VOUCHER=falsch` failed the truthy
    // test and silently became `false` — opening public signup on a typo. A
    // default-true flag must survive being misspelt.
    for (const v of ["falsch", "flase", "ture", "enabled", "maybe"]) {
      expect(parseFlag(v, true), `${v} with default true`).toBe(true);
      expect(parseFlag(v, false), `${v} with default false`).toBe(false);
    }
  });
});

/**
 * Env vars that are legitimately compared as raw strings, with the reason:
 *  - NODE_ENV: bundlers (Next, webpack) statically replace
 *    `process.env.NODE_ENV` at build time. Wrapping it in a function call
 *    defeats dead-code elimination, so it stays a literal comparison.
 *  - SKIP_DB_INIT: read inside `@brain/db`, which must not depend on
 *    `@brain/core` (that direction is the package-boundary rule).
 *  - SKIP_E2E / MEETING_UPLOAD_ENABLED in e2e specs: Playwright config, not
 *    runtime behaviour.
 *  - EMAIL_PROVIDER: not a boolean; `isEmailConfigured()` already owns it.
 */
const RAW_COMPARISON_ALLOWED = /\b(NODE_ENV|SKIP_DB_INIT|SKIP_E2E|EMAIL_PROVIDER)\b/;

const REPO = join(__dirname, "..", "..", "..", "..");
const ROOTS = [
  join(REPO, "apps", "web", "app"),
  join(REPO, "apps", "web", "lib"),
  join(REPO, "apps", "web", "components"),
  join(REPO, "apps", "mcp-server", "src"),
  join(REPO, "apps", "worker", "src"),
  join(REPO, "packages", "core", "src"),
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next" || e === "dist" || e === "generated") continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}

describe("no surface parses a boolean env var by hand", () => {
  const files = ROOTS.flatMap((r) => walk(r));

  it("sweeps a non-trivial number of files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("compares process.env to a string only where that is justified", () => {
    const offenders: string[] = [];
    const pattern =
      /process\.env(?:\.[A-Z_0-9]+|\["[A-Z_0-9]+"\])\s*(?:!==|===)\s*"[^"]*"/g;

    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(pattern)) {
        if (!RAW_COMPARISON_ALLOWED.test(m[0])) {
          offenders.push(`${relative(REPO, f)}: ${m[0]}`);
        }
      }
    }

    expect(
      offenders,
      "Use envFlag(name, default) from @brain/core/env instead. A hand-rolled " +
        "comparison is case-sensitive, rejects `1`/`yes`, and turns a typo in a " +
        "default-true flag into a silent opt-out.",
    ).toEqual([]);
  });
});
