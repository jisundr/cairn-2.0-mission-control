import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry, TaskDetail, TaskDoc } from "../api/types";
import { envelope, installFetchMock } from "../test/mockApi";
import { renderWithClient } from "../test/renderWithClient";
import { TaskDrawer } from "./TaskDrawer";

const noop = () => {};

function detail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    project: "cairn-2.0",
    folder: "docs/tasks/2026-09-28-1345-build-kanban-board",
    parent: null,
    kind: "build",
    column: "planned",
    active: false,
    needs_attention: false,
    frontmatter: { goal: "Ship the kanban board.", key_info: "in progress" },
    activity: [{ date: "2026-09-01", text: "started." }],
    draft_content: null,
    sub_tasks: null,
    docs: [],
    ...overrides,
  };
}

function installDetail(data: TaskDetail, docs: Record<string, TaskDoc & { content: string }> = {}) {
  return installFetchMock({
    "/api/tasks/detail": () => envelope(data),
    "/api/tasks/doc": (params) => {
      const name = params.get("file") ?? "";
      const found = docs[name];
      return found ? envelope({ content: found.content }) : { status: 404, body: { error: "not found" } };
    },
  });
}

function renderDrawer(data: TaskDetail, docs: Record<string, TaskDoc & { content: string }> = {}) {
  const fetchMock = installDetail(data, docs);
  renderWithClient(
    <TaskDrawer
      project={data.project}
      folder={data.folder}
      tab="details"
      onClose={noop}
      onTabChange={noop}
      onOpenTask={noop}
    />,
  );
  return fetchMock;
}

describe("TaskDrawer", () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("splits a real multi-entry activity log into individual dated timeline items", async () => {
    const activity: ActivityEntry[] = [
      { date: "2026-09-27", text: "Wrote the PRD and reviewed it with the user." },
      { date: "2026-09-28", text: "Built wireframes for the drawer, reusing v1's own CSS vocabulary." },
      { date: "2026-09-28/29", text: "Ran a long round of live observation-based tweaks against the built app." },
    ];
    renderDrawer(detail({ activity }));

    await waitFor(() => expect(screen.getByText(activity[0].text)).toBeInTheDocument());
    expect(screen.getByText(activity[1].text)).toBeInTheDocument();
    expect(screen.getByText(activity[2].text)).toBeInTheDocument();
    expect(screen.getByText("2026-09-28/29")).toBeInTheDocument();
    expect(document.querySelectorAll(".timeline-item")).toHaveLength(3);
  });

  it("renders draft_content instead of a timeline for a review (DRAFT.md-only) folder", async () => {
    renderDrawer(detail({ kind: "review", activity: null, draft_content: "# PR #9\n\nStatus: pending review\n" }));

    await waitFor(() => expect(screen.getByText(/Status: pending review/)).toBeInTheDocument());
    expect(document.querySelectorAll(".timeline-item")).toHaveLength(0);
  });

  it("shows an explicit empty state for a non-null, zero-length activity log", async () => {
    renderDrawer(detail({ activity: [] }));

    await waitFor(() => expect(screen.getByTestId("timeline-empty")).toBeInTheDocument());
    expect(screen.getByTestId("timeline-empty")).toHaveTextContent("No activity yet.");
    expect(document.querySelectorAll(".timeline-item")).toHaveLength(0);
  });

  it("lists a parent's direct sub-task children above the timeline, each re-opening the drawer on click", async () => {
    const onOpenTask = vi.fn();
    const fetchMock = installDetail(
      detail({
        sub_tasks: [
          { folder: "docs/tasks/parent/01-first", column: "done", active: false, needs_attention: false, goal: "First sub-task" },
          { folder: "docs/tasks/parent/02-second", column: "building", active: true, needs_attention: true, goal: "Second sub-task" },
        ],
      }),
    );
    renderWithClient(
      <TaskDrawer
        project="cairn-2.0"
        folder="docs/tasks/parent"
        tab="details"
        onClose={noop}
        onTabChange={noop}
        onOpenTask={onOpenTask}
      />,
    );

    await waitFor(() => expect(screen.getByText("First sub-task")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("subtask-row-docs/tasks/parent/01-first"));
    expect(onOpenTask).toHaveBeenCalledWith("cairn-2.0", "docs/tasks/parent/01-first");
    expect(fetchMock).toHaveBeenCalled();
    expect(document.querySelector(".kcard-attn.subtask-badge")).not.toBeNull();
  });

  it("Docs tab renders the file list and fetches a doc's content only once clicked", async () => {
    const fetchMock = installDetail(
      { ...detail(), docs: [{ name: "REQUIREMENTS.md", size: 3621, modified: "2026-09-28" }] },
      { "REQUIREMENTS.md": { name: "REQUIREMENTS.md", size: 3621, modified: "2026-09-28", content: "# Requirements\n" } },
    );
    renderWithClient(
      <TaskDrawer
        project="cairn-2.0"
        folder="docs/tasks/2026-09-28-1345-build-kanban-board"
        tab="docs"
        onClose={noop}
        onTabChange={noop}
        onOpenTask={noop}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("docs-file-REQUIREMENTS.md")).toBeInTheDocument());
    expect(screen.getByTestId("docs-select-placeholder")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/tasks/doc"))).toBe(false);

    fireEvent.click(screen.getByTestId("docs-file-REQUIREMENTS.md"));

    await waitFor(() => expect(screen.getByText("Requirements")).toBeInTheDocument());
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/tasks/doc"))).toBe(true);
    // Both the persistent sidebar and the <=900px collapse dropdown are
    // always rendered - design.css's own 900px breakpoint alone decides
    // which is visible, the same CSS-only pattern AppHeader's F3 nav
    // collapse already established (no matchMedia/innerWidth check here).
    expect(screen.getByTestId("docs-mobile-dropdown")).toBeInTheDocument();
  });

  it("Docs tab shows the empty state when the folder has no other docs", async () => {
    installDetail(detail({ docs: [] }));
    renderWithClient(
      <TaskDrawer
        project="cairn-2.0"
        folder="docs/tasks/2026-09-28-1345-build-kanban-board"
        tab="docs"
        onClose={noop}
        onTabChange={noop}
        onOpenTask={noop}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("docs-empty")).toBeInTheDocument());
  });

  it("shows the prompt composer on a needs-attention card in any column, pre-filled from key_info, and it makes zero network requests when used", async () => {
    const fetchMock = renderDrawer(
      detail({ column: "building", needs_attention: true, frontmatter: { key_info: "needs-human: pick a direction" } }),
    );

    await waitFor(() => expect(screen.getByTestId("reply-composer")).toBeInTheDocument());
    expect(screen.getByText('key_info: "needs-human: pick a direction"')).toBeInTheDocument();
    expect((screen.getByTestId("reply-textarea") as HTMLTextAreaElement).value).toContain(
      "needs-human: pick a direction",
    );
    expect(within(screen.getByTestId("reply-composer")).queryByText(/needs attention/i)).not.toBeInTheDocument();

    const callsBefore = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByTestId("reply-textarea"), { target: { value: "Go with option A." } });
    fireEvent.click(screen.getByTestId("reply-copy-btn"));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Go with option A.");
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("shows the prompt composer on a planned card too, pre-filled from goal/done_when", async () => {
    renderDrawer(
      detail({
        column: "planned",
        frontmatter: { goal: "Ship the kanban board.", done_when: "All four columns render live data." },
      }),
    );

    await waitFor(() => expect(screen.getByTestId("reply-composer")).toBeInTheDocument());
    const textarea = screen.getByTestId("reply-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toContain("Ship the kanban board.");
    expect(textarea.value).toContain("All four columns render live data.");
    expect(within(screen.getByTestId("reply-composer")).queryByText(/needs attention/i)).not.toBeInTheDocument();
  });

  it("never renders the prompt composer on a card that's neither planned nor needs-attention", async () => {
    renderDrawer(detail({ column: "building", active: true }));

    await waitFor(() => expect(screen.getByText("Ship the kanban board.")).toBeInTheDocument());
    expect(screen.queryByTestId("reply-composer")).not.toBeInTheDocument();
  });

  it("shows the stage chip plus attention and active badges in the header and on sub-task rows, from the response booleans", async () => {
    renderDrawer(
      detail({
        column: "building",
        active: true,
        needs_attention: true,
        frontmatter: { key_info: "stalled since friday" },
        sub_tasks: [
          { folder: "docs/tasks/parent/01-first", column: "in_review", active: false, needs_attention: true, goal: "First" },
        ],
      }),
    );

    await waitFor(() => expect(screen.getByTestId("subtask-row-docs/tasks/parent/01-first")).toBeInTheDocument());
    const header = document.querySelector(".drawer-badges") as HTMLElement;
    expect(within(header).getByText("Building")).toBeInTheDocument();
    expect(within(header).getByText("stalled")).toBeInTheDocument();
    expect(within(header).getByText("active")).toBeInTheDocument();
    const row = screen.getByTestId("subtask-row-docs/tasks/parent/01-first");
    expect(within(row).getByText("In review")).toBeInTheDocument();
    expect(within(row).getByText("needs attention")).toBeInTheDocument();
    expect(within(row).queryByText("active")).not.toBeInTheDocument();
  });

  it("shows a parent link in the header when the task has one, re-opening the drawer on click", async () => {
    const onOpenTask = vi.fn();
    const fetchMock = installDetail(detail({ parent: "docs/tasks/2026-09-28-1000-build-kanban-parent" }));
    renderWithClient(
      <TaskDrawer
        project="cairn-2.0"
        folder="docs/tasks/2026-09-28-1345-build-kanban-board"
        tab="details"
        onClose={noop}
        onTabChange={noop}
        onOpenTask={onOpenTask}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("drawer-parent-link")).toBeInTheDocument());
    expect(screen.getByTestId("drawer-parent-link")).toHaveTextContent("build-kanban-parent");
    fireEvent.click(screen.getByTestId("drawer-parent-link"));
    expect(onOpenTask).toHaveBeenCalledWith("cairn-2.0", "docs/tasks/2026-09-28-1000-build-kanban-parent");
    expect(fetchMock).toHaveBeenCalled();
  });

  it("shows a pluralized sub-task count in the header when the task has children", async () => {
    renderDrawer(
      detail({
        sub_tasks: [
          { folder: "docs/tasks/parent/01-first", column: "done", active: false, needs_attention: false, goal: "First" },
          { folder: "docs/tasks/parent/02-second", column: "planned", active: false, needs_attention: false, goal: "Second" },
        ],
      }),
    );

    await waitFor(() => expect(screen.getByTestId("drawer-subtask-count")).toBeInTheDocument());
    expect(screen.getByTestId("drawer-subtask-count")).toHaveTextContent("2 sub-tasks");
  });

  it("shows a singular sub-task count for exactly one child", async () => {
    renderDrawer(detail({ sub_tasks: [{ folder: "docs/tasks/parent/01-first", column: "done", active: false, needs_attention: false, goal: "First" }] }));

    await waitFor(() => expect(screen.getByTestId("drawer-subtask-count")).toBeInTheDocument());
    expect(screen.getByTestId("drawer-subtask-count")).toHaveTextContent("1 sub-task");
  });

  it("renders neither the parent link nor the sub-task count when the task has no parent and no children", async () => {
    renderDrawer(detail());

    await waitFor(() => expect(screen.getByText("Ship the kanban board.")).toBeInTheDocument());
    expect(screen.queryByTestId("drawer-parent-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("drawer-subtask-count")).not.toBeInTheDocument();
  });
});
