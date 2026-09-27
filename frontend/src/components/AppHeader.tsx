import { useState } from "react";
import { RefreshIcon } from "./icons";

// Header block per `overview-loaded.html`'s `header.app` markup - shared by
// every tab-bar screen (Overview, Sessions List). The Session Drilldown
// screen replaces this entirely with its own `.drill-header` (App.tsx never
// mounts this component while a session is open). `showTabs`/`onRefresh`/
// `updatedLabel` are each independently optional because the mockups don't
// render the same right-hand cluster on every screen: overview-empty.html
// keeps the nav but drops refresh/updated-at; overview-disconnected.html
// drops the nav entirely too; sessions-list-*.html keeps refresh but never
// shows updated-at. The hostname (F2) moved out of here onto its own
// `InstallScopeRow` - this header no longer takes or renders it.
//
// F3: below design.css's existing 900px breakpoint, `nav.app-tabs` and the
// wordmark's " mission-control" suffix hide and a `.dropdown-btn.nav-
// dropdown` (labeled with the active tab) takes over navigating between
// the same two tabs - CSS-only for which one is visible, both always
// rendered so no JS breakpoint check duplicates that logic.
export type AppTab = "overview" | "sessions";

const OTHER_TAB: Record<AppTab, AppTab> = { overview: "sessions", sessions: "overview" };
const TAB_LABEL: Record<AppTab, string> = { overview: "Overview", sessions: "Sessions" };

interface AppHeaderProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  connected: boolean;
  showTabs?: boolean;
  onRefresh?: () => void;
  updatedLabel?: string | null;
}

export function AppHeader({
  activeTab,
  onTabChange,
  connected,
  showTabs = true,
  onRefresh,
  updatedLabel,
}: AppHeaderProps) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <header className="app">
      <div className="app-left">
        <span className="wordmark">
          <span className="dim">~/ </span>cairn<span className="sep">/</span>
          <span className="sub">mission-control</span>
        </span>
        {showTabs && (
          <>
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
            <div className="dropdown-wrap">
              <button
                type="button"
                className="dropdown-btn nav-dropdown"
                data-testid="nav-dropdown"
                onClick={() => setNavOpen((o) => !o)}
              >
                {TAB_LABEL[activeTab]}
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {navOpen && (
                <div className="dropdown-menu" data-testid="nav-dropdown-menu">
                  <div
                    className="dropdown-item"
                    data-testid={`nav-dropdown-option-${OTHER_TAB[activeTab]}`}
                    onClick={() => {
                      onTabChange(OTHER_TAB[activeTab]);
                      setNavOpen(false);
                    }}
                  >
                    {TAB_LABEL[OTHER_TAB[activeTab]]}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <div className="app-right">
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
