import type { Timeseries } from "../api/types";
import { formatDayLabel } from "../lib/format";

// `.chart-bars`/`.bar-col`/`.bar`/`.bar-day` per overview-loaded.html - one
// bar per `Timeseries` point, scaled to the tallest point in the current
// page range (driven by the shared RangeControl, replacing this panel's
// former independent range tabs). The most recent bucket gets `.bar.today`
// regardless of range, matching the mockup's "today" bar treatment.
export function TokensPerDayChart({ timeseries }: { timeseries: Timeseries }) {
  const points = timeseries.points;
  const max = Math.max(...points.map((p) => p.tokens), 1);

  return (
    <div className="chart-bars" data-testid="chart-bars">
      {points.map((p, i) => (
        <div className="bar-col" key={p.bucket}>
          <div
            className={i === points.length - 1 ? "bar today" : "bar"}
            style={{ height: `${Math.max(2, Math.round((p.tokens / max) * 100))}%` }}
            title={`${p.bucket}: ${p.tokens.toLocaleString()} tokens`}
          />
          <div className="bar-day mono">{tickLabel(timeseries.bucket, p.bucket)}</div>
        </div>
      ))}
    </div>
  );
}

function tickLabel(bucket: "hour" | "day", value: string): string {
  return bucket === "hour" ? value.slice(-2) : formatDayLabel(value);
}
