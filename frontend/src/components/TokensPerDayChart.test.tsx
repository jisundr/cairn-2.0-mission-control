import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Timeseries } from "../api/types";
import { installFetchMock } from "../test/mockApi";
import { renderWithClient } from "../test/renderWithClient";
import { TokensPerDayChart } from "./TokensPerDayChart";

const TIMESERIES: Timeseries = {
  range: "7d",
  bucket: "day",
  since: "",
  until: "",
  points: [
    { bucket: "2026-09-24", calls: 3, tokens: 1000, cost: 1.0 },
    { bucket: "2026-09-25", calls: 5, tokens: 184204, cost: 12.4 },
  ],
  total_tokens: 185204,
  total_cost: 13.4,
};

describe("TokensPerDayChart", () => {
  it("renders a bar for every timeseries point, day-labeled on the x-axis", () => {
    installFetchMock({});
    const { container } = renderWithClient(<TokensPerDayChart timeseries={TIMESERIES} />);

    expect(screen.getByTestId("chart-bars")).toBeInTheDocument();
    const ticks = container.querySelectorAll(".recharts-cartesian-axis-tick-value");
    expect([...ticks].map((t) => t.textContent)).toEqual(["09-24", "09-25"]);
  });

  // O2: click-to-drill-into-a-day.
  it("O2: reports a clicked bar's date, toggling off on a repeat click of the selected bar", () => {
    installFetchMock({});
    const onSelectDate = vi.fn();
    renderWithClient(<TokensPerDayChart timeseries={TIMESERIES} selectedDate={null} onSelectDate={onSelectDate} />);

    fireEvent.click(screen.getByTestId("chart-bar-2026-09-24"));
    expect(onSelectDate).toHaveBeenCalledWith("2026-09-24");
  });

  it("O2: clicking the already-selected bar clears the selection", () => {
    installFetchMock({});
    const onSelectDate = vi.fn();
    renderWithClient(<TokensPerDayChart timeseries={TIMESERIES} selectedDate="2026-09-24" onSelectDate={onSelectDate} />);

    fireEvent.click(screen.getByTestId("chart-bar-2026-09-24"));
    expect(onSelectDate).toHaveBeenCalledWith(null);
  });
});
