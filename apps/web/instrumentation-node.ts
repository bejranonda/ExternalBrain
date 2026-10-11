import { captureError, getLogger, initSentry } from "@brain/core";

export async function registerNode(): Promise<void> {
  try {
    const enabled = await initSentry("web");
    // One line at start-up answers "is crash reporting on?" without a test
    // event: `false` with SENTRY_DSN set means the SDK failed to load.
    getLogger("web").info(
      { op: "web.sentry_init", enabled, dsnSet: Boolean(process.env.SENTRY_DSN) },
      "web.sentry_init",
    );
  } catch {
    // An error reporter that fails to start must not stop the app starting.
  }
}

/** Route-handler, server-component and server-action errors Next caught itself. */
export async function reportRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string },
): Promise<void> {
  await captureError(
    getLogger("web"),
    err,
    {
      op: "next.request_error",
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
    },
    "unhandled request error",
  );
}
