import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StackedBarPanel } from "./StackedBarPanel";

describe("StackedBarPanel", () => {
  it("sizes each segment by its share of the total value", () => {
    render(
      <StackedBarPanel
        data-testid="by-model"
        rows={[
          { key: "sonnet-5", value: 70, display: "$131.00" },
          { key: "opus-5.5", value: 30, display: "$48.60" },
        ]}
      />,
    );

    expect(screen.getByTestId("by-model-seg-sonnet-5")).toHaveStyle({ width: "70%" });
    expect(screen.getByTestId("by-model-seg-opus-5.5")).toHaveStyle({ width: "30%" });
    expect(screen.getByTestId("by-model-legend-sonnet-5")).toHaveTextContent("sonnet-5");
    expect(screen.getByTestId("by-model-legend-sonnet-5")).toHaveTextContent("$131.00");
  });

  it("shows the empty text instead of a zero-width bar when there's no data", () => {
    render(<StackedBarPanel rows={[]} emptyText="No tool calls yet." />);
    expect(screen.getByText("No tool calls yet.")).toBeInTheDocument();
  });
});
