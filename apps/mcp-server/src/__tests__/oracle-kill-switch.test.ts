/**
 * `ORACLE_ENABLED=false` must stop the MCP door to the Oracle, not only the
 * web one. `/api/oracle` honoured the switch since #56; `brain_ask_oracle`
 * reaches the same `oracle.ask()` without passing through that route and never
 * checked it, so `docs/PRIVACY.md`'s "send nothing to any LLM" recipe left
 * agents sending knowledge to the model (KNOWN_ISSUES §0ay). The check runs
 * before any DB or LLM call, so this needs neither.
 */
import { afterEach, describe, expect, it } from "vitest";
import { askOracle } from "../tools/oracle.js";
import type { AuthContext } from "../auth.js";

const auth: AuthContext = {
  userId: "u_kill_switch",
  teamId: null,
  scope: "personal",
  tokenId: "t_kill_switch",
  organizationId: null,
  projectId: null,
  capabilities: [],
};

const saved = process.env.ORACLE_ENABLED;
afterEach(() => {
  if (saved === undefined) delete process.env.ORACLE_ENABLED;
  else process.env.ORACLE_ENABLED = saved;
});

describe("brain_ask_oracle kill-switch", () => {
  it.each(["false", "FALSE"])("refuses with ORACLE_PAUSED when ORACLE_ENABLED=%s", async (v) => {
    process.env.ORACLE_ENABLED = v;
    await expect(askOracle.handler({ question: "what did we decide?" }, auth)).rejects.toMatchObject({
      code: "ORACLE_PAUSED",
      status: 503,
    });
  });

  it("still enforces the capability before the switch", async () => {
    process.env.ORACLE_ENABLED = "false";
    await expect(
      askOracle.handler({ question: "what did we decide?" }, { ...auth, capabilities: ["sessions"] }),
    ).rejects.toThrow(/FORBIDDEN_CAPABILITY/);
  });
});
