import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  // F6: ProjectCostPanel is this component's first click-to-filter
  // consumer - By models/tools/agents (O3) never pass onSelectRow, so their
  // legend rows stay non-interactive.
  it("F6: reports the clicked row's key via onSelectRow, and marks the selected row", () => {
    const onSelectRow = vi.fn();
    render(
      <StackedBarPanel
        data-testid="by-project"
        selectedKey="wardstone"
        onSelectRow={onSelectRow}
        rows={[
          { key: "cairn-2.0", value: 70, display: "$125.50" },
          { key: "wardstone", value: 30, display: "$45.00" },
        ]}
      />,
    );

    expect(screen.getByTestId("by-project-legend-wardstone")).toHaveClass("selected");
    fireEvent.click(screen.getByTestId("by-project-legend-cairn-2.0"));
    expect(onSelectRow).toHaveBeenCalledWith("cairn-2.0");
  });
});
