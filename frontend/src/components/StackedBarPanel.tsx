import { InfoDot } from "./InfoDot";

export interface StackedBarRow {
  key: string;
  value: number;
  display: string;
  unknown?: boolean;
}

interface StackedBarPanelProps {
  rows: StackedBarRow[];
  emptyText?: string;
  "data-testid"?: string;
  // Optional click-to-filter (F6's ProjectCostPanel restyle is this
  // component's first interactive consumer - By models/tools/agents (O3)
  // stay non-interactive by simply not passing these). The caller owns
  // toggle-off-on-repeat-click logic; this component only reports which
  // row's legend was clicked.
  onSelectRow?: (key: string) => void;
  selectedKey?: string;
  rowTestId?: (row: StackedBarRow) => string;
}

const TIER_COUNT = 3;

// `.stackbar`/`.seg`/`.stack-legend` per the overview-revamp mockups' By
// models/tools/agents/project panels - one proportional segmented bar (each
// segment's width is its row's share of the total `value`) plus a legend
// row per entry (swatch/name/display), on the same ink/ink-soft/ink-faint
// 3-tier monochrome scale the rest of the app already uses for hierarchy
// (`.tier-1`/`.tier-2`/`.tier-3`, cycling past 3 rows rather than adding a
// 4th tier). Which rows/values it's handed (range-wide aggregate vs. a
// single selected day) is a decision each Overview panel (O3/O4) makes,
// not this component's own state.
export function StackedBarPanel({
  rows,
  emptyText = "No data yet.",
  "data-testid": testId,
  onSelectRow,
  selectedKey,
  rowTestId,
}: StackedBarPanelProps) {
  if (rows.length === 0) {
    return (
      <p className="mono" style={{ color: "var(--ink-faint)", fontSize: 11.5 }}>
        {emptyText}
      </p>
    );
  }

  // An all-unresolved-cost row set (every row's `value` forced to 0 by its
  // caller, e.g. ProjectCostPanel's unknown-cost projects) sums to 0 -
  // divide-by-zero-safe: every segment renders at 0% width rather than NaN%,
  // same "no visible bar, but the legend row still shows" the pre-restyle
  // Recharts version rendered for a lone unpriced project.
  const total = rows.reduce((sum, r) => sum + r.value, 0);

  return (
    <div data-testid={testId}>
      <div className="stackbar">
        {rows.map((row, i) => (
          <div
            key={row.key}
            className={`seg tier-${(i % TIER_COUNT) + 1}${row.key === selectedKey ? " selected" : ""}`}
            style={{ width: `${total > 0 ? (row.value / total) * 100 : 0}%` }}
            data-testid={testId ? `${testId}-seg-${row.key}` : undefined}
          />
        ))}
      </div>
      <div className="stack-legend">
        {rows.map((row, i) => (
          <div
            className={`item${onSelectRow ? " clickable" : ""}${row.key === selectedKey ? " selected" : ""}`}
            key={row.key}
            data-testid={rowTestId ? rowTestId(row) : testId ? `${testId}-legend-${row.key}` : undefined}
            onClick={onSelectRow ? () => onSelectRow(row.key) : undefined}
          >
            <span className={`sw tier-${(i % TIER_COUNT) + 1}`} />
            <span className="name">{row.key}</span>
            <span className="val">{row.display}</span>
            {row.unknown && <InfoDot />}
          </div>
        ))}
      </div>
    </div>
  );
}
