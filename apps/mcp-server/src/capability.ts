/**
 * Capability enforcement for MCP tools and resources.
 *
 * One check, called from every restricted surface — the same reason
 * `scope.ts` exists rather than four copies of the project-scope rule. The
 * audit's recurring finding was one rule implemented in several places and
 * silently diverging (GUIDELINES §4), and a permission check is the last
 * place to repeat that.
 *
 * The empty-array contract (empty = unrestricted) lives in `@brain/core`'s
 * `hasCapability`, not here, so a caller cannot accidentally reimplement it.
 */
import { hasCapability, type Capability } from "@brain/core";
import type { AuthContext } from "./auth.js";

/** Message prefix clients can match on, mirroring FORBIDDEN_PROJECT's shape. */
export const FORBIDDEN_CAPABILITY = "FORBIDDEN_CAPABILITY";

/**
 * Throw unless the token may exercise `needed`.
 *
 * Names the missing capability in the error: a caller that gets a bare
 * "forbidden" has to guess which restriction bit them, and the token's
 * capability list is not visible from the client side.
 */
export function requireCapability(auth: AuthContext, needed: Capability): void {
  if (hasCapability(auth.capabilities, needed)) return;
  throw new Error(
    `${FORBIDDEN_CAPABILITY}: this token does not grant "${needed}". ` +
      `Granted: ${auth.capabilities.join(", ") || "(none)"}. ` +
      `Mint a token with the capability at /settings/tokens.`,
  );
}
