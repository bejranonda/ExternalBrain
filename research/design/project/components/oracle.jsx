/* global React, Icon */
const { useState: useStateO, useEffect: useEffectO, useRef: useRefO } = React;

function Oracle() {
  const [q, setQ] = useStateO("");
  const suggestions = [
    "how did I solve the CORS issue in the MCP server last month?",
    "what do I usually use for auth?",
    "show me my React anti-patterns",
    "which pgvector index settings worked on brain-platform?",
  ];

  return (
    <div className="oracle-layout" style={{ height: "100%", display: "grid", gridTemplateColumns: "1fr 320px" }}>
      <div className="scroll" style={{ padding: "24px 32px 120px", position: "relative" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div className="row" style={{ marginBottom: 18 }}>
            <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.02em", fontWeight: 500 }}>Oracle</h1>
            <span className="chip" style={{ marginLeft: 10 }}><span className="dot" style={{ background: "var(--accent)" }} />sonnet 4.6 · medium</span>
            <div className="grow" />
            <button className="btn btn-ghost"><Icon name="branch" size={11} /> New thread</button>
          </div>

          {/* Question */}
          <div style={{ padding: "18px 0 8px" }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>You · 14:22</div>
            <div className="serif oracle-q" style={{ fontSize: 22, lineHeight: 1.35, letterSpacing: "-0.01em", color: "var(--ink)", fontWeight: 400 }}>
              how did I solve the CORS issue in the MCP server last month?
            </div>
          </div>

          {/* Oracle answer */}
          <div style={{ padding: "22px 0 8px", borderTop: "1px solid var(--line-soft)", marginTop: 14 }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <div style={{
                width: 20, height: 20, borderRadius: 4, display: "grid", placeItems: "center",
                background: "var(--accent)", color: "var(--accent-ink)"
              }}><Icon name="oracle" size={11} /></div>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Oracle</span>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>· 8 items retrieved · 2 cited</span>
              <div className="grow" />
              <span className="chip"><Icon name="clock" size={9} /> 1.2s</span>
            </div>
            <div style={{ fontSize: 14.5, lineHeight: 1.65, color: "var(--ink)" }}>
              You had two attempts on this. The one that <em style={{ color: "var(--accent)", fontStyle: "normal", fontWeight: 500 }}>worked</em> —
              session <span className="mono" style={{ color: "var(--cool)" }}>s_9d12</span> on March 14 — used a <span className="mono">Vary: Origin</span> header
              plus a dynamic allowlist driven by <span className="mono">BRAIN_ALLOWED_ORIGINS</span>. A week earlier you tried wildcard <span className="mono">*</span> with credentials
              and the browser rejected it.
              <br /><br />
              The durable rule you taught me afterward:
            </div>

            {/* Citations */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
              {window.BRAIN_DATA.oracleChat[0].citations && [
                { id: "k_89c", type: "anti", title: "Never use `Access-Control-Allow-Origin: *` with credentials", conf: 0.94, scope: "user" },
                { id: "k_89d", type: "recipe", title: "MCP server CORS: echo origin from allowlist + Vary: Origin", conf: 0.91, scope: "project" },
              ].map((c, i) => (
                <div key={c.id} className="panel" style={{ padding: "10px 12px", background: "var(--bg-elev-1)", borderLeft: `2px solid var(--k-${c.type})` }}>
                  <div className="row" style={{ marginBottom: 4 }}>
                    <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>[{i + 1}]</span>
                    <span className={`chip k-${c.type}`}>{c.type}</span>
                    <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{c.scope}</span>
                    <div className="grow" />
                    <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>conf {c.conf}</span>
                    <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-4)", marginLeft: 6 }}>{c.id}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink)" }}>{c.title}</div>
                </div>
              ))}
            </div>

            <div className="row" style={{ marginTop: 20, gap: 4 }}>
              <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }}><Icon name="check" size={10} /> Helpful</button>
              <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }}><Icon name="x" size={10} /> Not useful</button>
              <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }}><Icon name="branch" size={10} /> Follow-up</button>
              <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }}><Icon name="copy" size={10} /> Copy as skill</button>
              <div className="grow" />
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>reasoning: medium · 2,140 tokens · $0.008</span>
            </div>
          </div>

          {/* Next question input */}
          <div style={{ marginTop: 32 }}>
            <div className="panel" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>→</span>
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Follow up — or ask anything about your Brain…"
                style={{ flex: 1, fontSize: 14, padding: "6px 0" }}
              />
              <div className="row oracle-reasoning-seg" style={{ gap: 4 }}>
                <button className="btn btn-ghost" style={{ height: 24, fontSize: 11 }}>min</button>
                <button className="btn btn-ghost" style={{ height: 24, fontSize: 11 }}>low</button>
                <button className="btn" style={{ height: 24, fontSize: 11 }}>medium</button>
                <button className="btn btn-ghost" style={{ height: 24, fontSize: 11 }}>high</button>
                <button className="btn btn-ghost" style={{ height: 24, fontSize: 11 }}>max</button>
              </div>
              <button className="btn btn-primary" style={{ height: 26 }}><Icon name="arrowR" size={11} /></button>
            </div>
            <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: "wrap" }}>
              {suggestions.map(s => (
                <button key={s} className="chip" style={{ height: 24, padding: "0 10px", fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--ink-2)" }}
                  onClick={() => setQ(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Right panel — retrieval inspector */}
      <aside className="scroll oracle-inspector" style={{ borderLeft: "1px solid var(--line)", background: "var(--bg-elev-1)" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Retrieval inspector</div>
          <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 6 }}>8 items · scored by <span className="mono">0.40·sem + 0.20·success + 0.15·recency + 0.15·ctx + 0.10·conf</span></div>
        </div>

        <div style={{ padding: "12px 14px" }}>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", marginBottom: 8, letterSpacing: "0.06em" }}>TOP MATCHES</div>
          {[
            { id: "k_89d", type: "recipe", title: "MCP server CORS: echo origin from allowlist + Vary: Origin", score: 0.94, sem: 0.91, rec: 0.85, used: true },
            { id: "k_89c", type: "anti", title: "Never use `*` with credentials", score: 0.88, sem: 0.86, rec: 0.82, used: true },
            { id: "k_a33", type: "heuristic", title: "CORS preflight cache: 86400s for stable APIs", score: 0.71, sem: 0.74, rec: 0.55, used: false },
            { id: "k_9e1", type: "recipe", title: "Express CORS middleware vs. manual headers", score: 0.68, sem: 0.72, rec: 0.48, used: false },
            { id: "k_9b7", type: "principle", title: "Security headers before caching headers", score: 0.62, sem: 0.59, rec: 0.67, used: false },
            { id: "k_997", type: "heuristic", title: "Browsers treat mixed-case scheme case-sensitively", score: 0.51, sem: 0.58, rec: 0.41, used: false },
          ].map(r => (
            <div key={r.id} style={{
              padding: "8px 10px", marginBottom: 4, borderRadius: 6,
              background: r.used ? "var(--accent-wash)" : "transparent",
              border: r.used ? "1px solid color-mix(in oklab, var(--accent) 25%, var(--line))" : "1px solid transparent",
            }}>
              <div className="row" style={{ marginBottom: 4 }}>
                <span className={`chip k-${r.type}`} style={{ fontSize: 9, height: 16, padding: "0 5px" }}>{r.type}</span>
                <div className="grow" />
                <span className="mono tab-num" style={{ fontSize: 10.5, color: r.used ? "var(--accent)" : "var(--ink-3)", fontWeight: 600 }}>{r.score.toFixed(2)}</span>
              </div>
              <div style={{ fontSize: 11.5, lineHeight: 1.35, color: "var(--ink-2)" }}>{r.title}</div>
              <div className="row mono" style={{ marginTop: 5, gap: 10, fontSize: 9.5, color: "var(--ink-4)" }}>
                <span>sem {r.sem.toFixed(2)}</span>
                <span>rec {r.rec.toFixed(2)}</span>
                {r.used && <span style={{ color: "var(--accent)" }}>· cited</span>}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

Object.assign(window, { Oracle });
