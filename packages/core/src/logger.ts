/**
 * Shared structured logger.
 *
 * Wraps `pino` so every app logs in the same JSON shape:
 *   {level, time, service, requestId?, msg, op?, durMs?, outcome?, err?, ...}
 *
 * Per-request context is threaded via `AsyncLocalStorage` so handlers can
 * call `log.info({...}, "msg")` without plumbing the requestId through
 * every function. Call `withRequest(id, fn)` at the edge (HTTP handler,
 * worker job handler) to scope all nested log lines to that id.
 *
 * AI-debuggability contract — every error log line includes:
 *   - `err.code`        stable machine-readable identifier (e.g. DB_UNIQUE_VIOLATION)
 *   - `err.category`    coarse bucket (auth|db|http|llm|embedding|validation|...)
 *   - `err.remediation` short hint a future agent can act on
 *   - `err.stackHead`   first 3 stack frames as `file:line:col` strings
 *
 * Dev convenience: when `NODE_ENV !== "production"` and `stderr` is a TTY,
 * output uses `pino.transport({ target: "pino-pretty" })` if that module is
 * installed; otherwise falls back to raw JSON.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import pino, { type Logger } from "pino";

const requestCtx = new AsyncLocalStorage<{ requestId: string }>();

/** Coarse error bucket. Pick the closest match; `internal` is the catch-all. */
export type ErrorCategory =
  | "auth"
  | "db"
  | "http"
  | "llm"
  | "embedding"
  | "validation"
  | "rate-limit"
  | "external"
  | "config"
  | "internal";

/** Outcome tag used by `withTimer` and request middleware. */
export type Outcome = "ok" | "error" | "timeout";

/**
 * Structured application error. Preferred over plain `Error` at boundaries
 * the user-facing or MCP-facing API touches, so logs and responses carry
 * a stable `code` an AI agent (or human) can grep for and remediate.
 */
export class BrainError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly remediation?: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly fields?: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(opts: {
    code: string;
    category: ErrorCategory;
    message: string;
    remediation?: string;
    retryable?: boolean;
    status?: number;
    fields?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = "BrainError";
    this.code = opts.code;
    this.category = opts.category;
    this.retryable = opts.retryable ?? false;
    // Only set optional fields when defined — `exactOptionalPropertyTypes`
    // would otherwise reject `field: undefined`.
    if (opts.remediation !== undefined) this.remediation = opts.remediation;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.fields !== undefined) this.fields = opts.fields;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

/**
 * Field names whose values are always replaced with `<redacted>` before
 * logging. Conservative list — better to over-redact than leak a token
 * through an `err.fields` payload an operator pasted into chat.
 */
const REDACT_KEYS = new Set<string>([
  "password",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "secret",
  "set-cookie",
  "x-api-key",
  "openai_api_key",
  "anthropic_api_key",
  "google_gemini_api_key",
  "brain_mcp_token",
  "database_url",
]);

/**
 * Recursively walk an object and replace values whose key matches the
 * redaction list. Returns a new object — does not mutate input. Stops at
 * a depth of 4 to bound work for accidentally-cyclic structures.
 */
export function redactFields<T>(input: T, depth = 0): T {
  if (depth > 4 || input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) {
    return input.map((v) => redactFields(v, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = "<redacted>";
    } else {
      out[k] = redactFields(v, depth + 1);
    }
  }
  return out as T;
}

/**
 * Convert any thrown value into a structured, JSON-safe shape that an
 * AI agent can read. Preserves the chain via `cause` and trims the stack
 * to the first three frames (enough to locate the throw site without
 * dumping the whole runtime).
 */
export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof BrainError) {
    return {
      name: err.name,
      code: err.code,
      category: err.category,
      message: err.message,
      remediation: err.remediation,
      retryable: err.retryable,
      ...(err.status !== undefined ? { status: err.status } : {}),
      ...(err.fields ? { fields: redactFields(err.fields) } : {}),
      stackHead: stackHead(err),
      ...(err.cause !== undefined ? { cause: serializeError(err.cause) } : {}),
    };
  }
  if (err instanceof Error) {
    const causeMaybe = (err as Error & { cause?: unknown }).cause;
    return {
      name: err.name || "Error",
      code: (err as { code?: string }).code ?? "UNKNOWN",
      category: "internal" as ErrorCategory,
      message: err.message,
      remediation: undefined,
      retryable: false,
      stackHead: stackHead(err),
      ...(causeMaybe !== undefined ? { cause: serializeError(causeMaybe) } : {}),
    };
  }
  return {
    name: "NonError",
    code: "UNKNOWN",
    category: "internal" as ErrorCategory,
    message: typeof err === "string" ? err : JSON.stringify(err),
    retryable: false,
  };
}

function stackHead(err: Error): string[] {
  if (!err.stack) return [];
  return err.stack
    .split("\n")
    .slice(1, 4)
    .map((line) => line.trim().replace(/^at\s+/, ""));
}

function pinoSerializers() {
  return {
    err: (err: unknown) => serializeError(err),
    error: (err: unknown) => serializeError(err),
  };
}

function baseLogger(service: string): Logger {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    serializers: pinoSerializers(),
    mixin() {
      const ctx = requestCtx.getStore();
      return ctx ? { requestId: ctx.requestId } : {};
    },
  });
}

const loggers = new Map<string, Logger>();

/**
 * Get (or create) the logger for a given service name. Services are fixed
 * strings: `"web"`, `"mcp-server"`, `"worker"`, `"core"`. Each app should
 * call this once at module top-level and reuse the instance.
 *
 * `stream = "stderr"` routes output to fd 2 — required for MCP stdio
 * transport, which owns stdout for JSON-RPC framing.
 */
export function getLogger(
  service: string,
  opts: { stream?: "stdout" | "stderr" } = {},
): Logger {
  const cacheKey = `${service}:${opts.stream ?? "stdout"}`;
  const existing = loggers.get(cacheKey);
  if (existing) return existing;
  const dest = opts.stream === "stderr" ? pino.destination(2) : undefined;
  const fresh = dest
    ? pino(
        {
          level: process.env.LOG_LEVEL ?? "info",
          base: { service },
          timestamp: pino.stdTimeFunctions.isoTime,
          formatters: { level: (label) => ({ level: label }) },
          serializers: pinoSerializers(),
          mixin() {
            const ctx = requestCtx.getStore();
            return ctx ? { requestId: ctx.requestId } : {};
          },
        },
        dest,
      )
    : baseLogger(service);
  loggers.set(cacheKey, fresh);
  return fresh;
}

/**
 * Run `fn` with an associated requestId. All `log.*()` calls inside `fn`
 * (and anything it awaits) will carry `{ requestId }`.
 */
export function withRequest<T>(requestId: string, fn: () => Promise<T> | T): Promise<T> | T {
  return requestCtx.run({ requestId }, fn);
}

/** Read the current requestId, if any. Useful for echoing it in a response header. */
export function currentRequestId(): string | undefined {
  return requestCtx.getStore()?.requestId;
}

/** Short request id helper — 12 chars of a random UUID. */
export function shortId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * Wrap an async operation with timing + outcome logging. Emits exactly one
 * line on success (`info`) and one on failure (`error` with `err`).
 * Re-throws so callers keep their normal error path.
 *
 * Use for any boundary worth seeing on a dashboard: HTTP handler, MCP
 * tool call, worker job, external API call.
 */
export async function withTimer<T>(
  log: Logger,
  op: string,
  fn: () => Promise<T>,
  fields: Record<string, unknown> = {},
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const durMs = Math.round(performance.now() - start);
    log.info({ op, durMs, outcome: "ok" as Outcome, ...fields }, op);
    return result;
  } catch (err) {
    const durMs = Math.round(performance.now() - start);
    log.error(
      { op, durMs, outcome: "error" as Outcome, err, ...fields },
      `${op} failed`,
    );
    throw err;
  }
}

/**
 * Sentry integration — initialize once per process. No-op when
 * `SENTRY_DSN` is unset, so local dev and CI don't accidentally
 * ship error payloads anywhere.
 *
 * Dynamic import so `@sentry/node` doesn't load on cold paths that
 * never call this (e.g. Next's page-data collection). Safe to call
 * multiple times; subsequent calls are ignored by Sentry itself.
 */
let sentryInitialized = false;
export async function initSentry(service: string): Promise<void> {
  if (sentryInitialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      serverName: service,
      // Traces are off by default — call volume can be high. Operators
      // who want tracing set SENTRY_TRACES_SAMPLE_RATE explicitly.
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0"),
      // Don't leak API keys / tokens.
      beforeSend(event) {
        if (event.request?.headers) {
          const redact = ["authorization", "cookie", "x-api-key"];
          for (const h of redact) {
            if (event.request.headers[h]) {
              event.request.headers[h] = "<redacted>";
            }
          }
        }
        return event;
      },
    });
    sentryInitialized = true;
  } catch {
    // Never block startup on a logging pipeline failure.
  }
}

/**
 * Log at `error`-or-worse AND report to Sentry (if configured).
 * Call this at `catch` boundaries where you'd otherwise just log.
 * Safe when Sentry is absent — degrades to log-only.
 */
export async function captureError(
  log: Logger,
  err: unknown,
  fields: Record<string, unknown> = {},
  msg = "error",
): Promise<void> {
  log.error({ err, ...redactFields(fields) }, msg);
  if (!sentryInitialized) return;
  try {
    const Sentry = await import("@sentry/node");
    Sentry.captureException(err, { extra: redactFields(fields) });
  } catch {
    /* swallow */
  }
}

/** Test-only: drop all cached loggers so a new LOG_LEVEL takes effect. */
export function _resetLoggerCache(): void {
  loggers.clear();
}
