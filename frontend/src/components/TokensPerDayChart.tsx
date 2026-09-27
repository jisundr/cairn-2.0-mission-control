import { useState } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useDayDetail } from "../api/hooks";
import type { Timeseries, TimeseriesPoint } from "../api/types";
import { formatCost, formatDayLabel, formatTokens } from "../lib/format";
import { isUnknownCost } from "./InfoDot";

// `.chart-bars` per overview-loaded.html, rebuilt on Recharts (goal 3) - one
// bar per `Timeseries` point. The most recent bucket keeps the mockup's
// `.bar.today` treatment (a distinct fill), now via a per-point `<Cell>`
// rather than a CSS class. Hovering a bar calls `useDayDetail` (its first
// caller anywhere in this app) for that bucket's per-model breakdown,
// rendered in a custom tooltip so it never clips/overflows the panel like
// the native `title` attribute it replaces did.
export function TokensPerDayChart({ timeseries, project }: { timeseries: Timeseries; project?: string }) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const dayDetail = useDayDetail(hoveredDate, project);
  const points = timeseries.points;

  return (
    <div data-testid="chart-bars" style={{ width: "100%", height: 150 }}>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart
          data={points}
          onMouseMove={(state) => {
            const bucket = typeof state.activeLabel === "string" ? state.activeLabel : undefined;
            setHoveredDate(bucket ? bucketDate(bucket) : null);
          }}
          onMouseLeave={() => setHoveredDate(null)}
        >
          <XAxis
            dataKey="bucket"
            tickFormatter={(value: string) => tickLabel(timeseries.bucket, value)}
            interval={0}
            axisLine={false}
            tickLine={false}
            tick={{ fontFamily: "var(--mono)", fontSize: 10, fill: "var(--ink-faint)" }}
          />
          <YAxis hide domain={[0, "auto"]} />
          <Tooltip
            cursor={{ fill: "var(--panel-sunken)" }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as TimeseriesPoint | undefined;
              if (!active || !point) return null;
              return <DayTooltip point={point} bucketLabel={tickLabel(timeseries.bucket, point.bucket)} dayDetail={dayDetail.data} />;
            }}
          />
          <Bar dataKey="tokens" radius={[2, 2, 0, 0]} maxBarSize={30}>
            {points.map((p, i) => (
              <Cell key={p.bucket} fill={i === points.length - 1 ? "var(--ink-soft)" : "var(--border-soft)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function bucketDate(bucket: string): string {
  // "day" buckets are already "YYYY-MM-DD"; "hour" buckets ("today"'s range)
  // are "YYYY-MM-DDTHH" - useDayDetail's /api/rollup/day-detail wants the
  // plain date either way.
  return bucket.slice(0, 10);
}

function tickLabel(bucket: "hour" | "day", value: string): string {
  return bucket === "hour" ? value.slice(-2) : formatDayLabel(value);
}

function DayTooltip({
  point,
  bucketLabel,
  dayDetail,
}: {
  point: TimeseriesPoint;
  bucketLabel: string;
  dayDetail: { by_model: { key: string; tokens: number; cost: number | null }[] } | undefined;
}) {
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title mono">
        {bucketLabel} · {formatTokens(point.tokens)} tokens
      </div>
      {dayDetail?.by_model.map((row) => (
        <div className="chart-tooltip-row mono" key={row.key}>
          <span>{row.key}</span>
          <span>
            {formatTokens(row.tokens)} · {formatCost(row.cost)}
            {isUnknownCost(row.cost) ? " (unpriced)" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
