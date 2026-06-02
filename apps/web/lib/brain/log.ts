/**
 * Server-only logging + error helpers for Next.js API routes.
 *
 * Goal: every API request produces ONE structured log line that an AI
 * agent reading the dashboard can use to:
 *   - locate the request    (`requestId`, `op`, `route`)
 *   - measure it            (`durMs`, `outcome`, `status`)
 *   - diagnose a failure    (`err.code`, `err.category`, `err.remediation`)
 *   - reproduce it          (sanitized request fields)
 *
 * Use `withApi(name, handler)` to wrap any route handler; on any thrown
 * error it returns a JSON envelope `{error, code, requestId}` so the
 * client (and any AI consumer hitting the API directly) gets the same
 * stable code that appears in the logs.
 */
import {
  BrainError,
  captureError,
  currentRequestId,
  getLogger,
  shortId,
  withRequest,
} from "@brain/core";
import { AuthError } from "./auth";

const log = getLogger("web");

type RouteCtx = { params?: Record<string, string | string[]> | Promise<Record<string, string | string[]>> };
type Handler = (req: Request, ctx: RouteCtx) => Promise<Response> | Response;

/**
 * Wrap a Next.js route handler. Adds a requestId, times the call, and
 * converts thrown errors into a JSON envelope while logging the failure
 * via `captureError` (so Sentry sees it when configured).
 */
export function withApi(op: string, handler: Handler): Handler {
  return async (req, ctx) => {
    const requestId = req.headers.get("x-request-id") ?? shortId();
    const start = performance.now();
    return withRequest(requestId, async () => {
      try {
        const res = await handler(req, ctx);
        const durMs = Math.round(performance.now() - start);
        log.info(
          {
            op,
            route: new URL(req.url).pathname,
            method: req.method,
            status: res.status,
            durMs,
            outcome: res.status >= 500 ? "error" : "ok",
          },
          op,
        );
        // Echo the requestId to the client so a user can paste it back to
        // an AI agent and pull the matching log line.
        try {
          res.headers.set("x-request-id", requestId);
        } catch {
          /* immutable response headers — ignore */
        }
        return res;
      } catch (err) {
        const durMs = Math.round(performance.now() - start);
        const envelope = errorToEnvelope(err);
        await captureError(
          log,
          err,
          {
            op,
            route: new URL(req.url).pathname,
            method: req.method,
            durMs,
            outcome: "error",
            status: envelope.status,
          },
          `${op} failed`,
        );
        return Response.json(
          {
            error: envelope.error,
            code: envelope.code,
            ...(envelope.remediation ? { remediation: envelope.remediation } : {}),
            requestId,
          },
          {
            status: envelope.status,
            headers: { "x-request-id": requestId },
          },
        );
      }
    });
  };
}

type Envelope = {
  status: number;
  error: string;
  code: string;
  remediation?: string;
};

/** Translate any thrown value into a stable HTTP envelope. */
export function errorToEnvelope(err: unknown): Envelope {
  if (err instanceof BrainError) {
    return {
      status: err.status ?? statusForCategory(err.category),
      error: err.message,
      code: err.code,
      ...(err.remediation !== undefined ? { remediation: err.remediation } : {}),
    };
  }
  if (err instanceof AuthError) {
    return {
      status: err.status,
      error: err.message,
      code: "AUTH_ERROR",
    };
  }
  // Zod errors — keep the message generic but the code stable.
  if (err && typeof err === "object" && (err as { name?: string }).name === "ZodError") {
    return {
      status: 400,
      error: "invalid_request",
      code: "VALIDATION_FAILED",
    };
  }
  return {
    status: 500,
    error: "internal",
    code: "INTERNAL_ERROR",
  };
}

function statusForCategory(c: BrainError["category"]): number {
  switch (c) {
    case "auth":
      return 401;
    case "validation":
      return 400;
    case "rate-limit":
      return 429;
    case "config":
      return 503;
    case "external":
    case "llm":
    case "embedding":
      return 502;
    default:
      return 500;
  }
}

/**
 * Re-export so route handlers get `requestId` from the same module they
 * already import `withApi` from.
 */
export { currentRequestId };
