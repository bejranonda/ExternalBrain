import { describe, expect, it } from "vitest";
import { tokenTestMessage } from "./token-test";
import { translate, type Vars } from "./i18n-dict";

const de = (path: string, vars?: Vars) => translate("de", path, vars);

describe("tokenTestMessage", () => {
  it("never shows the server's reason slug", () => {
    const msg = tokenTestMessage(de, "de", {
      ok: false,
      reason: "scheduled-revoke",
      scheduledRevokeAt: "2026-10-01T12:00:00Z",
    });
    expect(msg).not.toContain("scheduled-revoke");
    expect(msg).toContain("2026");
  });

  it("maps an HTTP failure through the API error table", () => {
    expect(tokenTestMessage(de, "de", { ok: false, status: 404, error: "not_found" })).toBe(
      translate("de", "apiErrors.not_found"),
    );
  });

  it("tells a connection failure apart from an unexplained refusal", () => {
    expect(tokenTestMessage(de, "de", { ok: false, network: true })).toBe(
      translate("de", "apiErrors.network"),
    );
    expect(tokenTestMessage(de, "de", { ok: false })).toBe(translate("de", "tokens.test_unknown"));
  });
});
