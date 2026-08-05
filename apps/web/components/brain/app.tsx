"use client";

import { useEffect, useState } from "react";
import { BottomNav, CmdK, Rail, Topbar, useMe, type Counts } from "./shell";
import { Tweaks } from "./tweaks";
import { Dashboard } from "./dashboard";
import { Oracle } from "./oracle";
import { Skills } from "./skills";
import { Graph } from "./graph";
import { Autoskill } from "./autoskill";
import { Sessions } from "./sessions";
import { Decisions } from "./decisions";
import { Meetings } from "./meetings";
import { LangContext } from "@/lib/brain/i18n";
import { KEY_MAP, useRoute } from "@/lib/brain/routes";
import { useTweaks } from "@/lib/brain/tweaks";
import { useCounts } from "@/lib/brain/use-counts";
import { useJargonTipReveal } from "@/lib/brain/use-jargon-tip";
import { TeachModal } from "./teach";
import { NotificationsPanel } from "./notifications";
import { UserMenu } from "./user-menu";
import { Onboarding } from "./onboarding";
import { LearnedToast } from "./learned-toast";

/** `mcpUrl` is resolved server-side from BRAIN_MCP_PUBLIC_HOSTNAME and passed
 *  down so the onboarding snippet shows the real endpoint. Undefined in local
 *  dev, where Onboarding uses its own local fallback. */
export function BrainApp({ mcpUrl }: { mcpUrl?: string | undefined }) {
  const [route, setRoute] = useRoute();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [tweakOpen, setTweakOpen] = useState(false);
  const [teachOpen, setTeachOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [tweaks, setTweaks] = useTweaks();
  const liveCounts = useCounts();
  const me = useMe();
  useJargonTipReveal();

  const counts: Counts = {
    skills: liveCounts.skills,
    proposals: liveCounts.proposals,
  };

  // UX-newcomer-pass: previous label "ingest queue · 0 pending" leaked
  // worker-queue jargon AND was wrong — `liveCounts.proposals` is the
  // count of pending skill proposals, not the worker queue depth. The
  // new label reads in plain English; zero-state shows "Up to date" so
  // a fresh Brain doesn't look broken with "0 pending".
  const ingestLabel = liveCounts.loaded
    ? liveCounts.proposals === 0
      ? "Up to date"
      : `${liveCounts.proposals} skill ${liveCounts.proposals === 1 ? "proposal" : "proposals"} to review`
    : "Syncing…";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (target as HTMLElement | null)?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((c) => !c);
        return;
      }
      if (e.key === "Escape") {
        setCmdOpen(false);
        setTweakOpen(false);
        setTeachOpen(false);
        setNotifOpen(false);
        setUserOpen(false);
        return;
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !typing) {
        const next = KEY_MAP[e.key];
        if (next) {
          e.preventDefault();
          setRoute(next);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setRoute]);

  const screens = {
    dashboard: <Dashboard go={setRoute} onTeach={() => setTeachOpen(true)} />,
    oracle: <Oracle />,
    skills: <Skills onTeach={() => setTeachOpen(true)} />,
    graph: <Graph />,
    autoskill: <Autoskill />,
    sessions: <Sessions />,
    decisions: <Decisions />,
    meetings: <Meetings />,
  } as const;

  return (
    <LangContext.Provider value={tweaks.language}>
      <div
        className={`app${tweaks.railCollapsed ? " rail-collapsed" : ""}`}
        data-screen-label={route}
      >
        <Rail
          route={route}
          setRoute={setRoute}
          counts={counts}
          me={me}
          onUser={() => setUserOpen((v) => !v)}
          collapsed={tweaks.railCollapsed}
          onToggleCollapse={() => setTweaks({ railCollapsed: !tweaks.railCollapsed })}
        />
        <div className="main">
          <Topbar
            route={route}
            setRoute={setRoute}
            onCmd={() => setCmdOpen(true)}
            onTweaks={() => setTweakOpen((v) => !v)}
            onUser={() => setUserOpen((v) => !v)}
            onTeach={() => setTeachOpen(true)}
            onNotifications={() => setNotifOpen((v) => !v)}
            notificationCount={counts.proposals}
            ingestLive={liveCounts.loaded}
            ingestLabel={ingestLabel}
          />
          <div className="content">{screens[route]}</div>
        </div>
      </div>
      <BottomNav route={route} setRoute={setRoute} counts={counts} me={me} />
      <CmdK open={cmdOpen} onClose={() => setCmdOpen(false)} go={setRoute} />
      <Tweaks open={tweakOpen} state={tweaks} onChange={setTweaks} />
      <TeachModal
        open={teachOpen}
        onClose={() => setTeachOpen(false)}
        onTaught={() => {
          void liveCounts.refresh();
          setTeachOpen(false);
        }}
      />
      <NotificationsPanel
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        onReview={() => {
          setRoute("autoskill");
          setNotifOpen(false);
        }}
      />
      <UserMenu
        open={userOpen}
        onClose={() => setUserOpen(false)}
        onTweaks={() => {
          setUserOpen(false);
          setTweakOpen(true);
        }}
      />
      <Onboarding
        mcpUrl={mcpUrl}
        knowledgeCount={counts.skills}
        ready={liveCounts.loaded}
        onTeach={() => setTeachOpen(true)}
        onOracle={() => setRoute("oracle")}
        onAutoskill={() => setRoute("autoskill")}
      />
      {/* Toast lives at the shell so it can fire on any surface, but is
          suppressed on the dashboard where HomeHero's Card 2 already
          surfaces the same insight (R.4 dedup, audit 2026-05-26). */}
      {route !== "dashboard" && <LearnedToast go={setRoute} />}
    </LangContext.Provider>
  );
}
