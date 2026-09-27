export interface StackedBarRow {
  key: string;
  value: number;
  display: string;
}

interface StackedBarPanelProps {
  rows: StackedBarRow[];
  emptyText?: string;
  "data-testid"?: string;
}

const TIER_COUNT = 3;

// `.stackbar`/`.seg`/`.stack-legend` per the overview-revamp mockups' By
// models/tools/agents/project panels - one proportional segmented bar (each
// segment's width is its row's share of the total `value`) plus a legend
// row per entry (swatch/name/display), on the same ink/ink-soft/ink-faint
// 3-tier monochrome scale the rest of the app already uses for hierarchy
// (`.tier-1`/`.tier-2`/`.tier-3`, cycling past 3 rows rather than adding a
// 4th tier). Purely presentational - which rows/values it's handed (range-
// wide aggregate vs. a single selected day) is a decision each Overview
// panel (O3/O4) makes, not this component's own state.
export function StackedBarPanel({ rows, emptyText = "No data yet.", "data-testid": testId }: StackedBarPanelProps) {
  const total = rows.reduce((sum, r) => sum + r.value, 0);

  if (rows.length === 0 || total <= 0) {
    return (
      <p className="mono" style={{ color: "var(--ink-faint)", fontSize: 11.5 }}>
        {emptyText}
      </p>
    );
  }

  return (
    <div data-testid={testId}>
      <div className="stackbar">
        {rows.map((row, i) => (
          <div
            key={row.key}
            className={`seg tier-${(i % TIER_COUNT) + 1}`}
            style={{ width: `${(row.value / total) * 100}%` }}
            data-testid={testId ? `${testId}-seg-${row.key}` : undefined}
          />
        ))}
      </div>
      <div className="stack-legend">
        {rows.map((row, i) => (
          <div className="item" key={row.key} data-testid={testId ? `${testId}-legend-${row.key}` : undefined}>
            <span className={`sw tier-${(i % TIER_COUNT) + 1}`} />
            <span className="name">{row.key}</span>
            <span className="val">{row.display}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
