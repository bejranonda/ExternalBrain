/**
 * KEA model evaluation harness — replay real sessions against candidate models.
 *
 * Why this exists: on 2026-08-18 a single synthetic session ranked glm-5.3
 * first for extraction. Replayed against five REAL sessions it came last —
 * it returned zero findings on the richest one and emitted a schema-invalid
 * `type`. Model choice here cannot be made from a hand-written payload, and
 * KEA's failure mode is a silent empty extraction that no unit test and no
 * amount of production monitoring will surface as an error.
 *
 * Read-only: replays the mining prompt, persists nothing, touches no queue.
 *
 * Usage:
 *   pnpm --filter @brain/worker eval:kea
 *   pnpm --filter @brain/worker eval:kea -- --models glm-4.7,glm-5.3 --limit 8
 *
 * Interpreting the output: prefer the model with the fewest `empty` runs and
 * zero `schemaBad`, then the lowest p95 latency. Total finding count is the
 * weakest signal — a verbose model inflates it without adding value.
 */
import { db } from "@brain/db";
import { getLogger } from "@brain/core";
import { SYSTEM_PROMPT as KEA_SYSTEM_PROMPT, isValidFinding, type KEAFinding } from "@brain/core/kea";
import { callLLMText } from "@brain/core/llm";

const log = getLogger("worker");

const DEFAULT_MODELS = ["glm-4.5", "glm-4.7", "glm-5.3"];

interface Replayable {
  sessionId: string;
  prompt: string;
  language: string | null;
  framework: string | null;
  finalBuildSuccess: boolean;
  submittedLearnings: unknown[];
}

/**
 * Sessions worth replaying: those carrying `learning_captured` events. A
 * session with no captured learnings has nothing to extract, so including
 * them would dilute every model's score identically and hide real differences.
 */
async function loadSessions(limit: number): Promise<Replayable[]> {
  return db.$queryRawUnsafe<Replayable[]>(
    `
    SELECT
      s.id AS "sessionId",
      COALESCE((SELECT e.payload->>'prompt' FROM "SessionEvent" e
                WHERE e."sessionId" = s.id AND e."eventType" = 'session_started' LIMIT 1), '') AS prompt,
      s.metadata->>'language'  AS language,
      s.metadata->>'framework' AS framework,
      (s.outcome = 'success')  AS "finalBuildSuccess",
      COALESCE((SELECT json_agg(e2.payload) FROM "SessionEvent" e2
                WHERE e2."sessionId" = s.id AND e2."eventType" = 'learning_captured'), '[]'::json)
        AS "submittedLearnings"
    FROM "Session" s
    WHERE EXISTS (SELECT 1 FROM "SessionEvent" e3
                  WHERE e3."sessionId" = s.id AND e3."eventType" = 'learning_captured')
    ORDER BY s."startedAt" DESC
    LIMIT ${limit}
    `,
  );
}

interface Score {
  runs: number;
  empty: number;
  schemaBad: number;
  parseFail: number;
  findings: number;
  latencies: number[];
}

function p95(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!;
}

async function scoreModel(model: string, sessions: Replayable[]): Promise<Score> {
  const sc: Score = { runs: 0, empty: 0, schemaBad: 0, parseFail: 0, findings: 0, latencies: [] };

  for (const s of sessions) {
    const userPrompt =
      `SESSION SUMMARY:\n${JSON.stringify(s, null, 2)}\n\nExtract now.`;
    const started = Date.now();
    let text: string;
    try {
      text = await callLLMText(userPrompt, {
        model,
        systemPrompt: KEA_SYSTEM_PROMPT,
        maxTokens: 1024,
      });
    } catch (err) {
      sc.runs += 1;
      sc.parseFail += 1;
      log.warn({ model, sessionId: s.sessionId, err }, "eval-kea: call failed");
      continue;
    }
    sc.latencies.push(Date.now() - started);
    sc.runs += 1;

    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let parsed: { findings?: unknown[] };
    try {
      parsed = JSON.parse(cleaned) as { findings?: unknown[] };
    } catch {
      sc.parseFail += 1;
      continue;
    }
    const list = Array.isArray(parsed.findings) ? parsed.findings : [];
    if (list.length === 0) sc.empty += 1;
    // Same predicate production uses, so "schemaBad" counts findings that
    // would be silently dropped before ever reaching the Knowledge table.
    sc.schemaBad += list.filter((f) => !isValidFinding(f as KEAFinding)).length;
    sc.findings += list.length;
  }
  return sc;
}

function parseFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const models = (parseFlag("models") ?? DEFAULT_MODELS.join(",")).split(",").map((m) => m.trim());
  const limit = Number(parseFlag("limit") ?? 10);
  const sessions = await loadSessions(Number.isFinite(limit) ? limit : 10);

  if (sessions.length === 0) {
    log.warn({}, "eval-kea: no sessions with learning_captured events — nothing to replay");
    return;
  }

  const rows: string[] = [];
  for (const model of models) {
    const sc = await scoreModel(model, sessions);
    rows.push(
      [
        model.padEnd(12),
        `runs=${sc.runs}`.padEnd(9),
        `empty=${sc.empty}`.padEnd(9),
        `schemaBad=${sc.schemaBad}`.padEnd(14),
        `parseFail=${sc.parseFail}`.padEnd(14),
        `findings=${sc.findings}`.padEnd(14),
        `p95=${p95(sc.latencies)}ms`,
      ].join(" "),
    );
  }

  // Printed rather than logged: this is a human-read comparison table, and
  // JSON log lines make columns unreadable in a terminal.
  console.log(`\nKEA model evaluation — ${sessions.length} real sessions replayed\n`);
  console.log(rows.join("\n"));
  console.log(
    "\nPrefer: fewest `empty`, then schemaBad=0, then lowest p95. " +
      "High `findings` alone means verbose, not better.\n",
  );
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main()
    .catch((err) => {
      log.fatal({ err }, "eval-kea failed");
      process.exitCode = 1;
    })
    .finally(() => void db.$disconnect());
}
