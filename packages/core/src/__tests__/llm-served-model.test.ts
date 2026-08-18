/**
 * Gateway alias detection.
 *
 * Anthropic-compatible gateways answer an unknown or superseded model name
 * with a different model instead of 404ing. Measured against the Z.ai Coding
 * Plan endpoint on 2026-08-17: `glm-5.1`, `glm-5.2` and `glm-5` were all
 * served by `glm-5.3`, and `claude-haiku-4-5` by `glm-4.7`. Nothing errored,
 * so `cost.ts` priced a model that never ran. `reportServedModel` is the only
 * place that divergence becomes visible — these tests pin that it fires, that
 * it stays quiet on the happy path, and that it doesn't spam per call.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { reportServedModel, seenModelAliases } from "../llm.js";
import { getLogger } from "../logger.js";

describe("reportServedModel", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    seenModelAliases.clear();
    // The module-level child logger shares the "core" logger's warn method.
    warn = vi.spyOn(getLogger("core"), "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("stays silent when the provider served what we asked for", () => {
    reportServedModel("glm-4.7", "glm-4.7");
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when the provider reported no model", () => {
    reportServedModel("glm-4.7", undefined);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when the gateway aliases to a different model", () => {
    reportServedModel("glm-5.1", "glm-5.3");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      requested: "glm-5.1",
      served: "glm-5.3",
    });
  });

  it("warns when a claude-* request is answered by a GLM model", () => {
    reportServedModel("claude-haiku-4-5", "glm-4.7");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      requested: "claude-haiku-4-5",
      served: "glm-4.7",
    });
  });

  it("does not warn when Anthropic resolves an alias to a dated snapshot", () => {
    // `claude-x` -> `claude-x-20260101` is a version pin, not a gateway
    // substituting a different model. Warning here would fire on every plain
    // Anthropic deployment and write an audit row claiming a model "did not
    // run" when it did.
    reportServedModel("claude-opus-5", "claude-opus-5-20260101");
    expect(warn).not.toHaveBeenCalled();
  });

  it("still warns when a different model shares the requested prefix", () => {
    // Not a dated snapshot — no 8-digit suffix — so this is a real swap and
    // the prefix check must not swallow it.
    reportServedModel("glm-4", "glm-4-turbo");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("logs each requested->served pair once, not once per call", () => {
    reportServedModel("glm-5.1", "glm-5.3");
    reportServedModel("glm-5.1", "glm-5.3");
    reportServedModel("glm-5.1", "glm-5.3");
    expect(warn).toHaveBeenCalledTimes(1);

    // A different pair is still worth one line of its own.
    reportServedModel("claude-haiku-4-5", "glm-4.7");
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
