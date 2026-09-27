import { useEffect, useState } from "react";
import { ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import type { HeatmapRow } from "../api/types";

const DOW_COUNT = 7;
const HOUR_COUNT = 24;
const DOW_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CellAgg {
  calls: number;
  tokens: number;
}

interface HeatPoint extends CellAgg {
  dow: number;
  hour: number;
}

// `.heatmap`/`.cell` per overview-loaded.html, rebuilt on Recharts (goal 4)
// for a uniform charting library with TokensPerDayChart - a `ScatterChart`
// with custom square `Cell` shapes standing in for Recharts' lack of a
// native heatmap type. Client-side bucketing into a 7 (day-of-week) x 24
// (hour-of-day) grid is unchanged from the CSS-grid version; only the
// render swaps. Axis ticks (day-of-week, hour) and a `.chart-tooltip`
// (shared with TokensPerDayChart) make a cell's meaning discoverable on
// hover, replacing the sole-source-of-meaning native `title` this rebuild
// deletes.
export function ActivityHeatmap({ calls }: { calls: HeatmapRow[] }) {
  const cells: CellAgg[][] = Array.from({ length: DOW_COUNT }, () =>
    Array.from({ length: HOUR_COUNT }, () => ({ calls: 0, tokens: 0 })),
  );

  for (const row of calls) {
    const d = new Date(row.timestamp);
    const cell = cells[d.getDay()][d.getHours()];
    cell.calls += 1;
    cell.tokens += row.tokens;
  }

  const points: HeatPoint[] = cells.flatMap((row, dow) => row.map((cell, hour) => ({ dow, hour, ...cell })));
  const max = Math.max(...points.map((p) => p.tokens), 0);
  const colors = useHeatColors();

  return (
    <div data-testid="activity-heatmap" style={{ width: "100%", height: 170 }}>
      <ResponsiveContainer width="100%" height={170}>
        <ScatterChart margin={{ top: 4, right: 10, bottom: 0, left: 0 }}>
          <XAxis
            type="number"
            dataKey="hour"
            domain={[0, 23]}
            ticks={[0, 6, 12, 18]}
            tickFormatter={(h: number) => `${h}:00`}
            axisLine={false}
            tickLine={false}
            tick={{ fontFamily: "var(--mono)", fontSize: 10, fill: "var(--ink-faint)" }}
          />
          <YAxis
            type="number"
            dataKey="dow"
            domain={[0, 6]}
            ticks={[0, 1, 2, 3, 4, 5, 6]}
            tickFormatter={(d: number) => DOW_LABEL[d]}
            reversed
            axisLine={false}
            tickLine={false}
            width={34}
            tick={{ fontFamily: "var(--mono)", fontSize: 10, fill: "var(--ink-faint)" }}
          />
          <Tooltip
            cursor={false}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as HeatPoint | undefined;
              if (!active || !point || point.calls === 0) return null;
              return (
                <div className="chart-tooltip">
                  {DOW_LABEL[point.dow]} {point.hour}:00 — {point.calls} calls, {point.tokens.toLocaleString()} tokens
                </div>
              );
            }}
          />
          <Scatter
            data={points}
            shape={(props: unknown) => <HeatCell {...(props as HeatCellProps)} max={max} colors={colors} />}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

interface HeatCellProps {
  cx: number;
  cy: number;
  payload: HeatPoint;
  max: number;
  colors: { add: string; border: string };
}

const CELL_SIZE = 13;

function HeatCell({ cx, cy, payload, max, colors }: HeatCellProps) {
  const opacity = max === 0 || payload.tokens === 0 ? 0 : Math.max(0.15, payload.tokens / max);
  const fill = mixHex(colors.border, colors.add, opacity);
  return (
    <rect
      x={cx - CELL_SIZE / 2}
      y={cy - CELL_SIZE / 2}
      width={CELL_SIZE}
      height={CELL_SIZE}
      rx={2}
      fill={fill}
      data-testid={`heat-cell-${payload.dow}-${payload.hour}`}
    />
  );
}

// `color-mix(in srgb, var(--add) X%, var(--border-soft))` is a CSS string,
// not usable inline on an SVG `fill` the same way - resolves both custom
// properties to concrete hex values once (light/dark-mode aware, since
// `getComputedStyle` reads whichever `@media (prefers-color-scheme)` block
// is active) and mixes in plain JS instead.
function useHeatColors(): { add: string; border: string } {
  const [colors, setColors] = useState({ add: "#2f8f49", border: "#ece9e1" });
  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const add = styles.getPropertyValue("--add").trim();
    const border = styles.getPropertyValue("--border-soft").trim();
    setColors({ add: add || "#2f8f49", border: border || "#ece9e1" });
  }, []);
  return colors;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return null;
  return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) };
}

function mixHex(base: string, tint: string, t: number): string {
  const from = hexToRgb(base);
  const to = hexToRgb(tint);
  if (!from || !to) return t > 0 ? tint : base;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(from.r, to.r)}, ${mix(from.g, to.g)}, ${mix(from.b, to.b)})`;
}
