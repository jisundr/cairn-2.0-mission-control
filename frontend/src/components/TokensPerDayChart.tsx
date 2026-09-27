import { useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useDayDetail } from "../api/hooks";
import type { Timeseries, TimeseriesPoint } from "../api/types";
import { formatCost, formatDayLabel, formatTokens } from "../lib/format";
import { isUnknownCost } from "./InfoDot";

interface TokensPerDayChartProps {
  timeseries: Timeseries;
  project?: string;
  // O2: click-to-drill-into-a-day. Both optional - a caller that never
  // passes them (none currently do) gets the plain hover-tooltip chart
  // this component always was, no click behavior added.
  selectedDate?: string | null;
  onSelectDate?: (date: string | null) => void;
}

// `.chart-bars` per overview-loaded.html, rebuilt on Recharts (goal 3) - one
// bar per `Timeseries` point, drawn via a custom `Bar` `shape` (`DayBar`
// below) rather than Recharts' deprecated `<Cell>` - the same convention
// HbarList/ProjectCostPanel/ActivityHeatmap already use for a clickable or
// test-id-bearing bar/cell, and the only way to get a click handler + a
// discoverable `data-testid` onto the actual rendered element (`<Cell>`
// doesn't forward either). The most recent bucket keeps the mockup's
// `.bar.today` treatment; a selected bucket (O2) gets `--add` instead.
// Hovering a bar calls `useDayDetail` (its first caller anywhere in this
// app) for that bucket's per-model breakdown, rendered in a custom tooltip.
// Clicking a bar reports its date via `onSelectDate`, toggling off on a
// repeat click of the already-selected bar.
export function TokensPerDayChart({ timeseries, project, selectedDate, onSelectDate }: TokensPerDayChartProps) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const dayDetail = useDayDetail(hoveredDate, project);
  const points = timeseries.points;
  const lastBucket = points[points.length - 1]?.bucket;

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
          <Bar
            dataKey="tokens"
            isAnimationActive={false}
            maxBarSize={30}
            shape={(props: unknown) => (
              <DayBar {...(props as DayBarShapeProps)} lastBucket={lastBucket} selectedDate={selectedDate} onSelectDate={onSelectDate} />
            )}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface DayBarShapeProps {
  x: number;
  y: number;
  width: number;
  height: number;
  payload: TimeseriesPoint;
  lastBucket: string | undefined;
  selectedDate: string | null | undefined;
  onSelectDate: ((date: string | null) => void) | undefined;
}

function DayBar({ x, y, width, height, payload: point, lastBucket, selectedDate, onSelectDate }: DayBarShapeProps) {
  const date = bucketDate(point.bucket);
  const selected = date === selectedDate;
  const fill = selected ? "var(--add)" : point.bucket === lastBucket ? "var(--ink-soft)" : "var(--border-soft)";

  return (
    <rect
      x={x}
      y={y}
      width={Math.max(width, 1)}
      height={Math.max(height, 0)}
      rx={2}
      fill={fill}
      style={{ cursor: onSelectDate ? "pointer" : undefined }}
      data-testid={`chart-bar-${date}`}
      onClick={onSelectDate ? () => onSelectDate(selected ? null : date) : undefined}
    />
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
