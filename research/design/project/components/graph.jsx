/* global React, Icon */
const { useState: useStateG, useMemo: useMemoG, useRef: useRefG, useEffect: useEffectG } = React;

function Graph() {
  const nodes = window.BRAIN_DATA.graphNodes;
  const edges = window.BRAIN_DATA.graphEdges;
  const [hover, setHover] = useStateG(null);
  const [selected, setSelected] = useStateG("composition-over-inheritance");
  const W = 800, H = 600;

  const nodeMap = useMemoG(() => Object.fromEntries(nodes.map(n => [n.id, n])), [nodes]);

  const isConnected = (a, b) => edges.some(([s, t]) => (s === a && t === b) || (s === b && t === a));
  const neighbors = new Set();
  if (selected) {
    edges.forEach(([s, t]) => {
      if (s === selected) neighbors.add(t);
      if (t === selected) neighbors.add(s);
    });
  }

  const sel = nodeMap[selected];

  return (
    <div className="graph-layout" style={{ height: "100%", display: "grid", gridTemplateColumns: "1fr 300px", minHeight: 0 }}>
      <div className="dot-grid" style={{ position: "relative", overflow: "hidden", background: "var(--bg)" }}>
        {/* Toolbar overlay */}
        <div style={{ position: "absolute", top: 16, left: 16, zIndex: 2, display: "flex", gap: 6 }}>
          <div className="panel row" style={{ padding: "4px 8px", gap: 8, fontSize: 11.5 }}>
            <Icon name="search" size={11} />
            <input placeholder="Search the graph" style={{ width: 180, fontSize: 11.5 }} />
          </div>
          <button className="btn btn-ghost"><Icon name="filter" size={11} /> Filters</button>
        </div>

        {/* Legend */}
        <div style={{ position: "absolute", bottom: 16, left: 16, zIndex: 2 }} className="panel">
          <div style={{ padding: "10px 12px" }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Legend</div>
            {[
              { k: "recipe", l: "Recipe" }, { k: "heuristic", l: "Heuristic" },
              { k: "principle", l: "Principle" }, { k: "reflex", l: "Reflex" },
              { k: "anti", l: "Anti-principle" }
            ].map(x => (
              <div key={x.k} className="row" style={{ fontSize: 11, padding: "2px 0", gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: `var(--k-${x.k})` }} />
                <span style={{ color: "var(--ink-2)" }}>{x.l}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: "8px 12px", borderTop: "1px solid var(--line-soft)" }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Edges</div>
            <div className="mono" style={{ fontSize: 10, lineHeight: 1.9, color: "var(--ink-2)" }}>
              <div>— depends_on</div>
              <div>— specializes</div>
              <div style={{ color: "var(--k-anti)" }}>— contradicts</div>
              <div>— deepens</div>
            </div>
          </div>
        </div>

        {/* Zoom */}
        <div style={{ position: "absolute", bottom: 16, right: 16, zIndex: 2, display: "flex", flexDirection: "column", gap: 2 }} className="panel">
          <button className="icon-btn" style={{ width: 32, height: 32 }}><Icon name="plus" size={12} /></button>
          <button className="icon-btn" style={{ width: 32, height: 32 }}><span style={{ fontSize: 14, lineHeight: 1 }}>−</span></button>
          <button className="icon-btn" style={{ width: 32, height: 32, fontSize: 10, fontFamily: "var(--font-mono)" }}>1:1</button>
        </div>

        <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0 }}>
          <defs>
            <radialGradient id="accentGlow">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.6" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Edges */}
          {edges.map(([s, t, rel], i) => {
            const a = nodeMap[s], b = nodeMap[t];
            if (!a || !b) return null;
            const active = selected && (s === selected || t === selected);
            const hoverActive = hover && (s === hover || t === hover);
            const color = rel === "contradicts" ? "var(--k-anti)" : (active || hoverActive) ? "var(--accent)" : "var(--line-strong)";
            const opacity = selected && !active ? 0.25 : 1;
            return (
              <line
                key={i}
                x1={a.x * W} y1={a.y * H} x2={b.x * W} y2={b.y * H}
                stroke={color}
                strokeWidth={active || hoverActive ? 1.2 : 0.6}
                strokeDasharray={rel === "contradicts" ? "3 3" : undefined}
                opacity={opacity}
              />
            );
          })}

          {/* Glow for selected */}
          {sel && <circle cx={sel.x * W} cy={sel.y * H} r={60} fill="url(#accentGlow)" />}

          {/* Nodes */}
          {nodes.map(n => {
            const active = n.id === selected;
            const isNeighbor = neighbors.has(n.id);
            const dim = selected && !active && !isNeighbor;
            const color = `var(--k-${n.type})`;
            return (
              <g key={n.id}
                style={{ cursor: "pointer", opacity: dim ? 0.3 : 1, transition: "opacity 0.2s" }}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setSelected(n.id)}>
                <circle
                  cx={n.x * W} cy={n.y * H}
                  r={n.r}
                  fill={active ? "var(--accent)" : color}
                  stroke={active ? "var(--accent)" : "var(--bg)"}
                  strokeWidth={active ? 2 : 1.5}
                  opacity={active ? 1 : 0.9}
                />
                <circle cx={n.x * W} cy={n.y * H} r={n.r + 4} fill="none" stroke={color} strokeWidth="0.5" opacity="0.4" />
                <text
                  x={n.x * W} y={n.y * H + n.r + 13}
                  fontSize="10" fontFamily="var(--font-mono)"
                  fill={active ? "var(--ink)" : "var(--ink-2)"}
                  textAnchor="middle"
                  style={{ fontWeight: active ? 500 : 400 }}>
                  {n.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Right panel — node inspector */}
      <aside className="scroll graph-inspector" style={{ borderLeft: "1px solid var(--line)", background: "var(--bg-elev-1)" }}>
        {sel && (
          <div style={{ padding: "16px 18px" }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className={`chip k-${sel.type}`}>{sel.type === "anti" ? "anti-principle" : sel.type}</span>
              <div className="grow" />
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>deg {sel.deg}</span>
            </div>
            <div className="mono" style={{ fontSize: 13, color: "var(--ink)", marginBottom: 6, letterSpacing: "-0.005em" }}>[[{sel.label}]]</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5, marginBottom: 16 }}>
              Prefer composition over inheritance. Abstract value carried across 31 sessions; influences 12 downstream skills.
            </div>

            <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Backlinks · {neighbors.size}</div>
            {[...neighbors].map(id => {
              const n = nodeMap[id];
              if (!n) return null;
              return (
                <div key={id} onClick={() => setSelected(id)}
                  style={{ padding: "6px 8px", cursor: "pointer", borderRadius: 6, display: "flex", alignItems: "center", gap: 8 }}
                  onMouseEnter={e => e.currentTarget.style.background = "var(--bg-elev-2)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: `var(--k-${n.type})` }} />
                  <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{n.label}</span>
                  <div className="grow" />
                  <Icon name="arrowR" size={10} />
                </div>
              );
            })}

            <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "18px 0 6px" }}>Stats</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11.5 }}>
              <div className="row"><span style={{ color: "var(--ink-3)" }}>Confidence</span><div className="grow" /><span className="mono tab-num" style={{ color: "var(--accent)" }}>0.92</span></div>
              <div className="row"><span style={{ color: "var(--ink-3)" }}>Uses · 30d</span><div className="grow" /><span className="mono tab-num">31</span></div>
              <div className="row"><span style={{ color: "var(--ink-3)" }}>Success rate</span><div className="grow" /><span className="mono tab-num">87%</span></div>
              <div className="row"><span style={{ color: "var(--ink-3)" }}>First seen</span><div className="grow" /><span className="mono tab-num">2026-02-11</span></div>
              <div className="row"><span style={{ color: "var(--ink-3)" }}>Last used</span><div className="grow" /><span className="mono tab-num">2h ago</span></div>
            </div>

            <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "18px 0 6px" }}>Graph queries</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <button className="btn btn-ghost" style={{ justifyContent: "flex-start", height: 26, fontSize: 11 }}><Icon name="link" size={10} /> Backlinks ({neighbors.size})</button>
              <button className="btn btn-ghost" style={{ justifyContent: "flex-start", height: 26, fontSize: 11 }}><Icon name="link" size={10} /> Orphans in cluster</button>
              <button className="btn btn-ghost" style={{ justifyContent: "flex-start", height: 26, fontSize: 11 }}><Icon name="link" size={10} /> Dependents · transitive</button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function Autoskill() {
  const proposals = window.BRAIN_DATA.proposals;
  return (
    <div className="scroll" style={{ height: "100%", padding: "24px 32px 60px" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.02em", fontWeight: 500 }}>Autoskill proposals</h1>
          <span className="chip" style={{ marginLeft: 10 }}><span className="live-dot" /> queue live</span>
          <div className="grow" />
          <button className="btn btn-ghost" style={{ height: 26 }}>Auto-apply HIGH</button>
        </div>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 20 }}>
          detected from the last {window.BRAIN_DATA.stats.sessionsWeek} sessions · filtered for cross-session signal
        </div>

        {proposals.map(p => (
          <div key={p.id} className="panel" style={{ marginBottom: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderLeft: `3px solid ${p.confidence === "high" ? "var(--accent)" : "var(--warn)"}` }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="mono" style={{
                  fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase",
                  padding: "3px 6px", borderRadius: 3,
                  color: p.confidence === "high" ? "var(--accent-ink)" : "var(--bg)",
                  background: p.confidence === "high" ? "var(--accent)" : "var(--warn)",
                  fontWeight: 600
                }}>{p.confidence}</span>
                <span className={`chip k-${p.type === 'anti_principle' ? 'anti' : p.type === 'style' ? 'reflex' : p.type}`}>{p.type.replace("_", " ")}</span>
                <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-4)" }}>· session {p.session}</span>
                <div className="grow" />
                <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>pattern × {p.pattern}</span>
              </div>
              <div style={{ fontSize: 15, letterSpacing: "-0.005em", marginBottom: 4 }}>{p.title}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 10 }}>
                <span className="mono" style={{ color: "var(--ink-4)" }}>target → </span>
                <span>{p.target}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", padding: "8px 10px", background: "var(--bg-elev-2)", borderRadius: 6, marginBottom: 10 }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>reason · </span>{p.reason}
              </div>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn btn-primary"><Icon name="check" size={10} /> Apply</button>
                <button className="btn"><Icon name="copy" size={10} /> Edit</button>
                <button className="btn btn-ghost"><Icon name="x" size={10} /> Reject</button>
                <div className="grow" />
                <button className="btn btn-ghost" style={{ fontSize: 11 }}>View diff <Icon name="arrowR" size={10} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sessions() {
  const s = window.BRAIN_DATA.recentSessions;
  return (
    <div className="scroll" style={{ height: "100%", padding: "24px 32px 60px" }}>
      <div className="row" style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.02em", fontWeight: 500 }}>Sessions</h1>
        <span className="chip" style={{ marginLeft: 10 }}>{window.BRAIN_DATA.stats.sessionsAllTime.toLocaleString()} all time</span>
        <div className="grow" />
        <button className="btn btn-ghost"><Icon name="filter" size={11} /> Filter</button>
      </div>
      <div className="panel">
        <div className="row mono" style={{ padding: "10px 16px", fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid var(--line-soft)" }}>
          <span style={{ width: 22 }} />
          <span style={{ width: 80 }}>ID</span>
          <span style={{ flex: 2 }}>Project</span>
          <span style={{ width: 120 }}>Started</span>
          <span style={{ width: 70 }}>Dur</span>
          <span style={{ width: 80 }}>Outcome</span>
          <span style={{ width: 60, textAlign: "right" }}>SQS</span>
          <span style={{ width: 90, textAlign: "right" }}>K in/out</span>
        </div>
        {[...s, ...s].map((row, i) => (
          <div key={i} className="row" style={{ padding: "11px 16px", fontSize: 12, borderBottom: "1px solid var(--line-soft)" }}>
            <span style={{ width: 22, color: "var(--ink-3)" }}><Icon name={row.icon} size={13} /></span>
            <span className="mono" style={{ width: 80, fontSize: 11, color: "var(--ink-3)" }}>{row.id}</span>
            <span className="mono" style={{ flex: 2, fontSize: 12 }}>{row.project}</span>
            <span className="mono tab-num" style={{ width: 120, fontSize: 11, color: "var(--ink-3)" }}>{row.startedAt}</span>
            <span className="mono tab-num" style={{ width: 70, fontSize: 11, color: "var(--ink-3)" }}>{row.duration}</span>
            <span style={{ width: 80 }}>
              <span className="chip" style={{
                color: row.outcome === "accepted" ? "var(--ok)" : row.outcome === "partial" ? "var(--warn)" : "var(--bad)",
              }}>{row.outcome}</span>
            </span>
            <span className="mono tab-num" style={{ width: 60, textAlign: "right", color: row.sqs >= 0.7 ? "var(--accent)" : "var(--ink-2)" }}>{row.sqs.toFixed(2)}</span>
            <span className="mono tab-num" style={{ width: 90, textAlign: "right", fontSize: 11, color: "var(--ink-3)" }}>{row.injected} / {row.extracted}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { Graph, Autoskill, Sessions });
