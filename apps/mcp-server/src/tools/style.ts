import { db } from "@brain/db";
import type { ToolDef } from "./index.js";

export const getUserStyle: ToolDef = {
  name: "brain_get_user_style",
  description:
    "Get the user's coding style preferences (reflexes + peer card) for scaffolding new files. Returns Peer Card facts first (hard overrides) then high-confidence reflexes.",
  inputSchema: { type: "object", properties: {} },
  handler: async (_input, auth) => {
    const [card, reflexes] = await Promise.all([
      db.peerCard.findFirst({
        where: { ownerUserId: auth.userId, ownerProjectId: null },
      }),
      db.knowledge.findMany({
        where: {
          ownerUserId: auth.userId,
          type: "reflex",
          confidence: { gte: 0.7 },
          deletedAt: null,
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
