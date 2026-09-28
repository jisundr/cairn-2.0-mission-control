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

    expect(screen.getByRole("link", { name: "Overview" })).toHaveClass("active");
    expect(screen.getByRole("link", { name: "Sessions" })).not.toHaveClass("active");

    fireEvent.click(screen.getByRole("link", { name: "Sessions" }));
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

  // F3: the mobile-collapse dropdown is CSS-hidden above 900px, not
  // React-unmounted - always in the DOM, so it's testable independent of
  // viewport width the same way the full-width `nav.app-tabs` already is.
  it("F3: the collapsed-nav dropdown is labeled with the active tab and switches tabs on selection", () => {
    const onTabChange = vi.fn();
    render(<AppHeader activeTab="sessions" onTabChange={onTabChange} connected onRefresh={() => {}} updatedLabel={null} />);

    expect(screen.getByTestId("nav-dropdown")).toHaveTextContent("Sessions");
    fireEvent.click(screen.getByTestId("nav-dropdown"));
    fireEvent.click(screen.getByTestId("nav-dropdown-option-overview"));

    expect(onTabChange).toHaveBeenCalledWith("overview");
  });

  // The 900px breakpoint swaps the wordmark's full "mission-control" suffix
  // for an abbreviated "mc" - CSS-only (like the nav dropdown above), so
  // both are always in the DOM and only one is ever visible per viewport.
  it("renders both the full and abbreviated wordmark suffix for CSS to switch between", () => {
    const { container } = render(
      <AppHeader activeTab="overview" onTabChange={() => {}} connected onRefresh={() => {}} updatedLabel={null} />,
    );

    expect(container.querySelector(".wordmark .sub")).toHaveTextContent("mission-control");
    expect(container.querySelector(".wordmark .sub-short")).toHaveTextContent("mc");
  });
});
