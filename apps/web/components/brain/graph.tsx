"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Icon } from "./icons";
import { useT } from "@/lib/brain/i18n";
import { useGraph, useGraphFilter, type LaidOutNode } from "@/lib/brain/use-graph";
import { useProjectScope } from "@/lib/brain/use-project-scope";
import { ScopePill } from "./scope-pill";
import { HelpPopover } from "./help-popover";
import { formatRelative } from "@brain/core/format-relative";

type GraphQuery = "all" | "backlinks" | "orphans" | "dependents";

export function Graph() {
  const t = useT();
  const { scope, setScope } = useProjectScope();
  const { nodes, edges } = useGraph(scope);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState<GraphQuery>("all");
  const [zoom, setZoom] = useState(1);
  const W = 800;
  const H = 600;

  // No default selection — the inspector only opens when the user clicks a
  // node. First-visit shows an uncluttered canvas.
  const active = selected;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const filteredNodes = useGraphFilter(nodes, search);
  const nodeMap = useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<string, LaidOutNode>,
    [nodes],
  );

  const neighbors = useMemo(() => {
    const s = new Set<string>();
    if (!active) return s;
    for (const e of edges) {
      if (e.source === active) s.add(e.target);
      if (e.target === active) s.add(e.source);
    }
    return s;
  }, [active, edges]);

  const dependents = useMemo(() => {
    const root = active;
    if (!root) return new Set<string>();
    const set = new Set<string>([root]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of edges) {
        if (set.has(e.target) && !set.has(e.source) && e.relation === "depends_on") {
          set.add(e.source);
          grew = true;
        }
      }
    }
    set.delete(root);
    return set;
  }, [active, edges]);

  const orphans = useMemo(() => {
    const linked = new Set<string>();
    for (const e of edges) {
      linked.add(e.source);
      linked.add(e.target);
    }
    return new Set(nodes.filter((n) => !linked.has(n.id)).map((n) => n.id));
  }, [nodes, edges]);

  const queryFilteredIds = useMemo(() => {
    switch (query) {
      case "backlinks":
        return active ? new Set([active, ...neighbors]) : null;
      case "dependents":
        return active ? new Set([active, ...dependents]) : null;
      case "orphans":
        return orphans;
      default:
        return null;
    }
  }, [query, active, neighbors, dependents, orphans]);

  const visibleIds = useMemo(() => {
    const s = new Set(filteredNodes.map((n) => n.id));
    if (queryFilteredIds) {
      for (const id of [...s]) if (!queryFilteredIds.has(id)) s.delete(id);
    }
    return s;
  }, [filteredNodes, queryFilteredIds]);

  const sel = active ? nodeMap[active] ?? null : null;

  if (nodes.length === 0) {
    return (
      <div
        className="scroll"
        style={{
          height: "100%",
          padding: "48px 32px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
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
            <Icon name="filter" size={14} />
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
            {t("graph.empty_title")}
          </h2>
          <p
            style={{
              margin: "0 0 16px",
              fontSize: 14,
              lineHeight: 1.55,
              color: "var(--ink-2)",
            }}
          >
            {t("graph.empty_body")}
          </p>
          <div
            className="row"
            style={{ gap: 8, justifyContent: "center", flexWrap: "wrap" }}
          >
            <a
              href="/settings/tokens"
              className="btn btn-primary"
              style={{ fontSize: 13, textDecoration: "none" }}
            >
              <Icon name="link" size={11} /> {t("graph.connect_tool")}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: "16px 24px 12px",
          borderBottom: "1px solid var(--line-soft)",
          flexShrink: 0,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.02em", fontWeight: 500 }}>
          Graph
        </h1>
        <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--ink-3)", lineHeight: 1.4 }}>
          How your knowledge connects
        </p>
      </div>
    <div
      className="graph-layout"
      data-inspector-open={sel ? "true" : "false"}
      style={{
        flex: 1,
        display: "grid",
        // Inspector hides until a node is clicked — first visit should be the
        // canvas breathing, not a half-empty "Click a node to inspect." panel
        // stealing 300px.
        gridTemplateColumns: sel ? "1fr 300px" : "1fr",
        minHeight: 0,
      }}
    >
      <div
        className="dot-grid"
        style={{ position: "relative", overflow: "hidden", background: "var(--bg)" }}
      >
        <div
          style={{ position: "absolute", top: 16, left: 16, zIndex: 2, display: "flex", gap: 6 }}
        >
          <div className="panel row" style={{ padding: "4px 8px", gap: 8, fontSize: 13 }}>
            <Icon name="search" size={11} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("graph.search")}
              style={{ width: 180, fontSize: 13 }}
            />
          </div>
          <button
            type="button"
            className={query !== "all" ? "btn" : "btn btn-ghost"}
            onClick={() => setQuery((q) => (q === "all" ? "backlinks" : "all"))}
            title={query !== "all" ? `Query: ${query}` : t("graph.filters")}
          >
            <Icon name="filter" size={11} /> {t("graph.filters")}
            {query !== "all" && <span className="kbd" style={{ marginLeft: 4 }}>{query}</span>}
          </button>
          <ScopePill scope={scope} onScopeChange={setScope} />
          <HelpPopover
            content={{
              what: "Your knowledge as a map. Each dot is one skill or rule the Brain has learned; lines show how rules relate (related topics, dependencies, anti-patterns of each other).",
              whatToDo: [
                "Click any dot to inspect that skill in a side panel.",
                "Use Search to focus on a topic. Use Filters to highlight orphans (skills nothing else points at) or backlinks.",
                "Color coding (bottom-left legend) groups skills by type: recipe, rule of thumb, principle, reflex, anti-pattern.",
              ],
              related: [],
              docHref: "/docs/concepts/graph",
            }}
          />
        </div>

        <div
          style={{ position: "absolute", bottom: 16, left: 16, zIndex: 2 }}
          className="panel"
        >
          <div style={{ padding: "10px 12px" }}>
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
              {t("graph.legend")}
            </div>
            {([
              { k: "recipe", l: t("skills.recipe") },
              { k: "heuristic", l: t("skills.heuristic") },
              { k: "principle", l: t("skills.principle") },
              { k: "reflex", l: t("skills.reflex") },
              { k: "anti", l: t("skills.anti") },
            ] as const).map((x) => (
              <div
                key={x.k}
                className="row"
                style={{ fontSize: 12, padding: "2px 0", gap: 8 }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 99,
                    background: `var(--k-${x.k})`,
                  }}
                />
                <span style={{ color: "var(--ink-2)" }}>{x.l}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: "8px 12px", borderTop: "1px solid var(--line-soft)" }}>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 4,
              }}
            >
              {t("graph.edges")}
            </div>
            <div
              className="mono"
              style={{ fontSize: 11, lineHeight: 1.9, color: "var(--ink-2)" }}
            >
              <div>— depends on</div>
              <div>— specializes</div>
              <div style={{ color: "var(--k-anti)" }}>— contradicts</div>
              <div>— deepens</div>
            </div>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 16,
            right: 16,
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
          className="panel"
        >
          <button
            type="button"
            className="icon-btn"
            style={{ width: 32, height: 32 }}
            onClick={() => setZoom((z) => Math.min(3, z * 1.25))}
            aria-label="Zoom in"
          >
            <Icon name="plus" size={12} />
          </button>
          <button
            type="button"
            className="icon-btn"
            style={{ width: 32, height: 32 }}
            onClick={() => setZoom((z) => Math.max(0.3, z / 1.25))}
            aria-label="Zoom out"
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>−</span>
          </button>
          <button
            type="button"
            className="icon-btn"
            style={{ width: 32, height: 32, fontSize: 11, fontFamily: "var(--font-mono)" }}
            onClick={() => setZoom(1)}
            aria-label="Reset zoom"
          >
            1:1
          </button>
        </div>

        <svg
          width="100%"
          height="100%"
          viewBox={viewBoxForZoom(zoom, W, H)}
          preserveAspectRatio="xMidYMid meet"
          style={{ position: "absolute", inset: 0 }}
        >
          <defs>
            <radialGradient id="accentGlow">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.6" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {edges.map((e, i) => {
            const a = nodeMap[e.source];
            const b = nodeMap[e.target];
            if (!a || !b) return null;
            if (!visibleIds.has(a.id) || !visibleIds.has(b.id)) return null;
            const activeEdge = active && (e.source === active || e.target === active);
            const hoverActive = hover && (e.source === hover || e.target === hover);
            const color =
              e.relation === "contradicts"
                ? "var(--k-anti)"
                : activeEdge || hoverActive
                  ? "var(--accent)"
                  : "var(--line-strong)";
            const opacity = active && !activeEdge ? 0.25 : 1;
            return (
              <line
                key={i}
                x1={a.x * W}
                y1={a.y * H}
                x2={b.x * W}
                y2={b.y * H}
                stroke={color}
                strokeWidth={activeEdge || hoverActive ? 1.2 : 0.6}
                strokeDasharray={e.relation === "contradicts" ? "3 3" : undefined}
                opacity={opacity}
              />
            );
          })}

          {sel && <circle cx={sel.x * W} cy={sel.y * H} r={60} fill="url(#accentGlow)" />}

          {nodes.map((n, i) => {
            if (!visibleIds.has(n.id)) return null;
            const isActive = n.id === active;
            const isNeighbor = neighbors.has(n.id);
            const dim = active && !isActive && !isNeighbor;
            const color = `var(--k-${n.type})`;
            // UX-newcomer-pass: the previous 42-char cap still collided
            // when many same-type nodes ended up at similar y on the
            // concentric-ring layout. The fix is two-pronged:
            //   (a) tighter truncation — 16 chars for inactive labels
            //   (b) vertical stagger — alternate labels above vs below
            //       the node by index parity, so adjacent ring positions
            //       sit on different baselines.
            // Active/hover label shows full text on the inspector side.
            const labelAbove = i % 2 === 1;
            const labelY = labelAbove
              ? n.y * H - n.r - 6
              : n.y * H + n.r + 13;
            const truncated = n.label.length > 16
              ? `${n.label.slice(0, 14)}…`
              : n.label;
            return (
              <g
                key={n.id}
                style={{
                  cursor: "pointer",
                  opacity: dim ? 0.3 : 1,
                  transition: "opacity 0.2s",
                }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setSelected(n.id)}
              >
                <circle
                  cx={n.x * W}
                  cy={n.y * H}
                  r={n.r}
                  fill={isActive ? "var(--accent)" : color}
                  stroke={isActive ? "var(--accent)" : "var(--bg)"}
                  strokeWidth={isActive ? 2 : 1.5}
                  opacity={isActive ? 1 : 0.9}
                />
                <circle
                  cx={n.x * W}
                  cy={n.y * H}
                  r={n.r + 4}
                  fill="none"
                  stroke={color}
                  strokeWidth="0.5"
                  opacity="0.4"
                />
                <text
                  x={n.x * W}
                  y={labelY}
                  fontSize="10"
                  fontFamily="var(--font-mono)"
                  fill={isActive ? "var(--ink)" : "var(--ink-2)"}
                  textAnchor="middle"
                  style={{ fontWeight: isActive ? 500 : 400 }}
                >
                  <title>{n.label}</title>
                  {truncated}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {sel && (
      <aside
        className="scroll graph-inspector"
        style={{ borderLeft: "1px solid var(--line)", background: "var(--bg-elev-1)" }}
      >
        {(
          <div style={{ padding: "16px 18px" }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className={`chip k-${sel.type}`}>
                {sel.type === "anti" ? "anti-principle" : sel.type}
              </span>
              <div className="grow" />
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--ink-4)" }}
                title="Number of connections to other skills"
              >
                {sel.deg} {sel.deg === 1 ? "link" : "links"}
              </span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSelected(null)}
                aria-label="Close inspector"
                title="Close (Esc)"
                style={{ marginLeft: 6 }}
              >
                <Icon name="x" />
              </button>
            </div>
            <div
              className="mono"
              style={{
                fontSize: 13,
                color: "var(--ink)",
                marginBottom: 6,
                letterSpacing: "-0.005em",
              }}
            >
              [[{sel.label}]]
            </div>
            <div
              style={{
                fontSize: 13,
                color: "var(--ink-3)",
                lineHeight: 1.5,
                marginBottom: 16,
              }}
            >
              {sel.scope} · {sel.type} · confidence {sel.confidence.toFixed(2)}
            </div>

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
              {t("graph.backlinks")} · {neighbors.size}
            </div>
            {[...neighbors].map((id) => {
              const n = nodeMap[id];
              if (!n) return null;
              return (
                <button
                  type="button"
                  key={id}
                  onClick={() => setSelected(id)}
                  style={{
                    padding: "6px 8px",
                    cursor: "pointer",
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    background: "transparent",
                    border: 0,
                    color: "inherit",
                    textAlign: "left",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-elev-2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 99,
                      background: `var(--k-${n.type})`,
                    }}
                  />
                  <span className="mono" style={{ fontSize: 13, color: "var(--ink-2)" }}>
                    {n.label}
                  </span>
                  <div className="grow" />
                  <Icon name="arrowR" size={10} />
                </button>
              );
            })}

            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                margin: "18px 0 6px",
              }}
            >
              {t("graph.stats")}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontSize: 13,
              }}
            >
              <Stat label={t("graph.confidence")} value={sel.confidence.toFixed(2)} accent />
              <Stat label={t("graph.uses_30")} value={String(sel.uses)} />
              <Stat label={t("graph.success_rate")} value={`${Math.round(sel.successRate * 100)}%`} />
              <Stat label={t("graph.first_seen")} value={sel.firstSeen} />
              <Stat
                label={t("graph.last_used")}
                value={<RelativeText iso={sel.lastUsed} />}
              />
            </div>

            <div
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--ink-4)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                margin: "18px 0 6px",
              }}
            >
              {t("graph.queries")}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <QueryBtn
                label={`${t("graph.backlinks")} (${neighbors.size})`}
                active={query === "backlinks"}
                onClick={() => setQuery("backlinks")}
              />
              <QueryBtn
                label={`${t("graph.orphans")} (${orphans.size})`}
                active={query === "orphans"}
                onClick={() => setQuery("orphans")}
              />
              <QueryBtn
                label={`${t("graph.dependents")} (${dependents.size})`}
                active={query === "dependents"}
                onClick={() => setQuery("dependents")}
              />
              {query !== "all" && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ justifyContent: "flex-start", height: 22, fontSize: 11 }}
                  onClick={() => setQuery("all")}
                >
                  clear query
                </button>
              )}
            </div>
          </div>
        )}
      </aside>
      )}
    </div>
    </div>
  );
}

function viewBoxForZoom(zoom: number, W: number, H: number): string {
  const z = Math.max(0.1, zoom);
  const w = W / z;
  const h = H / z;
  const x = (W - w) / 2;
  const y = (H - h) / 2;
  return `${x} ${y} ${w} ${h}`;
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  // ReactNode so the inspector can pass the hydration-safe
  // `<RelativeText>` component as the value (FE5).
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="row">
      <span style={{ color: "var(--ink-3)" }}>{label}</span>
      <div className="grow" />
      <span
        className="mono tab-num"
        style={{ color: accent ? "var(--accent-text)" : undefined }}
      >
        {value}
      </span>
    </div>
  );
}

function QueryBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "btn" : "btn btn-ghost"}
      style={{ justifyContent: "flex-start", height: 26, fontSize: 12 }}
      onClick={onClick}
    >
      <Icon name="link" size={10} /> {label}
    </button>
  );
}

/**
 * Hydration-safe wrapper around the canonical formatRelative. See FE5 in
 * #103 — same pattern as the `<RelativeTime>` in oracle.tsx. Renders the
 * absolute YYYY-MM-DD on SSR + first client render, swaps to relative
 * post-mount via useEffect. (Dropped the local `relative()` formatter in
 * the 2026-05-31 consistency pass — was one of 4 divergent variants.)
 */
function RelativeText({ iso }: { iso: string | null | undefined }) {
  const fallback = iso ? iso.slice(0, 10) : "—";
  const [str, setStr] = useState(fallback);
  useEffect(() => {
    setStr(iso ? formatRelative(iso) : "—");
  }, [iso]);
  return <>{str}</>;
}
