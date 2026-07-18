"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/brain/i18n";

interface DecisionCandidate {
  triggerText: string;
  ruleText: string;
  rationale: string;
  instead: string;
  supersedes: { id: string; ruleText: string; similarity: number } | null;
}

interface ActionItemCandidate {
  triggerText: string;
  ruleText: string;
  assigneeGuessEmail: string | null;
  blocker: boolean;
  kind: "action-item" | "open-question";
}

interface Member {
  email: string;
  name: string | null;
}

interface ExtractResponse {
  decisions: DecisionCandidate[];
  actionItems: ActionItemCandidate[];
  members: Member[];
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: "var(--ink-2)",
  marginBottom: 6,
  display: "block",
};

const helpStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--ink-4)",
  marginTop: 4,
};

const alertStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--bad, #ff6b6b)",
  padding: "8px 10px",
  borderRadius: "var(--r-sm)",
  background: "var(--bg-elev-1)",
  border: "1px solid var(--line)",
};

/**
 * Meetings surface — paste a transcript, review the LLM's extracted
 * decisions / action items / open questions, teach the ones worth keeping,
 * and browse prior imports. Flag-gated end-to-end (MEETING_UPLOAD_ENABLED):
 * the nav entry itself is hidden unless the server reports the capability
 * on (shell.tsx), and /api/meetings/extract 503s with a readable message
 * otherwise — handleExtract's existing error path surfaces that message
 * as-is if this surface is ever reached directly via #meetings.
 */
export function Meetings() {
  const t = useT();
  const [mode, setMode] = useState<"paste" | "review" | "history">("paste");
  const [transcript, setTranscript] = useState("");
  const [meetingDate, setMeetingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResponse | null>(null);
  // Decision and action-item cards share these three maps, keyed by
  // `d-${index}` / `a-${index}` — string prefixes make collisions between
  // the two lists statically impossible (no more `1000 +` offset trick).
  const [taught, setTaught] = useState<Set<string>>(new Set());
  const [teaching, setTeaching] = useState<Set<string>>(new Set());
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [decisionSupersedeConfirmed, setDecisionSupersedeConfirmed] = useState<Set<number>>(new Set());
  const [actionItemAssignee, setActionItemAssignee] = useState<Record<number, string>>({});

  async function handleExtract(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/meetings/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `Extraction failed (${res.status})`);
      }
      const data = (await res.json()) as ExtractResponse;
      if (data.decisions.length === 0 && data.actionItems.length === 0) {
        setError(
          "Didn't find any decisions, action items, or open questions in this text — try pasting the raw transcript, or use + Teach a skill for one-off facts.",
        );
        return;
      }
      setResult(data);
      setMode("review");
      // Pre-select the LLM's assigneeGuessEmail ONLY when it matches a real
      // member's email — otherwise leave the item unassigned. The dropdown
      // is the only source of a submitted assignee (see teachActionItem
      // below); a hallucinated or mistyped guess never silently ships.
      const memberEmails = new Set(data.members.map((m) => m.email.toLowerCase()));
      const preSelected: Record<number, string> = {};
      data.actionItems.forEach((a, i) => {
        if (a.assigneeGuessEmail && memberEmails.has(a.assigneeGuessEmail.toLowerCase())) {
          preSelected[i] = a.assigneeGuessEmail.toLowerCase();
        }
      });
      setActionItemAssignee(preSelected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.");
    } finally {
      setLoading(false);
    }
  }

  const meetingTag = `meeting:${meetingDate}`;

  // Server-side validation (POST /api/knowledge) is the real trust boundary
  // for the for: tag; this client fallback only produces a readable message
  // instead of a raw error body when it's rejected.
  async function postKnowledge(payload: Record<string, unknown>): Promise<{ ok: true } | { ok: false; message: string }> {
    const res = await fetch("/api/knowledge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true };
    // If the route ever returns a bare-string error (authErrorResponse's
    // AuthError/ZodError branches), `.message` on a string is just an
    // undefined property read — falls through to the generic message below.
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, message: body?.error?.message ?? `Teach failed (${res.status})` };
  }

  async function teachDecision(index: number): Promise<void> {
    if (!result) return;
    const key = `d-${index}`;
    setTeaching((prev) => new Set(prev).add(key));
    setCardErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const d = result.decisions[index]!;
    const supersedes = decisionSupersedeConfirmed.has(index) ? d.supersedes : null;
    const outcome = await postKnowledge({
      type: "principle",
      scope: "project",
      triggerText: d.triggerText,
      ruleText: d.ruleText,
      rationale: d.rationale || undefined,
      tags: ["decision", meetingTag],
      ...(supersedes ? { supersedesKnowledgeId: supersedes.id } : {}),
    });
    setTeaching((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (outcome.ok) {
      setTaught((prev) => new Set(prev).add(key));
    } else {
      setCardErrors((prev) => ({ ...prev, [key]: outcome.message }));
    }
  }

  async function teachActionItem(index: number): Promise<void> {
    if (!result) return;
    const key = `a-${index}`; // shares the taught/teaching/cardErrors maps with decisions; the "a-" prefix keeps the keyspaces disjoint
    setTeaching((prev) => new Set(prev).add(key));
    setCardErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    const a = result.actionItems[index]!;
    // No raw-guess fallback here — actionItemAssignee[index] is either a
    // dropdown-confirmed real member email (pre-selected in handleExtract,
    // or hand-picked by the reviewer) or empty/unassigned. Never the
    // unvalidated a.assigneeGuessEmail directly.
    const assignee = actionItemAssignee[index] ?? "";
    const tags = [
      a.kind === "open-question" ? "open-question" : "action-item",
      meetingTag,
      ...(a.blocker ? ["blocker"] : []),
      ...(assignee ? [`for:${assignee.toLowerCase()}`] : []),
    ];
    const outcome = await postKnowledge({
      type: "action_item",
      scope: "project",
      triggerText: a.triggerText,
      ruleText: a.ruleText,
      tags,
    });
    setTeaching((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (outcome.ok) {
      setTaught((prev) => new Set(prev).add(key));
    } else {
      setCardErrors((prev) => ({ ...prev, [key]: outcome.message }));
    }
  }

  return (
    <div className="scroll" style={{ padding: "24px 32px 96px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 500, letterSpacing: "-0.02em" }}>
          {t("nav.meetings")}
        </h1>
        <p style={{ margin: "2px 0 18px", fontSize: 13, color: "var(--ink-3)", lineHeight: 1.4 }}>
          {t("nav.hints.meetings")}
        </p>

        <div className="row" style={{ gap: 6, marginBottom: 16 }}>
          <button
            type="button"
            className={mode === "paste" ? "btn" : "btn btn-ghost"}
            onClick={() => setMode("paste")}
            aria-pressed={mode === "paste"}
          >
            Paste
          </button>
          {result && (
            <button
              type="button"
              className={mode === "review" ? "btn" : "btn btn-ghost"}
              onClick={() => setMode("review")}
              aria-pressed={mode === "review"}
            >
              Review
            </button>
          )}
          <button
            type="button"
            className={mode === "history" ? "btn" : "btn btn-ghost"}
            onClick={() => setMode("history")}
            aria-pressed={mode === "history"}
          >
            History
          </button>
        </div>

        {mode === "paste" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label htmlFor="meeting-date" style={labelStyle}>
                Meeting date
              </label>
              <input
                id="meeting-date"
                type="date"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                style={{ fontSize: 15 }}
              />
            </div>
            <div>
              <label htmlFor="meeting-transcript" style={labelStyle}>
                Transcript
              </label>
              <textarea
                id="meeting-transcript"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Paste the meeting transcript or notes here…"
                rows={16}
                style={{ fontSize: 15, resize: "vertical", width: "100%" }}
              />
              <div style={helpStyle}>
                Decisions, action items, and open questions are extracted for you to review before
                anything is saved.
              </div>
            </div>
            {error && <div role="alert" style={alertStyle}>{error}</div>}
            <div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleExtract()}
                disabled={loading || transcript.trim().length === 0}
              >
                {loading ? "Extracting…" : "Extract"}
              </button>
            </div>
          </div>
        )}

        {mode === "review" && result && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div>
              <h2 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 500 }}>Decisions</h2>
              {result.decisions.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--ink-3)" }}>No decisions found.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {result.decisions.map((d, i) => {
                    const key = `d-${i}`;
                    return (
                      <div
                        key={i}
                        data-testid={`decision-card-${i}`}
                        className="panel"
                        style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}
                      >
                        <p style={{ margin: 0, fontSize: 14, color: "var(--ink)" }}>{d.ruleText}</p>
                        {d.instead && (
                          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>Not: {d.instead}</p>
                        )}
                        {d.supersedes && (
                          <label style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: "var(--ink-2)" }}>
                            <input
                              type="checkbox"
                              checked={decisionSupersedeConfirmed.has(i)}
                              onChange={(e) =>
                                setDecisionSupersedeConfirmed((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(i);
                                  else next.delete(i);
                                  return next;
                                })
                              }
                            />
                            <span>Replaces: &ldquo;{d.supersedes.ruleText}&rdquo;</span>
                          </label>
                        )}
                        {cardErrors[key] && <div role="alert" style={alertStyle}>{cardErrors[key]}</div>}
                        <div>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => void teachDecision(i)}
                            disabled={taught.has(key) || teaching.has(key)}
                          >
                            {taught.has(key) ? "✓ Taught" : teaching.has(key) ? "Teaching…" : cardErrors[key] ? "Retry" : "Teach"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div>
              <h2 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 500 }}>Action Items &amp; Open Questions</h2>
              {result.actionItems.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--ink-3)" }}>No action items or open questions found.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {result.actionItems.map((a, i) => {
                    const key = `a-${i}`;
                    return (
                      <div
                        key={i}
                        data-testid={`action-item-card-${i}`}
                        className="panel"
                        style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {a.blocker && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: "var(--bad, #ff6b6b)",
                                border: "1px solid var(--line)",
                                borderRadius: "var(--r-sm)",
                                padding: "1px 6px",
                              }}
                            >
                              BLOCKER
                            </span>
                          )}
                          {a.kind === "open-question" && (
                            <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ink-4)" }}>
                              Open question
                            </span>
                          )}
                        </div>
                        <p style={{ margin: 0, fontSize: 14, color: "var(--ink)" }}>{a.ruleText}</p>
                        <div>
                          <label htmlFor={`assignee-${i}`} style={labelStyle}>
                            Assignee
                          </label>
                          <select
                            id={`assignee-${i}`}
                            value={actionItemAssignee[i] ?? ""}
                            onChange={(e) =>
                              setActionItemAssignee((prev) => ({ ...prev, [i]: e.target.value }))
                            }
                            style={{ fontSize: 14 }}
                          >
                            <option value="">— unassigned —</option>
                            {result.members.map((m) => (
                              <option key={m.email} value={m.email}>
                                {m.name ?? m.email}
                              </option>
                            ))}
                          </select>
                        </div>
                        {cardErrors[key] && (
                          <div role="alert" style={alertStyle}>
                            {cardErrors[key]}
                          </div>
                        )}
                        <div>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => void teachActionItem(i)}
                            disabled={taught.has(key) || teaching.has(key)}
                          >
                            {taught.has(key)
                              ? "✓ Taught"
                              : teaching.has(key)
                                ? "Teaching…"
                                : cardErrors[key]
                                  ? "Retry"
                                  : "Teach"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {mode === "history" && <MeetingHistory />}
      </div>
    </div>
  );
}

interface MeetingHistoryRow {
  id: string;
  ruleText: string;
  tags: string[];
}

function MeetingHistory() {
  const [rows, setRows] = useState<MeetingHistoryRow[] | null>(null);

  // Mount-time fetch belongs in useEffect, not a useState lazy initializer —
  // a side effect during render is unsound under Strict Mode / concurrent
  // rendering. res.ok is checked before parsing so a non-2xx response
  // degrades to the empty-history state instead of throwing on a non-JSON
  // error body.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/knowledge?tagPrefix=meeting%3A")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { items: Array<{ id: string; body: string; tags: string[] }> }) => {
        if (cancelled) return;
        setRows(data.items.map((i) => ({ id: i.id, ruleText: i.body, tags: i.tags })));
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows === null) {
    return <p style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading…</p>;
  }
  if (rows.length === 0) {
    return (
      <div className="panel" style={{ padding: "20px 22px" }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 500 }}>No meetings imported yet</h2>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
          Paste a transcript to extract decisions and action items — imported meetings show up here,
          grouped by date.
        </p>
      </div>
    );
  }

  const byMeeting = new Map<string, MeetingHistoryRow[]>();
  for (const row of rows) {
    const tag = row.tags.find((t) => t.startsWith("meeting:")) ?? "meeting:unknown";
    byMeeting.set(tag, [...(byMeeting.get(tag) ?? []), row]);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {Array.from(byMeeting.entries()).map(([tag, items]) => (
        <div key={tag}>
          <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
            {tag.slice("meeting:".length)}
          </h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((i) => (
              <li key={i.id} className="panel" style={{ padding: "10px 14px", fontSize: 13, color: "var(--ink)" }}>
                {i.ruleText}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
