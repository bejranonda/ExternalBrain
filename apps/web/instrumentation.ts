/**
 * Next.js server start-up hook — the web half of the Sentry wiring the worker
 * and mcp-server already had. `SENTRY_DSN` has always been delivered to web,
 * and PRIVACY.md says crash reporting turns on when it is set, but nothing in
 * web ever called initSentry(), so `captureError` returned early and every
 * web error stayed local (KNOWN_ISSUES §0ay).
 *
 * The literal `process.env.NEXT_RUNTIME === "nodejs"` guard lets Next drop
 * the Node-only module from any edge compile of this file.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportRequestError } = await import("./instrumentation-node");
    await reportRequestError(err, request, context);
  }
}
