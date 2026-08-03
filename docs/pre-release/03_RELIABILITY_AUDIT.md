# Pass 3 — Worker, Database & Background-Process Reliability Audit

**Role:** Principal Reliability Engineer
**Scope:** `apps/worker`, `packages/db`, background paths in `packages/core`
**Baseline:** `202fe7a` (`v2.7.1`), branch `main`, 2026-08-02.

## Method & honesty statement

Static audit; no job was run, no failure injected, no migration applied.

- ✅ **Performed:** full read of `apps/worker/src` (both files), every pg-boss
  queue definition and handler, all 13 `$transaction` sites, the LLM and
  embedding seams, the migration set and its entrypoints in both deploy scripts,
  and `/api/admin/backup-status`.
- ⬜ **Not performed (reviewer must do):** `prisma migrate deploy` against a
  fresh Postgres, a SIGTERM-during-job test, a forced LLM 5xx.
- ⚠️ **One assumption flagged in place (R-6):** the Anthropic/OpenAI SDK default
  timeout. `node_modules` is not installed in this checkout, so I could not read
  the shipped default and am relying on the vendors' documented value. The
  finding names this explicitly.

---

## Findings

| ID | Severity | Finding |
|---|---|---|
| **R-1** | **[HIGH]** | `callLLMText` has no timeout, no retry, no rate-limit handling — while its sibling `embedding.ts` has all three. |
| **R-2** | **[HIGH]** | Worker has no SIGTERM/SIGINT handler. Every deploy kills in-flight jobs mid-execution. |
| **R-3** | **[HIGH]** | `FAILED_EXTRACTION` does not exist anywhere in the codebase. A session whose extraction failed is indistinguishable from one that succeeded. |
| **R-4** | [MEDIUM] | No dead-letter queue on any of the nine queues. Exhausted jobs land in `failed` with no surface that reads them. |
| **R-5** | [MEDIUM] | Five of nine handlers have no `try`/`catch` and no `captureError` — their failures reach neither Sentry nor the structured log. |
| **R-6** | [MEDIUM] | The LLM SDK's default timeout is ≥ `expireInSeconds` for `kea.extract`, so job expiry races the in-flight call → duplicate spend. |
| **R-7** | [MEDIUM] | All 13 interactive transactions rely on Prisma's implicit 5-second default; none sets `timeout`. |
| **R-8** | [LOW] | Floating promise at module load; no `unhandledRejection` / `uncaughtException` handler. |
| **R-9** | [LOW] | `summarizeSession` feeds KEA hardcoded zeros for `durationMs`, `tokensUsed`, `knowledgeUsed`. |
| **R-10** | [LOW] | `authenticate()` writes `lastUsedAt` on every MCP request — one row write per tool call. |
| **R-11** | [LOW] | Synchronous `fs` calls inside the `backup-status` route handler. |

### Verified healthy — skip these in review

- **Retry/backoff/expire is configured per queue, not left to defaults.** All
  nine queues pass explicit `retryLimit` / `retryBackoff` / `expireInSeconds` to
  `createQueue` (`index.ts:52-93`), with the reasoning for each value written
  down. This is better than most production workers.
- **Cron overlap is prevented.** Every `schedule()` passes a `singletonKey`
  (`:230-244`), with the comment explaining the concrete failure it avoids — a
  12-minute backfill being lapped by the 10-minute tick and double-spending
  embedding API.
- **Job payloads are validated at the worker boundary.** `sessionJobSchema`
  (`:20-23`) + `parseSessionJob` (`:96-103`) reject malformed payloads with a log
  line instead of crashing on `findUniqueOrThrow(undefined)`.
- **Poison-message handling is correct.** `isPrismaRecordNotFound` (`:113-117`)
  short-circuits P2025 so a session deleted between enqueue and process
  completes the job instead of burning three retries.
- **The Oracle cost cap is genuinely atomic.** `reserveCapSlot`
  (`cost.ts:138-175`) takes `pg_advisory_xact_lock` keyed on `(userId, day)`,
  which fixes the documented non-atomic check-then-record race.
- **Embedding calls retry on transient failures** (`embedding.ts:16,92`) with a
  classifier for `rate.?limit|quota|timeout|exceeded|unavailable|temporarily`.
- **Migration safety: PASS** — see the dedicated section below.
- **Backup staleness alarm: PASS** — see the dedicated section below.

---

## 1. Failure-mode inspection

### R-1 — [HIGH] The LLM seam has no resilience; its sibling does

`packages/core/src/llm.ts` is the single dispatch point for **every** LLM call in
the background pipeline — `kea.ts:733,746,759`, `autoskill-classifier.ts:365`,
`meeting-extract.ts`. In 121 lines it contains **no** `catch`, **no** `retry`,
**no** `timeout`, and **no** error classification. It constructs a vendor client
and awaits:

```ts
// packages/core/src/llm.ts:45-50 — the entire error strategy
const res = await client.messages.create({
  model: opts.model,
  max_tokens: opts.maxTokens ?? 1024,
  system: opts.systemPrompt ?? DEFAULT_SYSTEM,
  messages: [{ role: "user", content: prompt }],
});
```

Now compare the file next to it. `packages/core/src/embedding.ts` classifies
transient failures and retries:

```ts
// packages/core/src/embedding.ts:16 (docblock) and :92
//   "We retry once on rate-limit / transient errors before giving up"
return /rate.?limit|quota|timeout|exceeded|unavailable|temporarily/.test(msg);
```

…and wraps failures in a `BrainError` carrying a `retryable` flag
(`:114-171`). **The 429 lesson was learned and applied to the embedding path,
then never carried across to the chat path.**

The practical effect: a provider 429 or 503 during `kea.extract` propagates
straight out of `callLLMText`, past the handler's `catch`, and re-throws
(`worker/index.ts:165`). pg-boss retries with backoff — three attempts, then the
job is dead and **that session is never extracted from**. Under a sustained rate
limit every session in the window is lost, and (per R-3) nothing records that it
happened.

The vendor SDKs do carry their own internal retry defaults, which is why this
has not been catastrophic. But that behaviour is undeclared, differs per
provider, and can change under a dependency bump with no local signal.

```diff
--- a/packages/core/src/llm.ts
+++ b/packages/core/src/llm.ts
@@ -9,6 +9,7 @@ export interface LLMCallOpts {
   model: string;
   systemPrompt?: string;
   maxTokens?: number;
+  /** Wall-clock budget for the whole call including retries. Default 120s. */
+  timeoutMs?: number;
 }
@@
+/**
+ * Transient-failure classifier — same predicate embedding.ts uses. Kept
+ * textual rather than status-code-based because the three SDKs surface
+ * status differently and all of them put the reason in the message.
+ */
+function isTransient(err: unknown): boolean {
+  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
+  return /rate.?limit|quota|timeout|exceeded|unavailable|temporarily|429|50[234]/.test(msg);
+}
+
 export async function callLLMText(
   prompt: string,
   opts: LLMCallOpts,
   deps: LLMDeps = realDeps,
 ): Promise<string> {
   const model = opts.model;
   const system = opts.systemPrompt ?? DEFAULT_SYSTEM;
   const maxTokens = opts.maxTokens ?? 1024;
-  if (model.startsWith("claude")) return deps.anthropic(prompt, opts);
-  if (model.startsWith("qwen") || model.startsWith("glm")) {
-    return deps.dashscope(prompt, model, system, maxTokens);
-  }
-  return deps.openai(prompt, model, system, maxTokens, true);
+  const dispatch = (): Promise<string> => {
+    if (model.startsWith("claude")) return deps.anthropic(prompt, opts);
+    if (model.startsWith("qwen") || model.startsWith("glm")) {
+      return deps.dashscope(prompt, model, system, maxTokens);
+    }
+    return deps.openai(prompt, model, system, maxTokens, true);
+  };
+
+  // Bound the wall clock explicitly. The vendor SDKs each have their own
+  // default (documented as 10 min), which is longer than the 600 s
+  // expireInSeconds on kea.extract — a hung call would otherwise let the
+  // job expire and re-enqueue while the first one is still burning tokens.
+  const budgetMs = opts.timeoutMs ?? 120_000;
+  const withDeadline = async (): Promise<string> =>
+    await Promise.race([
+      dispatch(),
+      new Promise<never>((_, rej) =>
+        setTimeout(() => rej(new Error(`llm timeout after ${budgetMs}ms (model=${model})`)), budgetMs).unref(),
+      ),
+    ]);
+
+  try {
+    return await withDeadline();
+  } catch (err) {
+    if (!isTransient(err)) throw err;
+    // One retry with jitter — mirrors embedding.ts. Anything beyond this is
+    // pg-boss's job (retryLimit 3 + backoff), which is the right place for
+    // a minutes-scale wait.
+    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
+    return await withDeadline();
+  }
 }
```

`llm.ts`'s injectable `deps` seam makes this directly unit-testable with no API
key — a `deps.anthropic` that rejects twice, then resolves, pins the behaviour.

### R-2 — [HIGH] No graceful shutdown: every deploy kills in-flight jobs

`apps/worker/src/index.ts` registers no `SIGTERM` or `SIGINT` handler and never
calls `boss.stop()`. The only shutdown wiring in the repo is on the *producer*
side (`apps/mcp-server/src/jobs.ts:52`, a `beforeExit` hook).

So on every `./scripts/deploy.sh`, Docker sends SIGTERM, Node exits immediately,
and any job mid-flight is killed without releasing its pg-boss lease. The row
sits in `active` until `expireInSeconds` elapses — **10 minutes** for
`kea.extract` and `autoskill.run`, **60 minutes** for `kea.cross_extract` — then
retries from the top.

For an LLM-backed job that means the tokens already spent are wasted and the
whole extraction is paid for twice. `kea.cross_extract` is explicitly configured
`retryLimit: 1` because *"LLM-call failures usually indicate provider issues"*
(`:64-68`) — so a deploy landing during its 06:00 window doesn't retry at all:
that day's cross-session extraction is silently skipped.

```diff
--- a/apps/worker/src/index.ts
+++ b/apps/worker/src/index.ts
@@ -352,7 +352,29 @@
   log.info({ schema: env.PG_BOSS_SCHEMA }, "Worker running. Press Ctrl+C to stop.");
+
+  // Graceful shutdown. Without this, SIGTERM (every `deploy.sh`, every
+  // `docker compose restart`) kills jobs mid-execution: the lease is not
+  // released, the row sits `active` until expireInSeconds (10 min for
+  // kea.extract, 60 for kea.cross_extract), and the work is redone —
+  // re-spending the LLM tokens the killed attempt already burned.
+  // `boss.stop({ wait: true })` stops fetching new jobs and lets in-flight
+  // handlers finish. The grace window is bounded so a wedged handler can't
+  // block the deploy indefinitely; Docker's own SIGKILL follows at 10 s by
+  // default, so raise `stop_grace_period` in docker-compose.yml to match.
+  const SHUTDOWN_GRACE_MS = 25_000;
+  let stopping = false;
+  const shutdown = async (signal: string): Promise<void> => {
+    if (stopping) return;
+    stopping = true;
+    log.info({ op: "worker.shutdown", signal }, "draining in-flight jobs");
+    const timer = setTimeout(() => {
+      log.warn({ op: "worker.shutdown", signal }, "grace window expired — exiting anyway");
+      process.exit(0);
+    }, SHUTDOWN_GRACE_MS);
+    timer.unref();
+    try {
+      await boss.stop({ wait: true });
+      log.info({ op: "worker.shutdown", signal, outcome: "drained" }, "worker stopped cleanly");
+    } catch (err) {
+      log.error({ op: "worker.shutdown", err }, "boss.stop failed");
+    }
+    process.exit(0);
+  };
+  process.on("SIGTERM", () => void shutdown("SIGTERM"));
+  process.on("SIGINT", () => void shutdown("SIGINT"));
 }
```

Pair it with a matching grace period in the compose file:

```diff
--- a/deploy/docker-compose.yml
+++ b/deploy/docker-compose.yml
@@  (worker service)
     restart: unless-stopped
+    # Must exceed the worker's SHUTDOWN_GRACE_MS (25 s) so Docker doesn't
+    # SIGKILL mid-drain — the default is 10 s.
+    stop_grace_period: 30s
```

### R-4 — [MEDIUM] No dead-letter queue anywhere

The `QUEUES` table (`index.ts:52-86`) sets `retryLimit`, `retryBackoff` and
`expireInSeconds` on all nine queues — and no `deadLetter`. pg-boss supports a
per-queue dead-letter target; without one, a job that exhausts its retries moves
to `failed` in `pgboss.job` and stops existing as far as the platform is
concerned. Nothing reads that table: there is no admin surface, no cron check, no
alert.

Combined with R-3 and R-5, an entire class of failure is invisible: KEA
extraction fails three times, the job goes `failed`, the Session keeps its
`success` outcome, and the only trace is a log line nobody is grepping for.

```diff
--- a/apps/worker/src/index.ts
+++ b/apps/worker/src/index.ts
@@ -52,6 +52,7 @@
   const QUEUES: Array<{
     name: string;
     retryLimit: number;
     retryDelay?: number;
     retryBackoff: boolean;
     expireInSeconds: number;
+    deadLetter?: string;
   }> = [
-    { name: "kea.extract",     retryLimit: 3, retryBackoff: true,  expireInSeconds: 600 },
-    { name: "autoskill.run",   retryLimit: 3, retryBackoff: true,  expireInSeconds: 600 },
+    { name: "kea.extract",     retryLimit: 3, retryBackoff: true,  expireInSeconds: 600, deadLetter: "dlq" },
+    { name: "autoskill.run",   retryLimit: 3, retryBackoff: true,  expireInSeconds: 600, deadLetter: "dlq" },
@@
   ];
+  // Terminal destination for jobs that exhausted their retries. Nothing
+  // works this queue — it is an inbox, read by the admin surface and by
+  // the operator during an incident. Without it, an exhausted job vanishes
+  // into pgboss.job's `failed` state with no reader.
+  await boss.createQueue("dlq", { retryLimit: 0, retryBackoff: false, expireInSeconds: 86_400 });
   for (const q of QUEUES) {
     await boss.createQueue(q.name, {
       retryLimit: q.retryLimit,
       retryBackoff: q.retryBackoff,
       expireInSeconds: q.expireInSeconds,
+      ...(q.deadLetter ? { deadLetter: q.deadLetter } : {}),
     });
   }
```

`/api/admin/backup-status` is the right precedent for the surface: a small
`GET /api/admin/queue-health` returning DLQ depth and oldest-entry age, rendered
as a `Stat` tile next to `BackupStatusCard` on `/admin`. The backup incident
(KNOWN_ISSUES §0f — a dump failing silently for three weeks) is the same failure
shape as this one, and it was solved exactly that way.

### R-5 — [MEDIUM] Five handlers swallow their failures into silence

`kea.extract`, `autoskill.run`, `kea.cross_extract` and `session.sweep_abandoned`
all wrap their body in `try`/`catch` with `captureError(...)` before re-throwing.
The other five do not:

| Handler | Line | `try/catch` | `captureError` |
|---|---|---|---|
| `evolution.decay` | `:246` | ❌ | ❌ |
| `evolution.consolidate` | `:250` | ❌ | ❌ |
| `evolution.detect-obsolescence` | `:254` | ❌ | ❌ |
| `evolution.health-snapshot` | `:258` | ❌ | ❌ |
| `embeddings.backfill` | `:262` | ❌ | ❌ |

pg-boss will still mark these failed and retry, so the *work* degrades correctly.
What is lost is **observability**: no `outcome: "error"` log line, no Sentry
event. `evolution.decay` is the job that keeps stale knowledge from being served;
if it has been failing nightly for a month, nothing in the system says so.
`embeddings.backfill` runs every 10 minutes — 144 silent failures a day.

```diff
--- a/apps/worker/src/index.ts
+++ b/apps/worker/src/index.ts
@@ -244,25 +244,38 @@
-  await boss.work("evolution.decay", async () => {
-    const res = await evolution.decayUnused();
-    log.info({ updated: res.updated, flaggedLowEffectiveness: res.flaggedLowEffectiveness }, "evolution.decay");
-  });
+  /**
+   * Wrap a maintenance handler so a failure is *visible*. pg-boss already
+   * retries these; what was missing is any record that they failed at all —
+   * evolution.decay silently erroring nightly looks identical to it working.
+   */
+  const observed = (op: string, fn: () => Promise<Record<string, unknown> | void>) =>
+    async (): Promise<void> => {
+      const start = performance.now();
+      try {
+        const fields = (await fn()) ?? {};
+        log.info({ op, outcome: "ok", ...fields, durMs: Math.round(performance.now() - start) }, op);
+      } catch (err) {
+        await captureError(log, err, { op, outcome: "error", durMs: Math.round(performance.now() - start) }, `${op} failed`);
+        throw err;
+      }
+    };
+
+  await boss.work("evolution.decay", observed("evolution.decay", async () => {
+    const res = await evolution.decayUnused();
+    return { updated: res.updated, flaggedLowEffectiveness: res.flaggedLowEffectiveness };
+  }));
+  await boss.work("evolution.consolidate", observed("evolution.consolidate", async () => {
+    const res = await evolution.consolidateDuplicates();
+    return { merged: res.merged };
+  }));
+  await boss.work("evolution.detect-obsolescence", observed("evolution.detect-obsolescence", async () => {
+    const res = await evolution.detectObsolescence();
+    return { flagged: res.flagged };
+  }));
+  await boss.work("evolution.health-snapshot", observed("evolution.health-snapshot", async () => {
+    await evolution.snapshotKnowledgeHealth();
+  }));
+  await boss.work("embeddings.backfill", observed("embeddings.backfill", async () => {
+    const res = await backfillEmbeddings({ limit: 256 });
+    return { rows: res.processed };
+  }));
```

### R-6 — [MEDIUM] Job expiry races the in-flight LLM call

`kea.extract` and `autoskill.run` are configured `expireInSeconds: 600`
(`index.ts:61-62`). The Anthropic and OpenAI SDKs both document a default request
timeout of **10 minutes** — the same 600 seconds.

⚠️ **Assumption flagged:** `node_modules` is not installed here, so I read the
vendors' documented default rather than the shipped constant. ⬜ Reviewer should
confirm against the installed SDK version.

If the default holds, a hung provider call and the job's expiry fire at
approximately the same moment. pg-boss reclaims the expired job and hands it to a
worker while the original request may still be open — two concurrent extractions
for one session, double the token spend, and two writers racing the same
`Knowledge` rows.

The `timeoutMs` default of 120 s in the R-1 patch resolves this by putting a
comfortable margin between the call budget and the job budget. That is the reason
to prefer an explicit LLM timeout over relying on the SDK's.

### R-8 — [LOW] Floating promise at module load; no process-level guards

```ts
// apps/worker/src/index.ts:29-32
void (async () => {
  const { initSentry } = await import("@brain/core");
  await initSentry("worker");
})();
```

`void` discards the promise. If `initSentry` rejects — a malformed `SENTRY_DSN`,
a failed dynamic import — that is an unhandled rejection, which terminates the
process by default on Node 18+. The worker would then fail to start *because its
error reporter failed to start*, and the crash arrives before `main()`'s
`.catch()` (`:400`) is even reachable.

There is also no `process.on("unhandledRejection")` or `("uncaughtException")`
handler anywhere in the worker, so any async escape outside a job handler exits
silently with no `log.fatal` line.

```diff
@@ -27,10 +27,20 @@
 const log = getLogger("worker");
-// Sentry is no-op unless SENTRY_DSN is set.
-void (async () => {
-  const { initSentry } = await import("@brain/core");
-  await initSentry("worker");
-})();
+// Sentry is no-op unless SENTRY_DSN is set. Failing to start the error
+// reporter must never be what stops the worker starting — swallow it, but
+// say so.
+void (async () => {
+  try {
+    const { initSentry } = await import("@brain/core");
+    await initSentry("worker");
+  } catch (err) {
+    log.warn({ err, op: "worker.sentry_init" }, "Sentry init failed — continuing without it");
+  }
+})();
+
+process.on("unhandledRejection", (reason) => {
+  log.error({ err: reason, op: "worker.unhandled_rejection" }, "unhandled promise rejection");
+});
+process.on("uncaughtException", (err) => {
+  log.fatal({ err, op: "worker.uncaught" }, "uncaught exception — exiting");
+  process.exit(1);
+});
```

---

## 2. Data-integrity checks

### ✅ Migration & schema safety — **PASS**

The checklist asks whether `prisma migrate` runs cleanly on a fresh Postgres
**without manual SQL intervention**. It does, and the pgvector trap is handled
three times over:

1. `packages/db/prisma/migrations/20260421_init/migration.sql:2` —
   `CREATE EXTENSION IF NOT EXISTS "vector";` as the first statement of the first
   migration. This is the important one: the migration set is self-sufficient.
2. `scripts/dev-up.sh:118` and `scripts/deploy.sh:157` each run the same
   `CREATE EXTENSION` against the DB before `migrate deploy`, belt-and-braces.
3. `deploy/docker-compose.yml:30` pins `pgvector/pgvector:pg16`, so the extension
   is present in the image.

Both scripts then run `prisma migrate deploy` (`dev-up.sh:128`,
`deploy.sh:165`) followed by a `migrate status` **drift check** that warns when
the DB diverges from `migrations/` (`dev-up.sh:130-135`, `deploy.sh:171`).

The seed is registered at `migrations.seed` in `packages/db/prisma.config.ts` —
the Prisma 7 location. The comment records why: `package.json#prisma.seed` is
silently ignored in v7, so `prisma db seed` no-op'd against a live brain while
printing a warning the deploy script ignored.

The one documentation inconsistency: `deploy/DEPLOY.md:25` still lists
`CREATE EXTENSION IF NOT EXISTS vector` as **manual step 4**. Given the migration
and both scripts now do it, this reads as a requirement that no longer exists.
Recommend rewording to "verified automatically by `deploy.sh`; listed here for
operators provisioning Postgres by hand."

### ❌ R-3 — [HIGH] Graceful worker degradation: `FAILED_EXTRACTION` is not implemented

The checklist asks that a failed LLM key during post-session extraction set the
session status to `FAILED_EXTRACTION` rather than locking the queue. Two halves,
two different answers:

**The queue does not lock — ✅.** pg-boss isolates the failure to the job:
retryLimit 3 with backoff, `expireInSeconds` release, `singletonKey` only on the
cron queues. A dead `kea.extract` cannot block `autoskill.run` or any other
session's extraction. The "melting the dependency at default cadence" concern in
the `:48-51` comment is genuinely handled.

**The status is never recorded — ❌.** A repo-wide grep for
`FAILED_EXTRACTION` / `failed_extraction` across `*.ts`, `*.prisma` and `*.md`
returns **zero matches**. The schema has only:

```prisma
// packages/db/prisma/schema.prisma:322
outcome         String?   // success | partial | failed
```

— a free-form string written by the *client* through
`brain_report_session_outcome`, describing whether the user's coding task
succeeded. It has nothing to do with whether extraction ran. `worker/index.ts:165`
logs, captures, and re-throws; it never touches the Session row.

So after three failed retries the session is left reading `outcome: "success"`
with no knowledge extracted and no marker anywhere. Downstream this is worse than
cosmetic: the dashboard counts it as a productive session, and the flywheel
metrics ("sessions closed with learnings") count a session that taught nothing.

Since `outcome` is client-owned semantics, the right fix is a separate
extraction-status column rather than overloading it:

```diff
--- a/packages/db/prisma/schema.prisma
+++ b/packages/db/prisma/schema.prisma
@@ -320,6 +320,13 @@ model Session {
   outcome         String?   // success | partial | failed
+  /// Whether the KEA extraction pipeline ran for this session. Distinct from
+  /// `outcome`, which is the CLIENT's report of whether the user's coding task
+  /// succeeded. Null = not yet attempted (the normal state until the worker
+  /// picks the job up). Kept as a separate column rather than an `outcome`
+  /// value so a failed extraction can't be mistaken for a failed user task.
+  extractionStatus  String?   // pending | ok | failed
+  extractionError   String?   // last error message, truncated to 500 chars
+  extractionAt      DateTime?
```

```diff
--- a/apps/worker/src/index.ts
+++ b/apps/worker/src/index.ts
@@ -140,6 +140,11 @@
+          await db.session.update({
+            where: { id: data.sessionId },
+            data: { extractionStatus: "ok", extractionAt: new Date(), extractionError: null },
+          }).catch(() => { /* status bookkeeping must never fail the job */ });
           log.info({ op: "kea.extract", outcome: "ok", … }, "kea.extract");
@@ -163,6 +168,18 @@
+          // Mark the session so a failed extraction is visible in the data,
+          // not only in a log line. Only on the FINAL attempt — earlier
+          // retries may still succeed. `job.retryCount` is 0-indexed.
+          if ((job.retryCount ?? 0) >= 2) {
+            await db.session.update({
+              where: { id: data.sessionId },
+              data: {
+                extractionStatus: "failed",
+                extractionAt: new Date(),
+                extractionError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
+              },
+            }).catch(() => { /* best-effort */ });
+          }
           await captureError(log, err, { op: "kea.extract", … }, "kea.extract failed");
           throw err;
```

⚠️ **This adds a Prisma migration.** Per the local operator rules, a diff
containing `packages/db/prisma/migrations/**` may not be auto-deployed — it needs
explicit operator authorization. Land it deliberately, not as part of a batch.

### ✅ Backup & status endpoint — **PASS, and unusually good**

`/api/admin/backup-status` checks **both** halves and is admin-gated via
`requireAdmin()`:

- **On-host dumps** — newest `*.sql.gz` mtime under `/data/backups/last`, warning
  past `BACKUP_DUMP_MAX_AGE` (default 26 h = daily schedule + slack).
- **Off-host replication** — the sidecar's epoch heartbeat, warning past 2× the
  sync interval.

Two details worth calling out as correct:

- **The empty-directory case warns rather than passing.** `readDumpStatus`
  returns `warn: true` when `last/` exists but holds no dumps (`:70-75`) — *"the
  service is wired up but has never succeeded — that IS the silent-failure
  state."* That is precisely the condition the v1.11.1 incident (three weeks of
  silently failing dumps, KNOWN_ISSUES §0f) went undetected in.
- **An unreadable directory degrades to `configured: false`, not a 500** (`:66`),
  so a permissions problem on the mount doesn't take the admin page down.

`BackupStatusCard` is rendered on `/admin` (`app/admin/page.tsx:48`), so the
alarm is visible without anyone running `docker ps`. **No change recommended.**

### R-7 — [MEDIUM] No explicit transaction timeouts

All 13 interactive transactions use the bare two-argument form with no options
object:

```
packages/core/src/cost.ts:146      org.ts:61,527,885      kea.ts:624,887
apps/web/lib/brain/vouchers.ts:142
apps/web/app/api/{invites/signup:110,139, auth/register:164,
                  auth/reset-password:79, projects/[id]:288, knowledge:194}
```

Every one inherits Prisma's implicit defaults — `maxWait: 2s`, `timeout: 5s`.
Exceeding either aborts with P2028 and rolls back.

**Rollback itself is correct** — that is what a transaction is for, and no site
swallows the error. The risk is that 5 seconds is a *silent* budget nobody
declared. Two sites are worth pinning explicitly:

- **`cost.ts:146`** takes `pg_advisory_xact_lock` on `(userId, day)`. Under
  concurrent Oracle calls from one user, waiters queue on that lock — and the
  clock they are racing is an undeclared default. A P2028 here surfaces to the
  user as a failed Oracle call, not as "you are being rate-limited".
- **`kea.ts:624,887`** run three writes including a raw `UPDATE … ::vector`. The
  `embed()` call is correctly placed *outside* the transaction (`:622`) — that is
  the important thing and it is right — so the remaining budget is generous. Worth
  declaring anyway, since the ordering is what keeps it safe and a future edit
  could move the embed inside without noticing.

```diff
--- a/packages/core/src/cost.ts
+++ b/packages/core/src/cost.ts
@@ -146,7 +146,13 @@
-  return await db.$transaction(async (tx) => {
+  // Declare the budget rather than inheriting Prisma's implicit 5 s: this
+  // transaction holds an advisory lock that concurrent callers queue behind,
+  // so the wait is a product decision, not a default.
+  return await db.$transaction(async (tx) => {
     …
-  });
+  }, { maxWait: 5_000, timeout: 15_000 });
```

**Connection pooling:** `DATABASE_URL` carries no `connection_limit` or
`pool_timeout` in `.env.example:22` or `docker-compose.yml`, so Prisma's default
(`num_cpus * 2 + 1` per client instance) applies. With web + worker + mcp-server
each holding a pool against one Postgres, this is worth an explicit setting
before scaling replicas — but at single-host scale it is not a release blocker.

### R-9 — [LOW] KEA is fed hardcoded zeros

```ts
// apps/worker/src/index.ts:388-397
return {
  filesCreated, filesModified, filesRejected, buildAttempts, errors,
  knowledgeUsed: [],   // ← always empty
  durationMs: 0,       // ← always zero
  tokensUsed: 0,       // ← always zero
};
```

`summarizeSession` reconstructs metrics from `SessionEvent` rows but returns
constants for three fields, which then flow into `kea.buildPayload` and into the
LLM prompt. `durationMs` is derivable from `startedAt`/`endedAt`, and
`knowledgeUsed` from the `SessionKnowledgeApplication` rows that
`bulkBumpKnowledgeOutcome` already reads. Whatever the extractor infers from
"this session took 0 ms and used no knowledge" is inference from a known-false
premise.

---

## Recommended order

1. **R-2** (graceful shutdown) — smallest diff, biggest immediate win; every
   deploy currently costs in-flight work.
2. **R-1 + R-6** (LLM timeout + retry) — one patch closes both.
3. **R-5** (observability wrapper) — mechanical, and it is what makes the rest
   of this list measurable.
4. **R-4** (dead-letter queue + admin tile) — follows the backup-status
   precedent.
5. **R-3** (`extractionStatus`) — **carries a migration; needs operator sign-off
   and its own deploy.**
6. **R-7, R-8** — before release. **R-9, R-10, R-11** — schedule after.

**Overall:** the worker is materially better engineered than the average
background service — explicit per-queue retry policy, payload validation, poison
handling, cron-overlap prevention, and a backup alarm born of a real incident and
built properly. The gaps cluster in one place: **what happens after the retries
run out.** There is no drain on shutdown, no dead-letter, no failure marker on
the data, and no error signal from five of the nine handlers. Individually each
is small; together they mean a background pipeline that fails quietly, which for
a product whose entire value is "the Brain learns from your sessions" is the most
expensive way to fail.
