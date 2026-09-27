import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
