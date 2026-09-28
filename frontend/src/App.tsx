import { useEffect, useState } from "react";
import type { AppTab } from "./components/AppHeader";
import { Drilldown } from "./pages/Drilldown";
import { Kanban } from "./pages/Kanban";
import { Overview } from "./pages/Overview";
import { SessionsList } from "./pages/SessionsList";

type DrawerTab = "details" | "docs";
type View =
  | { kind: "tab"; tab: AppTab; task?: string; drawerTab?: DrawerTab }
  | { kind: "session"; sessionId: string };

function pathForView(view: View): string {
  if (view.kind === "session") return `/sessions/${encodeURIComponent(view.sessionId)}`;
  if (view.tab === "sessions") return "/sessions";
  if (view.tab === "kanban") {
    // Drawer URL state (PRD §6.5): `?task=<folder>&tab=details|docs`, shareable
    // and restorable on a hard reload - the query string lives only on the
    // Kanban path, the other tabs' own URLs are untouched by this feature.
    if (view.task) {
      const params = new URLSearchParams({ task: view.task, tab: view.drawerTab ?? "details" });
      return `/kanban?${params.toString()}`;
    }
    return "/kanban";
  }
  return "/";
}

function parseView(pathname: string, search: string): View {
  const sessionMatch = pathname.match(/^\/sessions\/(.+)$/);
  if (sessionMatch) return { kind: "session", sessionId: decodeURIComponent(sessionMatch[1]) };
  if (pathname.startsWith("/kanban")) {
    const params = new URLSearchParams(search);
    const task = params.get("task") ?? undefined;
    const drawerTab: DrawerTab = params.get("tab") === "docs" ? "docs" : "details";
    return { kind: "tab", tab: "kanban", task, drawerTab };
  }
  return { kind: "tab", tab: pathname.startsWith("/sessions") ? "sessions" : "overview" };
}

// Path-based nav, no router library - ported from token-metering/frontend's
// Dashboard.tsx approach, so a hard reload of /sessions or /sessions/<id>
// lands back on the same view instead of resetting to Overview. Each page
// owns its own `.shell` + header (their header props differ too much
// across states - e.g. Overview/Disconnected drops the nav entirely - to
// hoist into one shared wrapper here).
export function App() {
  const initialView = parseView(window.location.pathname, window.location.search);
  const [activeTab, setActiveTabState] = useState<AppTab>(initialView.kind === "tab" ? initialView.tab : "sessions");
  const [viewSessionId, setViewSessionId] = useState<string | null>(
    initialView.kind === "session" ? initialView.sessionId : null,
  );
  const [openTask, setOpenTask] = useState<string | null>(
    initialView.kind === "tab" ? (initialView.task ?? null) : null,
  );
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(
    initialView.kind === "tab" ? (initialView.drawerTab ?? "details") : "details",
  );

  function navigateToTab(tab: AppTab) {
    setActiveTabState(tab);
    setViewSessionId(null);
    setOpenTask(null);
    const path = pathForView({ kind: "tab", tab });
    if (path !== window.location.pathname) window.history.pushState(null, "", path);
  }

  function navigateToSession(sessionId: string) {
    setViewSessionId(sessionId);
    setActiveTabState("sessions");
    const path = pathForView({ kind: "session", sessionId });
    if (path !== window.location.pathname) window.history.pushState(null, "", path);
  }

  // Task drawer URL state (PRD §6.5): `task: null` closes it. Always
  // pushes (not replaces) so the drawer's own open/close/tab-change history
  // is real browser-back-able, matching `navigateToTab`/`navigateToSession`'s
  // own convention.
  function navigateToTask(task: string | null, tab: DrawerTab = "details") {
    setOpenTask(task);
    setDrawerTab(tab);
    setActiveTabState("kanban");
    const path = pathForView({ kind: "tab", tab: "kanban", task: task ?? undefined, drawerTab: tab });
    const current = window.location.pathname + window.location.search;
    if (path !== current) window.history.pushState(null, "", path);
  }

  useEffect(() => {
    // Regression guard (App.test.tsx): every other page (Overview/
    // SessionsList) owns its own query-string state (sort/dir/page/range)
    // that this normalization must not silently drop - only Kanban's own
    // task/tab pair is derived from `view` itself, so only its path is
    // rebuilt from `pathForView` alone; everywhere else keeps the original
    // search string verbatim.
    const view = parseView(window.location.pathname, window.location.search);
    const isKanban = view.kind === "tab" && view.tab === "kanban";
    const path = isKanban ? pathForView(view) : pathForView(view) + window.location.search;
    window.history.replaceState(null, "", path);
  }, []);

  useEffect(() => {
    function onPopState() {
      const view = parseView(window.location.pathname, window.location.search);
      if (view.kind === "session") {
        setViewSessionId(view.sessionId);
        setActiveTabState("sessions");
        setOpenTask(null);
      } else {
        setViewSessionId(null);
        setActiveTabState(view.tab);
        setOpenTask(view.task ?? null);
        setDrawerTab(view.drawerTab ?? "details");
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (viewSessionId) {
    return (
      <Drilldown
        sessionId={viewSessionId}
        activeTab={activeTab}
        onTabChange={navigateToTab}
        onBack={() => navigateToTab("sessions")}
      />
    );
  }

  if (activeTab === "overview") {
    return <Overview activeTab={activeTab} onTabChange={navigateToTab} />;
  }

  if (activeTab === "kanban") {
    return (
      <Kanban
        activeTab={activeTab}
        onTabChange={navigateToTab}
        openTask={openTask}
        drawerTab={drawerTab}
        onOpenTask={navigateToTask}
      />
    );
  }

  return <SessionsList activeTab={activeTab} onTabChange={navigateToTab} onSelectSession={navigateToSession} />;
}
