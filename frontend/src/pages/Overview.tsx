import { useState } from "react";
import {
  useAgentRollup,
  useHeatmap,
  useModelRollup,
  useProjects,
  useSessions,
  useTimeseries,
  useToolRollup,
  useUsageLimitEvents,
} from "../api/hooks";
import type { RangeKey } from "../api/types";
import { ActivityHeatmap } from "../components/ActivityHeatmap";
import { AppHeader, type AppTab } from "../components/AppHeader";
import { HbarList } from "../components/HbarList";
import { InfoDot, isUnknownCost } from "../components/InfoDot";
import { Panel, PanelTitle } from "../components/Panel";
import { PanelError } from "../components/PanelError";
import { ProjectCostPanel } from "../components/ProjectCostPanel";
import { RangeControl } from "../components/RangeControl";
import { StateCard } from "../components/StateCard";
import { StatCard } from "../components/StatCard";
import { AlertTriangleIcon, InboxIcon, RefreshIcon } from "../components/icons";
import { TokensPerDayChart } from "../components/TokensPerDayChart";
import { WarningBanner } from "../components/WarningBanner";
import { formatCost, formatRelativeToNow, formatTokens } from "../lib/format";

const RANGE_LABEL: Record<RangeKey, string> = {
  today: "Today",
  "7d": "7D",
  "30d": "30D",
  month: "Month",
  "6m": "6M",
  life: "Life",
};

interface OverviewProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  onSelectSession: (sessionId: string) => void;
}

export function Overview({ activeTab, onTabChange, onSelectSession }: OverviewProps) {
  const [range, setRange] = useState<RangeKey>("7d");
  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined);

  const projects = useProjects();
  const hostTag = projects.data?.hostname ?? "localhost";
  // Unscoped by range/project - answers "has backfill ever found anything,
  // for anyone" for the empty-state check below, independent of whatever
  // range/filter the page happens to be showing.
  const anyHistory = useSessions({ range: "life" });

  if (projects.isError) {
    return (
      <div className="shell">
        <AppHeader activeTab={activeTab} onTabChange={onTabChange} hostTag={hostTag} connected={false} showTabs={false} />
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
        <AppHeader activeTab={activeTab} onTabChange={onTabChange} hostTag={hostTag} connected showTabs />
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
      range={range}
      onRangeChange={setRange}
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
  range: RangeKey;
  onRangeChange: (range: RangeKey) => void;
  projectFilter: string | undefined;
  onProjectFilterChange: (project: string | undefined) => void;
}

function OverviewLoaded({
  activeTab,
  onTabChange,
  onSelectSession,
  hostTag,
  range,
  onRangeChange,
  projectFilter,
  onProjectFilterChange,
}: OverviewLoadedProps) {
  const todayTimeseries = useTimeseries({ range: "today", project: projectFilter });
  const rangeTimeseries = useTimeseries({ range, project: projectFilter });
  const sessionsFiltered = useSessions({ range, project: projectFilter });
  const sessionsAllProjects = useSessions({ range });
  const toolRollup = useToolRollup({ range, project: projectFilter });
  const agentRollup = useAgentRollup({ range, project: projectFilter });
  const modelRollup = useModelRollup({ range, project: projectFilter });
  const heatmap = useHeatmap({ range, project: projectFilter });
  const usageLimitEvents = useUsageLimitEvents({ range: "7d", project: projectFilter });

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  function handleRefresh() {
    todayTimeseries.refetch();
    rangeTimeseries.refetch();
    sessionsFiltered.refetch();
    sessionsAllProjects.refetch();
    toolRollup.refetch();
    agentRollup.refetch();
    modelRollup.refetch();
    heatmap.refetch();
    usageLimitEvents.refetch();
    setLastUpdated(new Date());
  }

  const todayCost = todayTimeseries.data?.total_cost ?? null;
  const rangeCost = rangeTimeseries.data?.total_cost ?? null;

  return (
    <div className="shell">
      <AppHeader
        activeTab={activeTab}
        onTabChange={onTabChange}
        hostTag={hostTag}
        connected
        onRefresh={handleRefresh}
        updatedLabel={lastUpdated ? `updated ${formatRelativeToNow(lastUpdated.toISOString())}` : null}
      />

      <WarningBanner events={usageLimitEvents.data ?? []} onViewSession={onSelectSession} />

      <RangeControl value={range} onChange={onRangeChange} />

      <div className="stats">
        <StatCard
          data-testid="stat-cost-today"
          label="Cost today"
          value={todayTimeseries.data ? formatCost(todayCost) : "…"}
          faint={isUnknownCost(todayCost)}
          infoDot={isUnknownCost(todayCost) && todayTimeseries.data ? <InfoDot /> : undefined}
        />
        <StatCard
          data-testid="stat-tokens-today"
          label="Tokens today"
          value={todayTimeseries.data ? formatTokens(todayTimeseries.data.total_tokens) : "…"}
        />
        <StatCard
          data-testid="stat-cost-range"
          label={`Cost (${RANGE_LABEL[range]})`}
          value={rangeTimeseries.data ? formatCost(rangeCost) : "…"}
          faint={isUnknownCost(rangeCost)}
          infoDot={isUnknownCost(rangeCost) && rangeTimeseries.data ? <InfoDot /> : undefined}
        />
        <StatCard
          data-testid="stat-sessions-range"
          label={`Sessions (${RANGE_LABEL[range]})`}
          value={sessionsFiltered.data ? String(sessionsFiltered.data.length) : "…"}
        />
      </div>

      <div className="grid">
        <div className="col">
          <Panel err={rangeTimeseries.isError}>
            <PanelTitle err={rangeTimeseries.isError}>Tokens / cost per day</PanelTitle>
            {rangeTimeseries.isError ? (
              <div className="err-inline">
                <PanelError message="Couldn't load — request failed" onRetry={() => rangeTimeseries.refetch()} testId="chart-error" />
              </div>
            ) : rangeTimeseries.data ? (
              <TokensPerDayChart timeseries={rangeTimeseries.data} project={projectFilter} />
            ) : (
              <div className="skel" style={{ height: 150 }} />
            )}
          </Panel>

          <Panel err={heatmap.isError}>
            <PanelTitle err={heatmap.isError}>Activity heatmap</PanelTitle>
            {heatmap.isError ? (
              <div className="err-inline">
                <PanelError message="Couldn't load — request failed" onRetry={() => heatmap.refetch()} testId="heatmap-error" />
              </div>
            ) : heatmap.data ? (
              <ActivityHeatmap calls={heatmap.data} />
            ) : (
              <div className="skel" style={{ height: 90 }} />
            )}
          </Panel>

          <Panel err={toolRollup.isError} style={{ flexGrow: 1, display: "flex", flexDirection: "column" }}>
            <PanelTitle err={toolRollup.isError}>
              By tool
              <InfoDot title="Number of calls that used each tool in the current range" />
            </PanelTitle>
            {toolRollup.isError ? (
              <div className="err-inline">
                <PanelError message="Couldn't load — request failed" onRetry={() => toolRollup.refetch()} testId="by-tool-error" />
              </div>
            ) : (
              <HbarList
                data-testid="tool-rollup"
                rows={(toolRollup.data ?? []).map((r) => ({ label: r.key, value: r.count, display: String(r.count) }))}
                emptyText="No tool calls yet."
              />
            )}
          </Panel>
        </div>

        <div className="col">
          <ProjectCostPanel
            sessions={sessionsAllProjects.data ?? []}
            selectedProject={projectFilter}
            onSelectProject={onProjectFilterChange}
          />

          <Panel err={agentRollup.isError}>
            <PanelTitle err={agentRollup.isError}>
              By agent
              <InfoDot title="Share of tokens in the current range" />
            </PanelTitle>
            {agentRollup.isError ? (
              <div className="err-inline">
                <PanelError message="Couldn't load — request failed" onRetry={() => agentRollup.refetch()} testId="by-agent-error" />
              </div>
            ) : (
              <HbarList
                data-testid="agent-rollup"
                rows={agentRollupPercentRows(agentRollup.data ?? [])}
                emptyText="No agent activity yet."
              />
            )}
          </Panel>

          <Panel err={modelRollup.isError}>
            <PanelTitle err={modelRollup.isError}>
              By model
              <InfoDot title="Share of tokens in the current range" />
            </PanelTitle>
            {modelRollup.isError ? (
              <div className="err-inline">
                <PanelError message="Couldn't load — request failed" onRetry={() => modelRollup.refetch()} testId="by-model-error" />
              </div>
            ) : (
              <HbarList
                data-testid="model-rollup"
                rows={(modelRollup.data ?? []).map((r) => ({
                  label: r.key,
                  value: r.tokens,
                  display: formatCost(r.cost),
                  unknown: isUnknownCost(r.cost),
                }))}
                emptyText="No model usage yet."
              />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function agentRollupPercentRows(rows: { key: string; tokens: number }[]) {
  const total = rows.reduce((sum, r) => sum + r.tokens, 0);
  return rows.map((r) => ({
    label: r.key,
    value: r.tokens,
    display: total > 0 ? `${Math.round((r.tokens / total) * 100)}%` : "0%",
  }));
}
