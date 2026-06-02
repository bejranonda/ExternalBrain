import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetEnvCache, envForWeb, envForWorker, envForMcp } from "../env.js";

const KEEP = [
  "NODE_ENV",
  "DATABASE_URL",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIMENSIONS",
  "ORACLE_MODEL",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DEV_USER_ID",
  "RATE_LIMIT_ORACLE_PER_DAY",
  "RATE_LIMIT_KEA_PER_HOUR",
  "RATE_LIMIT_MCP_PER_MINUTE",
  "MCP_TRANSPORT",
  "MCP_SERVER_HTTP_PORT",
  "BRAIN_MCP_TOKEN",
  "PG_BOSS_SCHEMA",
  "KEA_ENABLED",
  "AUTOSKILL_ENABLED",
] as const;

let saved: Partial<Record<(typeof KEEP)[number], string | undefined>>;

function setEnv(patch: Partial<Record<(typeof KEEP)[number], string | undefined>>): void {
  for (const k of KEEP) delete process.env[k];
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) process.env[k] = v;
  }
  _resetEnvCache();
}

describe("env", () => {
  beforeEach(() => {
    saved = {};
    for (const k of KEEP) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of KEEP) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    _resetEnvCache();
  });

  it("throws when DATABASE_URL is missing", () => {
    setEnv({});
    expect(() => envForWeb()).toThrow(/DATABASE_URL/);
  });

  it("throws when DATABASE_URL is not a postgres URL", () => {
    setEnv({ DATABASE_URL: "mysql://foo" });
    expect(() => envForWeb()).toThrow(/postgres:\/\/ URL/);
  });

  it("applies defaults when optional vars are unset", () => {
    setEnv({ DATABASE_URL: "postgresql://x" });
    const env = envForWeb();
    expect(env.EMBEDDING_MODEL).toBe("text-embedding-3-small");
    expect(env.EMBEDDING_DIMENSIONS).toBe(1536);
    expect(env.RATE_LIMIT_ORACLE_PER_DAY).toBe(100);
    expect(env.ORACLE_MODEL).toBe("claude-sonnet-4-6");
  });

  it("coerces numeric strings for int fields", () => {
    setEnv({
      DATABASE_URL: "postgresql://x",
      RATE_LIMIT_ORACLE_PER_DAY: "250",
      EMBEDDING_DIMENSIONS: "3072",
    });
    const env = envForWeb();
    expect(env.RATE_LIMIT_ORACLE_PER_DAY).toBe(250);
    expect(env.EMBEDDING_DIMENSIONS).toBe(3072);
  });

  it("worker env parses feature-flag booleans", () => {
    setEnv({
      DATABASE_URL: "postgresql://x",
      KEA_ENABLED: "0",
      AUTOSKILL_ENABLED: "true",
    });
    const env = envForWorker();
    expect(env.KEA_ENABLED).toBe(false);
    expect(env.AUTOSKILL_ENABLED).toBe(true);
  });

  it("mcp env parses transport enum and port", () => {
    setEnv({
      DATABASE_URL: "postgresql://x",
      MCP_TRANSPORT: "http",
      MCP_SERVER_HTTP_PORT: "4321",
    });
    const env = envForMcp();
    expect(env.MCP_TRANSPORT).toBe("http");
    expect(env.MCP_SERVER_HTTP_PORT).toBe(4321);
  });

  it("rejects an invalid transport value", () => {
    setEnv({
      DATABASE_URL: "postgresql://x",
      MCP_TRANSPORT: "quic",
    });
    expect(() => envForMcp()).toThrow(/MCP_TRANSPORT/);
  });

  it("memoizes — repeated calls return the same object", () => {
    setEnv({ DATABASE_URL: "postgresql://x" });
    const a = envForWeb();
    const b = envForWeb();
    expect(a).toBe(b);
  });
});
