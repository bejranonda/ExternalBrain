/**
 * GET /api/admin/backup-status — off-host backup replication heartbeat.
 *
 * Reports how long ago the backup-replicate sidecar last successfully synced
 * the postgres-backup-local dumps to remote storage. The sidecar writes a
 * Unix-epoch timestamp to /data/backups/.replicate-heartbeat after each sync;
 * the web container mounts brain_backups read-only at /data/backups so it can
 * stat the file without touching the backup volume data.
 *
 * The "warn" flag is set when lastSyncAge > threshold (default 2 × interval).
 *
 * Auth: platform admin only (requireAdmin()).
 * Returns 200 even if the heartbeat file is absent — "not configured" is
 * a valid state that the caller renders differently from "configured but late".
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { authErrorResponse } from "@/lib/brain/auth";
import { requireAdmin } from "@/lib/brain/admin-auth";

/** Path where the backup-replicate sidecar writes its heartbeat. */
const HEARTBEAT_PATH = join("/data/backups", ".replicate-heartbeat");

/** Default warn threshold: 2× the default sync interval (3600 s = 1 h). */
const DEFAULT_THRESHOLD_SECONDS = 7200;

export async function GET(_req: Request): Promise<Response> {
  try {
    await requireAdmin();

    if (!existsSync(HEARTBEAT_PATH)) {
      // The backup-replicate profile is not active, or the sidecar has not
      // completed its first sync yet.
      return Response.json({
        ok: false,
        configured: false,
        lastSyncAge: null,
        threshold: DEFAULT_THRESHOLD_SECONDS,
        warn: false,
        message: "backup-replicate not active or first sync not yet complete",
      });
    }

    const raw = readFileSync(HEARTBEAT_PATH, "utf8").trim();
    const epochSeconds = parseInt(raw, 10);

    if (isNaN(epochSeconds) || epochSeconds <= 0) {
      return Response.json(
        { ok: false, configured: true, error: "heartbeat_invalid" },
        { status: 200 },
      );
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const lastSyncAge = nowSeconds - epochSeconds;
    const warn = lastSyncAge > DEFAULT_THRESHOLD_SECONDS;

    return Response.json({
      ok: !warn,
      configured: true,
      lastSyncAge,
      threshold: DEFAULT_THRESHOLD_SECONDS,
      warn,
    });
  } catch (err) {
    return authErrorResponse(err);
  }
}
