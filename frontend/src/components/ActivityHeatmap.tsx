import type { HeatmapRow } from "../api/types";

const DOW_COUNT = 7;
const HOUR_COUNT = 24;

interface Cell {
  calls: number;
  tokens: number;
}

// `.heatmap`/`.cell` per overview-loaded.html and DESIGN.md's Activity
// Heatmap component: a 7-row (day-of-week) x 24-column (hour-of-day) grid,
// not the calendar-week grid token-metering/frontend's ActivityHeatmap.tsx
// drew - this screen's grid answers "when in the week do I use Claude,"
// not "which calendar days had activity." Bucketed from /api/heatmap's raw
// per-call rows using each row's *local* Date fields, same DST-safe
// approach as the reference component.
export function ActivityHeatmap({ calls }: { calls: HeatmapRow[] }) {
  const cells: Cell[][] = Array.from({ length: DOW_COUNT }, () =>
    Array.from({ length: HOUR_COUNT }, () => ({ calls: 0, tokens: 0 })),
  );

  for (const row of calls) {
    const d = new Date(row.timestamp);
    const cell = cells[d.getDay()][d.getHours()];
    cell.calls += 1;
    cell.tokens += row.tokens;
  }

  const max = Math.max(...cells.flat().map((c) => c.tokens), 0);

  return (
    <div className="heatmap" data-testid="activity-heatmap">
      {cells.flatMap((row, dow) =>
        row.map((cell, hour) => {
          const opacity = max === 0 || cell.tokens === 0 ? 0 : Math.max(0.15, cell.tokens / max);
          const style =
            opacity > 0
              ? { background: `color-mix(in srgb, var(--add) ${Math.round(opacity * 100)}%, var(--border-soft))` }
              : undefined;
          const title = cell.calls > 0 ? `${DOW_LABEL[dow]} ${hour}:00 — ${cell.calls} calls` : undefined;
          return <div key={`${dow}-${hour}`} className="cell" style={style} title={title} />;
        }),
      )}
    </div>
  );
}

const DOW_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
