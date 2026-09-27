import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../api/types";
import { envelope, installFetchMock, serverError } from "../test/mockApi";
import { renderWithClient } from "../test/renderWithClient";
import { SessionsList } from "./SessionsList";

const noop = () => {};

const SESSION: SessionSummary = {
  session_id: "a8de42aabbccddeeffgg1234c884",
  project: "cairn-2.0",
  started: "2026-09-25T11:58:00Z",
  ended: "2026-09-25T12:39:00Z",
  agents: ["builder"],
  calls: 12,
  tokens: 184204,
  cost: 12.4,
  usage_limit_hit: false,
};

// S1: a second, older, cheaper, shorter-duration, lower-token session -
// distinguishes every sortable column from SESSION so a sort test can tell
// which row landed first without relying on the default order alone.
const OLDER_SESSION: SessionSummary = {
  session_id: "older-session-0000000000000000",
  project: "cairn-2.0",
  started: "2026-09-20T09:00:00Z",
  ended: "2026-09-20T09:05:00Z",
  agents: ["builder"],
  calls: 2,
  tokens: 500,
  cost: 1.0,
  usage_limit_hit: false,
};

function install(overrides: Record<string, ReturnType<typeof envelope> | { status: number; body: unknown }> = {}) {
  return installFetchMock({
    "/api/projects": () =>
      overrides["/api/projects"] ?? envelope({ hostname: "test-host", projects: [{ label: "cairn-2.0", parent: null }] }),
    "/api/rollup/session": () => overrides["/api/rollup/session"] ?? envelope([SESSION]),
  });
}

describe("SessionsList", () => {
  it("renders the sessions table and navigates to a drilldown on row click", async () => {
    install();
    const onSelectSession = vi.fn();
    renderWithClient(<SessionsList activeTab="sessions" onTabChange={noop} onSelectSession={onSelectSession} />);

    await waitFor(() => expect(screen.getByTestId("sessions-table")).toHaveTextContent("cairn-2.0"));
    expect(screen.getByText("$12.40")).toBeInTheDocument();

    fireEvent.click(screen.getByText("a8de42…c884"));
    expect(onSelectSession).toHaveBeenCalledWith(SESSION.session_id);
  });

  it("shows PanelError with a working retry when the sessions fetch fails", async () => {
    const fetchMock = install({ "/api/rollup/session": serverError() });
    renderWithClient(<SessionsList activeTab="sessions" onTabChange={noop} onSelectSession={noop} />);

    expect(await screen.findByTestId("sessions-error-text")).toHaveTextContent("Couldn't load sessions — request failed");
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByTestId("sessions-error-retry"));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });

  it("shows the empty state when no sessions fall in the selected range", async () => {
    install({ "/api/rollup/session": envelope([]) });
    renderWithClient(<SessionsList activeTab="sessions" onTabChange={noop} onSelectSession={noop} />);

    expect(await screen.findByTestId("sessions-empty")).toHaveTextContent("No sessions in this range");
  });

  // S1: sort controls.
  function rowOrder(): string[] {
    return screen.getAllByTestId(/^session-row-/).map((r) => r.getAttribute("data-testid")!);
  }

  it("S1: defaults to Started, descending - newest session first", async () => {
    install({ "/api/rollup/session": envelope([OLDER_SESSION, SESSION]) });
    renderWithClient(<SessionsList activeTab="sessions" onTabChange={noop} onSelectSession={noop} />);

    await waitFor(() => expect(rowOrder()).toHaveLength(2));
    expect(rowOrder()).toEqual([`session-row-${SESSION.session_id}`, `session-row-${OLDER_SESSION.session_id}`]);
  });

  it("S1: the direction toggle reverses the current column's order", async () => {
    install({ "/api/rollup/session": envelope([SESSION, OLDER_SESSION]) });
    renderWithClient(<SessionsList activeTab="sessions" onTabChange={noop} onSelectSession={noop} />);

    await waitFor(() => expect(rowOrder()).toHaveLength(2));
    fireEvent.click(screen.getByTestId("sort-direction"));

    expect(rowOrder()).toEqual([`session-row-${OLDER_SESSION.session_id}`, `session-row-${SESSION.session_id}`]);
  });

  it("S1: a column-header click sorts by that column, same as picking it from the dropdown", async () => {
    install({ "/api/rollup/session": envelope([SESSION, OLDER_SESSION]) });
    renderWithClient(<SessionsList activeTab="sessions" onTabChange={noop} onSelectSession={noop} />);

    await waitFor(() => expect(rowOrder()).toHaveLength(2));
    // Tokens, descending (the default direction) - SESSION (184204) first.
    fireEvent.click(screen.getByTestId("sort-header-tokens"));
    expect(rowOrder()).toEqual([`session-row-${SESSION.session_id}`, `session-row-${OLDER_SESSION.session_id}`]);

    // The dropdown's own "Cost" option sets the same state - OLDER_SESSION
    // ($1.00) sorts last under descending, unchanged from the toggle above.
    fireEvent.click(screen.getByTestId("sort-select"));
    fireEvent.click(screen.getByTestId("sort-option-cost"));
    expect(rowOrder()).toEqual([`session-row-${SESSION.session_id}`, `session-row-${OLDER_SESSION.session_id}`]);
  });
});
