/* global React, Icon */

function Rail({ route, setRoute, counts }) {
  const items = [
    { id: "dashboard", label: window.t("nav.dashboard"), icon: "dashboard", kbd: "1" },
    { id: "oracle", label: window.t("nav.oracle"), icon: "oracle", kbd: "2" },
    { id: "skills", label: window.t("nav.skills"), icon: "skills", kbd: "3", count: counts.skills },
    { id: "graph", label: window.t("nav.graph"), icon: "graph", kbd: "4" },
    { id: "autoskill", label: window.t("nav.autoskill"), icon: "autoskill", kbd: "5", count: counts.proposals },
    { id: "sessions", label: window.t("nav.sessions"), icon: "sessions", kbd: "6" },
  ];
  return (
    <nav className="rail">
      <div className="rail-brand">
        <div className="rail-brand-mark">B</div>
        <div className="rail-brand-wm">Brain</div>
        <div className="rail-brand-tag">v0.1</div>
      </div>

      <div className="rail-section-label">{window.t("nav.workspace")}</div>
      {items.slice(0, 4).map(it => (
        <div key={it.id} className={`rail-item ${route === it.id ? "active" : ""}`} onClick={() => setRoute(it.id)}>
          <Icon name={it.icon} />
          <span>{it.label}</span>
          {it.count != null ? <span className="count tab-num">{it.count}</span> : <span className="kbd">{it.kbd}</span>}
        </div>
      ))}

      <div className="rail-section-label">{window.t("nav.activity")}</div>
      {items.slice(4).map(it => (
        <div key={it.id} className={`rail-item ${route === it.id ? "active" : ""}`} onClick={() => setRoute(it.id)}>
          <Icon name={it.icon} />
          <span>{it.label}</span>
          {it.count != null ? <span className="count tab-num">{it.count}</span> : <span className="kbd">{it.kbd}</span>}
        </div>
      ))}

      <div className="rail-section-label">{window.t("nav.scopes")}</div>
      <div className="rail-item"><span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)" }} /><span>{window.t("nav.personal")}</span><span className="count tab-num">347</span></div>
      <div className="rail-item"><span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--cool)" }} /><span>{window.t("nav.team")}</span><span className="count tab-num">89</span></div>
      <div className="rail-item"><span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--violet)" }} /><span>{window.t("nav.community")}</span><span className="count tab-num">2.4k</span></div>

      <div className="rail-footer">
        <div className="rail-user">
          <div className="rail-user-avatar">AC</div>
          <div className="rail-user-meta">
            <div>Alex Chen</div>
            <div className="rail-user-tenant">{window.t("app.tenant_personal")}</div>
          </div>
          <Icon name="chevD" size={12} />
        </div>
      </div>
    </nav>
  );
}

function BottomNav({ route, setRoute, counts }) {
  const items = [
    { id: "dashboard", label: window.t("nav.dashboard"), icon: "dashboard" },
    { id: "oracle", label: window.t("nav.oracle"), icon: "oracle" },
    { id: "skills", label: window.t("nav.skills"), icon: "skills" },
    { id: "graph", label: window.t("nav.graph"), icon: "graph" },
    { id: "autoskill", label: window.t("nav.autoskill"), icon: "autoskill", badge: counts.proposals },
  ];
  return (
    <nav className="bottom-nav mobile-only">
      {items.map(it => (
        <button key={it.id}
          className={`bottom-nav-item ${route === it.id ? "active" : ""}`}
          onClick={() => setRoute(it.id)}>
          <div style={{ position: "relative" }}>
            <Icon name={it.icon} size={18} />
            {it.badge ? (
              <span style={{
                position: "absolute", top: -4, right: -6,
                minWidth: 14, height: 14, padding: "0 3px",
                borderRadius: 7, background: "var(--accent)", color: "var(--accent-ink)",
                fontSize: 9, fontWeight: 700, display: "grid", placeItems: "center",
                fontFamily: "var(--font-mono)",
              }}>{it.badge}</span>
            ) : null}
          </div>
          <span style={{ fontSize: 10 }}>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

function Topbar({ route, onCmd }) {
  const crumbsMap = {
    dashboard: [window.t("nav.workspace"), window.t("nav.dashboard")],
    oracle: [window.t("nav.workspace"), window.t("nav.oracle")],
    skills: [window.t("nav.workspace"), window.t("nav.skills")],
    graph: [window.t("nav.workspace"), window.t("nav.graph")],
    autoskill: [window.t("nav.activity"), window.t("nav.autoskill")],
    sessions: [window.t("nav.activity"), window.t("nav.sessions")],
  };
  const crumbs = crumbsMap[route] || [window.t("nav.workspace")];

  return (
    <header className="topbar">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={i === crumbs.length - 1 ? "current" : ""}>{c}</span>
          </React.Fragment>
        ))}
      </div>
      <div className="row topbar-live desktop-only" style={{ gap: 6, marginLeft: 16 }}>
        <span className="live-dot" />
        <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>{window.t("app.ingest_ok")}</span>
      </div>

      <div className="topbar-search" onClick={onCmd}>
        <Icon name="search" size={12} />
        <span style={{ fontSize: 12 }}>{window.t("app.search")}</span>
        <span className="kbd">⌘K</span>
      </div>
      <div className="topbar-actions desktop-only">
        <button className="icon-btn" title={window.t("app.notifications")}><Icon name="notifications" /></button>
        <button className="icon-btn" title={window.t("app.settings")}><Icon name="settings" /></button>
        <button className="btn btn-primary" style={{ marginLeft: 6 }}>
          <Icon name="plus" size={11} /> {window.t("app.teach")}
        </button>
      </div>
      <button className="icon-btn mobile-only"><Icon name="notifications" /></button>
    </header>
  );
}

function CmdK({ open, onClose, go }) {
  if (!open) return null;
  const items = [
    { section: window.t("nav.workspace"), items: [
      { label: window.t("nav.dashboard"), hint: "⌘1", action: () => go("dashboard") },
      { label: window.t("nav.oracle"), hint: "⌘2", action: () => go("oracle") },
      { label: window.t("nav.skills"), hint: "⌘3", action: () => go("skills") },
      { label: window.t("nav.graph"), hint: "⌘4", action: () => go("graph") },
      { label: window.t("nav.autoskill"), hint: "⌘5", action: () => go("autoskill") },
    ]},
    { section: window.t("nav.oracle"), items: [
      { label: "how did I solve the CORS issue last month?", hint: "↵", action: () => go("oracle") },
      { label: "what do I usually use for auth?", hint: "↵", action: () => go("oracle") },
      { label: "show me my React anti-patterns", hint: "↵", action: () => go("oracle") },
    ]},
  ];
  return (
    <div className="cmdk-scrim" onClick={onClose}>
      <div className="cmdk" onClick={e => e.stopPropagation()}>
        <input className="cmdk-input" autoFocus placeholder={window.t("app.search")} />
        <div className="cmdk-list">
          {items.map(sec => (
            <div key={sec.section}>
              <div className="cmdk-section">{sec.section}</div>
              {sec.items.map((it, i) => (
                <div key={i} className="cmdk-item" onClick={() => { it.action(); onClose(); }}>
                  <Icon name={sec.section === window.t("nav.oracle") ? "oracle" : "arrowR"} size={12} />
                  <span>{it.label}</span>
                  <span className="hint">{it.hint}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Rail, Topbar, CmdK, BottomNav });
