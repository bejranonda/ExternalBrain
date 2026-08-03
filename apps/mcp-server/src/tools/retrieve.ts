import { z } from "zod";
import { kra, formatter } from "@brain/core";
import type { ToolDef } from "./index.js";
import { resolveReadProjectId } from "../scope.js";
import { resolveOrgScope } from "../org-scope.js";

const inputShape = z.object({
  prompt: z.string().min(1),
  context: z
    .object({
      sessionId: z.string().optional(),
      projectId: z.string().optional(),
      framework: z.string().optional(),
      language: z.string().optional(),
      sessionMode: z
        .enum(["building", "debugging", "refactoring", "exploring"])
        .optional(),
    })
    .default({}),
  maxItems: z.number().int().min(1).max(20).default(10),
});

export const retrieveKnowledge: ToolDef = {
  name: "brain_retrieve_knowledge",
  description:
    "Retrieve knowledge relevant to a coding task. Call BEFORE generating code to ensure consistency with the user's preferences and past successful patterns. Returns typed knowledge items and a pre-formatted injection string ready for a user-message block.",
  inputSchema: {
    type: "object",
    required: ["prompt"],
    properties: {
      prompt: { type: "string" },
      context: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          projectId: { type: "string" },
          framework: {
            type: "string",
            examples: ["react", "nextjs", "vue", "django"],
          },
          language: {
            type: "string",
            examples: ["typescript", "python", "rust"],
          },
          sessionMode: {
            type: "string",
            enum: ["building", "debugging", "refactoring", "exploring"],
          },
        },
      },
      maxItems: { type: "integer", default: 10, maximum: 20 },
    },
  },
  handler: async (raw, auth) => {
    const input = inputShape.parse(raw);
    // A scoped token reads only its own project. `projectId` arrives from
    // client input, so without this a token labelled "scoped to project X"
    // could retrieve from every project its owner had. See ../scope.ts.
    const projectId = resolveReadProjectId(auth, input.context.projectId);
    // Org sharing: resolved server-side from the project's own organizationId
    // and re-checked against OrganizationMember. Never client-supplied — it
    // is the only input that widens kra.ts's owner gate. See ../org-scope.ts.
    const orgScope = await resolveOrgScope(auth.userId, projectId);
    const bundle = await kra.retrieve(
      input.prompt,
      {
        sessionId: input.context.sessionId ?? "",
        userId: auth.userId,
        projectId,
        ...orgScope,
        framework: input.context.framework,
        language: input.context.language,
        sessionMode: input.context.sessionMode,
      },
      input.maxItems,
    );
    return {
      bundle,
      injection: formatter.formatForInjection(bundle),
    };
  },
};
