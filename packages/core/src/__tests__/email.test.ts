/**
 * Unit tests for the email-sending utility (packages/core/src/email.ts).
 *
 * sendEmail() reads env at call time so we can control the provider per-test
 * via process.env mutations. The global fetch is mocked via vi.stubGlobal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SendEmailArgs } from "../email.js";

// We import the module fresh each time via dynamic import when needed,
// but for most tests we mock fetch before importing so the module-level
// RESEND_API constant is already set. We just import the function directly.

// Save + restore env so tests are hermetic.
const envBackup: Record<string, string | undefined> = {};
function saveEnv(...keys: string[]) {
  for (const k of keys) envBackup[k] = process.env[k];
}
function restoreEnv(...keys: string[]) {
  for (const k of keys) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
}

const ENV_KEYS = ["EMAIL_PROVIDER", "EMAIL_API_KEY", "EMAIL_FROM", "EMAIL_REPLY_TO"];

beforeEach(() => {
  saveEnv(...ENV_KEYS);
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  restoreEnv(...ENV_KEYS);
  vi.restoreAllMocks();
});

async function getSendEmail() {
  // Re-import after env change — vitest uses a module cache but since we're
  // testing at the call-time env read, we don't need to bust the cache.
  const { sendEmail } = await import("../email.js");
  return sendEmail;
}

const SAMPLE_ARGS: SendEmailArgs = {
  to: "user@example.com",
  subject: "Hello",
  html: "<p>Hello</p>",
  text: "Hello",
};

// ── disabled / missing provider ──────────────────────────────────────────────

describe("sendEmail — disabled provider", () => {
  it("returns {ok:false, reason:'disabled'} when EMAIL_PROVIDER is unset", async () => {
    const sendEmail = await getSendEmail();
    const result = await sendEmail(SAMPLE_ARGS);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("disabled");
  });

  it("returns {ok:false, reason:'disabled'} when EMAIL_PROVIDER='disabled'", async () => {
    process.env.EMAIL_PROVIDER = "disabled";
    const sendEmail = await getSendEmail();
    const result = await sendEmail(SAMPLE_ARGS);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("disabled");
  });

  it("does NOT call fetch when provider is disabled", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const sendEmail = await getSendEmail();
    await sendEmail(SAMPLE_ARGS);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("sendEmail — missing API key", () => {
  it("returns {ok:false, reason:'missing_api_key'} when provider=resend but key is empty", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    // EMAIL_API_KEY intentionally absent
    const sendEmail = await getSendEmail();
    const result = await sendEmail(SAMPLE_ARGS);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_api_key");
  });

  it("does NOT call fetch when API key is missing", async () => {
    process.env.EMAIL_PROVIDER = "resend";
    const fetchSpy = vi.spyOn(global, "fetch");
    const sendEmail = await getSendEmail();
    await sendEmail(SAMPLE_ARGS);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Resend happy path ─────────────────────────────────────────────────────────

describe("sendEmail — Resend happy path", () => {
  beforeEach(() => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.EMAIL_API_KEY = "test-resend-key";
    process.env.EMAIL_FROM = "External Brain <noreply@example.com>";
  });

  it("calls fetch with correct URL and Authorization header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg_123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const sendEmail = await getSendEmail();
    await sendEmail(SAMPLE_ARGS);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer test-resend-key",
    );
  });

  it("sends correct payload: from, to array, subject, html, text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg_456" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const sendEmail = await getSendEmail();
    await sendEmail(SAMPLE_ARGS);

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>;
    expect(body.from).toBe("External Brain <noreply@example.com>");
    expect(body.to).toEqual(["user@example.com"]);
    expect(body.subject).toBe("Hello");
    expect(body.html).toBe("<p>Hello</p>");
    expect(body.text).toBe("Hello");
  });

  it("returns {ok:true, messageId} on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg_789" }),
    }));

    const sendEmail = await getSendEmail();
    const result = await sendEmail(SAMPLE_ARGS);
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe("msg_789");
  });

  it("omits text from payload when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg_x" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const sendEmail = await getSendEmail();
    await sendEmail({ to: "a@b.com", subject: "s", html: "<p>h</p>" });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>;
    expect("text" in body).toBe(false);
  });

  it("uses EMAIL_REPLY_TO when set", async () => {
    process.env.EMAIL_REPLY_TO = "support@example.com";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg_rt" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const sendEmail = await getSendEmail();
    await sendEmail(SAMPLE_ARGS);

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>;
    expect(body.reply_to).toBe("support@example.com");
  });
});

// ── Resend error paths ────────────────────────────────────────────────────────

describe("sendEmail — Resend error paths", () => {
  beforeEach(() => {
    process.env.EMAIL_PROVIDER = "resend";
    process.env.EMAIL_API_KEY = "test-key";
  });

  it("returns {ok:false, reason} containing status when HTTP non-200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: "Invalid to address" }),
    }));

    const sendEmail = await getSendEmail();
    const result = await sendEmail(SAMPLE_ARGS);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("422");
    expect(result.reason).toContain("Invalid to address");
  });

  it("returns {ok:false, reason} with http status when body is unparseable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error("parse error"); },
    }));

    const sendEmail = await getSendEmail();
    const result = await sendEmail(SAMPLE_ARGS);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("500");
  });

  it("returns {ok:false, reason:'fetch_error:...'} when fetch() throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network unreachable")));

    const sendEmail = await getSendEmail();
    const result = await sendEmail(SAMPLE_ARGS);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^fetch_error:/);
    expect(result.reason).toContain("Network unreachable");
  });

  it("returns {ok:true} even when response body is non-JSON (messageId undefined)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new Error("not json"); },
    }));

    const sendEmail = await getSendEmail();
    const result = await sendEmail(SAMPLE_ARGS);
    expect(result.ok).toBe(true);
    expect(result.messageId).toBeUndefined();
  });
});
