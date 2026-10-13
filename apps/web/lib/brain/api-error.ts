/**
 * Turn an API error into a sentence a person can read, in their language.
 *
 * Settings pages used to render `body.error ?? "HTTP 403"` verbatim, so a
 * visitor saw `FORBIDDEN_ORG` or `HTTP 500` where an explanation belonged.
 * Routes answer with a machine code (`authErrorResponse` forwards a
 * BrainError's `code`, hand-written routes use snake_case literals); this maps
 * the ones we know to `apiErrors.*` and everything else to a generic sentence
 * that still carries the status for a support conversation.
 */
import { I18N, type Vars } from "./i18n-dict";

export type Translate = (path: string, vars?: Vars) => string;

// Only an own key of the English table is looked up — the code comes off the
// wire, and an arbitrary string must not be able to address another path.
function knownKey(code: unknown): string | null {
  if (typeof code !== "string" || !code) return null;
  const key = code.toLowerCase();
  return Object.hasOwn(I18N.en.apiErrors, key) && key !== "generic" && key !== "network"
    ? key
    : null;
}

export function apiErrorMessage(t: Translate, code: unknown, status?: number): string {
  const key = knownKey(code);
  if (key) return t(`apiErrors.${key}`);
  return status ? t("apiErrors.generic", { status }) : t("apiErrors.network");
}

/** Read `{ error }` from a failed response, tolerating a non-JSON body. */
export async function apiErrorFromResponse(t: Translate, res: Response): Promise<string> {
  let code: unknown;
  try {
    code = ((await res.json()) as { error?: unknown }).error;
  } catch {
    code = undefined;
  }
  return apiErrorMessage(t, code, res.status);
}

/**
 * Carries an already-translated message through a `throw`, so a catch block
 * can tell it apart from a network failure (`TypeError: Failed to fetch`),
 * whose English `message` must not reach the screen.
 */
export class ApiError extends Error {}

export async function throwApiError(t: Translate, res: Response): Promise<never> {
  throw new ApiError(await apiErrorFromResponse(t, res));
}

/**
 * The message to show for anything a `try { fetch… }` block caught.
 *
 * Besides ApiError it understands the `new Error(body.error ?? "HTTP n")`
 * convention the data hooks (use-knowledge, …) throw with, so their callers
 * get a translated sentence without each hook being rewritten.
 */
export function caughtMessage(t: Translate, err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) {
    const http = /^HTTP (\d{3})$/.exec(err.message);
    if (http) return apiErrorMessage(t, undefined, Number(http[1]));
    if (knownKey(err.message)) return apiErrorMessage(t, err.message);
  }
  return t("apiErrors.network");
}
