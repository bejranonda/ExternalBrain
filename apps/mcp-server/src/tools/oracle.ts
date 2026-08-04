import { z } from "zod";
import { oracle } from "@brain/core";
import type { ToolDef } from "./index.js";
import { resolveReadProjectId } from "../scope.js";
import { requireCapability } from "../capability.js";

const inputShape = z.object({
  question: z.string().min(3),
  reasoningLevel: z
    .enum(["minimal", "low", "medium", "high", "max"])
    .default("medium"),
});

export const askOracle: ToolDef = {
  name: "brain_ask_oracle",
  description:
    "Ask a natural-language question about the user's Brain — past sessions, patterns, preferences. Use when the user asks 'how did I solve X before?' or 'what do I usually use for Y?'. Returns an answer with [^N] citations.",
  inputSchema: {
    type: "object",
    required: ["question"],
    properties: {
      question: { type: "string" },
      reasoningLevel: {
        type: "string",
        enum: ["minimal", "low", "medium", "high", "max"],
        default: "medium",
      },
    },
  },
  handler: async (raw, auth) => {
    requireCapability(auth, "oracle");
    const input = inputShape.parse(raw);
    // `ask()` has always accepted a projectId; this tool simply never passed
    // one, so a scoped token's Oracle answers were drawn from the whole
    // account. The tool takes no project parameter of its own, so there is
    // nothing to reject — resolve() just supplies the token's binding.
    const projectId = resolveReadProjectId(auth);
    return oracle.ask(
      auth.userId,
      {
        question: input.question,
        reasoningLevel: input.reasoningLevel,
      },
      projectId,
    );
  },
};
