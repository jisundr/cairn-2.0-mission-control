import { useEffect, useState } from "react";
import { AppHeader, type AppTab } from "./components/AppHeader";

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
// lands back on the same view instead of resetting to Overview.
export function App() {
  const initialView = parseView(window.location.pathname);
  const [activeTab, setActiveTabState] = useState<AppTab>(initialView.kind === "tab" ? initialView.tab : "sessions");
  const [viewSessionId, setViewSessionId] = useState<string | null>(
    initialView.kind === "session" ? initialView.sessionId : null,
  );
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

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

  function handleRefresh() {
    setLastUpdated(new Date());
  }

  return (
    <div className="shell">
      {!viewSessionId && (
        <AppHeader
          activeTab={activeTab}
          onTabChange={navigateToTab}
          hostTag={window.location.hostname || "localhost"}
          connected
          onRefresh={handleRefresh}
          updatedLabel={lastUpdated ? `updated ${lastUpdated.toLocaleTimeString()}` : null}
        />
      )}

      {viewSessionId ? (
        <div>Session {viewSessionId}</div>
      ) : activeTab === "overview" ? (
        <div>Overview coming up</div>
      ) : (
        <div onClick={() => navigateToSession("placeholder")}>Sessions coming up</div>
      )}
    </div>
  );
}
