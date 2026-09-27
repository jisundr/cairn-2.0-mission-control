import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HeatmapRow } from "../api/types";
import { ActivityHeatmap } from "./ActivityHeatmap";

describe("ActivityHeatmap", () => {
  it("buckets calls into a day-of-week x hour-of-day cell", () => {
    // 2026-09-27 is a Sunday; toISOString-friendly UTC noon avoids any local
    // timezone shifting the bucketed day-of-week/hour under test.
    const calls: HeatmapRow[] = [
      { timestamp: "2026-09-27T12:00:00Z", tokens: 500 },
      { timestamp: "2026-09-27T12:30:00Z", tokens: 500 },
    ];
    const { container } = render(<ActivityHeatmap calls={calls} />);

    expect(screen.getByTestId("activity-heatmap")).toBeInTheDocument();
    const dow = new Date("2026-09-27T12:00:00Z").getDay();
    const hour = new Date("2026-09-27T12:00:00Z").getHours();
    const cell = container.querySelector(`[data-testid="heat-cell-${dow}-${hour}"]`);
    expect(cell).not.toBeNull();
    // The two calls in this cell sum to 1000 tokens - the busiest cell in an
    // otherwise-empty grid, so it renders at full tint rather than the
    // empty/no-activity fill every other cell gets.
    const emptyCell = container.querySelector(`[data-testid="heat-cell-${dow}-${(hour + 1) % 24}"]`);
    expect(cell?.getAttribute("fill")).not.toEqual(emptyCell?.getAttribute("fill"));
  });
});
