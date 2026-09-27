import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../api/types";
import { ProjectCostPanel } from "./ProjectCostPanel";

function session(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    session_id: "s1",
    project: "cairn-2.0",
    started: "2026-09-25T11:58:00Z",
    ended: "2026-09-25T12:39:00Z",
    agents: ["builder"],
    calls: 1,
    tokens: 100,
    cost: 5,
    usage_limit_hit: false,
    ...overrides,
  };
}

describe("ProjectCostPanel", () => {
  it("sums each project's cost and toggles the filter on row click", () => {
    const onSelectProject = vi.fn();
    const sessions = [session({ project: "cairn-2.0", cost: 5 }), session({ project: "cairn-2.0", cost: 7 }), session({ project: "wardstone", cost: 2 })];
    render(<ProjectCostPanel sessions={sessions} selectedProject={undefined} onSelectProject={onSelectProject} />);

    expect(screen.getByTestId("project-row-cairn-2.0")).toHaveTextContent("$12.00");
    expect(screen.getByTestId("project-row-wardstone")).toHaveTextContent("$2.00");

    fireEvent.click(screen.getByTestId("project-row-cairn-2.0"));
    expect(onSelectProject).toHaveBeenCalledWith("cairn-2.0");
  });

  it("clears the filter when the already-selected project's row is clicked again", () => {
    const onSelectProject = vi.fn();
    render(
      <ProjectCostPanel
        sessions={[session({ project: "cairn-2.0" })]}
        selectedProject="cairn-2.0"
        onSelectProject={onSelectProject}
      />,
    );

    fireEvent.click(screen.getByTestId("project-row-cairn-2.0"));
    expect(onSelectProject).toHaveBeenCalledWith(undefined);
  });

  it("marks a project unknown, with an info-mark, when any of its sessions has an unresolved cost", () => {
    render(
      <ProjectCostPanel
        sessions={[session({ project: "cairn-2.0", cost: null })]}
        selectedProject={undefined}
        onSelectProject={() => {}}
      />,
    );

    expect(screen.getByTestId("project-row-cairn-2.0")).toHaveTextContent("unknown");
    expect(screen.getAllByTitle("Model not yet priced").length).toBeGreaterThan(0);
  });
});
