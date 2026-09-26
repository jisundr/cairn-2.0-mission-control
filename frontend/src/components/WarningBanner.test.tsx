import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WarningBanner } from "./WarningBanner";
import type { UsageLimitEvent } from "../api/types";

const event: UsageLimitEvent = {
  id: 1,
  session_id: "sess-1",
  timestamp: "2026-09-27T00:00:00Z",
  raw_entry: "usage limit hit",
  project: "test-project",
};

describe("WarningBanner", () => {
  it("renders nothing when there are no events", () => {
    render(<WarningBanner events={[]} onViewSession={() => {}} />);
    expect(screen.queryByTestId("usage-limit-banner")).not.toBeInTheDocument();
  });

  // Regression test: AlertTriangleIcon here has no wrapping .err-text/
  // .state-icon class to constrain it (unlike every other caller), so it
  // must size itself via its own `size` prop - unbounded (no width/height
  // attribute at all) is the bug this guards against.
  it("renders its icon at a bounded size, not an unconstrained viewBox fill", () => {
    render(<WarningBanner events={[event]} onViewSession={() => {}} />);

    const svg = screen.getByTestId("usage-limit-banner").querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg?.getAttribute("width")).toBe("14");
    expect(svg?.getAttribute("height")).toBe("14");
  });
});
