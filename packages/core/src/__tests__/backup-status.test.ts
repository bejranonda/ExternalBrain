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
