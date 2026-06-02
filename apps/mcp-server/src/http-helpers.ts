/**
 * Pure helpers for the HTTP transport — extracted so they can be unit-tested
 * without standing up the full server (#42). The runtime entry point in
 * `index.ts` re-imports these.
 */
import type { IncomingMessage } from "node:http";

/**
 * Parse `Authorization: Bearer <token>` out of an inbound request.
 *
 *  - Case-insensitive on the scheme name (`Bearer`, `bearer`, `BEARER`).
 *  - Trims surrounding whitespace from the token value.
 *  - Returns `undefined` for missing headers, non-Bearer schemes,
 *    or malformed values, so callers can `if (!token) → 401` uniformly.
 *
 * NOT a token validator — it only parses. Verification happens in
 * `auth.ts::authenticate`.
 */
export function extractBearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m?.[1]?.trim();
}
