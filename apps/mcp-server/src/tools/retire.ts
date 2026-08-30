/**
 * brain_retire_knowledge — retire ANY Knowledge row this token can see.
 *
 * The gap this closes: every other write on the MCP surface only ever ADDS
 * (teach) or retires a row the SAME caller owns as a side effect of teaching
 * its replacement (`supersedesKnowledgeId`). Nothing let an agent clean up a
 * misfile it just made — including the exact shape that motivated this tool:
 * a decision taught with no `projectName`, landing in the wrong project, with
 * no MCP path to undo it (KNOWN_ISSUES §0au).
 *
 * Scope is deliberately broader than teach's supersede: authorization here is
 * READ parity — if `brain_retrieve_knowledge` could return this row to this
 * caller, this tool can retire it, including a teammate's org-shared
 * decision. That is a real widening of what an agent can do unilaterally, and
 * it was an explicit operator choice (2026-08-30), not a default assumed
 * without asking. The mitigation lives in `retireKnowledgeById`
 * (packages/core/src/knowledge-retire.ts): it never hard-deletes, and it
 * writes the full pre-delete content into an append-only AuditLog row before
 * touching anything — so a wrongly-retired row is always recoverable from the
 * `snapshot` this tool returns, without an operator ever touching SQL.
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
});

export const retireKnowledge: ToolDef = {
  name: "brain_retire_knowledge",
  description:
    "Soft-delete one Knowledge row by id — the only MCP verb that removes rather than adds. Scope is READ parity: you can retire any row brain_retrieve_knowledge could have returned to you, including a teammate's org-shared decision, not only rows you authored. Never hard-deletes and never destroys the content: the full row is written into an audit-log snapshot BEFORE deletion and returned in the response as `snapshot`, so a mistaken retire is recoverable by re-teaching from that snapshot — there is no separate restore tool. Use this to clean up a misfile (e.g. knowledge that landed under the wrong project via the fallback) rather than leaving it live and hoping to remember to ignore it.",
  inputSchema: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", description: "The Knowledge row id, as returned by brain_teach_knowledge or brain_retrieve_knowledge." },
      reason: {
        type: "string",
        description: "Optional — why this is being retired. Stored in the audit-log snapshot, not on the row itself.",
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
      snapshot: result.snapshot,
      ...(result.wasOwnRow
        ? {}
        : {
            note:
              "This row belonged to another user (org-shared). Its retirement was written to the audit log with your userId as actor.",
          }),
    };
  },
};
