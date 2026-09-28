import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TaskCard as TaskCardData } from "../api/types";
import { TaskCard } from "./TaskCard";

function task(overrides: Partial<TaskCardData> = {}): TaskCardData {
  return {
    project: "cairn-2.0",
    folder: "docs/tasks/2026-09-28-1345-build-kanban-board",
    parent: null,
    kind: "build",
    goal: "Cross-project kanban board in mission-control.",
    key_info: "in progress",
    last_log_date: "2026-09-28",
    column: "ready",
    active: false,
    needs_attention: false,
    done: false,
    sub_tasks: null,
    ...overrides,
  };
}

describe("TaskCard", () => {
  it("renders the folder's display name, goal, and kind, with no project tag on a single-project install", () => {
    render(<TaskCard task={task()} showProject={false} />);

    expect(screen.getByText("build-kanban-board")).toBeInTheDocument();
    expect(screen.getByText("Cross-project kanban board in mission-control.")).toBeInTheDocument();
    expect(screen.getByText("build")).toBeInTheDocument();
    expect(screen.queryByText("cairn-2.0")).not.toBeInTheDocument();
  });

  it("shows the project tag on a multi-project install", () => {
    render(<TaskCard task={task()} showProject />);
    expect(screen.getByText("cairn-2.0")).toBeInTheDocument();
  });

  it("shows the sub-task parent indicator using the parent's own display name", () => {
    render(
      <TaskCard
        task={task({ folder: "docs/tasks/2026-.../02-build-cleanup-fixtures", parent: "docs/tasks/2026-09-01-task-folder-cleanup" })}
        showProject={false}
      />,
    );
    expect(screen.getByTestId("kcard-parent")).toHaveTextContent("task-folder-cleanup");
  });

  it("renders an accurate N of M done progress bar for a parent with sub-tasks", () => {
    render(<TaskCard task={task({ sub_tasks: { done: 1, total: 3 } })} showProject={false} />);
    expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
    const fill = document.querySelector(".hbar-fill") as HTMLElement;
    expect(fill.style.width).toBe("33%");
  });

  it("omits the progress bar entirely when there are no sub-tasks", () => {
    render(<TaskCard task={task({ sub_tasks: null })} showProject={false} />);
    expect(document.querySelector(".kcard-progress")).not.toBeInTheDocument();
  });

  it("shows the matched attention trigger phrase only for a Needs Attention card", () => {
    render(<TaskCard task={task({ column: "needs_attention", key_info: "stalled since last week" })} showProject={false} />);
    expect(screen.getByText("stalled")).toBeInTheDocument();
  });

  it("shows the active badge only for an Ongoing card", () => {
    render(<TaskCard task={task({ column: "ongoing" })} showProject={false} />);
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("shows neither the attention nor the active badge for a Ready or Done card", () => {
    render(<TaskCard task={task({ column: "done" })} showProject={false} />);
    expect(screen.queryByText("active")).not.toBeInTheDocument();
    expect(document.querySelector(".kcard-attn")).not.toBeInTheDocument();
  });
});
