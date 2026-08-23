import { z } from "zod";
import { db } from "@brain/db";
import type { ToolDef } from "./index.js";
import { resolveReadProjectId } from "../scope.js";
import { requireCapability } from "../capability.js";

const inputShape = z.object({
  query: z.string().min(2),
  limit: z.number().int().min(1).max(50).default(10),
});

export const sessionSearch: ToolDef = {
  name: "brain_session_search",
  description:
    "Search the user's past sessions by free text (Postgres full-text). Matches session PROMPTS, and every term must appear (AND semantics) — so pass one or two distinctive keywords ('embedding provenance'), not a natural-language sentence, which will usually match nothing. An empty result means no prompt contained all your terms; it does NOT mean the Brain has no relevant sessions. Widen by dropping terms, or use brain_ask_oracle for a question-shaped query.",
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string" },
      limit: { type: "integer", default: 10, maximum: 50 },
    },
  },
  handler: async (raw, auth) => {
    requireCapability(auth, "sessions");
    const input = inputShape.parse(raw);
    // A scoped token searches only its own project's sessions. Appended as
    // an extra AND rather than folded into the existing predicate so the
    // unscoped path emits byte-identical SQL to before.
    const scopedProjectId = resolveReadProjectId(auth);
    const projectClause = scopedProjectId ? ` AND s."projectId" = $3` : "";
    const projectClauseFlat = scopedProjectId ? ` AND "projectId" = $3` : "";
    const projectParams = scopedProjectId ? [scopedProjectId] : [];
    // Postgres FTS over `metadata->>'prompt'` and `SessionEvent.payload::text`,
    // ranked with `ts_rank_cd`. The `websearch_to_tsquery` form accepts the
    // natural query string as-is (quoted phrases, `-term`, `or`). A GIN
    // expression index keeps this fast at scale — see
    // `packages/db/prisma/migrations/*_session_fts/` for the DDL.
    // Fallback path: if no row matches the tsquery, degrade to ILIKE so that
    // partial-word and pre-migration environments still return useful rows.
    const tsRows = await db.$queryRawUnsafe<
      Array<{
        id: string;
        startedAt: Date;
        endedAt: Date | null;
        outcome: string | null;
        sqs: number | null;
        prompt: string | null;
        rank: number;
      }>
    >(
      `
      WITH q AS (SELECT websearch_to_tsquery('english', $2) AS tsq),
      matches AS (
        SELECT s.id,
               s."startedAt",
               s."endedAt",
               s.outcome,
               s.sqs,
               s.metadata->>'prompt' AS prompt,
               ts_rank_cd(
                 to_tsvector('english', coalesce(s.metadata->>'prompt', '')),
                 q.tsq
               ) AS rank
        FROM "Session" s, q
        WHERE s."userId" = $1${projectClause}
          AND (
            to_tsvector('english', coalesce(s.metadata->>'prompt', '')) @@ q.tsq
            OR s.id IN (
              SELECT e."sessionId"
              FROM "SessionEvent" e, q
              WHERE to_tsvector('english', coalesce(e.payload::text, '')) @@ q.tsq
            )
          )
      )
      SELECT * FROM matches
      ORDER BY rank DESC, "startedAt" DESC
      LIMIT ${input.limit}
      `,
      auth.userId,
      input.query,
      ...projectParams,
    );

    if (tsRows.length > 0) {
      return { sessions: tsRows };
    }

    const fallback = await db.$queryRawUnsafe<
      Array<{
        id: string;
        startedAt: Date;
        endedAt: Date | null;
        outcome: string | null;
        sqs: number | null;
        prompt: string | null;
        rank: number | null;
      }>
    >(
      `
      SELECT id, "startedAt", "endedAt", outcome, sqs,
             metadata->>'prompt' AS prompt,
             NULL::real AS rank
      FROM "Session"
      WHERE "userId" = $1${projectClauseFlat}
        AND (
          metadata->>'prompt' ILIKE '%' || $2 || '%'
          OR id IN (
            SELECT "sessionId" FROM "SessionEvent"
            WHERE payload::text ILIKE '%' || $2 || '%'
          )
        )
      ORDER BY "startedAt" DESC
      LIMIT ${input.limit}
      `,
      auth.userId,
      input.query,
      ...projectParams,
    );
    return { sessions: fallback };
  },
};
