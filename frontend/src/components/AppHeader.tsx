import { RefreshIcon } from "./icons";

// Header block per `overview-loaded.html`'s `header.app` markup - shared by
// every tab-bar screen (Overview, Sessions List). The Session Drilldown
// screen replaces this entirely with its own `.drill-header` (App.tsx never
// mounts this component while a session is open). `showTabs`/`onRefresh`/
// `updatedLabel` are each independently optional because the mockups don't
// render the same right-hand cluster on every screen: overview-empty.html
// keeps the nav but drops refresh/updated-at; overview-disconnected.html
// drops the nav entirely too; sessions-list-*.html keeps refresh but never
// shows updated-at.
export type AppTab = "overview" | "sessions";

interface AppHeaderProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  hostTag: string;
  connected: boolean;
  showTabs?: boolean;
  onRefresh?: () => void;
  updatedLabel?: string | null;
}

export function AppHeader({
  activeTab,
  onTabChange,
  hostTag,
  connected,
  showTabs = true,
  onRefresh,
  updatedLabel,
}: AppHeaderProps) {
  return (
    <header className="app">
      <div className="app-left">
        <span className="wordmark">
          <span className="dim">~/ </span>cairn<span className="sep">/</span>
          <span className="sub">mission-control</span>
        </span>
        {showTabs && (
          <nav className="app-tabs">
            <a
              href="/"
              className={activeTab === "overview" ? "active" : undefined}
              onClick={(e) => {
                e.preventDefault();
                onTabChange("overview");
              }}
            >
              Overview
            </a>
            <a
              href="/sessions"
              className={activeTab === "sessions" ? "active" : undefined}
              onClick={(e) => {
                e.preventDefault();
                onTabChange("sessions");
              }}
            >
              Sessions
            </a>
          </nav>
        )}
      </div>
      <div className="app-right">
        <span className="host-tag mono">{hostTag}</span>
        <span
          className={connected ? "status-dot" : "status-dot err"}
          title={connected ? "Connected to the local server" : "Can't reach the local server"}
        />
        {onRefresh && (
          <button className="icon-btn" title="Refresh now" aria-label="Refresh now" onClick={onRefresh}>
            <RefreshIcon />
          </button>
        )}
        {updatedLabel && <span className="updated-at mono">{updatedLabel}</span>}
      </div>
    </header>
  );
}
