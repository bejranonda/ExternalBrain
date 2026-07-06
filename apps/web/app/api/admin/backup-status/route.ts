/**
 * GET /api/admin/backup-status — backup health, both halves:
 *
 * 1. **On-host dumps** (`backup` service, pg_dump nightly at 03:00): the age
 *    of the newest `*.sql.gz` under /data/backups/last. This is the alert the
 *    v1.11.1 incident demanded — the dump failed silently every night for
 *    three weeks while its container sat "unhealthy" in a `ps` no one ran
 *    (KNOWN_ISSUES §0f). `dump.warn` fires when the newest dump is older than
 *    BACKUP_DUMP_MAX_AGE (default 26 h = daily schedule + slack), so a broken
 *    pg_dump surfaces on the admin overview within a day instead of weeks.
 * 2. **Off-host replication** (`backup-replicate` sidecar, opt-in): how long
 *    ago the sidecar last synced the dumps to remote storage, via the
 *    Unix-epoch timestamp it writes to /data/backups/.replicate-heartbeat.
 *
 * The web container mounts brain_backups read-only at /data/backups so both
 * checks are pure filesystem stats. Top-level `ok` is the AND of both halves
 * (an unconfigured half is not a failure). Response keeps the original
 * heartbeat fields at top level for backward compatibility and adds `dump`.
 *
 * Auth: platform admin only (requireAdmin()).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { authErrorResponse } from "@/lib/brain/auth";
import { requireAdmin } from "@/lib/brain/admin-auth";

const BACKUPS_ROOT = "/data/backups";

/** Path where the backup-replicate sidecar writes its heartbeat. */
const HEARTBEAT_PATH = join(BACKUPS_ROOT, ".replicate-heartbeat");

/** postgres-backup-local writes each run's dump into ./last. */
const DUMPS_DIR = join(BACKUPS_ROOT, "last");

/** Default sync-warn threshold: 2× the default 3600-s sync interval. */
const DEFAULT_THRESHOLD_SECONDS = 7200;

/** Dump-warn threshold: daily 03:00 schedule + slack. Env-tunable. */
const DUMP_MAX_AGE_SECONDS = (() => {
  const n = Number(process.env.BACKUP_DUMP_MAX_AGE);
  return Number.isFinite(n) && n > 0 ? n : 93_600; // 26 h
})();

interface DumpStatus {
  configured: boolean;
  lastDumpAge: number | null;
  threshold: number;
  warn: boolean;
}

/** Age in seconds of the newest *.sql.gz under /data/backups/last. */
function readDumpStatus(nowSeconds: number): DumpStatus {
  const base: DumpStatus = {
    configured: false,
    lastDumpAge: null,
    threshold: DUMP_MAX_AGE_SECONDS,
    warn: false,
  };
  if (!existsSync(DUMPS_DIR)) return base; // backup service off / first run pending
  let newestMtime = 0;
  try {
    for (const name of readdirSync(DUMPS_DIR)) {
      if (!name.endsWith(".sql.gz")) continue;
      const mtime = statSync(join(DUMPS_DIR, name)).mtimeMs;
      if (mtime > newestMtime) newestMtime = mtime;
    }
  } catch {
    return base; // unreadable — treat as unconfigured rather than 500
  }
  if (newestMtime === 0) {
    // Directory exists but holds no dumps yet: the service is wired up but
    // has never succeeded — that IS the silent-failure state. Warn.
    return { ...base, configured: true, warn: true };
  }
  const lastDumpAge = nowSeconds - Math.floor(newestMtime / 1000);
  return {
    configured: true,
    lastDumpAge,
    threshold: DUMP_MAX_AGE_SECONDS,
    warn: lastDumpAge > DUMP_MAX_AGE_SECONDS,
  };
}

export async function GET(_req: Request): Promise<Response> {
  try {
    await requireAdmin();

    const nowSeconds = Math.floor(Date.now() / 1000);
    const dump = readDumpStatus(nowSeconds);

    if (!existsSync(HEARTBEAT_PATH)) {
      // The backup-replicate profile is not active, or the sidecar has not
      // completed its first sync yet.
      return Response.json({
        ok: !dump.warn,
        configured: false,
        lastSyncAge: null,
        threshold: DEFAULT_THRESHOLD_SECONDS,
        warn: false,
        message: "backup-replicate not active or first sync not yet complete",
        dump,
      });
    }

    const raw = readFileSync(HEARTBEAT_PATH, "utf8").trim();
    const epochSeconds = parseInt(raw, 10);

    if (isNaN(epochSeconds) || epochSeconds <= 0) {
      return Response.json(
        { ok: !dump.warn, configured: true, error: "heartbeat_invalid", dump },
        { status: 200 },
      );
    }

    const lastSyncAge = nowSeconds - epochSeconds;
    const warn = lastSyncAge > DEFAULT_THRESHOLD_SECONDS;

    return Response.json({
      ok: !warn && !dump.warn,
      configured: true,
      lastSyncAge,
      threshold: DEFAULT_THRESHOLD_SECONDS,
      warn,
      dump,
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
