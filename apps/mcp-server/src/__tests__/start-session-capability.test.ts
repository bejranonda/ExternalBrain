/**
 * brain_start_session hands back rule text only to tokens holding the
 * `knowledge` capability.
 *
 * Retrieval is mocked so the test can tell "gated" from "found nothing": the
 * test env has no embedding provider, so with real retrieval
 * `relevantKnowledge` is absent for every token and a gate regression would
 * still pass. The permitted-token case is the control that proves the mock
 * path returns knowledge when the gate allows it.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

const retrieve = vi.hoisted(() => vi.fn());
vi.mock("@brain/core", async (orig) => {
  const real = await orig<typeof import("@brain/core")>();
  return { ...real, kra: { ...real.kra, retrieve } };
});

const { db } = await import("@brain/db");
const { startSession } = await import("../tools/start-session.js");

const live = await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
const guard = live ? describe : describe.skip;

guard("brain_start_session knowledge capability gate", () => {
  const userIds: string[] = [];

  beforeEach(() => {
    retrieve.mockReset();
    retrieve.mockResolvedValue({
      injectedIds: ["k_gate_probe"],
      decisions: [],
      reflexes: [
        { id: "k_gate_probe", type: "reflex", triggerText: "t", ruleText: "GATE-PROBE-RULE", confidence: 0.9, tags: [] },
      ],
      recipes: [],
      heuristics: [],
      principles: [],
      antiPrinciples: [],
    });
  });

  afterAll(async () => {
    await db.session.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => {});
    await db.$disconnect().catch(() => {});
  });

  async function authWith(capabilities: string[]) {
    const u = await db.user.create({ data: { email: `cap-gate-${randomBytes(5).toString("hex")}@test.local` } });
    userIds.push(u.id);
    return { userId: u.id, projectId: null, tokenId: null, capabilities } as unknown as Parameters<
      typeof startSession.handler
    >[1];
  }

  const call = async (capabilities: string[]) =>
    (await startSession.handler(
      { clientType: "custom", prompt: "wire a pg-boss job for nightly digests" },
      await authWith(capabilities),
    )) as { sessionId: string; relevantKnowledge?: { knowledgeIds: string[] } };

  it("control: a knowledge-capable token retrieves and receives rules", async () => {
    const res = await call(["knowledge", "sessions"]);
    expect(retrieve).toHaveBeenCalledOnce();
    expect(res.relevantKnowledge?.knowledgeIds).toEqual(["k_gate_probe"]);
  });

  it("an unrestricted token (empty list) is treated as knowledge-capable", async () => {
    const res = await call([]);
    expect(retrieve).toHaveBeenCalledOnce();
    expect(res.relevantKnowledge).toBeDefined();
  });

  it("a sessions-only token opens a session without retrieval running at all", async () => {
    const res = await call(["sessions"]);
    expect(res.sessionId).toBeTruthy();
    expect(retrieve).not.toHaveBeenCalled();
    expect(res.relevantKnowledge).toBeUndefined();
  });
});
