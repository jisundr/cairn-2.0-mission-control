import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

// The drawer itself (TaskDrawer.tsx) has its own test file - these tests
// only cover Kanban's own wiring: a card click reports its folder up via
// `onOpenTask`, and the drawer mounts once `openTask`/its resolved project
// are both known.
function renderKanban(overrides: Partial<Parameters<typeof Kanban>[0]> = {}) {
  return renderWithClient(
    <Kanban
      activeTab="kanban"
      onTabChange={noop}
      openTask={null}
      openTaskProject={null}
      drawerTab="details"
      onOpenTask={noop}
      boardProject={undefined}
      onBoardProjectChange={noop}
      {...overrides}
    />,
  );
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
    renderKanban();

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
    renderKanban();

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
    renderKanban();

    await waitFor(() => expect(screen.getByTestId("kanban-empty")).toBeInTheDocument());
    expect(screen.getByText("No task folders yet")).toBeInTheDocument();
  });

  it("reports a clicked card's folder and its own already-known project up via onOpenTask (§6.5's wiring, not the drawer's own content)", async () => {
    const folder = "docs/tasks/2026-09-01-0900-ready-one";
    install([task({ folder, column: "ready", project: "cairn-2.0" })]);
    const onOpenTask = vi.fn();
    renderKanban({ onOpenTask });

    await waitFor(() => expect(screen.getByTestId(`task-card-${folder}`)).toBeInTheDocument());
    fireEvent.click(screen.getByTestId(`task-card-${folder}`));

    expect(onOpenTask).toHaveBeenCalledWith(folder, "details", "cairn-2.0");
  });

  it("opens the clicked project's own drawer content, not the first project sharing that folder name (a real click's project bypasses the by-folder-only fallback lookup)", async () => {
    const folder = "docs/tasks/0001-shared-folder-name";
    installFetchMock({
      "/api/projects": () =>
        envelope({
          hostname: "test-host",
          projects: [
            { label: "project-a", parent: null },
            { label: "project-b", parent: null },
          ],
        }),
      "/api/tasks": () =>
        envelope([
          task({ project: "project-a", folder, goal: "Project A's own task" }),
          task({ project: "project-b", folder, goal: "Project B's own task" }),
        ]),
      "/api/tasks/detail": (params) =>
        envelope({
          project: params.get("project"),
          folder,
          parent: null,
          kind: "build",
          column: "ready",
          frontmatter: { goal: params.get("project") === "project-b" ? "Project B's own task" : "Project A's own task" },
          activity: [],
          draft_content: null,
          sub_tasks: null,
          docs: [],
        }),
    });
    // Simulates the render right after a direct click on project-b's card:
    // `openTaskProject` is already known, so Kanban must not fall back to
    // `allTasks.data.find()`'s first-match-wins-by-folder lookup, which
    // would resolve project-a instead (it's first in `/api/tasks`).
    renderKanban({ openTask: folder, openTaskProject: "project-b" });

    // Scoped to the drawer itself - both projects' own cards behind it
    // legitimately render "Project A's/B's own task" as their goal text, so
    // only the drawer's own content is a meaningful assertion here.
    const drawer = within(await screen.findByTestId("task-drawer"));
    await waitFor(() => expect(drawer.getByText("Project B's own task")).toBeInTheDocument());
    expect(drawer.queryByText("Project A's own task")).not.toBeInTheDocument();
  });

  it("mounts the drawer once openTask's project resolves from the (unfiltered) task list", async () => {
    const folder = "docs/tasks/2026-09-01-0900-ready-one";
    install([task({ folder, column: "ready" })]);
    installFetchMock({
      "/api/projects": () => envelope({ hostname: "test-host", projects: [{ label: "cairn-2.0", parent: null }] }),
      "/api/tasks": () => envelope([task({ folder, column: "ready" })]),
      "/api/tasks/detail": () =>
        envelope({
          project: "cairn-2.0",
          folder,
          parent: null,
          kind: "build",
          column: "ready",
          frontmatter: { goal: "g" },
          activity: [],
          draft_content: null,
          sub_tasks: null,
          docs: [],
        }),
    });
    renderKanban({ openTask: folder, drawerTab: "details" });

    await waitFor(() => expect(screen.getByTestId("task-drawer")).toBeInTheDocument());
  });

  it("reports a picked project up via onBoardProjectChange rather than filtering from local state (the filter now lives in App.tsx's URL)", async () => {
    install(
      [task({ folder: "docs/tasks/2026-09-01-0900-ready-one", project: "project-a" })],
      [
        { label: "project-a", parent: null },
        { label: "project-b", parent: null },
      ],
    );
    const onBoardProjectChange = vi.fn();
    renderKanban({ onBoardProjectChange });

    await waitFor(() => expect(screen.getByTestId("install-scope-dropdown")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("install-scope-dropdown"));
    fireEvent.click(screen.getByTestId("install-scope-option-project-b"));

    expect(onBoardProjectChange).toHaveBeenCalledWith("project-b");
  });

  it("renders the chip and clears via onBoardProjectChange when boardProject is already set (reload-restored filter, not local state)", async () => {
    install(
      [task({ folder: "docs/tasks/2026-09-01-0900-ready-one", project: "project-a" })],
      [
        { label: "project-a", parent: null },
        { label: "project-b", parent: null },
      ],
    );
    const onBoardProjectChange = vi.fn();
    renderKanban({ boardProject: "project-a", onBoardProjectChange });

    const chip = await screen.findByTestId("install-scope-chip");
    expect(chip).toHaveTextContent("project-a");
    fireEvent.click(within(chip).getByTitle("Clear filter"));

    expect(onBoardProjectChange).toHaveBeenCalledWith(undefined);
  });

  it("pages a column's cards behind a manual See more control, and shows the end marker once exhausted", async () => {
    const tasks = Array.from({ length: 25 }, (_, i) =>
      task({ folder: `docs/tasks/2026-09-01-0900-ready-${i}`, column: "ready" }),
    );
    install(tasks);
    renderKanban();

    await waitFor(() => expect(screen.getByTestId(`task-card-${tasks[0].folder}`)).toBeInTheDocument());
    expect(screen.queryByTestId(`task-card-${tasks[20].folder}`)).not.toBeInTheDocument();
    const seeMore = screen.getByTestId("kanban-see-more-ready");
    expect(seeMore).toHaveTextContent("See more");

    fireEvent.click(seeMore);

    for (const t of tasks) {
      expect(screen.getByTestId(`task-card-${t.folder}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("kanban-see-more-ready")).not.toBeInTheDocument();
    expect(screen.getByTestId("kanban-end-ready")).toHaveTextContent("End of Ready");
  });

  it("shows the end marker on a column with no cards, without triggering the board's own all-empty state", async () => {
    install([task({ folder: "docs/tasks/2026-09-01-0900-ready-one", column: "ready" })]);
    renderKanban();

    await waitFor(() => expect(screen.getByTestId("kanban-end-done")).toBeInTheDocument());
    expect(screen.getByTestId("kanban-end-done")).toHaveTextContent("End of Done");
    expect(screen.queryByTestId("kanban-see-more-done")).not.toBeInTheDocument();
  });

  it("shows an error state with retry when /api/tasks fails", async () => {
    const fetchMock = installFetchMock({
      "/api/projects": () => envelope({ hostname: "test-host", projects: [{ label: "cairn-2.0", parent: null }] }),
      "/api/tasks": () => serverError(),
    });
    renderKanban();

    await waitFor(() => expect(screen.getByTestId("kanban-error-text")).toBeInTheDocument());
    const callsBeforeRetry = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByTestId("kanban-error-retry"));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeRetry));
  });
});
