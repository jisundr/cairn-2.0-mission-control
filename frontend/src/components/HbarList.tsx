import { useState } from "react";

export interface HbarRow {
  label: string;
  value: number;
  display: string;
  scope?: string;
  unknown?: boolean;
}

interface HbarListProps {
  rows: HbarRow[];
  emptyText?: string;
  maxRows?: number;
  "data-testid"?: string;
}

const DEFAULT_MAX_ROWS = 3;

// `.hbar-row`/`.hbar-track`/`.hbar-fill` per overview-loaded.html - the
// non-clickable ranked-list variant (By tool/By agent/By model): no sign
// column, no selection state (design.css's "reserved for rows that
// actually filter something" rule). Overflow past `maxRows` collapses
// behind a `.btn-block` "Show all N →" button, matching the By-agent panel.
export function HbarList({ rows, emptyText = "No data yet.", maxRows = DEFAULT_MAX_ROWS, "data-testid": testId }: HbarListProps) {
  const [expanded, setExpanded] = useState(false);

  if (rows.length === 0) {
    return <p className="mono" style={{ color: "var(--ink-faint)", fontSize: 11.5 }}>{emptyText}</p>;
  }

  const visible = expanded ? rows : rows.slice(0, maxRows);
  const hiddenCount = rows.length - visible.length;
  const max = Math.max(...visible.map((r) => r.value), 1);

  return (
    <div data-testid={testId}>
      {visible.map((row) => (
        <div className="hbar-row" key={row.label}>
          <div className="hbar-label">
            {row.label}
            {row.scope && <span className="hbar-scope"> · {row.scope}</span>}
          </div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
          <div className="hbar-value">{row.display}</div>
        </div>
      ))}
      {hiddenCount > 0 && (
        <button className="btn-block" onClick={() => setExpanded(true)} data-testid={testId ? `${testId}-show-all` : undefined}>
          Show all {rows.length} →
        </button>
      )}
    </div>
  );
}
