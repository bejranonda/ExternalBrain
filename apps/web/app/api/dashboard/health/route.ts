import { db } from "@brain/db";
import { authErrorResponse, getCurrentUserId } from "@/lib/brain/auth";
import { findDuplicateProjectGroups, getUserProjects, LEARNING_EVENT_TYPE } from "@brain/core";

export interface LoopHealthPayload {
  windowDays: number;
  sessions: {
    opened: number;
    closed: number;
    closedWithLearnings: number;
  };
  injection: {
    /** Sessions in the window that received injected knowledge at open. */
    injectedSessions: number;
    /** Of those, sessions whose close reported ≥1 injected item as used. */
    usedSessions: number;
  };
  knowledge: {
    active: number;
    /** Active knowledge with ≥1 recorded outcome (success or failure). */
    withOutcomes: number;
    validatedPositive: number;
    validatedNegative: number;
  };
  duplicateProjects: {
    organizationId: string;
    normalizedName: string;
    names: string[];
  }[];
}

const WINDOW_DAYS = 30;

/**
 * Loop-health vitals for the flywheel-repair program (spec §4.2): is capture
 * alive, is retrieval helping, is the corpus validated, is project identity
 * fragmenting again. User-wide (not project-scoped) — the loop is a property
 * of the whole Brain, and a starved corpus must not hide behind an active
 * project filter.
 */
export async function GET(): Promise<Response> {
  try {
    const userId = await getCurrentUserId();
    const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
    const windowSession = { userId, startedAt: { gte: cutoff } };

    const [
      opened,
      closed,
      learningSessions,
      injectedRows,
      usedRows,
      active,
      withOutcomes,
      validatedPositive,
      userProjects,
    ] = await Promise.all([
      db.session.count({ where: windowSession }),
      db.session.count({ where: { ...windowSession, endedAt: { not: null } } }),
      db.sessionEvent.findMany({
        where: { eventType: LEARNING_EVENT_TYPE, session: windowSession },
        select: { sessionId: true },
        distinct: ["sessionId"],
      }),
      db.sessionKnowledgeApplication.findMany({
        where: { role: "injected", session: windowSession },
        select: { sessionId: true },
        distinct: ["sessionId"],
      }),
      db.sessionKnowledgeApplication.findMany({
        where: { role: "used_reported", session: windowSession },
        select: { sessionId: true },
        distinct: ["sessionId"],
      }),
      db.knowledge.count({ where: { ownerUserId: userId, deletedAt: null } }),
      db.knowledge.count({
        where: {
          ownerUserId: userId,
          deletedAt: null,
          OR: [{ successCount: { gt: 0 } }, { failureCount: { gt: 0 } }],
        },
      }),
      db.knowledge.count({
        where: { ownerUserId: userId, deletedAt: null, successCount: { gt: 0 } },
      }),
      getUserProjects(db, userId),
    ]);

    const injectedIds = new Set(injectedRows.map((r) => r.sessionId));
    const usedWithinInjected = usedRows.filter((r) => injectedIds.has(r.sessionId)).length;

    const payload: LoopHealthPayload = {
      windowDays: WINDOW_DAYS,
      sessions: {
        opened,
        closed,
        closedWithLearnings: learningSessions.length,
      },
      injection: {
        injectedSessions: injectedIds.size,
        usedSessions: usedWithinInjected,
      },
      knowledge: {
        active,
        withOutcomes,
        validatedPositive,
        validatedNegative: withOutcomes - validatedPositive,
      },
      duplicateProjects: findDuplicateProjectGroups(
        userProjects.map((p) => ({ id: p.id, name: p.name, organizationId: p.organizationId })),
      ).map((g) => ({
        organizationId: g.organizationId,
        normalizedName: g.normalizedName,
        names: g.projects.map((p) => p.name),
      })),
    };

    return Response.json(payload);
  } catch (err) {
    return authErrorResponse(err);
  }
}
