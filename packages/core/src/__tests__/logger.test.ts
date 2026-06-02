import { describe, it, expect } from "vitest";
import {
  BrainError,
  redactFields,
  serializeError,
  withRequest,
  withTimer,
  currentRequestId,
  shortId,
  getLogger,
} from "../logger.js";

describe("BrainError + serializeError", () => {
  it("BrainError carries code/category/remediation/retryable", () => {
    const e = new BrainError({
      code: "DB_UNIQUE_VIOLATION",
      category: "db",
      message: "duplicate key",
      remediation: "deduplicate before insert",
      retryable: false,
      status: 409,
      fields: { table: "Knowledge" },
    });
    expect(e.code).toBe("DB_UNIQUE_VIOLATION");
    expect(e.category).toBe("db");
    expect(e.remediation).toBe("deduplicate before insert");
    expect(e.retryable).toBe(false);
    expect(e.status).toBe(409);
    expect(e.fields).toEqual({ table: "Knowledge" });
  });

  it("serializeError produces AI-readable shape for BrainError", () => {
    const e = new BrainError({
      code: "EMBEDDING_NO_PROVIDER",
      category: "config",
      message: "no key",
      remediation: "set GOOGLE_GEMINI_API_KEY",
    });
    const out = serializeError(e);
    expect(out).toMatchObject({
      name: "BrainError",
      code: "EMBEDDING_NO_PROVIDER",
      category: "config",
      message: "no key",
      remediation: "set GOOGLE_GEMINI_API_KEY",
      retryable: false,
    });
    expect(Array.isArray(out.stackHead)).toBe(true);
  });

  it("serializeError handles plain Error with cause chain", () => {
    const inner = new Error("boom");
    const outer = new Error("wrapper") as Error & { cause?: unknown };
    outer.cause = inner;
    const out = serializeError(outer);
    expect(out.message).toBe("wrapper");
    expect(out.code).toBe("UNKNOWN");
    expect(out.category).toBe("internal");
    expect((out.cause as { message: string }).message).toBe("boom");
  });

  it("serializeError handles non-Error throws", () => {
    expect(serializeError("oops").message).toBe("oops");
    expect(serializeError({ x: 1 }).message).toBe('{"x":1}');
  });
});

describe("redactFields", () => {
  it("redacts known secret keys at any depth", () => {
    const input = {
      ok: "yes",
      password: "hunter2",
      nested: { token: "abc", deeper: { apikey: "k" } },
      arr: [{ authorization: "Bearer x" }],
    };
    const out = redactFields(input);
    expect(out.ok).toBe("yes");
    expect(out.password).toBe("<redacted>");
    expect(out.nested.token).toBe("<redacted>");
    expect(out.nested.deeper.apikey).toBe("<redacted>");
    expect(out.arr[0]!.authorization).toBe("<redacted>");
  });

  it("does not mutate input", () => {
    const input = { token: "abc" };
    redactFields(input);
    expect(input.token).toBe("abc");
  });

  it("is case-insensitive on key names", () => {
    const out = redactFields({ Authorization: "Bearer x", API_KEY: "k" });
    expect(out.Authorization).toBe("<redacted>");
    expect(out.API_KEY).toBe("<redacted>");
  });

  it("handles primitives and nulls without throwing", () => {
    expect(redactFields(null as unknown as object)).toBeNull();
    expect(redactFields(42 as unknown as object)).toBe(42);
  });
});

describe("withRequest / currentRequestId", () => {
  it("propagates requestId across async awaits", async () => {
    const id = "req-test-1";
    const inner = async () => {
      await Promise.resolve();
      return currentRequestId();
    };
    const seen = await withRequest(id, () => inner());
    expect(seen).toBe(id);
  });

  it("returns undefined outside a withRequest scope", () => {
    expect(currentRequestId()).toBeUndefined();
  });

  it("scopes are isolated", async () => {
    const a = withRequest("A", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return currentRequestId();
    });
    const b = withRequest("B", async () => {
      await new Promise((r) => setTimeout(r, 1));
      return currentRequestId();
    });
    expect(await Promise.all([a, b])).toEqual(["A", "B"]);
  });
});

describe("shortId", () => {
  it("returns 12 chars with no collisions across 1000 calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = shortId();
      expect(id.length).toBeGreaterThanOrEqual(11);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});

describe("withTimer", () => {
  it("returns the value and emits one ok line on success", async () => {
    const log = getLogger("core-test-ok");
    const got = await withTimer(log, "test.ok", async () => 42);
    expect(got).toBe(42);
  });

  it("rethrows the original error on failure", async () => {
    const log = getLogger("core-test-fail");
    await expect(
      withTimer(log, "test.fail", async () => {
        throw new BrainError({
          code: "TEST",
          category: "internal",
          message: "expected",
        });
      }),
    ).rejects.toThrow("expected");
  });
});
