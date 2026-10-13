"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { useT } from "@/lib/brain/i18n";
import { apiErrorFromResponse } from "@/lib/brain/api-error";

interface Props {
  open: boolean;
  onClose: () => void;
  onTaught: () => void;
  /** Pre-fill the Trigger field — e.g. the Oracle question that had no Brain context. */
  prefillTrigger?: string;
}

type KnowledgeType = "recipe" | "heuristic" | "principle" | "reflex" | "anti_principle";

// Labels and tooltips live in teach.type_<value> / teach.type_<value>_tip.
const TYPES: KnowledgeType[] = ["recipe", "heuristic", "principle", "reflex", "anti_principle"];

// The filled-in content stays English on purpose: it is saved as a rule and
// injected into agent sessions, which read English. Only the chip label is UI.
interface Example {
  labelKey: string;
  type: KnowledgeType;
  trigger: string;
  rule: string;
  rationale: string;
  tags: string;
}

const EXAMPLES: Example[] = [
  {
    labelKey: "teach.ex_bug_fix",
    type: "recipe",
    trigger: "When a Stripe webhook returns 400 with signature failure",
    rule: "Verify the signature against the raw request body, not parsed JSON",
    rationale: "Stripe's HMAC fails once the body is re-serialized",
    tags: "stripe, webhook, security",
  },
  {
    labelKey: "teach.ex_style",
    type: "heuristic",
    trigger: "When writing React state",
    rule: "Prefer useReducer over multiple useState when fields update together",
    rationale: "Keeps related state transitions atomic",
    tags: "react, state",
  },
  {
    labelKey: "teach.ex_anti",
    type: "anti_principle",
    trigger: "When tempted to disable a flaky test",
    rule: "Don't skip — quarantine it and file a ticket the same day",
    rationale: "Skipped tests rot and hide real regressions",
    tags: "testing",
  },
  {
    labelKey: "teach.ex_decision",
    type: "principle",
    trigger: "When choosing a queue for background jobs",
    rule: "We use pg-boss on the existing Postgres",
    rationale: "Avoids a second piece of infra to operate",
    tags: "architecture, decisions",
  },
  {
    labelKey: "teach.ex_reflex",
    type: "reflex",
    trigger: "When a deploy script changes",
    rule: "Run it once on the dev host before merging",
    rationale: "",
    tags: "deploy",
  },
];

/**
 * Lightweight authoring surface — the header "Teach" button opens this.
 * Lets the user hand-author a Knowledge item without going through KEA.
 */
export function TeachModal({ open, onClose, onTaught, prefillTrigger }: Props) {
  const t = useT();
  const [type, setType] = useState<KnowledgeType>("heuristic");
  const [trigger, setTrigger] = useState(prefillTrigger ?? "");
  const [rule, setRule] = useState("");
  const [rationale, setRationale] = useState("");
  const [tags, setTags] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  // First-time visitors see the examples expanded by default — choosing a
  // knowledge type is the hardest decision in this form, and the examples
  // make the taxonomy concrete. We remember the dismissal in localStorage
  // so returning users get the compact accordion. (UX-newcomer-pass-5)
  // Start collapsed (matches SSR), then expand for first-time users AFTER mount.
  // Reading localStorage during render diverges from the server output and
  // triggers a hydration mismatch (React #418).
  const [examplesOpen, setExamplesOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("brain.teach.examplesSeen") !== "1") {
        setExamplesOpen(true);
      }
    } catch {
      /* localStorage unavailable — leave collapsed */
    }
  }, []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const triggerInputRef = useRef<HTMLInputElement | null>(null);

  // Sync prefill when the Oracle passes a new question to the Teach modal.
  useEffect(() => {
    if (open && prefillTrigger) {
      setTrigger(prefillTrigger);
    }
  }, [open, prefillTrigger]);

  // Focus first field on open + ESC closes.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => triggerInputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const reset = () => {
    setType("heuristic");
    setTrigger("");
    setRule("");
    setRationale("");
    setTags("");
    setMoreOpen(false);
    setExamplesOpen(false);
    setError(null);
  };

  const applyExample = (ex: Example) => {
    setType(ex.type);
    setTrigger(ex.trigger);
    setRule(ex.rule);
    setRationale(ex.rationale);
    setTags(ex.tags);
    if (ex.rationale || ex.tags) setMoreOpen(true);
    setExamplesOpen(false);
  };

  const canSubmit = trigger.trim().length > 0 && rule.trim().length > 0 && !submitting;

  const submit = async () => {
    if (!rule.trim() || !trigger.trim()) {
      setError(t("teach.required"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type,
          triggerText: trigger.trim(),
          ruleText: rule.trim(),
          rationale: rationale.trim() || null,
          tags: tags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) {
        setError(await apiErrorFromResponse(t, res));
        return;
      }
      reset();
      onTaught();
    } catch {
      setError(t("apiErrors.network"));
    } finally {
      setSubmitting(false);
    }
  };

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
  const inputStyle: React.CSSProperties = { fontSize: 15 };

  return (
    <div className="cmdk-scrim" onClick={onClose} role="presentation">
      <div
        className="cmdk"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("teach.title")}
        style={{ maxWidth: 560 }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Icon name="sparkle" size={12} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>{t("teach.title")}</span>
          <span className="grow" />
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
            {t("teach.close_hint")}
          </span>
        </div>

        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Type chooser — plain English with tooltips */}
          <div>
            <span style={labelStyle}>{t("teach.kind")}</span>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {TYPES.map((ty) => (
                <button
                  key={ty}
                  type="button"
                  className={type === ty ? "btn" : "btn btn-ghost"}
                  style={{ height: 28, fontSize: 13, padding: "0 10px" }}
                  onClick={() => setType(ty)}
                  title={t(`teach.type_${ty}_tip`)}
                  aria-pressed={type === ty}
                >
                  {t(`teach.type_${ty}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Required field 1 */}
          <div>
            <label htmlFor="teach-trigger" style={labelStyle}>
              {t("teach.when")}
            </label>
            <input
              id="teach-trigger"
              ref={triggerInputRef}
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              placeholder={t("teach.when_placeholder")}
              style={inputStyle}
            />
            <div style={helpStyle}>{t("teach.when_help")}</div>
          </div>

          {/* Required field 2 */}
          <div>
            <label htmlFor="teach-rule" style={labelStyle}>
              {t("teach.rule")}
            </label>
            <textarea
              id="teach-rule"
              value={rule}
              onChange={(e) => setRule(e.target.value)}
              placeholder={t("teach.rule_placeholder")}
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          {/* Progressive disclosure */}
          <div>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              className="btn btn-ghost"
              style={{
                height: 26,
                fontSize: 13,
                padding: "0 8px",
                color: "var(--ink-3)",
              }}
              aria-expanded={moreOpen}
            >
              {moreOpen ? t("teach.more_hide") : t("teach.more_show")}
            </button>
          </div>

          {moreOpen && (
            <>
              <div>
                <label htmlFor="teach-rationale" style={labelStyle}>
                  {t("teach.why")}{" "}
                  <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>{t("teach.optional")}</span>
                </label>
                <input
                  id="teach-rationale"
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder={t("teach.why_placeholder")}
                  style={inputStyle}
                />
                <div style={helpStyle}>{t("teach.why_help")}</div>
              </div>
              <div>
                <label htmlFor="teach-tags" style={labelStyle}>
                  {t("teach.topics")}{" "}
                  <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>{t("teach.optional")}</span>
                </label>
                <input
                  id="teach-tags"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="stripe, webhook, security"
                  style={inputStyle}
                />
                <div style={helpStyle}>{t("teach.topics_help")}</div>
              </div>
            </>
          )}

          {/* Examples — pre-fill, not a parallel taxonomy */}
          <div>
            <button
              type="button"
              onClick={() => setExamplesOpen((v) => !v)}
              className="btn btn-ghost"
              style={{
                height: 26,
                fontSize: 13,
                padding: "0 8px",
                color: "var(--ink-3)",
              }}
              aria-expanded={examplesOpen}
              onMouseDown={() => {
                if (typeof window !== "undefined") {
                  try {
                    window.localStorage.setItem("brain.teach.examplesSeen", "1");
                  } catch {
                    /* localStorage may be blocked; not worth flagging */
                  }
                }
              }}
            >
              {examplesOpen ? t("teach.examples_hide") : t("teach.examples_show")}
            </button>
            {examplesOpen && (
              <div
                style={{
                  marginTop: 8,
                  padding: 10,
                  background: "var(--bg-elev-1)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--r-sm)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 13, color: "var(--ink-4)" }}>
                  {t("teach.examples_intro")}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.labelKey}
                      type="button"
                      className="btn btn-ghost"
                      style={{ height: 26, fontSize: 13, padding: "0 10px" }}
                      onClick={() => applyExample(ex)}
                      title={ex.rule}
                    >
                      {t(ex.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div
              role="alert"
              style={{
                fontSize: 13,
                color: "var(--bad, #ff6b6b)",
                padding: "8px 10px",
                borderRadius: "var(--r-sm)",
                background: "var(--bg-elev-1)",
                border: "1px solid var(--line)",
              }}
            >
              {error}
            </div>
          )}

          <div className="row" style={{ gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={!canSubmit}
              aria-disabled={!canSubmit}
            >
              {submitting ? t("common.saving") : t("teach.submit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
