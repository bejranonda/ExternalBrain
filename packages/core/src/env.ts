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

const boolish = (dflt: boolean) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v == null ? dflt : /^(1|true|yes|on)$/i.test(v),
    );

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
