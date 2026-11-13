/**
 * The worker's sunset notice job (docs/SUNSET.md): each account gets each
 * stage once, a dry run sends nothing, and an address that cannot receive
 * mail is never attempted.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "@brain/db";
import { runSunsetNotices, SUNSET_NOTICE_ACTION, type MailHostCheck } from "../sunset-notices.js";

const dbReachable = await db.user.count().then(() => true).catch(() => false);
const guard = dbReachable ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;

guard("runSunsetNotices", () => {
  const tag = randomBytes(5).toString("hex");
  const good = `good-${tag}.test`;
  const flaky = `flaky-${tag}.test`;
  // Every other domain in the shared test DB reads as unreachable, so the job
  // never mails — or records a send for — another test's users.
  const mailHost: MailHostCheck = async (d) => (d === good ? true : d === flaky ? "unknown" : false);
  const at = new Date(Date.now() + 20 * DAY);
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    for (const [k, email] of Object.entries({
      reachable: `ann-${tag}@${good}`,
      noMx: `bob-${tag}@nomx-${tag}.test`,
      flaky: `cat-${tag}@${flaky}`,
      erased: `erased_${tag}@deleted.local`,
    })) {
      ids[k] = (await db.user.create({ data: { email } })).id;
    }
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  });
  const setEnv = () => {
    process.env.SERVICE_SUNSET_AT = at.toISOString();
    process.env.SERVICE_SUNSET_KIND = "trial";
    process.env.BRAIN_PUBLIC_HOSTNAME = "brain.example.test";
    process.env.EMAIL_PROVIDER = "resend";
    process.env.EMAIL_API_KEY = "test-key";
  };
  afterEach(() => {
    for (const k of ["SERVICE_SUNSET_AT", "SERVICE_SUNSET_KIND", "BRAIN_PUBLIC_HOSTNAME", "EMAIL_PROVIDER", "EMAIL_API_KEY"]) delete process.env[k];
  });
  const sentTo = (send: { mock: { calls: unknown[][] } }) => send.mock.calls.map((c) => (c[0] as { to: string }).to);
  const records = (stage: "announce" | "week" | "final", userId: string) =>
    db.auditLog.count({ where: { action: SUNSET_NOTICE_ACTION(stage), targetId: userId } });

  it("does nothing without a sunset, or with emails off", async () => {
    const send = vi.fn();
    expect(await runSunsetNotices({ mode: "send", send, mailHost })).toEqual({ skipped: "no_sunset" });
    setEnv();
    expect(await runSunsetNotices({ mode: "off", send, mailHost })).toEqual({ skipped: "emails_off" });
    expect(send).not.toHaveBeenCalled();
  });

  it("a dry run reports who is due and sends nothing", async () => {
    setEnv();
    const send = vi.fn();
    const r = await runSunsetNotices({ mode: "dry_run", send, mailHost, pauseMs: 0 });
    expect(r).toMatchObject({ stage: "announce", mode: "dry_run" });
    expect("due" in r && r.due).toBeGreaterThanOrEqual(1);
    expect(send).not.toHaveBeenCalled();
    expect(await records("announce", ids.reachable!)).toBe(0);
  });

  it("sends the stage once, skipping unreachable, transient and erased addresses", async () => {
    setEnv();
    const send = vi.fn(async (_m: { to: string; subject: string; text?: string }) => ({ ok: true, messageId: "m1" }));
    await runSunsetNotices({ mode: "send", send, mailHost, pauseMs: 0 });
    expect(sentTo(send)).toEqual([`ann-${tag}@${good}`]);
    const call = send.mock.calls[0]![0];
    expect(call.subject).toBe(`Your External Brain trial ends on ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(at)}`);
    expect(call.text).toContain("https://brain.example.test/settings/data");
    expect(await records("announce", ids.reachable!)).toBe(1);
    for (const k of ["noMx", "flaky", "erased"]) expect(await records("announce", ids[k]!)).toBe(0);

    const again = vi.fn(async () => ({ ok: true }));
    await runSunsetNotices({ mode: "send", send: again, mailHost, pauseMs: 0 });
    expect(sentTo(again)).not.toContain(`ann-${tag}@${good}`);
  });

  it("the next stage is a new send; a provider failure records nothing and retries", async () => {
    setEnv();
    const failing = vi.fn(async () => ({ ok: false, reason: "http_500" }));
    const weekOut = new Date(at.getTime() - 3 * DAY);
    const r = await runSunsetNotices({ now: weekOut, mode: "send", send: failing, mailHost, pauseMs: 0 });
    expect(r).toMatchObject({ stage: "week" });
    expect(await records("week", ids.reachable!)).toBe(0);

    const ok = vi.fn(async () => ({ ok: true }));
    await runSunsetNotices({ now: weekOut, mode: "send", send: ok, mailHost, pauseMs: 0 });
    expect(sentTo(ok)).toContain(`ann-${tag}@${good}`);
    expect(await records("week", ids.reachable!)).toBe(1);
  });

  it("a postponed date is news: the announcement goes out again", async () => {
    setEnv();
    const later = new Date(at.getTime() + 14 * DAY);
    process.env.SERVICE_SUNSET_AT = later.toISOString();
    const send = vi.fn(async (_m: { to: string }) => ({ ok: true }));
    await runSunsetNotices({ mode: "send", send, mailHost, pauseMs: 0 });
    expect(sentTo(send)).toContain(`ann-${tag}@${good}`);
    expect(await records("announce", ids.reachable!)).toBe(2);
  });

  it("stops at the sunset instant, and refuses a malformed setting loudly", async () => {
    setEnv();
    expect(await runSunsetNotices({ now: at, mode: "send", send: vi.fn(), mailHost })).toEqual({ skipped: "after_sunset" });
    process.env.SERVICE_SUNSET_AT = "next month";
    await expect(runSunsetNotices({ mode: "send", send: vi.fn(), mailHost })).rejects.toThrow(/invalid/);
  });
});
