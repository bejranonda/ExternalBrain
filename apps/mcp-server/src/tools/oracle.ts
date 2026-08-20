import { z } from "zod";
import {
  oracle,
  getUserProjects,
  ensureDefaultProject,
  ensureNamedProject,
  userCanAccessProject,
} from "@brain/core";
import { db } from "@brain/db";
import type { ToolDef } from "./index.js";
import { resolveProjectForCall } from "../scope.js";
import { requireCapability } from "../capability.js";

const inputShape = z.object({
  question: z.string().min(3),
  reasoningLevel: z
    .enum(["minimal", "low", "medium", "high", "max"])
    .default("medium"),
  projectId: z.string().optional(),
  projectName: z.string().min(1).max(120).optional(),
});

export const askOracle: ToolDef = {
  name: "brain_ask_oracle",
  description:
    "Ask a natural-language question about the user's Brain — past sessions, patterns, preferences. Use when the user asks 'how did I solve X before?' or 'what do I usually use for Y?'. Returns an answer with [^N] citations. Project scoping is per-call and NOT inherited from brain_start_session: pass `projectName` (or `projectId`) to read a specific project's knowledge, or the question is answered from the fallback project only — the response's `project.source` says which happened.",
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
      projectId: { type: "string" },
      projectName: {
        type: "string",
        description:
          "Human-readable project name. Ask against the project the knowledge was taught under — without it the Oracle reads the fallback project only, and knowledge filed elsewhere is invisible.",
      },
    },
  },
  handler: async (raw, auth) => {
    requireCapability(auth, "oracle");
    const input = inputShape.parse(raw);

    // This tool used to take no project parameter at all and resolve purely
    // from the token, so knowledge deliberately filed under a named project
    // was unreadable here — following the documented "pass the project on
    // every call" discipline actively hid knowledge from the Oracle. It now
    // shares one resolution rule with brain_start_session and
    // brain_teach_knowledge (KNOWN_ISSUES §0ar).
    const resolved = await resolveProjectForCall(
      auth,
      { projectId: input.projectId, projectName: input.projectName },
      {
        userCanAccessProject: (u, p) => userCanAccessProject(db, u, p),
        ensureNamedProject: (u, n) => ensureNamedProject(db, u, n),
        getUserProjects: (u) => getUserProjects(db, u),
        ensureDefaultProject: (u) => ensureDefaultProject(db, u),
      },
      (name) =>
        `Answered from "${name}" because no projectId/projectName was given. ` +
        `Knowledge taught under a different project is NOT visible to this answer — ` +
        `pass projectName to ask that project instead.`,
    );

    const answer = await oracle.ask(
      auth.userId,
      {
        question: input.question,
        reasoningLevel: input.reasoningLevel,
      },
      resolved.projectId,
    );

    return {
      ...answer,
      project: {
        id: resolved.projectId,
        ...(resolved.projectName ? { name: resolved.projectName } : {}),
        source: resolved.source,
      },
      ...(resolved.hint ? { hint: resolved.hint } : {}),
    };
  },
};
