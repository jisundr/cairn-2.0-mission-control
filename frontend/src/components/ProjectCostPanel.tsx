import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProjectSummary, SessionSummary } from "../api/types";
import { estimateTextWidth } from "../lib/chartText";
import { formatCost } from "../lib/format";
import { ChartInfoMark } from "./ChartInfoMark";
import { InfoDot, isUnknownCost } from "./InfoDot";
import { Panel, PanelTitle } from "./Panel";
import { TruncatedAxisTick } from "./TruncatedAxisTick";

interface ProjectTotal {
  label: string;
  cost: number | "unknown";
}

// Goal 8: a project's own label maps to its ultimate ancestor's label
// (walking `parent` per `/api/projects`, added server-side in C1/C10) -
// e.g. both `engine` and `site` map to `ai-worth-carrying`, their filesystem
// parent, which then carries their sessions' cost in its own row instead of
// each showing as an independent top-level project. A cycle (which
// `discover_projects()` should never itself produce, but this walk doesn't
// assume that) stops after `projects.length` hops rather than looping
// forever, falling back to the project's own label. Also the fallback when
// `projects` is empty or still loading, or a session's `project` isn't in
// it at all (a label `sessions` mentions that the current `/api/projects`
// fetch doesn't, however that might happen) - a session's own label is
// always at least as good a bucket as dropping it.
function buildRootLabels(projects: ProjectSummary[]): Map<string, string> {
  const byLabel = new Map(projects.map((p) => [p.label, p]));
  const maxHops = projects.length;
  const roots = new Map<string, string>();
  for (const project of projects) {
    let current = project;
    let hops = 0;
    while (current.parent !== null && byLabel.has(current.parent) && hops < maxHops) {
      current = byLabel.get(current.parent)!;
      hops += 1;
    }
    roots.set(project.label, current.label);
  }
  return roots;
}

// Goal 4's fix: sums each project's **cost**, not tokens, and renders even
// for a single-project install (today's ProjectsPanel.tsx sums tokens and
// is gated `multiProject &&`, hidden entirely below 2 projects). There's
// still no dedicated per-project rollup endpoint, so this sums client-side
// from the already-fetched session rollup - but a project total is only
// ever shown as a real number when *every* contributing session has a
// priced cost; one `null`-cost session marks the whole project "unknown"
// (with goal 3's info-mark) rather than silently coercing that session's
// cost to zero and understating the total. `rootLabels` (goal 8) buckets
// each session under its root label rather than its own `project`, so a
// root with no sessions of its own but children with sessions still gets a
// row - the bucket exists because a child mapped into it.
function projectTotals(sessions: SessionSummary[], rootLabels: Map<string, string>): ProjectTotal[] {
  const rootLabel = (project: string) => rootLabels.get(project) ?? project;
  const sums = new Map<string, number>();
  const unresolved = new Set<string>();
  for (const s of sessions) {
    const label = rootLabel(s.project);
    if (s.cost === null) {
      unresolved.add(label);
      continue;
    }
    sums.set(label, (sums.get(label) ?? 0) + s.cost);
  }
  const labels = new Set([...sums.keys(), ...unresolved]);
  return [...labels]
    .map((label): ProjectTotal => (unresolved.has(label) ? { label, cost: "unknown" } : { label, cost: sums.get(label) ?? 0 }))
    .sort((a, b) => {
      if (a.cost === "unknown" && b.cost === "unknown") return a.label.localeCompare(b.label);
      if (a.cost === "unknown") return 1;
      if (b.cost === "unknown") return -1;
      return b.cost - a.cost;
    });
}

interface ProjectCostPanelProps {
  sessions: SessionSummary[];
  projects: ProjectSummary[];
  selectedProject: string | undefined;
  onSelectProject: (project: string | undefined) => void;
}

const ROW_HEIGHT = 28;

// `.hbar-row.clickable`/`.hbar-fill.selected` per overview-loaded.html,
// rebuilt on Recharts (goal 5) - same click-to-filter behavior (via a
// custom `Bar` `shape`'s own `onClick`, goal 5's own note that Recharts'
// `BarChart` doesn't give this for free), same `filter-chip` clear-X in
// `PanelTitle`, plus a header-level `InfoDot` explaining both what's
// clickable and that this is a per-project cost, not a percentage.
export function ProjectCostPanel({ sessions, projects, selectedProject, onSelectProject }: ProjectCostPanelProps) {
  const totals = projectTotals(sessions, buildRootLabels(projects));
  const max = Math.max(...totals.map((t) => (t.cost === "unknown" ? 0 : t.cost)), 1);
  const height = totals.length * ROW_HEIGHT;

  return (
    <Panel data-testid="project-cost-panel">
      <PanelTitle>
        Per-project cost
        <InfoDot title="Click a project to filter every panel to it - cost is per-project, not a share of the total" />
        {selectedProject && (
          <span className="filter-chip">
            Filtering: {selectedProject}
            <span className="clear" title="Clear filter" onClick={() => onSelectProject(undefined)}>
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </svg>
            </span>
          </span>
        )}
      </PanelTitle>
      {totals.length === 0 ? (
        <p className="mono" style={{ color: "var(--ink-faint)", fontSize: 11.5 }}>
          No sessions yet.
        </p>
      ) : (
        <div style={{ width: "100%", height }}>
          <ResponsiveContainer width="100%" height={height}>
            <BarChart
              data={totals.map((t) => ({ ...t, value: t.cost === "unknown" ? 0 : t.cost }))}
              layout="vertical"
              margin={{ top: 0, right: 74, bottom: 0, left: 0 }}
              barCategoryGap={6}
            >
              <XAxis type="number" domain={[0, max]} hide />
              <YAxis
                type="category"
                dataKey="label"
                width={130}
                interval={0}
                tickLine={false}
                axisLine={false}
                tick={<TruncatedAxisTick />}
              />
              <Tooltip cursor={{ fill: "var(--panel-sunken)" }} content={<ProjectTooltip />} />
              <Bar
                dataKey="value"
                isAnimationActive={false}
                shape={(props: unknown) => (
                  <ProjectRow
                    {...(props as ProjectRowShapeProps)}
                    selectedProject={selectedProject}
                    onSelectProject={onSelectProject}
                  />
                )}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

interface ProjectRowShapeProps {
  x: number;
  y: number;
  width: number;
  height: number;
  payload: ProjectTotal;
  selectedProject: string | undefined;
  onSelectProject: (project: string | undefined) => void;
}

function ProjectRow({ x, y, width, height, payload: row, selectedProject, onSelectProject }: ProjectRowShapeProps) {
  const selected = row.label === selectedProject;
  const barHeight = Math.max(height - 9, 4);
  const barY = y + (height - barHeight) / 2;
  const cy = y + height / 2;
  const labelX = x + Math.max(width, 0) + 8;
  const display = formatCost(row.cost);

  return (
    <g
      data-testid={`project-row-${row.label}`}
      onClick={() => onSelectProject(selected ? undefined : row.label)}
      style={{ cursor: "pointer" }}
    >
      <rect x={x} y={barY} width={Math.max(width, 1)} height={barHeight} rx={3} fill={selected ? "var(--add)" : "var(--ink-soft)"} />
      <text x={labelX} y={cy} dy={4} fontFamily="var(--mono)" fontSize={12} fontWeight={600} fill="var(--ink)">
        {display}
      </text>
      {isUnknownCost(row.cost) && <ChartInfoMark x={labelX + estimateTextWidth(display) + 6} y={cy} />}
    </g>
  );
}

function ProjectTooltip({ active, payload }: { active?: boolean; payload?: { payload: ProjectTotal }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title mono">{row.label}</div>
      <div className="chart-tooltip-row mono">
        <span>{formatCost(row.cost)}</span>
      </div>
      {isUnknownCost(row.cost) && <div className="chart-tooltip-row mono">Model not yet priced</div>}
    </div>
  );
}
