/* global React, Icon */

function Stat({ label, value, sub, accent }) {
  return (
    <div className="panel" style={{ padding: "14px 16px" }}>
      <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div className="tab-num" style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em", marginTop: 6, color: accent ? "var(--accent)" : "var(--ink)" }}>{value}</div>
      {sub && <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SQSChart({ data }) {
  const max = 1;
  const w = 100 / data.length;
  return (
    <div className="panel" style={{ padding: "14px 16px", gridColumn: "span 2" }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <div>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Session Quality Score · 12wk</div>
          <div className="row" style={{ gap: 10, marginTop: 6 }}>
            <span className="tab-num" style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-0.02em" }}>0.81</span>
            <span className="chip" style={{ color: "var(--ok)", borderColor: "color-mix(in oklab, var(--ok) 30%, var(--line))" }}>
              <Icon name="arrowUp" size={9} /> +0.23
            </span>
          </div>
        </div>
        <div className="grow" />
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>target ≥ 0.70</div>
      </div>
      <div style={{ position: "relative", height: 70, marginTop: 4 }}>
        <svg width="100%" height="70" viewBox="0 0 100 70" preserveAspectRatio="none">
          <line x1="0" y1="21" x2="100" y2="21" stroke="var(--line-soft)" strokeWidth="0.2" strokeDasharray="1 1" />
          <path
            d={`M ${data.map((v, i) => `${i * w + w/2},${(1 - v) * 60 + 5}`).join(" L ")}`}
            fill="none" stroke="var(--accent)" strokeWidth="1.2" vectorEffect="non-scaling-stroke"
          />
          <path
            d={`M ${data.map((v, i) => `${i * w + w/2},${(1 - v) * 60 + 5}`).join(" L ")} L ${100 - w/2},65 L ${w/2},65 Z`}
            fill="var(--accent-wash)"
          />
          {data.map((v, i) => (
            <circle key={i} cx={i * w + w/2} cy={(1 - v) * 60 + 5} r="0.8" fill="var(--accent)" />
          ))}
        </svg>
      </div>
    </div>
  );
}

function LiveExtraction() {
  const evts = window.BRAIN_DATA.liveExtraction.events;
  return (
    <div className="panel" style={{ gridColumn: "span 2" }}>
      <div className="panel-h">
        <span className="live-dot" />
        <h3>Live · extraction stream</h3>
        <span className="sub">session {window.BRAIN_DATA.liveExtraction.session}</span>
        <div className="grow" />
        <span className="chip"><Icon name="claude" size={9} /> claude-code</span>
      </div>
      <div style={{ padding: "4px 0 6px", fontFamily: "var(--font-mono)", fontSize: 11 }}>
        {evts.map((e, i) => (
          <div key={i} className="row" style={{ padding: "6px 14px", gap: 10, alignItems: "flex-start" }}>
            <span className="tab-num" style={{ color: "var(--ink-4)", fontSize: 10, minWidth: 40 }}>+{String(e.t).padStart(4, "0")}ms</span>
            <span style={{
              color: e.type === "extract" ? "var(--accent)" : e.type === "autoskill" ? "var(--violet)" : "var(--ink-3)",
              fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", minWidth: 62,
            }}>{e.type === "extract" ? "KEA" : e.type === "autoskill" ? "AUTOSKILL" : "EVENT"}</span>
            <span style={{ color: e.type !== "event" ? "var(--ink)" : "var(--ink-2)", flex: 1 }}>{e.text}</span>
            {e.conf && <span className="chip" style={{ marginLeft: "auto" }}>conf {e.conf}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentSessions() {
  const s = window.BRAIN_DATA.recentSessions;
  return (
    <div className="panel" style={{ gridColumn: "span 2" }}>
      <div className="panel-h">
        <h3>Recent sessions</h3>
        <span className="sub">{s.length} of 1,284</span>
        <div className="grow" />
        <button className="btn btn-ghost" style={{ height: 24, fontSize: 11 }}>View all <Icon name="arrowR" size={10} /></button>
      </div>
      <div>
        <div className="row mono" style={{ padding: "8px 14px", fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid var(--line-soft)" }}>
          <span style={{ width: 22 }} />
          <span style={{ flex: 2 }}>Project</span>
          <span style={{ width: 80 }}>Started</span>
          <span style={{ width: 50 }}>Dur</span>
          <span style={{ width: 70 }}>Outcome</span>
          <span style={{ width: 60, textAlign: "right" }}>SQS</span>
          <span style={{ width: 80, textAlign: "right" }}>K in/out</span>
        </div>
        {s.map(row => (
          <div key={row.id} className="row" style={{ padding: "10px 14px", fontSize: 12, borderBottom: "1px solid var(--line-soft)" }}>
            <span style={{ width: 22, color: "var(--ink-3)" }}><Icon name={row.icon} size={13} /></span>
            <span style={{ flex: 2 }}>
              <span className="mono" style={{ fontSize: 12 }}>{row.project}</span>
            </span>
            <span className="mono tab-num" style={{ width: 80, fontSize: 11, color: "var(--ink-3)" }}>{row.startedAt.slice(5)}</span>
            <span className="mono tab-num" style={{ width: 50, fontSize: 11, color: "var(--ink-3)" }}>{row.duration}</span>
            <span style={{ width: 70 }}>
              <span className="chip" style={{
                color: row.outcome === "accepted" ? "var(--ok)" : row.outcome === "partial" ? "var(--warn)" : "var(--bad)",
                borderColor: "var(--line)"
              }}>
                <span className="dot" />{row.outcome}
              </span>
            </span>
            <span className="mono tab-num" style={{ width: 60, textAlign: "right", color: row.sqs >= 0.7 ? "var(--accent)" : "var(--ink-2)" }}>{row.sqs.toFixed(2)}</span>
            <span className="mono tab-num" style={{ width: 80, textAlign: "right", fontSize: 11, color: "var(--ink-3)" }}>{row.injected} / {row.extracted}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingProposals() {
  const p = window.BRAIN_DATA.proposals.slice(0, 3);
  return (
    <div className="panel">
      <div className="panel-h">
        <h3>Autoskill proposals</h3>
        <span className="sub">{window.BRAIN_DATA.proposals.length} pending</span>
        <div className="grow" />
        <button className="btn btn-ghost" style={{ height: 24, fontSize: 11 }}>Review <Icon name="arrowR" size={10} /></button>
      </div>
      <div>
        {p.map(pr => (
          <div key={pr.id} style={{ padding: "12px 14px", borderBottom: "1px solid var(--line-soft)" }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <span className="chip" style={{
                color: pr.confidence === "high" ? "var(--accent)" : "var(--warn)",
                borderColor: pr.confidence === "high" ? "color-mix(in oklab, var(--accent) 30%, var(--line))" : "var(--line)",
                textTransform: "uppercase", fontSize: 9, letterSpacing: "0.08em"
              }}>{pr.confidence}</span>
              <span className={`chip k-${pr.type === 'anti_principle' ? 'anti' : pr.type === 'style' ? 'reflex' : pr.type}`}>{pr.type.replace('_', ' ')}</span>
              <div className="grow" />
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>{pr.session}</span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.35, marginBottom: 4 }}>{pr.title}</div>
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>→ {pr.target}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KnowledgeHealth() {
  const s = window.BRAIN_DATA.stats;
  const metrics = [
    { label: "Retrieval NDCG@5", value: s.retrievalNDCG.toFixed(2), bar: s.retrievalNDCG, target: "> 0.50" },
    { label: "Health index", value: s.knowledgeHealth.toFixed(2), bar: s.knowledgeHealth, target: "> 0.70" },
    { label: "Bundle hit-rate", value: s.bundleHitRate.toFixed(2), bar: s.bundleHitRate, target: "> 0.60" },
    { label: "Contradictions", value: s.contradictions, bar: 0.2, inv: true, target: "< 5" },
  ];
  return (
    <div className="panel">
      <div className="panel-h">
        <h3>Flywheel</h3>
        <span className="sub">all green · gate 2</span>
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {metrics.map(m => (
          <div key={m.label}>
            <div className="row" style={{ marginBottom: 5 }}>
              <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{m.label}</span>
              <div className="grow" />
              <span className="mono tab-num" style={{ fontSize: 12 }}>{m.value}</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)", marginLeft: 6 }}>{m.target}</span>
            </div>
            <div style={{ height: 3, background: "var(--bg-elev-3)", borderRadius: 2 }}>
              <div style={{ width: `${m.bar * 100}%`, height: "100%", background: m.inv ? "var(--ink-3)" : "var(--accent)", borderRadius: 2 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KnowledgeTypes() {
  const types = [
    { k: "recipe", count: 104, pct: 0.30 },
    { k: "heuristic", count: 92, pct: 0.27 },
    { k: "reflex", count: 71, pct: 0.20 },
    { k: "principle", count: 48, pct: 0.14 },
    { k: "anti", count: 32, pct: 0.09 },
  ];
  return (
    <div className="panel">
      <div className="panel-h">
        <h3>Knowledge composition</h3>
        <span className="sub">347 items</span>
      </div>
      <div style={{ padding: "14px 14px 10px" }}>
        <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
          {types.map(t => (
            <div key={t.k} style={{ width: `${t.pct * 100}%`, background: `var(--k-${t.k})`, opacity: 0.85 }} />
          ))}
        </div>
        {types.map(t => (
          <div key={t.k} className="row" style={{ padding: "6px 0", fontSize: 12 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: `var(--k-${t.k})` }} />
            <span style={{ textTransform: "capitalize" }}>{t.k === "anti" ? "Anti-principle" : t.k}</span>
            <div className="grow" />
            <span className="mono tab-num" style={{ color: "var(--ink-3)" }}>{t.count}</span>
            <span className="mono tab-num" style={{ width: 32, textAlign: "right", color: "var(--ink-4)" }}>{(t.pct * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dashboard() {
  const s = window.BRAIN_DATA.stats;
  const t = window.t;
  return (
    <div className="scroll" style={{ height: "100%", padding: "20px 24px 40px" }}>
      <div className="row dash-head" style={{ marginBottom: 6 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.02em", fontWeight: 500 }}>{t("dash.title")}</h1>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>
            {t("dash.subtitle")}
          </div>
        </div>
        <div className="grow" />
        <div className="row" style={{ gap: 6 }}>
          <button className="btn"><Icon name="copy" size={11} /> {t("dash.export")}</button>
          <button className="btn"><Icon name="link" size={11} /> {t("dash.mcp")}</button>
        </div>
      </div>

      <div className="dash-grid-stats" style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginTop: 20 }}>
        <Stat label="Active knowledge" value={s.activeKnowledge} sub="+12 this week" />
        <Stat label="Sessions · week" value={s.sessionsWeek} sub={`${s.sessionsAllTime.toLocaleString()} all time`} />
        <SQSChart data={s.sqsTrend} />
        <Stat label="Proposals" value={s.pendingProposals} sub="2 high · 2 med" accent />
        <Stat label="Decay · week" value={s.decayThisWeek} sub="stale items dimmed" />
      </div>

      <div className="dash-grid-wide" style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginTop: 10 }}>
        <LiveExtraction />
        <PendingProposals />
      </div>

      <div className="dash-grid-wide" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10, marginTop: 10 }}>
        <RecentSessions />
        <KnowledgeHealth />
        <KnowledgeTypes />
      </div>
    </div>
  );
}

Object.assign(window, { Dashboard });
