"use client";

import { useCallback, useState } from "react";
import { parseSSE } from "@brain/core/sse";
import { appendScopeParam } from "./use-project-scope";
import type { ProjectScopeKey } from "./use-project-scope";
import type { OracleReasoningLevel } from "./i18n-types";

export interface OracleCitationMeta {
  // Knowledge fields
  knowledgeType?: "reflex" | "recipe" | "heuristic" | "principle" | "anti_principle";
  triggerText?: string;
  effectiveness?: number;
  outcomes?: number;
  usageCount?: number;
  lastUsedAt?: string;
  // Session fields
  projectName?: string;
  sessionStartedAt?: string;
  sessionOutcome?: "success" | "failure" | "unknown";
  clientType?: string;
}

export interface OracleCitationView {
  marker: number;
  knowledgeId?: string;
  sessionId?: string;
  excerpt: string;
  meta?: OracleCitationMeta;
}

export interface RetrievalRowView {
  id: string;
  type: "anti" | "recipe" | "heuristic" | "principle" | "reflex";
  title: string;
  score: number;
  sem: number;
  rec: number;
  used: boolean;
}

export type OracleGroundedness = "strong" | "moderate" | "weak" | "none";

export interface OracleRetrievedCounts {
  knowledge: number;
  sessions: number;
}

export interface OracleAnswer {
  question: string;
  askedAt: string;
  answer: string;
  citations: OracleCitationView[];
  confidence: "high" | "medium" | "low";
  groundedness: OracleGroundedness;
  retrievedCounts: OracleRetrievedCounts;
  relatedQuestions: string[];
  tokensUsed: number;
  reasoningLevel: OracleReasoningLevel;
  latencyMs: number;
  retrieval: RetrievalRowView[];
}

type Status = "idle" | "asking" | "streaming" | "ready" | "error";

interface State {
  turns: OracleAnswer[];
  status: Status;
  error?: string;
}


export function useOracle(scope: ProjectScopeKey = "project") {
  const [state, setState] = useState<State>({ turns: [], status: "idle" });

  const ask = useCallback(
    async (question: string, reasoningLevel: OracleReasoningLevel) => {
      const trimmed = question.trim();
      if (!trimmed) return;
      const askedAt = new Date().toISOString();
      const t0 = performance.now();

      // Seed the turn immediately so the UI can show tokens as they arrive.
      const pendingTurn: OracleAnswer = {
        question: trimmed,
        askedAt,
        answer: "",
        citations: [],
        confidence: "low",
        groundedness: "none",
        retrievedCounts: { knowledge: 0, sessions: 0 },
        relatedQuestions: [],
        tokensUsed: 0,
        reasoningLevel,
        latencyMs: 0,
        retrieval: [],
      };
      setState((s) => ({ turns: [...s.turns, pendingTurn], status: "asking" }));
      const turnIndex = state.turns.length; // captured for this closure

      try {
        const [streamRes, retrievalRes] = await Promise.all([
          fetch(appendScopeParam("/api/oracle/stream", scope), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ question: trimmed, reasoningLevel }),
          }),
          fetch(appendScopeParam("/api/knowledge/retrieve", scope), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ prompt: trimmed, maxItems: 8 }),
          }),
        ]);
        if (!streamRes.ok || !streamRes.body) {
          throw new Error(`oracle ${streamRes.status}`);
        }

        let retrieval: RetrievalRowView[] = [];
        if (retrievalRes.ok) {
          const r = (await retrievalRes.json()) as {
            rows?: Array<{
              id: string;
              type: string;
              ruleText: string;
              triggerText: string;
              score: number;
              similarity: number;
              recency: number;
              used: boolean;
            }>;
          };
          retrieval = (r.rows ?? []).map((row) => ({
            id: row.id,
            type: normalizeType(row.type),
            title: truncate(row.ruleText ?? row.triggerText ?? row.id, 110),
            score: clamp01(row.score),
            sem: clamp01(row.similarity),
            rec: clamp01(row.recency),
            used: row.used,
          }));
        }
        // Seed retrieval on the pending turn so the inspector lights up
        // during streaming.
        setState((s) => {
          const turns = s.turns.slice();
          const t = turns[turnIndex];
          if (t) turns[turnIndex] = { ...t, retrieval };
          return { ...s, turns, status: "streaming" };
        });

        for await (const { event, data } of parseSSE(streamRes.body)) {
          if (event === "meta") {
            const meta = data as {
              groundedness: OracleGroundedness;
              retrievedCounts: OracleRetrievedCounts;
            };
            setState((s) => {
              const turns = s.turns.slice();
              const t = turns[turnIndex];
              if (t)
                turns[turnIndex] = {
                  ...t,
                  groundedness: meta.groundedness,
                  retrievedCounts: meta.retrievedCounts,
                };
              return { ...s, turns };
            });
          } else if (event === "delta") {
            const delta = (data as { text?: string }).text ?? "";
            if (!delta) continue;
            setState((s) => {
              const turns = s.turns.slice();
              const t = turns[turnIndex];
              if (t) turns[turnIndex] = { ...t, answer: t.answer + delta };
              return { ...s, turns };
            });
          } else if (event === "final") {
            const final = data as {
              citations: OracleCitationView[];
              confidence: "high" | "medium" | "low";
              groundedness: OracleGroundedness;
              retrievedCounts: OracleRetrievedCounts;
              relatedQuestions: string[];
              tokensUsed: number;
            };
            const t1 = performance.now();
            setState((s) => {
              const turns = s.turns.slice();
              const t = turns[turnIndex];
              if (t)
                turns[turnIndex] = {
                  ...t,
                  citations: final.citations,
                  confidence: final.confidence,
                  groundedness: final.groundedness ?? t.groundedness,
                  retrievedCounts: final.retrievedCounts ?? t.retrievedCounts,
                  relatedQuestions: final.relatedQuestions ?? [],
                  tokensUsed: final.tokensUsed,
                  latencyMs: Math.round(t1 - t0),
                };
              return { ...s, turns, status: "ready" };
            });
          } else if (event === "error") {
            throw new Error(
              (data as { message?: string }).message ?? "stream error",
            );
          }
        }
      } catch (err) {
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : "oracle failed",
        }));
      }
    },
    [state.turns.length, scope],
  );

  const reset = useCallback(() => {
    setState({ turns: [], status: "idle" });
  }, []);

  const sendFeedback = useCallback(
    async (turnIndex: number, rating: "up" | "down", reason?: string) => {
      const turn = state.turns[turnIndex];
      if (!turn) return;
      try {
        await fetch("/api/oracle/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: turn.question,
            answer: turn.answer,
            rating,
            // Reason picker (Phase polish) lets a thumbs-down tell the
            // server WHY — irrelevant / wrong / outdated / missing context.
            // Surfaces as the Feedback row's comment so future review
            // distinguishes "answer was bad" from "rule was bad".
            ...(reason ? { comment: `Reason: ${reason}` } : {}),
            citedKnowledgeIds: turn.citations
              .map((c) => c.knowledgeId)
              .filter((id): id is string => typeof id === "string"),
          }),
        });
      } catch {
        /* best-effort */
      }
    },
    [state.turns],
  );

  return { ...state, ask, reset, sendFeedback };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function normalizeType(t: string | undefined): RetrievalRowView["type"] {
  if (t === "anti_principle") return "anti";
  if (t === "heuristic" || t === "principle" || t === "reflex") return t;
  return "recipe";
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
