import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppHeader } from "./AppHeader";

describe("AppHeader", () => {
  it("marks the active tab and calls onTabChange when the other tab is clicked", () => {
    const onTabChange = vi.fn();
    render(
      <AppHeader
        activeTab="overview"
        onTabChange={onTabChange}
        connected
        onRefresh={() => {}}
        updatedLabel={null}
      />,
    );

    expect(screen.getByText("Overview")).toHaveClass("active");
    expect(screen.getByText("Sessions")).not.toHaveClass("active");

    fireEvent.click(screen.getByText("Sessions"));
    expect(onTabChange).toHaveBeenCalledWith("sessions");
  });

  it("shows the disconnected title on the status dot when not connected", () => {
    render(
      <AppHeader
        activeTab="overview"
        onTabChange={() => {}}
        connected={false}
        onRefresh={() => {}}
        updatedLabel={null}
      />,
    );

    expect(screen.getByTitle("Can't reach the local server")).toBeInTheDocument();
  });
});
