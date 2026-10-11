import { db } from "@brain/db";
import { hasCapability } from "@brain/core";
import type { ToolDef } from "./index.js";

export const getUserStyle: ToolDef = {
  name: "brain_get_user_style",
  description:
    "Get the user's coding style preferences (reflexes + peer card) for scaffolding new files. Returns Peer Card facts first (hard overrides) then high-confidence reflexes.",
  inputSchema: { type: "object", properties: {} },
  handler: async (_input, auth) => {
    // Reflexes are Knowledge rows: a token without `knowledge` gets the peer
    // card (a user-level fact) but no rule text, and a project-scoped token
    // gets that project's reflexes plus project-less ones — the same scoping
    // the brain://user/style-profile resource already applied. This tool is
    // the documented connectivity check, so it degrades instead of throwing.
    const mayReadKnowledge = hasCapability(auth.capabilities, "knowledge");
    const [card, reflexes] = await Promise.all([
      db.peerCard.findFirst({
        where: { ownerUserId: auth.userId, ownerProjectId: null },
      }),
      !mayReadKnowledge ? Promise.resolve([]) : db.knowledge.findMany({
        where: {
          ownerUserId: auth.userId,
          type: "reflex",
          confidence: { gte: 0.7 },
          deletedAt: null,
          ...(auth.projectId
            ? { OR: [{ ownerProjectId: auth.projectId }, { ownerProjectId: null }] }
            : {}),
        },
        orderBy: { confidence: "desc" },
        take: 30,
        select: {
          triggerText: true,
          ruleText: true,
          confidence: true,
          tags: true,
        },
      }),
    ]);

    return {
      peerCard: card?.facts ?? [],
      reflexes,
    };
  },
};
