import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isEmailConfigured } from "../email.js";

/**
 * One rule for "is email deliverable", used by every caller.
 *
 * `sendEmail()` deliberately auto-detects Resend from a populated API key
 * even when `EMAIL_PROVIDER` is unset — its own comment says that exists
 * because "operators commonly drop a key into .env without remembering the
 * EMAIL_PROVIDER toggle", and `.env.example` documents that path.
 *
 * Both callers ignored it and tested `process.env.EMAIL_PROVIDER === "resend"`
 * themselves, so an operator following the documented ergonomic got a system
 * where sendEmail() *would* have delivered but nothing ever called it —
 * invites silently undelivered, password resets unusable. The exact failure
 * the auto-detect was written to prevent (KNOWN_ISSUES §0y).
 *
 * The source sweep matters more than the unit assertions: a future caller
 * that reimplements the check is the way this comes back.
 */

const ENV_KEYS = [
  "EMAIL_PROVIDER",
  "EMAIL_API_KEY",
  "RESEND_API",
  "RESEND_API_KEY",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("isEmailConfigured", () => {
  it("is false with nothing set", () => {
    expect(isEmailConfigured()).toBe(false);
  });

  it("is true when only a key is set — the documented ergonomic", () => {
    // This is the case both callers used to get wrong.
    process.env.EMAIL_API_KEY = "re_example";
    expect(isEmailConfigured()).toBe(true);
  });

  it("accepts either alias the module advertises", () => {
    process.env.RESEND_API_KEY = "re_example";
    expect(isEmailConfigured()).toBe(true);
    delete process.env.RESEND_API_KEY;
    process.env.RESEND_API = "re_example";
    expect(isEmailConfigured()).toBe(true);
  });

  it("is true with an explicit provider even before a key is added", () => {
    // sendEmail then reports "missing_api_key" rather than failing silently,
    // which is the more useful error for an operator mid-setup.
    process.env.EMAIL_PROVIDER = "resend";
    expect(isEmailConfigured()).toBe(true);
  });

  it('is false when the provider is explicitly "disabled", key or not', () => {
    process.env.EMAIL_PROVIDER = "disabled";
    process.env.EMAIL_API_KEY = "re_example";
    expect(isEmailConfigured()).toBe(false);
  });
});

describe("no caller reimplements the check", () => {
  /** Every .ts/.tsx under the apps, excluding build output. */
  function walk(dir: string, out: string[] = []): string[] {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const e of entries) {
      if (e === "node_modules" || e === ".next" || e === "dist") continue;
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(e)) out.push(full);
    }
    return out;
  }

  const APPS = join(__dirname, "..", "..", "..", "..", "apps");
  const files = walk(APPS);

  it("found the app sources (guards against a silent no-op)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no app file decides email-readiness on its own", () => {
    const offenders = files.filter((f) =>
      /EMAIL_PROVIDER\s*===/.test(readFileSync(f, "utf8")),
    );
    expect(
      offenders.map((f) => f.slice(APPS.length + 1)),
      "Import isEmailConfigured() from @brain/core instead — a local " +
        "`EMAIL_PROVIDER === \"resend\"` check ignores the key-only " +
        "auto-detect and silently disables delivery for operators who " +
        "followed .env.example.",
    ).toEqual([]);
  });
});
