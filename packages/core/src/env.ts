/**
 * Environment validation — one zod schema, three role-specific parsers.
 *
 * Each entrypoint (`apps/web`, `apps/mcp-server`, `apps/worker`) calls the
 * matching `envFor*()` once at boot. Missing/malformed vars surface as a
 * loud startup error instead of a deep stack trace three requests later.
 *
 * Usage:
 *   import { envForWorker } from "@brain/core/env";
 *   const env = envForWorker();   // throws on failure
 */
import { z } from "zod";

const TRUTHY = /^(1|true|yes|on)$/i;
const FALSY = /^(0|false|no|off)$/i;

/**
 * The one place a string becomes a boolean flag.
 *
 * Two properties that the ad-hoc string comparisons against `process.env` this
 * replaced did not have:
 *
 * **Case- and spelling-tolerant.** `1`, `yes`, `on`, `TRUE` all mean true.
 * Operators write env files by hand and this repo already accepted that here —
 * the bug was that call sites re-implemented the comparison strictly, so
 * `ALLOW_RESET_LINK_IN_LOGS=yes` parsed as `true` through the schema and
 * `false` at the point that actually decided. One flag, two parsers, silently
 * disagreeing (the §0y shape).
 *
 * **An unrecognised value falls back to the DEFAULT, not to false.** This is
 * the security-relevant half. `REGISTRATION_REQUIRES_VOUCHER` defaults true;
 * under the old regex a typo (`falsch`, `flase`) failed the truthy test and
 * silently produced `false` — opening public signup because someone
 * mistyped. Now anything unrecognised keeps the declared default, so a typo
 * fails in whichever direction is safe for that particular flag.
 */
export function parseFlag(raw: string | undefined | null, dflt: boolean): boolean {
  const v = raw?.trim();
  if (!v) return dflt;
  if (TRUTHY.test(v)) return true;
  if (FALSY.test(v)) return false;
  return dflt;
}

/** `parseFlag` against `process.env`, read at call time (never memoized). */
export function envFlag(name: string, dflt: boolean): boolean {
  return parseFlag(process.env[name], dflt);
}

const boolish = (dflt: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => parseFlag(v, dflt));

const intFrom = (dflt: number) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v == null || v === "") return dflt;
      const n = Number(v);
      return Number.isFinite(n) ? n : dflt;
    });

const Shared = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((s) => s.startsWith("postgres"), "DATABASE_URL must be a postgres:// URL"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: intFrom(1536),
  EMBEDDING_BASE_URL: z.string().optional(),
  EMBEDDING_API_KEY: z.string().optional(),
  GOOGLE_GEMINI_API_KEY: z.string().optional(),
  // V2.0 (spec 2026-07-07) — dark-launch flags, default OFF until gate #149 passes.
  V2_ACTION_ITEMS: boolish(false),
  V2_ORACLE_TASKS: boolish(false),
  // Wave 2: multi-replica durability.
  REDIS_URL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.string().optional(),
});

const Oracle = z.object({
  ORACLE_MODEL: z.string().default("claude-sonnet-4-6"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
});

const WebExtra = z.object({
  DEV_USER_ID: z.string().optional(),
  RATE_LIMIT_ORACLE_PER_DAY: intFrom(100),
  RATE_LIMIT_KEA_PER_HOUR: intFrom(60),
  RATE_LIMIT_MCP_PER_MINUTE: intFrom(200),
  RATE_LIMIT_MEETING_EXTRACT_PER_DAY: intFrom(20),
  // NextAuth v5 — all three must be set for real auth. See `authConfigured()`.
  AUTH_GITHUB_ID: z.string().optional(),
  AUTH_GITHUB_SECRET: z.string().optional(),
  AUTH_SECRET: z.string().optional(),
  AUTH_URL: z.string().url().optional(),
  AUTH_TRUST_HOST: z.string().optional(),
  // Explicit opt-in to the dev-auth shim (DEV_USER_ID / first-User-row path).
  // Without this, an unconfigured deployment is NOT open — `getCurrentUserId`
  // throws `auth_not_configured`. Previously the shim was the silent default,
  // which meant any freshly-deployed VM served everyone the dev user's data.
  ALLOW_DEV_AUTH: boolish(false),
  // Backwards-compatible stricter guard — even with ALLOW_DEV_AUTH=true the
  // shim is refused when NODE_ENV=production unless THIS flag is also true.
  ALLOW_DEV_AUTH_IN_PRODUCTION: z.string().optional(),
  // Comma-separated emails auto-promoted to `role='admin'` on first sign-in.
  // Read once at signIn; changing the env afterwards does not demote anyone.
  ADMIN_EMAILS: z.string().optional(),
  // Require a valid voucher code for new-user registration. When true, the
  // signIn callback refuses any email that has no pending VoucherRedemption
  // and no existing User row. Set to false for a pre-launch open-signup
  // window; true before any public invite wave.
  REGISTRATION_REQUIRES_VOUCHER: boolish(true),
  // Operator kill-switch for the Oracle endpoint (#56 gap 3). When false,
  // /api/oracle and /api/oracle/stream return 503 with a clear "operator
  // paused this feature" error. Used to halt costs on a runaway prompt
  // chain or to take Oracle offline for a fix without blocking the rest
  // of the app. KEA / autoskill / MCP have their own switches.
  ORACLE_ENABLED: boolish(true),
  // V2.0 meeting-transcript-upload webapp surface (spec 2026-07-13) — dark
  // until the operator flips it. New LLM-cost-incurring surface, decoupled
  // from the rest of V2 (which is deterministic/zero-cost).
  MEETING_UPLOAD_ENABLED: boolish(false),
  // Password-reset link in the server log when email delivery is unavailable.
  // Fails CLOSED: a live credential in a log file is opt-in, never a default.
  // See KNOWN_ISSUES §0w — the first version of this logged unconditionally,
  // reasoning that a log beats a raw token in the database. Both are worse
  // than neither, and "secure by default" is hard rule #2.
  ALLOW_RESET_LINK_IN_LOGS: boolish(false),
});

const McpExtra = z.object({
  MCP_TRANSPORT: z.enum(["stdio", "http"]).optional(),
  MCP_SERVER_HTTP_PORT: intFrom(3100),
  BRAIN_MCP_TOKEN: z.string().optional(),
  // Operator kill-switch for the MCP HTTP transport (#56 gap 3). When
  // false, /mcp returns 503 on every method (the auth gate from #4 still
  // runs first; this disables the service even for valid Bearer holders).
  // /health stays open so monitoring + oncall liveness probes still work.
  MCP_ENABLED: boolish(true),
});

const WorkerExtra = z.object({
  PG_BOSS_SCHEMA: z.string().default("pgboss"),
  KEA_ENABLED: boolish(true),
  AUTOSKILL_ENABLED: boolish(true),
});

function run<S extends z.ZodTypeAny>(schema: S): z.infer<S> {
  const r = schema.safeParse(process.env);
  if (r.success) return r.data;
  const issues = r.error.issues
    .map((i) => `  · ${i.path.join(".") || "(root)"} — ${i.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment:\n${issues}\n\nCheck .env against .env.example.`,
  );
}

export type WebEnv = z.infer<typeof Shared> &
  z.infer<typeof Oracle> &
  z.infer<typeof WebExtra>;
export type McpEnv = z.infer<typeof Shared> &
  z.infer<typeof Oracle> &
  z.infer<typeof McpExtra>;
export type WorkerEnv = z.infer<typeof Shared> &
  z.infer<typeof Oracle> &
  z.infer<typeof WorkerExtra>;

let webCache: WebEnv | undefined;
let mcpCache: McpEnv | undefined;
let workerCache: WorkerEnv | undefined;

export function envForWeb(): WebEnv {
  if (webCache) return webCache;
  webCache = run(Shared.and(Oracle).and(WebExtra));
  return webCache;
}

export function envForMcp(): McpEnv {
  if (mcpCache) return mcpCache;
  mcpCache = run(Shared.and(Oracle).and(McpExtra));
  return mcpCache;
}

export function envForWorker(): WorkerEnv {
  if (workerCache) return workerCache;
  workerCache = run(Shared.and(Oracle).and(WorkerExtra));
  return workerCache;
}

/** Test-only: reset memoized caches between cases. */
export function _resetEnvCache(): void {
  webCache = undefined;
  mcpCache = undefined;
  workerCache = undefined;
}
