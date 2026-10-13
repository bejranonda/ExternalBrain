"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "./icons";
import { type KnowledgeDisplayType as KnowledgeType } from "@/lib/brain/views";
import { useT } from "@/lib/brain/i18n";
import { caughtMessage, type Translate } from "@/lib/brain/api-error";
import { useKnowledge } from "@/lib/brain/use-knowledge";
import { useRelated } from "@/lib/brain/use-related";
import { useProjectScope } from "@/lib/brain/use-project-scope";
import { ScopePill } from "./scope-pill";
import { EffectivenessBadge } from "./effectiveness-badge";
import { HelpPopover } from "./help-popover";
import { InfoDot } from "./info-dot";
import { LoadError } from "./load-error";
import type { KnowledgeItemView } from "@/lib/brain/views";

type ScopeFilter = "all" | KnowledgeItemView["scope"];
type VisibilityFilter = "all" | "private" | "project" | "org";

/** Map visibility value to a short label + emoji indicator */
function visibilityLabel(t: Translate, v: KnowledgeItemView["visibility"] | undefined): string {
  if (v === "private") return t("skills.vis_private");
  if (v === "org") return t("skills.vis_org");
  return t("skills.project");
}

function VisibilityPill({ visibility }: { visibility: KnowledgeItemView["visibility"] | undefined }) {
  const t = useT();
  const label = visibilityLabel(t, visibility);
  const color =
    visibility === "org"
      ? "var(--accent)"
      : visibility === "private"
        ? "var(--warn, #f5a623)"
        : "var(--violet)";
  const icon = visibility === "org" ? "🌐" : visibility === "private" ? "🔒" : "📁";
  return (
    <span
      className="chip mono"
      title={t("skills.vis_title", { label })}
      style={{ fontSize: 11, color, background: "transparent", padding: "1px 4px" }}
    >
      {icon} {label}
    </span>
  );
}

export function Skills({ onTeach }: { onTeach?: () => void } = {}) {
  const t = useT();
  const { scope, setScope } = useProjectScope();
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const { items, loadState, remove, fork, promote, forkToProject, refresh } = useKnowledge(
    scope,
    visibilityFilter === "all" ? undefined : visibilityFilter,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | KnowledgeType | "decision">("all");
  const [scopeFilter] = useState<ScopeFilter>("all");
  const [sort, setSort] = useState<"recency" | "confidence" | "uses">("recency");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const selected = useMemo(
    () => (selectedId ? items.find((k) => k.id === selectedId) ?? null : null),
    [items, selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      if (typing || editing) return;
      setSelectedId(null);
      setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, editing]);

  const related = useRelated(selected?.id ?? null);

  if (items.length === 0) {
    return (
      <div className="scroll" style={{ height: "100%", padding: "24px 32px" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 500 }}>
          {t("skills.knowledge")}
        </h1>
        <p
          style={{
            margin: "2px 0 16px",
            fontSize: 13,
            color: "var(--ink-3)",
            lineHeight: 1.4,
          }}
        >
          {t("skills.subtitle")}
        </p>
        {loadState === "loading" ? (
          <div
            className="panel"
            style={{ padding: "32px 24px", textAlign: "center", color: "var(--ink-3)" }}
          >
            {t("skills.loading")}
          </div>
        ) : loadState === "error" ? (
          <LoadError
            title={t("skills.load_error_title")}
            body={t("skills.load_error_body")}
            onRetry={refresh}
          />
        ) : (
          <div
            className="panel"
            style={{
              padding: "32px 28px",
              margin: "0 auto",
              maxWidth: 480,
              textAlign: "center",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "var(--bg-elev-1)",
                border: "1px solid var(--line-soft)",
                color: "var(--ink-3)",
                marginBottom: 14,
              }}
            >
              <Icon name="plus" size={14} />
            </div>
            <h2
              style={{
                margin: "0 0 8px",
                fontSize: 18,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                color: "var(--ink)",
              }}
            >
              {t("skills.empty_title")}
            </h2>
            {/* Phase R.1: dropped the marketing paragraph + numbered
                explainer that sat between the title and the CTAs. The
                two action buttons below already make the path obvious;
                the words were ceremony, not guidance. */}
            <div
              className="row"
              style={{ gap: 8, justifyContent: "center", flexWrap: "wrap" }}
            >
              {onTeach ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ fontSize: 13 }}
                  onClick={onTeach}
                >
                  <Icon name="plus" size={11} /> {t("skills.empty_teach")}
                </button>
              ) : null}
              <a
                href="/settings/tokens"
                className={onTeach ? "btn btn-ghost" : "btn btn-primary"}
                style={{ fontSize: 13, textDecoration: "none" }}
              >
                <Icon name="link" size={11} /> {t("skills.connect_tool")}
              </a>
            </div>
          </div>
        )}
      </div>
    );
  }

  const types: Array<{ k: "all" | KnowledgeType | "decision"; label: string; count: number }> = [
    { k: "all", label: t("skills.all"), count: items.length },
    { k: "recipe", label: t("skills.recipe"), count: items.filter((i) => i.type === "recipe").length },
    { k: "heuristic", label: t("skills.heuristic"), count: items.filter((i) => i.type === "heuristic").length },
    { k: "principle", label: t("skills.principle"), count: items.filter((i) => i.type === "principle").length },
    { k: "reflex", label: t("skills.reflex"), count: items.filter((i) => i.type === "reflex").length },
    { k: "anti", label: t("skills.anti"), count: items.filter((i) => i.type === "anti").length },
    { k: "decision", label: t("skills.decisions"), count: items.filter((i) => i.tags.includes("decision")).length },
  ];

  const filtered = items.filter(
    (i) =>
      (filter === "all" ||
        (filter === "decision" ? i.tags.includes("decision") : i.type === filter)) &&
      (scopeFilter === "all" || i.scope === scopeFilter),
  );
  const sorted = [...filtered].sort((a, b) => {
    if (sort === "recency") return 0;
    if (sort === "confidence") return b.confidence - a.confidence;
    return b.uses - a.uses;
  });

  const flash = (msg: string) => {
    setStatusMessage(msg);
    window.setTimeout(() => setStatusMessage(null), 2000);
  };

  const onSave = async () => {
    if (!selected) return;
    try {
      if (draft === selected.body) {
        setEditing(false);
        return;
      }
      // Knowledge is semantically immutable (KNOWLEDGE.md §5.1) — edits
      // create a new version via fork. Parent is retained for history.
      const child = await fork(selected.id, { ruleText: draft });
      setSelectedId(child.id);
      setEditing(false);
      flash(t("skills.saved_version"));
    } catch (e) {
      flash(caughtMessage(t, e));
    }
  };

  const onFork = async () => {
    if (!selected) return;
    try {
      const child = await fork(selected.id);
      setSelectedId(child.id);
      flash(t("skills.forked"));
    } catch (e) {
      flash(caughtMessage(t, e));
    }
  };

  const onCopy = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.body);
      flash(t("skills.copied_body"));
    } catch {
      flash(t("skills.clipboard_unavailable"));
    }
  };

  const onDelete = async () => {
    if (!selected) return;
    if (!window.confirm(t("skills.delete_confirm", { title: selected.title }))) return;
    try {
      await remove(selected.id);
      setSelectedId(null);
      setMenuOpen(false);
      flash(t("skills.deleted"));
    } catch (e) {
      flash(caughtMessage(t, e));
    }
  };

  const onPromote = async () => {
    if (!selected) return;
    if (!window.confirm(t("skills.promote_confirm", { title: selected.title }))) return;
    try {
      await promote(selected.id);
      flash(t("skills.promoted"));
    } catch (e) {
      flash(caughtMessage(t, e));
    }
  };

  const onForkToProject = async () => {
    if (!selected) return;
    try {
      const child = await forkToProject(selected.id);
      setSelectedId(child.id);
      flash(t("skills.forked_here"));
    } catch (e) {
      flash(caughtMessage(t, e));
    }
  };

  const onDownloadRules = async () => {
    try {
      const res = await fetch("/api/export/rules?format=manifest", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `brain-rules-${new Date().toISOString().slice(0, 10)}.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      flash(t("skills.bundle_downloaded"));
    } catch (e) {
      flash(caughtMessage(t, e));
    }
  };

  const onExport = async (target: "claude" | "cursor" | "windsurf" | "markdown") => {
    if (!selected) return;
    const text = renderExport(target, selected);
    try {
      await navigator.clipboard.writeText(text);
      flash(t("skills.export_copied", { target }));
    } catch {
      flash(t("skills.clipboard_unavailable"));
       
      console.info(text);
    }
  };

  return (
    <div
      className="skills-layout"
      data-detail-open={selected ? "true" : "false"}
      style={{
        height: "100%",
        display: "grid",
        gridTemplateColumns: selected ? "200px minmax(320px, 1fr) 1.2fr" : "200px 1fr",
        minHeight: 0,
        position: "relative",
      }}
    >
      {/* Landmark heading for screen readers. The populated Skills view is a
          dense filter+list tool surface with no visible page title (by
          design — a big header would fight the density), but every other
          surface exposes an <h1>, so a visually-hidden one keeps the
          document-outline / a11y landmark consistent. */}
      <h1
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {t("skills.knowledge")}
      </h1>
      {statusMessage && (
        <div
          className="chip"
          role="status"
          style={{
            position: "absolute",
            top: 12,
            right: 16,
            zIndex: 20,
            color: "var(--accent-text)",
            fontSize: 12,
            background: "var(--bg-elev-2)",
            border: "1px solid var(--line)",
            padding: "4px 10px",
          }}
        >
          {statusMessage}
        </div>
      )}
      <aside
        className="scroll skills-filters"
        style={{
          borderRight: "1px solid var(--line)",
          padding: "18px 12px",
          background: "var(--bg)",
        }}
      >
        <div
          className="mono rail-section-label"
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            padding: "0 8px 8px",
          }}
        >
          {t("skills.type")}
          <InfoDot
            term={t("skills.type")}
            conceptSlug="skills"
            tip={t("skills.type_tip")}
          />
        </div>
        {/* UX-newcomer-pass-2 (iter 13): hide buckets with zero items so
            "Anti-pattern 0" doesn't show on a fresh Brain. We keep "All"
            visible always so the filter is never empty. Currently-active
            filter also stays visible even if empty, so the user doesn't
            see their selection silently disappear when the underlying
            count drops to 0. */}
        {types
          .filter((tt) => tt.k === "all" || tt.count > 0 || filter === tt.k)
          .map((tt) => (
            <button
              key={tt.k}
              type="button"
              onClick={() => setFilter(tt.k)}
              className="rail-item"
              style={{
                background: filter === tt.k ? "var(--bg-elev-2)" : "transparent",
                color: filter === tt.k ? "var(--ink)" : "var(--ink-2)",
              }}
            >
              {tt.k !== "all" ? (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    background: tt.k === "decision" ? "var(--accent)" : `var(--k-${tt.k})`,
                  }}
                />
              ) : (
                <span style={{ width: 6 }} />
              )}
              <span>{tt.label}</span>
              <span className="count tab-num">{tt.count}</span>
            </button>
          ))}

        {/* UX-newcomer-pass-2 (iter 11): the sidebar previously showed
            TWO filter sections — "SCOPE" (Global/Personal/Project/Community)
            and "VISIBILITY" (Private/Project/Org). Newcomers couldn't tell
            them apart, because for fresh-seeded data every row is
            scope=user and the SCOPE filter never differentiates anything.
            The SCOPE filter is power-user UI (filter by Knowledge.scope
            audience class — global vs user vs project vs community); the
            VISIBILITY filter is the access-level newcomers reason about
            (who can see it). Keeping only Visibility in the sidebar.
            scopeFilter state remains so the existing filter logic still
            works (defaults to "all", a no-op). If/when the SCOPE filter
            returns, it should be a collapsed "More filters" expander, not
            a peer of Visibility. */}

        <div
          className="mono rail-section-label row"
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            padding: "18px 8px 8px",
            gap: 6,
            alignItems: "center",
          }}
        >
          <span>{t("skills.visibility")}</span>
          <HelpPopover
            content={{
              what: t("skills.vis_help_what"),
              whatToDo: [
                t("skills.vis_help_private"),
                t("skills.vis_help_project"),
                t("skills.vis_help_org"),
              ],
              docHref: "/docs/concepts/skills",
            }}
            triggerLabel={t("skills.vis_help_trigger")}
          />
        </div>
        {(
          [
            { k: "all", label: t("skills.all"), icon: "", tip: t("skills.vis_all_tip") },
            { k: "private", label: t("skills.vis_private"), icon: "🔒", tip: t("skills.vis_private_tip") },
            { k: "project", label: t("skills.project"), icon: "📁", tip: t("skills.vis_project_tip") },
            { k: "org", label: t("skills.vis_org"), icon: "🌐", tip: t("skills.vis_org_tip") },
          ] as const
        ).map((v) => (
          <button
            key={v.k}
            type="button"
            className="rail-item"
            onClick={() => setVisibilityFilter(v.k as VisibilityFilter)}
            title={v.tip}
            style={{
              background: visibilityFilter === v.k ? "var(--bg-elev-2)" : "transparent",
              color: visibilityFilter === v.k ? "var(--ink)" : "var(--ink-2)",
            }}
          >
            <span style={{ width: 6 }} />
            <span>{v.icon} {v.label}</span>
          </button>
        ))}
        {/* Phase R.3: replaced the "Who can see a skill / Learn more"
            legend with a (?) HelpPopover next to the section label,
            matching the rest of the app's help affordance. */}
      </aside>

      <section
        className="skills-list"
        style={{
          borderRight: "1px solid var(--line)",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          className="row"
          style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", gap: 8, flexWrap: "wrap" }}
        >
          <div style={{ fontSize: 13, fontWeight: 500 }}>{t("skills.knowledge")}</div>
          <HelpPopover
            content={{
              what: t("skills.help_what"),
              whatToDo: [
                t("skills.help_todo_1"),
                t("skills.help_todo_2"),
                t("skills.help_todo_3"),
                t("skills.help_todo_4"),
              ],
              docHref: "/docs/concepts/skills",
            }}
          />
          <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {t("skills.items", { n: sorted.length })}
          </span>
          <ScopePill scope={scope} onScopeChange={setScope} />
          <div className="grow" />
          {loadState === "error" && (
            <span
              className="chip"
              title={t("skills.load_error_title")}
              style={{ color: "var(--warn)", fontSize: 11 }}
            >
              {t("dash.offline")}
            </span>
          )}
          {/* Phase R.1: dropped the "Filter" toggle — it only revealed a
              status strip that *echoed* the sidebar's filter values
              without letting you change them. Sidebar is the canonical
              control. Sort stays because it's the only place sort lives. */}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ height: 24, fontSize: 12 }}
            onClick={() =>
              setSort((s) =>
                s === "recency" ? "confidence" : s === "confidence" ? "uses" : "recency",
              )
            }
          >
            <Icon name="sort" size={10} /> {t(`skills.sort_${sort}`)}
          </button>
          {/* Phase R.1: hero the primary action. "Teach a skill" was
              previously only reachable from the empty state — once the
              user had any skills, the affordance vanished. */}
          {onTeach && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ height: 24, fontSize: 12 }}
              onClick={onTeach}
              title={t("skills.empty_teach")}
            >
              <Icon name="plus" size={10} /> {t("skills.empty_teach")}
            </button>
          )}
        </div>
        <div className="scroll" style={{ flex: 1 }}>
          {sorted.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => {
                setSelectedId(k.id);
                setEditing(false);
                setMenuOpen(false);
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "12px 14px",
                cursor: "pointer",
                background: selected && k.id === selected.id ? "var(--bg-elev-2)" : "transparent",
                borderLeft:
                  selected && k.id === selected.id
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                borderRight: "0",
                borderTop: "0",
                borderBottom: "1px solid var(--line-soft)",
                textAlign: "left",
                color: "inherit",
              }}
            >
              <div className="row" style={{ marginBottom: 6 }}>
                <span className={`chip k-${k.type}`}>
                  {k.type === "anti" ? "anti-principle" : k.type}
                </span>
                {/* UX-newcomer-pass-2 (iter 18): hide the raw scope chip
                    ("user") when it's the default value. Visibility pill
                    already conveys the access-level concept newcomers
                    reason about. Only show scope when it's something
                    interesting (global/team/community). */}
                {k.scope !== "user" && (
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: "var(--ink-4)" }}
                    title={`Audience class: ${k.scope}`}
                  >
                    {k.scope}
                  </span>
                )}
                <VisibilityPill visibility={k.visibility} />
                <div className="grow" />
                <span
                  className="mono tab-num"
                  style={{
                    fontSize: 12,
                    color: k.confidence >= 0.9 ? "var(--accent-text)" : "var(--ink-3)",
                    display: "inline-flex",
                    alignItems: "baseline",
                    gap: 4,
                  }}
                  title={t("skills.confidence_tip")}
                >
                  <span style={{ fontSize: 10, color: "var(--ink-4)" }}>conf</span>
                  {k.confidence.toFixed(2)}
                </span>
              </div>
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.3,
                  marginBottom: 6,
                  letterSpacing: "-0.005em",
                }}
              >
                {k.title}
              </div>
              <div
                className="row mono"
                style={{ gap: 10, fontSize: 11, color: "var(--ink-4)" }}
              >
                <span>
                  {k.uses} {t("skills.uses")}
                </span>
                <span>·</span>
                <span>{k.updated}</span>
              </div>
              <div style={{ marginTop: 4 }}>
                <EffectivenessBadge
                  effectiveness={k.effectiveness}
                  outcomes={k.outcomes}
                  usageCount={k.uses}
                />
              </div>
            </button>
          ))}
        </div>
      </section>

      {selected && (
      <section className="scroll skills-detail" style={{ minWidth: 0 }}>
          <div style={{ padding: "20px 24px" }}>
            <div className="row" style={{ marginBottom: 14 }}>
              <span className={`chip k-${selected.type}`}>
                {selected.type === "anti" ? "anti-principle" : selected.type}
              </span>
              <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {selected.scope}
              </span>
              <VisibilityPill visibility={selected.visibility} />
              <span className="mono" style={{ fontSize: 12, color: "var(--ink-4)" }}>
                {selected.id.slice(0, 10)}
              </span>
              <div className="grow" />
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  setSelectedId(null);
                  setEditing(false);
                  setMenuOpen(false);
                }}
                aria-label={t("skills.close_detail")}
                title={t("skills.close_tip")}
                style={{ marginRight: 4 }}
              >
                <Icon name="x" />
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ height: 26, fontSize: 12 }}
                onClick={() => void onCopy()}
                title={t("skills.copy_body_tip")}
                aria-label={t("skills.copy_body_tip")}
              >
                <Icon name="copy" size={10} />
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ height: 26, fontSize: 12 }}
                onClick={() => void onFork()}
              >
                <Icon name="branch" size={10} /> {t("skills.fork")}
              </button>
              {/* Phase 4: Promote to org — only for project-visible rows owned by current user */}
              {selected.visibility === "project" && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ height: 26, fontSize: 12 }}
                  onClick={() => void onPromote()}
                  title={t("skills.promote_tip")}
                >
                  {t("skills.promote")}
                </button>
              )}
              {/* Phase 4: Fork into this project — only for org-visible rows */}
              {selected.visibility === "org" && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ height: 26, fontSize: 12 }}
                  onClick={() => void onForkToProject()}
                  title={t("skills.fork_here_tip")}
                >
                  {t("skills.fork_here")}
                </button>
              )}
              <button
                type="button"
                className={editing ? "btn btn-primary" : "btn"}
                style={{ height: 26, fontSize: 12 }}
                onClick={() => {
                  if (editing) void onSave();
                  else {
                    setDraft(selected.body);
                    setEditing(true);
                  }
                }}
              >
                {editing ? t("common.save") : t("skills.edit")}
              </button>
              {editing && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ height: 26, fontSize: 12 }}
                  onClick={() => setEditing(false)}
                >
                  {t("common.cancel")}
                </button>
              )}
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label={t("skills.more_actions")}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <Icon name="more" />
                </button>
                {menuOpen && (
                  <div
                    className="panel"
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 30,
                      zIndex: 10,
                      minWidth: 160,
                    }}
                  >
                    <MenuButton
                      icon="copy"
                      label={t("skills.copy_id")}
                      onClick={async () => {
                        setMenuOpen(false);
                        try {
                          await navigator.clipboard.writeText(selected.id);
                          flash(t("skills.id_copied"));
                        } catch {
                          flash(t("skills.clipboard_unavailable"));
                        }
                      }}
                    />
                    <MenuButton
                      icon="sort"
                      label={t("skills.refresh")}
                      onClick={() => {
                        setMenuOpen(false);
                        void refresh();
                      }}
                    />
                    <MenuButton icon="x" label={t("common.delete")} onClick={onDelete} danger />
                  </div>
                )}
              </div>
            </div>

            <h2
              style={{
                fontSize: 19,
                letterSpacing: "-0.015em",
                fontWeight: 500,
                margin: "0 0 12px",
                lineHeight: 1.3,
              }}
            >
              {selected.title}
            </h2>

            <div className="panel" style={{ padding: 16, marginBottom: 18 }}>
              {editing ? (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label={t("skills.edit_text")}
                  style={{
                    fontSize: 13.5,
                    lineHeight: 1.6,
                    color: "var(--ink)",
                    background: "transparent",
                    width: "100%",
                    resize: "vertical",
                    minHeight: 120,
                  }}
                />
              ) : (
                <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)" }}>
                  {selected.body}
                </div>
              )}
            </div>

            {/* Core Value B: Effectiveness signal */}
            <div style={{ marginBottom: 18 }}>
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--ink-4)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                }}
              >
                {t("skills.effectiveness")}
              </div>
              <div className="panel" style={{ padding: "10px 14px" }}>
                <EffectivenessBadge
                  effectiveness={selected.effectiveness}
                  outcomes={selected.outcomes}
                  usageCount={selected.uses}
                />
                <div
                  className="mono"
                  style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 6, lineHeight: 1.5 }}
                >
                  {t("skills.effectiveness_note")}
                </div>
              </div>
            </div>

            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 8,
              }}
            >
              {t("skills.frontmatter")}
            </div>
            <div
              className="panel mono"
              style={{
                padding: "12px 14px",
                fontSize: 13,
                lineHeight: 1.7,
                marginBottom: 18,
                color: "var(--ink-2)",
              }}
            >
              <div>
                <span style={{ color: "var(--ink-4)" }}>skill_id:</span> {selected.id}
              </div>
              <div>
                <span style={{ color: "var(--ink-4)" }}>type:</span> {selected.type}
              </div>
              <div>
                <span style={{ color: "var(--ink-4)" }}>scope:</span> {selected.scope}
              </div>
              <div>
                <span style={{ color: "var(--ink-4)" }}>visibility:</span>{" "}
                {selected.visibility ?? "project"}
                {selected.originProjectId && (
                  <span style={{ color: "var(--ink-4)" }}> (origin: {selected.originProjectId.slice(0, 8)})</span>
                )}
              </div>
              <div>
                <span style={{ color: "var(--ink-4)" }}>tags:</span>{" "}
                [{selected.tags.map((tg) => `"${tg}"`).join(", ")}]
              </div>
              <div>
                <span style={{ color: "var(--ink-4)" }}>confidence:</span>{" "}
                <span style={{ color: "var(--accent-text)" }}>
                  {selected.confidence.toFixed(2)}
                </span>
              </div>
              <div>
                <span style={{ color: "var(--ink-4)" }}>uses:</span> {selected.uses} ·{" "}
                <span style={{ color: "var(--ink-4)" }}>success:</span>{" "}
                {(selected.success * 100).toFixed(0)}%
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 18,
              }}
            >
              <UsagePanel selected={selected} t={t} />
              <ConfidenceTrail selected={selected} t={t} />
            </div>

            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 8,
              }}
            >
              {t("skills.related")}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                marginBottom: 18,
              }}
            >
              {related.loadState === "loading" && (
                <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("skills.loading_related")}</div>
              )}
              {related.loadState === "ready" && related.items.length === 0 && (
                <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
                  {t("skills.no_related")}
                </div>
              )}
              {related.items.map((r) => (
                <button
                  type="button"
                  key={`${r.id}-${r.relation}`}
                  className="panel"
                  style={{
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                    background: "transparent",
                    textAlign: "left",
                  }}
                  onClick={() => setSelectedId(r.id)}
                >
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: "var(--ink-4)", width: 90 }}
                  >
                    {r.direction === "out" ? r.relation : `← ${r.relation}`}
                  </span>
                  <span className={`chip k-${r.type}`}>{r.type}</span>
                  <span className="mono" style={{ fontSize: 13, color: "var(--ink-2)" }}>
                    [[{r.title}]]
                  </span>
                  <div className="grow" />
                  <Icon name="arrowR" size={11} />
                </button>
              ))}
            </div>

            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 8,
              }}
            >
              {t("skills.export_title")}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 6,
              }}
            >
              {(
                [
                  { n: "Claude Code", p: ".claude/skills/", ic: "claude", t: "claude" },
                  { n: "Cursor", p: ".cursor/rules/", ic: "cursor", t: "cursor" },
                  { n: "Windsurf", p: ".windsurfrules", ic: "windsurf", t: "windsurf" },
                  { n: "Markdown", p: "SKILL.md", ic: "file", t: "markdown" },
                ] as const
              ).map((x) => (
                <button
                  key={x.n}
                  type="button"
                  className="panel"
                  style={{
                    padding: "10px 12px",
                    cursor: "pointer",
                    background: "transparent",
                    textAlign: "left",
                  }}
                  onClick={() => void onExport(x.t)}
                >
                  <div className="row" style={{ marginBottom: 4 }}>
                    <Icon name={x.ic} size={12} />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{x.n}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
                    {x.p}
                  </div>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 10, width: "100%", fontSize: 12 }}
              onClick={() => void onDownloadRules()}
              title={t("skills.bundle_tip")}
            >
              <Icon name="file" size={11} /> {t("skills.download_rules_bundle")}
            </button>
          </div>
      </section>
      )}
    </div>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: "copy" | "sort" | "x";
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rail-item"
      style={{
        width: "100%",
        textAlign: "left",
        color: danger ? "var(--bad, #ff6b6b)" : undefined,
      }}
    >
      <Icon name={icon} size={11} />
      <span>{label}</span>
    </button>
  );
}

function UsagePanel({
  selected,
  t,
}: {
  selected: KnowledgeItemView;
  t: Translate;
}) {
  return (
    <div className="panel" style={{ padding: 14 }}>
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        {t("skills.outcome_history")}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color: selected.confidence >= 0.9 ? "var(--accent-text)" : "var(--ink)",
        }}
      >
        {selected.uses}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {t("skills.total_uses")}
        </span>
        <div className="grow" />
        <span className="mono" style={{ fontSize: 11, color: "var(--accent-text)" }}>
          {t("skills.accepted_pct", { pct: (selected.success * 100).toFixed(0) })}
        </span>
      </div>
    </div>
  );
}

function ConfidenceTrail({
  selected,
  t,
}: {
  selected: KnowledgeItemView;
  t: Translate;
}) {
  return (
    <div className="panel" style={{ padding: 14 }}>
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: "var(--ink-4)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        {t("skills.confidence_trail")}
      </div>
      <div
        className="mono"
        style={{ fontSize: 12, lineHeight: 1.8, color: "var(--ink-2)" }}
      >
        <div className="row">
          <span style={{ color: "var(--ink-4)", width: 90 }}>{t("skills.trail_extracted")}</span>
          <span title={t("tip.kea")}>{t("skills.trail_extracted_value")}</span>
        </div>
        <div className="row">
          <span style={{ color: "var(--ink-4)", width: 90 }}>{t("skills.trail_outcomes")}</span>
          <span>
            {selected.uses > 0
              ? t("skills.trail_outcomes_value", {
                  pct: Math.round(selected.success * 100),
                  n: selected.uses,
                })
              : t("skills.trail_no_data")}
          </span>
        </div>
        <div className="row">
          <span style={{ color: "var(--ink-4)", width: 90 }}>{t("skills.trail_current")}</span>
          <span style={{ color: "var(--accent-text)" }}>{selected.confidence.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}

function renderExport(
  target: "claude" | "cursor" | "windsurf" | "markdown",
  k: KnowledgeItemView,
): string {
  const body = [
    k.title,
    ``,
    k.body,
    ``,
    `<!-- id: ${k.id} · type: ${k.type} · scope: ${k.scope} · confidence: ${k.confidence.toFixed(2)} -->`,
  ].join("\n");
  if (target === "claude") {
    return `---\nname: ${k.id}\ntype: ${k.type}\nscope: ${k.scope}\ntags: ${JSON.stringify(k.tags)}\n---\n\n# ${body}`;
  }
  if (target === "cursor") {
    return `// Rule: ${k.title}\n${body}`;
  }
  if (target === "windsurf") {
    return `# ${k.title}\n${body}`;
  }
  return `# ${body}`;
}
