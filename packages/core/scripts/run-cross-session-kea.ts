/**
 * Cross-session KEA driver (2026-05-12).
 *
 * Picks the most recent N closed Sessions (one per user) and runs
 * `extractFromCrossSessions` against them. Designed to be runnable from
 * the bootstrap container during dev / proof-of-concept:
 *
 *   pnpm --filter @brain/core exec tsx scripts/run-cross-session-kea.ts
 *
 * Once the proof works, wire this as a pg-boss schedule in
 * apps/worker/src/index.ts under a `kea.cross_extract` queue.
 */
import { db } from "@brain/db";
import { extractFromCrossSessions } from "../src/kea.js";

const WINDOW = Number(process.env.CROSS_SESSION_WINDOW ?? 20);

async function main(): Promise<void> {
  // Group recently-closed sessions by user, keep up to WINDOW per user.
  // Cross-session KEA is per-user — patterns belong to individuals, not
  // the org. Sessions are ordered oldest-first inside each user's bundle
  // so the LLM sees progression.
  const closed = await db.session.findMany({
    where: { endedAt: { not: null } },
    orderBy: { endedAt: "desc" },
    take: 200, // overshoot; we'll group + slice per user below
    select: { id: true, userId: true, endedAt: true },
  });
  if (closed.length === 0) {
    console.log("[cross-session-kea] no closed sessions found");
    return;
  }

  const byUser = new Map<string, string[]>();
  for (const s of closed) {
    if (!byUser.has(s.userId)) byUser.set(s.userId, []);
    const arr = byUser.get(s.userId)!;
    if (arr.length < WINDOW) arr.unshift(s.id); // unshift → oldest first
  }

  for (const [userId, sessionIds] of byUser) {
    if (sessionIds.length < 2) {
      console.log(
        `[cross-session-kea] user=${userId.slice(0, 8)} only ${sessionIds.length} closed sessions — need ≥2`,
      );
      continue;
    }
    console.log(
      `[cross-session-kea] user=${userId.slice(0, 8)} running over ${sessionIds.length} sessions…`,
    );
    try {
      const persisted = await extractFromCrossSessions({ userId, sessionIds });
      console.log(
        `[cross-session-kea] user=${userId.slice(0, 8)} persisted=${persisted.length}`,
      );
      for (const k of persisted) {
        console.log(
          `  → ${k.id} ${k.type} conf=${k.confidence.toFixed(2)} sources=${k.sourceSessionIds.length}`,
        );
        console.log(`     trigger: ${k.triggerText.slice(0, 90)}`);
        console.log(`     rule:    ${k.ruleText.slice(0, 90)}`);
      }
    } catch (err) {
      console.error(
        `[cross-session-kea] user=${userId.slice(0, 8)} FAILED:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  await db.$disconnect();
}

main().catch((err) => {
  console.error("[cross-session-kea] fatal:", err);
  process.exit(1);
});
