import { useState } from "react";
import { useProjects, useSessions } from "../api/hooks";
import type { RangeKey } from "../api/types";
import { AppHeader, type AppTab } from "../components/AppHeader";
import { InfoDot, isUnknownCost } from "../components/InfoDot";
import { PanelError } from "../components/PanelError";
import { RangeControl } from "../components/RangeControl";
import { InboxIcon } from "../components/icons";
import { cn } from "../lib/utils";
import { formatCost, formatSessionDuration, formatStarted, shortId } from "../lib/format";

interface SessionsListProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onSelectSession: (sessionId: string) => void;
}

// pages/SessionsList.tsx per sessions-list-{loaded,error,empty}.html - its
// own RangeControl instance (goal 1: Overview and Sessions List each own
// one, not a page-spanning shared control) plus a project-filter pill row.
// No mockup shows the pill row (the loaded demo just lists every project
// unfiltered), but PLAN.md's Commit 4 calls for it - ported from
// token-metering/frontend's SessionsTable.tsx project-filter pills,
// restyled with the same `.segs`/`.seg` idiom RangeControl already uses
// rather than inventing a new pill component.
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
        hostTag={hostTag}
        connected={!projects.isError}
        onRefresh={() => {
          projects.refetch();
          sessions.refetch();
        }}
      />

      <RangeControl value={range} onChange={setRange} />

      {(projects.data?.projects.length ?? 0) > 1 && (
        <div className="segs" data-testid="project-filter" style={{ marginBottom: 14, display: "inline-flex" }}>
          <div className={cn("seg", !projectFilter && "active")} onClick={() => setProjectFilter(undefined)}>
            All projects
          </div>
          {(projects.data?.projects ?? []).map((p) => (
            <div
              key={p.label}
              className={cn("seg", projectFilter === p.label && "active")}
              onClick={() => setProjectFilter(p.label)}
              data-testid={`project-filter-${p.label}`}
            >
              {p.label}
            </div>
          ))}
        </div>
      )}

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
