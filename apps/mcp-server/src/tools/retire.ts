/**
 * brain_retire_knowledge — soft-delete a Knowledge row.
 *
 * Who may retire what (operator decision 2026-10-12, v2.23.0): your own rows
 * freely; anyone else's row only by naming the knowledge that replaces it
 * (`replacedById`). Knowledge leaves the Brain because better knowledge took
 * its place — an outdated rule after its successor is taught, or a duplicate
 * pointing at the copy that stays — never because one agent decided a
 * teammate's decision was wrong and erased it with nothing in its place. A
 * project-scoped token reaches only its own project. Rules live in
 * `retireKnowledgeById` (packages/core/src/knowledge-retire.ts), which also
 * keeps the safety net from v2.20.0: no hard delete, and a full snapshot in
 * the append-only audit log, returned here for recovery-by-re-teach.
 */
import { z } from "zod";
import { db } from "@brain/db";
import { retireKnowledgeById } from "@brain/core";
import type { ToolDef } from "./index.js";
import { requireCapability } from "../capability.js";
import { BrainError } from "@brain/core";

const inputShape = z.object({
  id: z.string().min(1),
  reason: z.string().max(500).optional(),
  replacedById: z.string().min(1).optional(),
});

export const retireKnowledge: ToolDef = {
  name: "brain_retire_knowledge",
  description:
    "Soft-delete one Knowledge row by id. Your OWN rows: retire freely (e.g. a misfile that landed under the wrong project). Anyone else's row (a teammate's org-shared decision): only by naming the knowledge that REPLACES it in `replacedById` — teach the corrected rule first and pass its id, or for a duplicate pass the id of the copy that stays. Without a replacement it is refused with REPLACEMENT_REQUIRED and nothing changes. A project-scoped token can only retire rows in its own project. Never hard-deletes: the full row is written to an audit-log snapshot and returned as `snapshot`, so a mistake is recoverable by re-teaching from it.",
  inputSchema: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", description: "The Knowledge row id, as returned by brain_teach_knowledge or brain_retrieve_knowledge." },
      reason: {
        type: "string",
        description: "Optional — why this is being retired. Stored in the audit-log snapshot, not on the row itself.",
      },
      replacedById: {
        type: "string",
        description:
          "The id of a live Knowledge row that takes this one's place. Required when the row belongs to someone else; optional for your own (it records the lineage).",
      },
    },
  },
  handler: async (raw, auth) => {
    requireCapability(auth, "knowledge");
    const input = inputShape.parse(raw);

    const result = await retireKnowledgeById(db, {
      id: input.id,
      actorUserId: auth.userId,
      reason: input.reason,
      replacedById: input.replacedById,
      tokenProjectId: auth.projectId,
    });

    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        throw new BrainError({
          message: "no knowledge row with that id (or it is already retired)",
          code: "NOT_FOUND",
          category: "validation",
          status: 404,
        });
      }
      if (result.error === "REPLACEMENT_REQUIRED") {
        throw new BrainError({
          message:
            "this row belongs to someone else — it can only be retired by naming the knowledge that replaces it. Teach the corrected rule (brain_teach_knowledge), then call again with replacedById set to its id; for a duplicate, pass the id of the copy that stays",
          code: "REPLACEMENT_REQUIRED",
          category: "validation",
          status: 409,
        });
      }
      if (result.error === "REPLACEMENT_INVALID") {
        throw new BrainError({
          message:
            "replacedById must be a different, live knowledge row that you can see (and, for a project-scoped token, in its project)",
          code: "REPLACEMENT_INVALID",
          category: "validation",
          status: 400,
        });
      }
      // FORBIDDEN: read-parity means this is indistinguishable from "does not
      // exist" for anyone who couldn't see it anyway — but the caller here
      // supplied a real id (e.g. a stale one from a previous session), so a
      // precise 403 is the honest answer, not information disclosure.
      throw new BrainError({
        message: "this row is not visible to you (private, or a different org/project) and cannot be retired",
        code: "FORBIDDEN_PROJECT",
        category: "auth",
        status: 403,
      });
    }

    return {
      retired: true,
      wasOwnRow: result.wasOwnRow,
      replacedById: result.replacedById,
      snapshot: result.snapshot,
      ...(result.wasOwnRow
        ? {}
        : {
            note:
              "This row belonged to another user (org-shared). It was retired as replaced by replacedById; the audit log records you as actor.",
          }),
    };
  },
};
