import { afterEach, describe, expect, it } from "vitest";
import { CAPABILITIES } from "@brain/core";
import {
  agenticOnboardingEnabled,
  bootstrapInstallCommand,
  setPasswordUrl,
  startUrl,
  BOOTSTRAP_TOKEN_CAPABILITIES,
  BOOTSTRAP_TOKEN_TTL_DAYS,
  DEFAULT_BOOTSTRAP_CLIENT,
} from "./agentic-onboarding";

/**
 * `/api/onboard/claim` hands a live bearer to a caller who proved only that
 * they hold a voucher code. These assertions are the security posture of that
 * exchange, pinned where they can be checked without a database, an HTTP
 * server, or a deployed instance — the `public-urls.test.ts` precedent.
 *
 * A test that needed a live stack would not have run in CI, and this posture
 * is exactly the kind that erodes silently.
 */

const ORIGINAL = process.env.AGENTIC_ONBOARDING;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AGENTIC_ONBOARDING;
  else process.env.AGENTIC_ONBOARDING = ORIGINAL;
});

describe("the master switch is off unless explicitly opened", () => {
  it("defaults to disabled when the variable is absent", () => {
    delete process.env.AGENTIC_ONBOARDING;
    expect(agenticOnboardingEnabled()).toBe(false);
  });

  it("stays disabled for every value that isn't the literal 'true'", () => {
    // Hard rule 2 in AGENTS.md: a fresh deploy is locked until the operator
    // picks a posture. "1", "yes" and "TRUE " are the values an operator
    // reasonably guesses, and only one of them may open a bearer-vending
    // endpoint — the one the docs name.
    for (const v of ["", "false", "0", "1", "yes", "on", " true"]) {
      process.env.AGENTIC_ONBOARDING = v;
      expect(agenticOnboardingEnabled(), `value ${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("opens for 'true' in any casing", () => {
    for (const v of ["true", "TRUE", "True"]) {
      process.env.AGENTIC_ONBOARDING = v;
      expect(agenticOnboardingEnabled()).toBe(true);
    }
  });
});

describe("bootstrap token policy", () => {
  it("expires well short of the 90-day hand-minted default", () => {
    expect(BOOTSTRAP_TOKEN_TTL_DAYS).toBe(14);
  });

  it("cannot call the Oracle", () => {
    // The one billed capability. A headless mint that included it would turn
    // a leaked voucher into direct spend on the operator's provider account.
    expect(BOOTSTRAP_TOKEN_CAPABILITIES).not.toContain("oracle");
  });

  it("grants only capabilities the platform actually recognises", () => {
    // An unknown slug here would be dropped by sanitizeCapabilities at the
    // MCP boundary, and a token whose allow-list is entirely dropped reads as
    // UNRESTRICTED. A typo in this list is therefore a privilege escalation,
    // not a no-op.
    for (const c of BOOTSTRAP_TOKEN_CAPABILITIES) {
      expect(CAPABILITIES).toContain(c);
    }
  });

  it("is a real allow-list, not an empty array meaning unrestricted", () => {
    expect(BOOTSTRAP_TOKEN_CAPABILITIES.length).toBeGreaterThan(0);
  });
});

describe("install command resolution", () => {
  const base = {
    token: "bp_TESTTOKEN",
    mcpUrl: "https://mcp.example.com/mcp",
    webUrl: "https://brain.example.com",
  };

  it("returns a runnable one-liner carrying the token for the default client", () => {
    const r = bootstrapInstallCommand(base);
    expect(r.client).toBe(DEFAULT_BOOTSTRAP_CLIENT);
    expect(r.command).toContain("bp_TESTTOKEN");
    expect(r.command).toContain("https://brain.example.com");
  });

  it("falls back to the default client rather than throwing on an unknown id", () => {
    const r = bootstrapInstallCommand({
      ...base,
      client: "not-a-real-client" as never,
    });
    expect(r.client).toBe(DEFAULT_BOOTSTRAP_CLIENT);
    expect(r.command).not.toBeNull();
  });

  it("returns command:null with usable manualLines for clients that have no installer", () => {
    // `jetbrains` is configured through the IDE settings UI and `rest` is not
    // an MCP client at all. `InstallSnippet.command` is optional because of
    // these two; asserting it non-null would have crashed the exchange at
    // runtime after type-checking clean.
    for (const client of ["jetbrains", "rest"] as const) {
      const r = bootstrapInstallCommand({ ...base, client });
      expect(r.command, `${client} should have no one-liner`).toBeNull();
      expect(r.manualLines.length, `${client} needs manual steps`).toBeGreaterThan(0);
      expect(r.manualLines.join("\n")).toContain("bp_TESTTOKEN");
    }
  });

  it("varies the command by target OS", () => {
    const posix = bootstrapInstallCommand({ ...base, os: "linux" });
    const win = bootstrapInstallCommand({ ...base, os: "win32" });
    expect(posix.command).not.toBe(win.command);
    expect(win.command).toContain("onboard.ps1");
    expect(posix.command).toContain("onboard.sh");
  });
});

describe("hand-off URLs", () => {
  it("escapes the email into the set-password link", () => {
    expect(setPasswordUrl("https://brain.example.com", "a+b@example.com")).toBe(
      "https://brain.example.com/forgot-password?email=a%2Bb%40example.com",
    );
  });

  it("does not double a trailing slash", () => {
    expect(startUrl("https://brain.example.com/")).toBe("https://brain.example.com/start");
    expect(setPasswordUrl("https://brain.example.com/", "x@y.z")).toContain(
      "https://brain.example.com/forgot-password",
    );
  });
});
