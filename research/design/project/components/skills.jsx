/* global React, Icon */
const { useState: useStateS } = React;

function Skills() {
  const [selectedId, setSelectedId] = useStateS(window.BRAIN_DATA.knowledge[2].id);
  const [filter, setFilter] = useStateS("all");
  const items = window.BRAIN_DATA.knowledge;
  const selected = items.find(k => k.id === selectedId) || items[0];

  const types = [
    { k: "all", label: "All", count: items.length },
    { k: "recipe", label: "Recipe", count: items.filter(i => i.type === "recipe").length },
    { k: "heuristic", label: "Heuristic", count: items.filter(i => i.type === "heuristic").length },
    { k: "principle", label: "Principle", count: items.filter(i => i.type === "principle").length },
    { k: "reflex", label: "Reflex", count: items.filter(i => i.type === "reflex").length },
    { k: "anti", label: "Anti-principle", count: items.filter(i => i.type === "anti").length },
  ];

  const filtered = filter === "all" ? items : items.filter(i => i.type === filter);

  return (
    <div className="skills-layout" style={{ height: "100%", display: "grid", gridTemplateColumns: "200px 1fr 1fr", minHeight: 0 }}>
      {/* Filters */}
      <aside className="scroll skills-filters" style={{ borderRight: "1px solid var(--line)", padding: "18px 12px", background: "var(--bg)" }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 8px 8px" }}>Type</div>
        {types.map(t => (
          <div key={t.k}
            onClick={() => setFilter(t.k)}
            className="rail-item"
            style={{ background: filter === t.k ? "var(--bg-elev-2)" : "transparent", color: filter === t.k ? "var(--ink)" : "var(--ink-2)" }}>
            {t.k !== "all" && <span style={{ width: 6, height: 6, borderRadius: 99, background: `var(--k-${t.k})` }} />}
            {t.k === "all" && <span style={{ width: 6 }} />}
            <span>{t.label}</span>
            <span className="count tab-num">{t.count}</span>
          </div>
        ))}

        <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "18px 8px 8px" }}>Scope</div>
        {[
          { k: "global", c: "var(--accent)" }, { k: "user", c: "var(--cool)" },
          { k: "project", c: "var(--violet)" }, { k: "community", c: "var(--ink-3)" }
        ].map(s => (
          <div key={s.k} className="rail-item">
            <span style={{ width: 6, height: 6, borderRadius: 99, background: s.c }} />
            <span style={{ textTransform: "capitalize" }}>{s.k}</span>
          </div>
        ))}

        <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "18px 8px 8px" }}>Stage</div>
        {["inbox", "notes", "knowledge", "wisdom"].map(s => (
          <div key={s} className="rail-item">
            <span style={{ width: 6, height: 6, borderRadius: 99, background: "var(--ink-3)" }} />
            <span style={{ textTransform: "capitalize" }}>{s}</span>
          </div>
        ))}
      </aside>

      {/* List */}
      <section className="skills-list" style={{ borderRight: "1px solid var(--line)", minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div className="row" style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Knowledge</div>
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{filtered.length} items</span>
          <div className="grow" />
          <button className="btn btn-ghost" style={{ height: 24, fontSize: 11 }}><Icon name="filter" size={10} /> Filter</button>
          <button className="btn btn-ghost" style={{ height: 24, fontSize: 11 }}><Icon name="sort" size={10} /> Recency</button>
        </div>
        <div className="scroll" style={{ flex: 1 }}>
          {filtered.map(k => (
            <div key={k.id}
              onClick={() => setSelectedId(k.id)}
              style={{
                padding: "12px 14px",
                borderBottom: "1px solid var(--line-soft)",
                cursor: "pointer",
                background: k.id === selected.id ? "var(--bg-elev-2)" : "transparent",
                borderLeft: k.id === selected.id ? "2px solid var(--accent)" : "2px solid transparent",
              }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <span className={`chip k-${k.type}`}>{k.type === "anti" ? "anti-principle" : k.type}</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>{k.scope}</span>
                <div className="grow" />
                <span className="mono tab-num" style={{ fontSize: 10.5, color: k.confidence >= 0.9 ? "var(--accent)" : "var(--ink-3)" }}>
                  {k.confidence.toFixed(2)}
                </span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.3, marginBottom: 6, letterSpacing: "-0.005em" }}>{k.title}</div>
              <div className="row mono" style={{ gap: 10, fontSize: 10, color: "var(--ink-4)" }}>
                <span>{k.uses} uses</span>
                <span>·</span>
                <span>{(k.success * 100).toFixed(0)}% success</span>
                <span>·</span>
                <span>{k.updated}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Detail */}
      <section className="scroll skills-detail" style={{ minWidth: 0 }}>
        <div style={{ padding: "20px 24px" }}>
          <div className="row" style={{ marginBottom: 14 }}>
            <span className={`chip k-${selected.type}`}>{selected.type === "anti" ? "anti-principle" : selected.type}</span>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{selected.scope}</span>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-4)" }}>{selected.id}</span>
            <div className="grow" />
            <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }}><Icon name="copy" size={10} /></button>
            <button className="btn btn-ghost" style={{ height: 26, fontSize: 11 }}><Icon name="branch" size={10} /> Fork</button>
            <button className="btn" style={{ height: 26, fontSize: 11 }}>Edit</button>
            <button className="icon-btn"><Icon name="more" /></button>
          </div>

          <h2 style={{ fontSize: 19, letterSpacing: "-0.015em", fontWeight: 500, margin: "0 0 12px", lineHeight: 1.3 }}>
            {selected.title}
          </h2>

          <div className="panel" style={{ padding: 16, marginBottom: 18 }}>
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-2)" }}>
              {selected.body}
            </div>
          </div>

          {/* Frontmatter */}
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Frontmatter</div>
          <div className="panel mono" style={{ padding: "12px 14px", fontSize: 11.5, lineHeight: 1.7, marginBottom: 18, color: "var(--ink-2)" }}>
            <div><span style={{ color: "var(--ink-4)" }}>skill_id:</span> {selected.id}</div>
            <div><span style={{ color: "var(--ink-4)" }}>stage:</span> knowledge</div>
            <div><span style={{ color: "var(--ink-4)" }}>scope:</span> {selected.scope}</div>
            <div><span style={{ color: "var(--ink-4)" }}>kind:</span> output</div>
            <div><span style={{ color: "var(--ink-4)" }}>tags:</span> [{selected.tags.map(t => `"${t}"`).join(", ")}]</div>
            <div><span style={{ color: "var(--ink-4)" }}>confidence:</span> <span style={{ color: "var(--accent)" }}>{selected.confidence}</span></div>
            <div><span style={{ color: "var(--ink-4)" }}>mastery:</span> ★★★★☆</div>
            <div><span style={{ color: "var(--ink-4)" }}>updated:</span> 2026-04-{18 + Math.floor(Math.random() * 3)}</div>
          </div>

          {/* Confidence + success */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
            <div className="panel" style={{ padding: 14 }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Outcome history · 12 uses</div>
              <div className="spark">
                {[3, 5, 4, 6, 7, 5, 8, 9, 8, 10, 11, 14].map((v, i) => (
                  <div key={i} className="b" style={{ height: `${v * 2}px`, background: i > 7 ? "var(--accent)" : "var(--ink-4)" }} />
                ))}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>{selected.uses} total</span>
                <div className="grow" />
                <span className="mono" style={{ fontSize: 10, color: "var(--accent)" }}>{(selected.success * 100).toFixed(0)}% accepted</span>
              </div>
            </div>
            <div className="panel" style={{ padding: 14 }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Confidence trail</div>
              <div className="mono" style={{ fontSize: 11, lineHeight: 1.8, color: "var(--ink-2)" }}>
                <div className="row"><span style={{ color: "var(--ink-4)", width: 90 }}>extracted</span><span>0.70 → KEA</span></div>
                <div className="row"><span style={{ color: "var(--ink-4)", width: 90 }}>+ outcome</span><span>0.78 → 3× success</span></div>
                <div className="row"><span style={{ color: "var(--ink-4)", width: 90 }}>+ user-taught</span><span style={{ color: "var(--accent)" }}>{selected.confidence.toFixed(2)} → current</span></div>
              </div>
            </div>
          </div>

          {/* Related */}
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Related · graph</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 18 }}>
            {[
              { t: "depends_on", title: "react-forms-basics", type: "recipe" },
              { t: "specializes", title: "composition-over-inheritance", type: "principle" },
              { t: "contradicts", title: "inline-tailwind-arbitrary", type: "anti" },
            ].map(r => (
              <div key={r.title} className="panel" style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)", width: 90 }}>{r.t}</span>
                <span className={`chip k-${r.type}`}>{r.type}</span>
                <span className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>[[{r.title}]]</span>
                <div className="grow" />
                <Icon name="arrowR" size={11} />
              </div>
            ))}
          </div>

          {/* Export */}
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Export · one-click</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
            {[
              { n: "Claude Code", p: ".claude/skills/", ic: "claude" },
              { n: "Cursor", p: ".cursor/rules/", ic: "cursor" },
              { n: "Windsurf", p: ".windsurfrules", ic: "windsurf" },
              { n: "Markdown", p: "SKILL.md", ic: "file" },
            ].map(x => (
              <div key={x.n} className="panel" style={{ padding: "10px 12px", cursor: "pointer" }}>
                <div className="row" style={{ marginBottom: 4 }}>
                  <Icon name={x.ic} size={12} />
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{x.n}</span>
                </div>
                <div className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>{x.p}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

Object.assign(window, { Skills });
