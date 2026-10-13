import { describe, expect, it } from "vitest";
import { ApiError, apiErrorFromResponse, apiErrorMessage, caughtMessage } from "./api-error";
import { translate, type Vars } from "./i18n-dict";

const en = (path: string, vars?: Vars) => translate("en", path, vars);
const th = (path: string, vars?: Vars) => translate("th", path, vars);

describe("apiErrorMessage", () => {
  it("maps a BrainError code regardless of case", () => {
    expect(apiErrorMessage(en, "FORBIDDEN_ORG", 403)).toBe(translate("en", "apiErrors.forbidden_org"));
    expect(apiErrorMessage(en, "forbidden_org", 403)).toBe(translate("en", "apiErrors.forbidden_org"));
  });

  it("translates known codes into the caller's language", () => {
    expect(apiErrorMessage(th, "LAST_OWNER", 409)).toBe(translate("th", "apiErrors.last_owner"));
    expect(apiErrorMessage(th, "LAST_OWNER", 409)).not.toBe(apiErrorMessage(en, "LAST_OWNER", 409));
  });

  it("never echoes an unknown code, but keeps the status", () => {
    const msg = apiErrorMessage(en, "SOMETHING_NEW", 418);
    expect(msg).not.toContain("SOMETHING_NEW");
    expect(msg).toContain("418");
  });

  it("does not let a wire code address another dictionary path", () => {
    expect(apiErrorMessage(en, "generic", 500)).toContain("500");
    expect(apiErrorMessage(en, "constructor", 500)).toContain("500");
    expect(apiErrorMessage(en, "../auth.signIn", 500)).toContain("500");
  });

  it("falls back to the connection message without a status", () => {
    expect(apiErrorMessage(en, undefined)).toBe(translate("en", "apiErrors.network"));
  });
});

describe("apiErrorFromResponse", () => {
  it("reads the error code from a JSON body", async () => {
    const res = Response.json({ error: "last_project" }, { status: 409 });
    expect(await apiErrorFromResponse(en, res)).toBe(translate("en", "apiErrors.last_project"));
  });

  it("tolerates a non-JSON body", async () => {
    const res = new Response("<html>bad gateway</html>", { status: 502 });
    expect(await apiErrorFromResponse(en, res)).toContain("502");
  });
});

describe("caughtMessage", () => {
  it("keeps an already-translated ApiError and hides raw fetch failures", () => {
    expect(caughtMessage(en, new ApiError("translated"))).toBe("translated");
    expect(caughtMessage(en, new TypeError("Failed to fetch"))).toBe(translate("en", "apiErrors.network"));
  });

  it("understands the hooks' Error(body.error ?? \"HTTP n\") convention", () => {
    expect(caughtMessage(en, new Error("forbidden"))).toBe(translate("en", "apiErrors.forbidden"));
    const msg = caughtMessage(en, new Error("HTTP 502"));
    expect(msg).toContain("502");
    expect(msg).not.toBe("HTTP 502");
  });
});
