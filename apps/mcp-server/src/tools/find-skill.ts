import { z } from "zod";
import { db, toVector } from "@brain/db";
import { embedding } from "@brain/core";
import type { ToolDef } from "./index.js";
import { requireCapability } from "../capability.js";

const inputShape = z.object({
  query: z.string().min(2),
  framework: z.string().optional(),
  stage: z.enum(["inbox", "notes", "knowledge", "wisdom"]).optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

/**
 * NOTE ON TOKEN SCOPE: this tool is deliberately NOT project-scoped, and that
 * is a schema fact rather than an omission — the `Skill` model has no
 * `ownerProjectId` column (see packages/db/prisma/schema.prisma). Skills are a
 * user/team artifact, so there is no project boundary for a scoped token to
 * cross here. Every read path that *does* have one now enforces it via
 * ../scope.ts.
 *
 * If skills should become project-partitioned, that is a migration plus a
 * product decision, tracked in KNOWN_ISSUES §0q. Until then a scoped token
 * sees its owner's skills, and the docs say so rather than implying otherwise.
 */
export const findSkill: ToolDef = {
  name: "brain_find_skill",
  description:
    "Find a skill (full markdown bundle) by semantic match. Use when the user asks for a complete recipe rather than atomic rules.",
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string" },
      framework: { type: "string" },
      stage: {
        type: "string",
        enum: ["inbox", "notes", "knowledge", "wisdom"],
      },
      limit: { type: "integer", default: 5, maximum: 20 },
    },
  },
  handler: async (raw, auth) => {
    requireCapability(auth, "skills");
    const input = inputShape.parse(raw);
    const vec = await embedding.embed(input.query);

    // Placeholders and params are built together — see packages/db/src/index.ts
    // for the same shape. Keeping them in one place is what stops the count
    // from drifting the way it did here.
    const params: unknown[] = [toVector(vec), auth.userId];
    const stageCond = input.stage
      ? (params.push(input.stage), `AND stage = $${params.length}`)
      : "";

    const rows = await db.$queryRawUnsafe<
      Array<{ id: string; skillId: string; title: string; similarity: number }>
    >(
      `
      SELECT id, "skillId", title,
             1 - (embedding <=> $1::vector) AS similarity
      FROM "Skill"
      WHERE embedding IS NOT NULL
        AND "ownerUserId" = $2
        ${stageCond}
      ORDER BY embedding <=> $1::vector ASC
      LIMIT ${input.limit}
      `,
      // `input.stage` used to be passed unconditionally while `$3` appeared
      // only when a stage was supplied, so every call WITHOUT `stage` — the
      // default — died at bind time with Postgres 08P01 before any row was
      // read. The empty Skill table hid it: the failure looked like a
      // database problem rather than a query-construction one.
      ...params,
    );

    const skills = await db.skill.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
    const byId = new Map(skills.map((s) => [s.id, s]));
    return rows
      .map((r) => {
        const s = byId.get(r.id);
        if (!s) return null;
        return { ...s, similarity: r.similarity };
      })
      .filter(Boolean);
  },
};
