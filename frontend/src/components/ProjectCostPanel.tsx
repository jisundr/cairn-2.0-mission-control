import type { SessionSummary } from "../api/types";
import { formatCost } from "../lib/format";
import { InfoDot, isUnknownCost } from "./InfoDot";
import { Panel, PanelTitle } from "./Panel";

interface ProjectTotal {
  label: string;
  cost: number | "unknown";
}

// Goal 4's fix: sums each project's **cost**, not tokens, and renders even
// for a single-project install (today's ProjectsPanel.tsx sums tokens and
// is gated `multiProject &&`, hidden entirely below 2 projects). There's
// still no dedicated per-project rollup endpoint, so this sums client-side
// from the already-fetched session rollup - but a project total is only
// ever shown as a real number when *every* contributing session has a
// priced cost; one `null`-cost session marks the whole project "unknown*"
// (with goal 3's info-dot) rather than silently coercing that session's
// cost to zero and understating the total.
function projectTotals(sessions: SessionSummary[]): ProjectTotal[] {
  const sums = new Map<string, number>();
  const unresolved = new Set<string>();
  for (const s of sessions) {
    if (s.cost === null) {
      unresolved.add(s.project);
      continue;
    }
    sums.set(s.project, (sums.get(s.project) ?? 0) + s.cost);
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
  selectedProject: string | undefined;
  onSelectProject: (project: string | undefined) => void;
}

export function ProjectCostPanel({ sessions, selectedProject, onSelectProject }: ProjectCostPanelProps) {
  const totals = projectTotals(sessions);
  const max = Math.max(...totals.map((t) => (t.cost === "unknown" ? 0 : t.cost)), 1);

  return (
    <Panel data-testid="project-cost-panel">
      <PanelTitle>
        Per-project cost
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
        totals.map((t) => {
          const selected = t.label === selectedProject;
          const width = t.cost === "unknown" ? 0 : (t.cost / max) * 100;
          return (
            <div
              key={t.label}
              className={`hbar-row clickable${selected ? " selected" : ""}`}
              onClick={() => onSelectProject(selected ? undefined : t.label)}
              data-testid={`project-row-${t.label}`}
            >
              <div className={selected ? "hbar-sign add" : "hbar-sign"}>{selected ? "+" : " "}</div>
              <div className="hbar-label">{t.label}</div>
              <div className="hbar-track">
                <div className={selected ? "hbar-fill selected" : "hbar-fill"} style={{ width: `${width}%` }} />
              </div>
              <div className="hbar-value">
                {formatCost(t.cost)}
                {isUnknownCost(t.cost) && <InfoDot />}
              </div>
            </div>
          );
        })
      )}
    </Panel>
  );
}
