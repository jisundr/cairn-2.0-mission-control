import { useEffect, useState } from "react";
import type { AppTab } from "./components/AppHeader";
import { Overview } from "./pages/Overview";

type View = { kind: "tab"; tab: AppTab } | { kind: "session"; sessionId: string };

function pathForView(view: View): string {
  if (view.kind === "session") return `/sessions/${encodeURIComponent(view.sessionId)}`;
  return view.tab === "sessions" ? "/sessions" : "/";
}

function parseView(pathname: string): View {
  const sessionMatch = pathname.match(/^\/sessions\/(.+)$/);
  if (sessionMatch) return { kind: "session", sessionId: decodeURIComponent(sessionMatch[1]) };
  return { kind: "tab", tab: pathname.startsWith("/sessions") ? "sessions" : "overview" };
}

// Path-based nav, no router library - ported from token-metering/frontend's
// Dashboard.tsx approach, so a hard reload of /sessions or /sessions/<id>
// lands back on the same view instead of resetting to Overview. Each page
// owns its own `.shell` + header (their header props differ too much
// across states - e.g. Overview/Disconnected drops the nav entirely - to
// hoist into one shared wrapper here).
export function App() {
  const initialView = parseView(window.location.pathname);
  const [activeTab, setActiveTabState] = useState<AppTab>(initialView.kind === "tab" ? initialView.tab : "sessions");
  const [viewSessionId, setViewSessionId] = useState<string | null>(
    initialView.kind === "session" ? initialView.sessionId : null,
  );

  function navigateToTab(tab: AppTab) {
    setActiveTabState(tab);
    setViewSessionId(null);
    const path = pathForView({ kind: "tab", tab });
    if (path !== window.location.pathname) window.history.pushState(null, "", path);
  }

  function navigateToSession(sessionId: string) {
    setViewSessionId(sessionId);
    setActiveTabState("sessions");
    const path = pathForView({ kind: "session", sessionId });
    if (path !== window.location.pathname) window.history.pushState(null, "", path);
  }

  useEffect(() => {
    const view = parseView(window.location.pathname);
    window.history.replaceState(null, "", pathForView(view));
  }, []);

  useEffect(() => {
    function onPopState() {
      const view = parseView(window.location.pathname);
      if (view.kind === "session") {
        setViewSessionId(view.sessionId);
        setActiveTabState("sessions");
      } else {
        setViewSessionId(null);
        setActiveTabState(view.tab);
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (viewSessionId) {
    return <div className="shell">Session {viewSessionId}</div>;
  }

  if (activeTab === "overview") {
    return <Overview activeTab={activeTab} onTabChange={navigateToTab} onSelectSession={navigateToSession} />;
  }

  return (
    <div className="shell" onClick={() => navigateToSession("placeholder")}>
      Sessions coming up
    </div>
  );
}
