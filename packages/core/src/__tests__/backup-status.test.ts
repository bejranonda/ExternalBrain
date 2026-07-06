/**
 * Tests for the backup-status heartbeat logic.
 *
 * The GET /api/admin/backup-status route reads a Unix-epoch timestamp from
 * /data/backups/.replicate-heartbeat and computes `lastSyncAge` + `warn`.
 * These tests validate the core arithmetic and edge-case handling that live
 * in the route but can be exercised as pure functions here.
 */
import { describe, it, expect } from "vitest";

// ── Pure helpers mirroring the route logic ─────────────────────────────────

const DEFAULT_THRESHOLD = 7200; // 2 × default 3600-s interval

function parseHeartbeat(
  raw: string,
  nowSeconds: number,
): { ok: boolean; lastSyncAge: number; warn: boolean; threshold: number } | { ok: false; error: string } {
  const epochSeconds = parseInt(raw.trim(), 10);
  if (isNaN(epochSeconds) || epochSeconds <= 0) {
    return { ok: false, error: "heartbeat_invalid" };
  }
  const lastSyncAge = nowSeconds - epochSeconds;
  const warn = lastSyncAge > DEFAULT_THRESHOLD;
  return { ok: !warn, lastSyncAge, warn, threshold: DEFAULT_THRESHOLD };
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe("backup-status heartbeat parsing", () => {
  const NOW = 1_800_000_000; // arbitrary fixed "now" (seconds since epoch)

  it("returns ok:true and warn:false when sync was recent (5 minutes ago)", () => {
    const result = parseHeartbeat(String(NOW - 300), NOW);
    expect(result).toEqual({
      ok: true,
      lastSyncAge: 300,
      warn: false,
      threshold: DEFAULT_THRESHOLD,
    });
  });

  it("returns ok:false and warn:true when sync was exactly one second over threshold", () => {
    const result = parseHeartbeat(String(NOW - DEFAULT_THRESHOLD - 1), NOW);
    expect(result).toEqual({
      ok: false,
      lastSyncAge: DEFAULT_THRESHOLD + 1,
      warn: true,
      threshold: DEFAULT_THRESHOLD,
    });
  });

  it("returns ok:true and warn:false when sync was exactly at threshold (boundary)", () => {
    const result = parseHeartbeat(String(NOW - DEFAULT_THRESHOLD), NOW);
    expect(result).toEqual({
      ok: true,
      lastSyncAge: DEFAULT_THRESHOLD,
      warn: false,
      threshold: DEFAULT_THRESHOLD,
    });
  });

  it("returns heartbeat_invalid for NaN input", () => {
    const result = parseHeartbeat("not-a-number", NOW);
    expect(result).toMatchObject({ ok: false, error: "heartbeat_invalid" });
  });

  it("returns heartbeat_invalid for zero", () => {
    const result = parseHeartbeat("0", NOW);
    expect(result).toMatchObject({ ok: false, error: "heartbeat_invalid" });
  });

  it("returns heartbeat_invalid for negative value", () => {
    const result = parseHeartbeat("-1", NOW);
    expect(result).toMatchObject({ ok: false, error: "heartbeat_invalid" });
  });

  it("handles whitespace-padded heartbeat value", () => {
    const result = parseHeartbeat(`  ${NOW - 60}  \n`, NOW);
    expect(result).toMatchObject({ ok: true, lastSyncAge: 60, warn: false });
  });

  it("returns warn:true for a sync that happened 3 hours ago", () => {
    const result = parseHeartbeat(String(NOW - 10800), NOW);
    expect(result).toMatchObject({ warn: true, lastSyncAge: 10800 });
  });

  it("lastSyncAge is 0 when heartbeat matches now exactly", () => {
    const result = parseHeartbeat(String(NOW), NOW);
    expect(result).toMatchObject({ ok: true, lastSyncAge: 0, warn: false });
  });
});

// ── Nightly-dump age logic (mirrors readDumpStatus in the route) ────────────

const DUMP_MAX_AGE = 93_600; // 26 h default

function dumpStatusFromMtimes(
  newestMtimeMs: number | null,
  nowSeconds: number,
): { configured: boolean; lastDumpAge: number | null; warn: boolean } {
  if (newestMtimeMs === null) return { configured: false, lastDumpAge: null, warn: false };
  if (newestMtimeMs === 0) return { configured: true, lastDumpAge: null, warn: true };
  const lastDumpAge = nowSeconds - Math.floor(newestMtimeMs / 1000);
  return { configured: true, lastDumpAge, warn: lastDumpAge > DUMP_MAX_AGE };
}

describe("backup-status nightly-dump age", () => {
  const NOW = 1_800_000_000;

  it("fresh dump (8 h ago) is ok", () => {
    const r = dumpStatusFromMtimes((NOW - 8 * 3600) * 1000, NOW);
    expect(r).toEqual({ configured: true, lastDumpAge: 8 * 3600, warn: false });
  });

  it("stale dump (3 days ago) warns — the v1.11.1 silent-failure state", () => {
    const r = dumpStatusFromMtimes((NOW - 3 * 86400) * 1000, NOW);
    expect(r.warn).toBe(true);
    expect(r.lastDumpAge).toBe(3 * 86400);
  });

  it("exactly at the threshold does not warn; one second past does", () => {
    expect(dumpStatusFromMtimes((NOW - DUMP_MAX_AGE) * 1000, NOW).warn).toBe(false);
    expect(dumpStatusFromMtimes((NOW - DUMP_MAX_AGE - 1) * 1000, NOW).warn).toBe(true);
  });

  it("dumps dir present but empty = configured-and-never-succeeded → warn", () => {
    expect(dumpStatusFromMtimes(0, NOW)).toEqual({ configured: true, lastDumpAge: null, warn: true });
  });

  it("dumps dir absent = not configured, no warn", () => {
    expect(dumpStatusFromMtimes(null, NOW)).toEqual({ configured: false, lastDumpAge: null, warn: false });
  });
});
