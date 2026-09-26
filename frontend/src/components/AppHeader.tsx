// Header block per `overview-loaded.html`'s `header.app` markup - shared by
// every tab-bar screen (Overview, Sessions List). The Session Drilldown
// screen replaces this entirely with its own `.drill-header` (App.tsx never
// mounts this component while a session is open).
export type AppTab = "overview" | "sessions";

interface AppHeaderProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  hostTag: string;
  connected: boolean;
  onRefresh: () => void;
  updatedLabel: string | null;
}

export function AppHeader({ activeTab, onTabChange, hostTag, connected, onRefresh, updatedLabel }: AppHeaderProps) {
  return (
    <header className="app">
      <div className="app-left">
        <span className="wordmark">
          <span className="dim">~/ </span>cairn<span className="sep">/</span>
          <span className="sub">mission-control</span>
        </span>
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
      </div>
      <div className="app-right">
        <span className="host-tag mono">{hostTag}</span>
        <span
          className={connected ? "status-dot" : "status-dot err"}
          title={connected ? "Connected to the local server" : "Can't reach the local server"}
        />
        <button className="icon-btn" title="Refresh now" aria-label="Refresh now" onClick={onRefresh}>
          <RefreshIcon />
        </button>
        {updatedLabel && <span className="updated-at mono">{updatedLabel}</span>}
      </div>
    </header>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  );
}
