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

export async function readResource(uri: string, auth: AuthContext) {
  switch (uri) {
    case "brain://user/style-profile":
      return jsonResource(uri, await styleProfile(auth.userId));
    case "brain://user/active-skills":
      return jsonResource(uri, await activeSkills(auth.userId));
    case "brain://user/recent-sessions":
      return jsonResource(uri, await recentSessions(auth.userId));
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

async function styleProfile(userId: string) {
  const reflexes = await db.knowledge.findMany({
    where: { ownerUserId: userId, type: "reflex", deletedAt: null },
    orderBy: { confidence: "desc" },
    take: 20,
    select: { triggerText: true, ruleText: true, confidence: true },
  });
  return { rules: reflexes };
}

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

async function recentSessions(userId: string) {
  return db.session.findMany({
    where: { userId },
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
