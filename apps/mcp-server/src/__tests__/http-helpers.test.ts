import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { extractBearer } from "../http-helpers.js";

// Minimal stand-in for the parts of IncomingMessage that extractBearer
// touches. Full mock would need Stream + a dozen other props we don't use.
function reqWith(authorization: string | undefined): IncomingMessage {
  return { headers: { authorization } } as unknown as IncomingMessage;
}

describe("extractBearer", () => {
  it("returns undefined when Authorization header is absent", () => {
    expect(extractBearer(reqWith(undefined))).toBeUndefined();
  });

  it("returns undefined for an empty Authorization header", () => {
    expect(extractBearer(reqWith(""))).toBeUndefined();
  });

  it("extracts the token after a canonical 'Bearer ' prefix", () => {
    expect(extractBearer(reqWith("Bearer bp_abcdef0123456789"))).toBe(
      "bp_abcdef0123456789",
    );
  });

  it("is case-insensitive on the scheme name", () => {
    expect(extractBearer(reqWith("bearer bp_lowercase"))).toBe("bp_lowercase");
    expect(extractBearer(reqWith("BEARER bp_uppercase"))).toBe("bp_uppercase");
    expect(extractBearer(reqWith("BeArEr bp_mixed"))).toBe("bp_mixed");
  });

  it("tolerates extra whitespace between scheme and token", () => {
    // Multiple spaces — `\s+` in the regex absorbs them.
    expect(extractBearer(reqWith("Bearer    bp_padded"))).toBe("bp_padded");
  });

  it("trims surrounding whitespace from the token value", () => {
    expect(extractBearer(reqWith("Bearer bp_trimme   "))).toBe("bp_trimme");
  });

  it("rejects non-Bearer auth schemes", () => {
    expect(extractBearer(reqWith("Basic dXNlcjpwYXNz"))).toBeUndefined();
    expect(extractBearer(reqWith("Digest abc"))).toBeUndefined();
  });

  it("rejects 'Bearer' with no token", () => {
    expect(extractBearer(reqWith("Bearer"))).toBeUndefined();
    expect(extractBearer(reqWith("Bearer "))).toBeUndefined();
  });
});
