import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { TaskCard } from "../api/types";
import { _resetAttentionModuleStateForTests } from "../lib/attention";
import { envelope, installFetchMock, serverError } from "../test/mockApi";
import { renderWithClient } from "../test/renderWithClient";
import { Kanban } from "./Kanban";

const noop = () => {};

function task(overrides: Partial<TaskCard> = {}): TaskCard {
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

function install(tasks: TaskCard[], projects = [{ label: "cairn-2.0", parent: null }]) {
  return installFetchMock({
    "/api/projects": () => envelope({ hostname: "test-host", projects }),
    "/api/tasks": () => envelope(tasks),
  });
}

describe("Kanban", () => {
  // AppHeader (mounted by every page, including this one) reads/writes
  // module-level attention-signaling state that would otherwise leak
  // between tests in different files run in the same worker.
  beforeEach(() => {
    _resetAttentionModuleStateForTests();
  });

  it("groups a real /api/tasks response into its 4 columns", async () => {
    install([
      task({ folder: "docs/tasks/2026-09-01-0900-ready-one", column: "ready" }),
      task({ folder: "docs/tasks/2026-09-02-0900-attn-one", column: "needs_attention", key_info: "needs-human" }),
      task({ folder: "docs/tasks/2026-09-03-0900-ongoing-one", column: "ongoing" }),
      task({ folder: "docs/tasks/2026-09-04-0900-done-one", column: "done" }),
      task({ folder: "docs/tasks/2026-09-05-0900-done-two", column: "done" }),
    ]);
    renderWithClient(<Kanban activeTab="kanban" onTabChange={noop} />);

    await waitFor(() => expect(screen.getByText("ready-one")).toBeInTheDocument());
    expect(screen.getByText("attn-one")).toBeInTheDocument();
    expect(screen.getByText("ongoing-one")).toBeInTheDocument();
    expect(screen.getByText("done-one")).toBeInTheDocument();
    expect(screen.getByText("done-two")).toBeInTheDocument();

    const columns = screen.getAllByText(/^\d+$/, { selector: ".kanban-column-count" });
    expect(columns.map((el) => el.textContent)).toEqual(["1", "1", "1", "2"]);
  });

  it("renders two sibling sub-task cards under the same parent as ordinary cards in different columns, and shows the parent's own N of M done bar", async () => {
    const parentFolder = "docs/tasks/2026-09-01-0900-parent";
    install([
      task({
        folder: parentFolder,
        column: "ready",
        sub_tasks: { done: 1, total: 2 },
      }),
      task({
        folder: `${parentFolder}/01-build-first`,
        parent: parentFolder,
        column: "done",
      }),
      task({
        folder: `${parentFolder}/02-build-second`,
        parent: parentFolder,
        column: "needs_attention",
        key_info: "stalled",
      }),
    ]);
    renderWithClient(<Kanban activeTab="kanban" onTabChange={noop} />);

    await waitFor(() => expect(screen.getByText("1 of 2 done")).toBeInTheDocument());
    expect(screen.getByTestId(`task-card-${parentFolder}/01-build-first`)).toBeInTheDocument();
    expect(screen.getByTestId(`task-card-${parentFolder}/02-build-second`)).toBeInTheDocument();
    // §6.3: siblings are ordinary, unattached cards in different columns -
    // not nested under or adjacent to the parent, just linked by the
    // parent-reference indicator.
    expect(screen.getAllByTestId("kcard-parent")).toHaveLength(2);
  });

  it("shows the empty state when the project has no task folders", async () => {
    install([]);
    renderWithClient(<Kanban activeTab="kanban" onTabChange={noop} />);

    await waitFor(() => expect(screen.getByTestId("kanban-empty")).toBeInTheDocument());
    expect(screen.getByText("No task folders yet")).toBeInTheDocument();
  });

  it("shows an error state with retry when /api/tasks fails", async () => {
    const fetchMock = installFetchMock({
      "/api/projects": () => envelope({ hostname: "test-host", projects: [{ label: "cairn-2.0", parent: null }] }),
      "/api/tasks": () => serverError(),
    });
    renderWithClient(<Kanban activeTab="kanban" onTabChange={noop} />);

    await waitFor(() => expect(screen.getByTestId("kanban-error-text")).toBeInTheDocument());
    const callsBeforeRetry = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByTestId("kanban-error-retry"));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeRetry));
  });
});
