/**
 * MCP resources — read-only views into the user's brain.
 */
import { db } from "@brain/db";
import type { AuthContext } from "./auth.js";

export const resources = [
  {
    uri: "brain://user/style-profile",
    name: "Your coding style profile",
    mimeType: "application/json",
    description:
      "Your style preferences: indentation, quotes, naming, framework defaults. Use when scaffolding new files.",
  },
  {
    uri: "brain://user/active-skills",
    name: "Your active skills",
    mimeType: "application/json",
    description: "Skills in the 'knowledge' or 'wisdom' stage for your account.",
  },
  {
    uri: "brain://user/recent-sessions",
    name: "Your 10 most recent sessions",
    mimeType: "application/json",
  },
  {
    uri: "brain://user/peer-card",
    name: "Your hard-override facts",
    mimeType: "application/json",
    description:
      "Hard-coded bullet facts the user has told us explicitly. These override synthesized knowledge.",
  },
];

/**
 * Resources honour `MCPToken.projectId` where the underlying table HAS a
 * project dimension, and say so plainly where it does not:
 *
 *   style-profile   → Knowledge.ownerProjectId    → scoped
 *   recent-sessions → Session.projectId           → scoped
 *   active-skills   → Skill has NO project column → cannot be scoped
 *   peer-card       → deliberately reads the user-level card
 *                     (ownerProjectId IS NULL), which is a user fact by
 *                     definition, so there is no boundary to enforce
 *
 * The `active-skills` gap is a schema fact, not an oversight to paper over:
 * skills are a user/team artifact and no `ownerProjectId` exists to filter
 * on. Tracked in KNOWN_ISSUES §0q — closing it needs a migration and a
 * product decision about whether skills should be project-partitioned at all.
 */
export async function readResource(uri: string, auth: AuthContext) {
  const projectId = auth.projectId ?? undefined;
  switch (uri) {
    case "brain://user/style-profile":
      return jsonResource(uri, await styleProfile(auth.userId, projectId));
    case "brain://user/active-skills":
      return jsonResource(uri, await activeSkills(auth.userId));
    case "brain://user/recent-sessions":
      return jsonResource(uri, await recentSessions(auth.userId, projectId));
    case "brain://user/peer-card":
      return jsonResource(uri, await peerCard(auth.userId));
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}

function jsonResource(uri: string, data: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

async function styleProfile(userId: string, projectId?: string) {
  const reflexes = await db.knowledge.findMany({
    where: {
      ownerUserId: userId,
      type: "reflex",
      deletedAt: null,
      // A scoped token sees this project's reflexes plus the caller's own
      // project-less ones — the same shape buildKnowledgeWhere uses, so a
      // scoped token is not cut off from its owner's user-level style.
      ...(projectId
        ? { OR: [{ ownerProjectId: projectId }, { ownerProjectId: null }] }
        : {}),
    },
    orderBy: { confidence: "desc" },
    take: 20,
    select: { triggerText: true, ruleText: true, confidence: true },
  });
  return { rules: reflexes };
}

/**
 * NOT project-scopable: the `Skill` model has no `ownerProjectId`. Left
 * user-scoped deliberately rather than silently returning nothing for a
 * scoped token. See the note on `readResource`.
 */
async function activeSkills(userId: string) {
  return db.skill.findMany({
    where: {
      ownerUserId: userId,
      stage: { in: ["knowledge", "wisdom"] },
      kind: "output",
    },
    orderBy: { usageCount: "desc" },
    take: 50,
    select: {
      skillId: true,
      title: true,
      tags: true,
      mastery: true,
      confidence: true,
    },
  });
}

async function recentSessions(userId: string, projectId?: string) {
  return db.session.findMany({
    where: { userId, ...(projectId ? { projectId } : {}) },
    orderBy: { startedAt: "desc" },
    take: 10,
    select: {
      id: true,
      clientType: true,
      startedAt: true,
      endedAt: true,
      outcome: true,
      sqs: true,
    },
  });
}

async function peerCard(userId: string) {
  const card = await db.peerCard.findFirst({
    where: { ownerUserId: userId, ownerProjectId: null },
  });
  return { facts: card?.facts ?? [] };
}
