import { useState } from "react";
import { useProjects, useSessions } from "../api/hooks";
import type { RangeKey } from "../api/types";
import { AppHeader, type AppTab } from "../components/AppHeader";
import { InfoDot, isUnknownCost } from "../components/InfoDot";
import { InstallScopeRow } from "../components/InstallScopeRow";
import { PanelError } from "../components/PanelError";
import { RangeControl } from "../components/RangeControl";
import { InboxIcon } from "../components/icons";
import { formatCost, formatSessionDuration, formatStarted, shortId } from "../lib/format";

interface SessionsListProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onSelectSession: (sessionId: string) => void;
}

// pages/SessionsList.tsx per sessions-list-{loaded,error,empty}.html - its
// own RangeControl instance (goal 1: Overview and Sessions List each own
// one, not a page-spanning shared control), plus (F2) the same
// InstallScopeRow Overview mounts, replacing this page's former ad-hoc
// `.segs` project-filter pill row with the shared install-type row every
// other screen in the revamp uses.
export function SessionsList({ activeTab, onTabChange, onSelectSession }: SessionsListProps) {
  const [range, setRange] = useState<RangeKey>("7d");
  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined);

  const projects = useProjects();
  const hostTag = projects.data?.hostname ?? "localhost";
  const sessions = useSessions({ range, project: projectFilter });

  return (
    <div className="shell">
      <AppHeader
        activeTab={activeTab}
        onTabChange={onTabChange}
        connected={!projects.isError}
        onRefresh={() => {
          projects.refetch();
          sessions.refetch();
        }}
      />

      <RangeControl value={range} onChange={setRange} />

      <InstallScopeRow
        projects={projects.data?.projects ?? []}
        hostTag={hostTag}
        selectedProject={projectFilter}
        onSelectProject={setProjectFilter}
      />

      {sessions.isError ? (
        <div className="panel err" style={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <PanelError message="Couldn't load sessions — request failed" onRetry={() => sessions.refetch()} testId="sessions-error" />
          </div>
        </div>
      ) : sessions.isSuccess && sessions.data.length === 0 ? (
        <div className="panel" style={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }} data-testid="sessions-empty">
            <div className="state-icon">
              <InboxIcon />
            </div>
            <div className="state-title">No sessions in this range</div>
            <div className="state-body">Try a wider range, like 7D or Life.</div>
          </div>
        </div>
      ) : (
        <div className="panel" style={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>
          <div className="panel-title" style={{ marginBottom: 8 }}>
            <span>{sessions.data ? `${sessions.data.length} sessions` : "…"}</span>
          </div>
          <div className="table-wrap">
            <table className="sessions" data-testid="sessions-table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Project</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Tokens</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {(sessions.data ?? []).map((s) => (
                  <tr key={s.session_id} data-testid={`session-row-${s.session_id}`}>
                    <td>
                      <a className="sess" href={`/sessions/${encodeURIComponent(s.session_id)}`} onClick={(e) => {
                        e.preventDefault();
                        onSelectSession(s.session_id);
                      }}>
                        {s.label || shortId(s.session_id)}
                      </a>
                    </td>
                    <td>{s.project}</td>
                    <td>{formatStarted(s.started)}</td>
                    <td>{formatSessionDuration(s.started, s.ended)}</td>
                    <td>{s.tokens.toLocaleString()}</td>
                    <td>
                      {formatCost(s.cost)}
                      {isUnknownCost(s.cost) && <InfoDot />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
