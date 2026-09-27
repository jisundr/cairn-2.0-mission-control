import { useEffect, useState } from "react";
import {
  useAgentRollup,
  useDayDetail,
  useModelRollup,
  useProjects,
  useSessions,
  useTimeseries,
  useToolRollup,
  useUsageLimitEvents,
} from "../api/hooks";
import type { CountRollupRow, GroupRollupRow, ProjectSummary, RangeKey, SessionSummary } from "../api/types";
import { AppHeader, type AppTab } from "../components/AppHeader";
import { ContributionCalendar } from "../components/ContributionCalendar";
import { isUnknownCost } from "../components/InfoDot";
import { InstallScopeRow } from "../components/InstallScopeRow";
import { Panel, PanelTitle } from "../components/Panel";
import { PanelError } from "../components/PanelError";
import { ProjectCostPanel } from "../components/ProjectCostPanel";
import { StackedBarPanel, type StackedBarRow } from "../components/StackedBarPanel";
import { StateCard } from "../components/StateCard";
import { AlertTriangleIcon, InboxIcon, RefreshIcon } from "../components/icons";
import { TokensPerDayChart } from "../components/TokensPerDayChart";
import { WarningBanner } from "../components/WarningBanner";
import { formatCost, formatRelativeToNow, formatTokens } from "../lib/format";
import { cn } from "../lib/utils";

// A view's own fixed window, not a user-facing range option - Trend keeps
// the day-by-day bar chart over the last 30 days ("30d"); Calendar's
// GitHub-style grid covers the last 13 weeks ("13w", added server-side in
// B1). Neither is offered in a shared RangeControl - this toggle replaces
// it entirely (goal: Trend/Calendar, not Today/7D/30D/Month/6M/Life).
type OverviewView = "trend" | "calendar";

const VIEW_RANGE: Record<OverviewView, RangeKey> = { trend: "30d", calendar: "13w" };
const VIEW_LABEL: Record<OverviewView, string> = { trend: "Last 30 days", calendar: "Last 13 weeks" };

// O2: a session "falls on" a selected day if its [started, ended) window
// overlaps that UTC calendar day at all - a session spanning midnight
// counts on both days it touches, rather than only the day it started.
// ISO8601 timestamps (all `Z`-suffixed, same format) compare correctly as
// plain strings, so this needs no Date parsing.
function sessionOverlapsDate(session: SessionSummary, date: string): boolean {
  const dayStart = `${date}T00:00:00Z`;
  const dayEnd = `${date}T23:59:59.999Z`;
  return session.started <= dayEnd && session.ended >= dayStart;
}

// O3: By models/By agents rows carry exact cost+tokens (both group rollups
// sum priced `calls` rows); By tools carries a call-count share only - see
// PLAN.md's Summary and B2's day_detail() docstring for why per-tool cost
// isn't attributable from the real schema.
function costTokenRows(rows: GroupRollupRow[]): StackedBarRow[] {
  return rows.map((r) => ({
    key: r.key,
    value: r.tokens,
    display: `${formatCost(r.cost)} (${formatTokens(r.tokens)})`,
    unknown: isUnknownCost(r.cost),
  }));
}

function callCountRows(rows: CountRollupRow[]): StackedBarRow[] {
  return rows.map((r) => ({ key: r.key, value: r.count, display: `${r.count} call${r.count === 1 ? "" : "s"}` }));
}

interface OverviewProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onSelectSession: (sessionId: string) => void;
}

export function Overview({ activeTab, onTabChange, onSelectSession }: OverviewProps) {
  const [view, setView] = useState<OverviewView>("trend");
  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined);

  const projects = useProjects();
  const hostTag = projects.data?.hostname ?? "localhost";
  // Unscoped by range/project - answers "has backfill ever found anything,
  // for anyone" for the empty-state check below, independent of whatever
  // view/filter the page happens to be showing.
  const anyHistory = useSessions({ range: "life" });

  if (projects.isError) {
    return (
      <div className="shell">
        <AppHeader activeTab={activeTab} onTabChange={onTabChange} connected={false} showTabs={false} />
        <StateCard
          err
          data-testid="overview-disconnected"
          icon={<AlertTriangleIcon />}
          title="Can't reach the local server"
          body="The mission control server isn't responding. Your session data is safe — the Stop hook keeps capturing locally regardless."
        >
          <button className="btn-err" style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px" }} onClick={() => projects.refetch()}>
            <RefreshIcon size={13} />
            Retry connection
          </button>
        </StateCard>
      </div>
    );
  }

  if (anyHistory.isSuccess && anyHistory.data.length === 0) {
    return (
      <div className="shell">
        <AppHeader activeTab={activeTab} onTabChange={onTabChange} connected showTabs />
        <StateCard
          data-testid="overview-empty"
          icon={<InboxIcon />}
          title="No sessions captured yet"
          body="Backfill scanned every known project's transcript history and found nothing yet. Cairn captures a session automatically each time one ends."
        >
          <div className="state-steps">
            <div className="state-step">
              <span className="n">1</span>Work a Claude Code session in any cairn-installed project
            </div>
            <div className="state-step">
              <span className="n">2</span>Let the session end (Stop hook fires)
            </div>
            <div className="state-step">
              <span className="n">3</span>Come back and refresh
            </div>
          </div>
        </StateCard>
      </div>
    );
  }

  return (
    <OverviewLoaded
      activeTab={activeTab}
      onTabChange={onTabChange}
      onSelectSession={onSelectSession}
      hostTag={hostTag}
      projects={projects.data?.projects ?? []}
      view={view}
      onViewChange={setView}
      projectFilter={projectFilter}
      onProjectFilterChange={setProjectFilter}
    />
  );
}

interface OverviewLoadedProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onSelectSession: (sessionId: string) => void;
  hostTag: string;
  projects: ProjectSummary[];
  view: OverviewView;
  onViewChange: (view: OverviewView) => void;
  projectFilter: string | undefined;
  onProjectFilterChange: (project: string | undefined) => void;
}

function OverviewLoaded({
  activeTab,
  onTabChange,
  onSelectSession,
  hostTag,
  projects,
  view,
  onViewChange,
  projectFilter,
  onProjectFilterChange,
}: OverviewLoadedProps) {
  const range = VIEW_RANGE[view];
  const timeseries = useTimeseries({ range, project: projectFilter });
  const sessionsFiltered = useSessions({ range, project: projectFilter });
  const sessionsAllProjects = useSessions({ range });
  const toolRollup = useToolRollup({ range, project: projectFilter });
  const agentRollup = useAgentRollup({ range, project: projectFilter });
  const modelRollup = useModelRollup({ range, project: projectFilter });
  const usageLimitEvents = useUsageLimitEvents({ range: "7d", project: projectFilter });

  // O2: click-to-drill-into-a-day. Reset whenever the view or project
  // filter changes - a selected date from a 30-day Trend window has no
  // meaning once the window itself changes shape (13w) or scope.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  useEffect(() => {
    setSelectedDate(null);
  }, [view, projectFilter]);
  const dayDetail = useDayDetail(selectedDate, projectFilter);

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  function handleRefresh() {
    timeseries.refetch();
    sessionsFiltered.refetch();
    sessionsAllProjects.refetch();
    toolRollup.refetch();
    agentRollup.refetch();
    modelRollup.refetch();
    usageLimitEvents.refetch();
    if (selectedDate) dayDetail.refetch();
    setLastUpdated(new Date());
  }

  const totalCost = selectedDate ? dayDetail.data?.total_cost ?? null : timeseries.data?.total_cost ?? null;
  const totalTokens = selectedDate ? dayDetail.data?.total_tokens ?? null : timeseries.data?.total_tokens ?? null;
  const totalsLoaded = selectedDate ? Boolean(dayDetail.data) : Boolean(timeseries.data);
  const sessionCount = selectedDate
    ? sessionsFiltered.data?.filter((s) => sessionOverlapsDate(s, selectedDate)).length ?? null
    : sessionsFiltered.data?.length ?? null;
  const breakdownLabel = selectedDate ? `${selectedDate} · ${VIEW_LABEL[view]}` : VIEW_LABEL[view];

  // O3: By models/tools/agents - aggregate (the active range's own rollup)
  // vs. day-selected (B2's day_detail() breakdown), same source split
  // Breakdown above uses.
  const byModelsRows = costTokenRows(selectedDate ? dayDetail.data?.by_model ?? [] : modelRollup.data ?? []);
  const byModelsError = selectedDate ? dayDetail.isError : modelRollup.isError;
  const byToolsRows = callCountRows(selectedDate ? dayDetail.data?.by_tool ?? [] : toolRollup.data ?? []);
  const byToolsError = selectedDate ? dayDetail.isError : toolRollup.isError;
  const byAgentsRows = costTokenRows(selectedDate ? dayDetail.data?.by_agent ?? [] : agentRollup.data ?? []);
  const byAgentsError = selectedDate ? dayDetail.isError : agentRollup.isError;
  const byPanelsLabel = selectedDate ? selectedDate : VIEW_LABEL[view];

  // O4: By project - only on a multi-project ("system") install, same
  // `projects.length > 1` signal SessionsList.tsx already uses. Reuses
  // sessionsAllProjects (Overview's own existing unfiltered fetch) rather
  // than a new call; day-selected filters that same array for date
  // overlap before handing it to ProjectCostPanel (F6) - its own
  // projectTotals()/buildRootLabels() math is unchanged either way.
  const multiProject = projects.length > 1;
  const byProjectSessions = selectedDate
    ? (sessionsAllProjects.data ?? []).filter((s) => sessionOverlapsDate(s, selectedDate))
    : sessionsAllProjects.data ?? [];

  return (
    <div className="shell">
      <AppHeader
        activeTab={activeTab}
        onTabChange={onTabChange}
        connected
        onRefresh={handleRefresh}
        updatedLabel={lastUpdated ? `updated ${formatRelativeToNow(lastUpdated.toISOString())}` : null}
      />

      <WarningBanner events={usageLimitEvents.data ?? []} onViewSession={onSelectSession} />

      <div className="range-row" data-testid="view-toggle">
        <div className="segs">
          <div className={cn("seg", view === "trend" && "active")} data-testid="view-seg-trend" onClick={() => onViewChange("trend")}>
            Trend
          </div>
          <div className={cn("seg", view === "calendar" && "active")} data-testid="view-seg-calendar" onClick={() => onViewChange("calendar")}>
            Calendar
          </div>
        </div>
      </div>

      <InstallScopeRow
        projects={projects}
        hostTag={hostTag}
        selectedProject={projectFilter}
        onSelectProject={onProjectFilterChange}
      />

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Panel err={timeseries.isError} style={{ display: "flex", flexDirection: "column" }}>
          <div className="trend-panel-head">
            <PanelTitle err={timeseries.isError} style={{ margin: 0 }}>
              {view === "trend" ? "Token trends" : "Daily activity"}
            </PanelTitle>
            <span className="host-name" style={{ fontWeight: 500, color: "var(--ink-faint)" }}>
              {VIEW_LABEL[view]}
            </span>
          </div>
          {timeseries.isError ? (
            <div className="err-inline">
              <PanelError message="Couldn't load — request failed" onRetry={() => timeseries.refetch()} testId="chart-error" />
            </div>
          ) : timeseries.data ? (
            view === "trend" ? (
              <TokensPerDayChart
                timeseries={timeseries.data}
                project={projectFilter}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
              />
            ) : (
              <ContributionCalendar points={timeseries.data.points} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
            )
          ) : (
            <div className="skel" style={{ height: 150 }} />
          )}
        </Panel>

        <Panel style={{ display: "flex", flexDirection: "column" }}>
          <div className="trend-panel-head">
            <PanelTitle style={{ margin: 0 }}>Breakdown</PanelTitle>
            <span className="host-name" style={{ fontWeight: 500, color: "var(--ink-faint)" }}>
              {breakdownLabel}
            </span>
          </div>
          <div className="kv-list" data-testid="breakdown">
            <div className="kv-row" data-testid="breakdown-cost">
              <span className="name">Cost</span>
              <span className="val">{totalsLoaded ? formatCost(totalCost) : "…"}</span>
            </div>
            <div className="kv-row" data-testid="breakdown-tokens">
              <span className="name">Tokens</span>
              <span className="val">{totalsLoaded && totalTokens !== null ? formatTokens(totalTokens) : "…"}</span>
            </div>
            <div className="kv-row" data-testid="breakdown-sessions">
              <span className="name">Sessions</span>
              <span className="val">{sessionCount !== null ? sessionCount : "…"}</span>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-3">
        {multiProject && (
          <ProjectCostPanel
            sessions={byProjectSessions}
            projects={projects}
            selectedProject={projectFilter}
            onSelectProject={onProjectFilterChange}
          />
        )}

        <Panel err={byModelsError}>
          <div className="trend-panel-head">
            <PanelTitle err={byModelsError} style={{ margin: 0 }}>
              By models
            </PanelTitle>
            <span className="host-name" style={{ fontWeight: 500, color: "var(--ink-faint)" }}>
              {byPanelsLabel}
            </span>
          </div>
          {byModelsError ? (
            <div className="err-inline">
              <PanelError message="Couldn't load — request failed" onRetry={() => (selectedDate ? dayDetail.refetch() : modelRollup.refetch())} testId="by-models-error" />
            </div>
          ) : (
            <StackedBarPanel data-testid="by-models" rows={byModelsRows} emptyText="No model usage yet." />
          )}
        </Panel>

        <Panel err={byToolsError}>
          <div className="trend-panel-head">
            <PanelTitle err={byToolsError} style={{ margin: 0 }}>
              By tools
            </PanelTitle>
            <span className="host-name" style={{ fontWeight: 500, color: "var(--ink-faint)" }}>
              {byPanelsLabel}
            </span>
          </div>
          {byToolsError ? (
            <div className="err-inline">
              <PanelError message="Couldn't load — request failed" onRetry={() => (selectedDate ? dayDetail.refetch() : toolRollup.refetch())} testId="by-tools-error" />
            </div>
          ) : (
            <StackedBarPanel data-testid="by-tools" rows={byToolsRows} emptyText="No tool calls yet." />
          )}
        </Panel>

        <Panel err={byAgentsError}>
          <div className="trend-panel-head">
            <PanelTitle err={byAgentsError} style={{ margin: 0 }}>
              By agents
            </PanelTitle>
            <span className="host-name" style={{ fontWeight: 500, color: "var(--ink-faint)" }}>
              {byPanelsLabel}
            </span>
          </div>
          {byAgentsError ? (
            <div className="err-inline">
              <PanelError message="Couldn't load — request failed" onRetry={() => (selectedDate ? dayDetail.refetch() : agentRollup.refetch())} testId="by-agents-error" />
            </div>
          ) : (
            <StackedBarPanel data-testid="by-agents" rows={byAgentsRows} emptyText="No agent activity yet." />
          )}
        </Panel>
      </div>
    </div>
  );
}
