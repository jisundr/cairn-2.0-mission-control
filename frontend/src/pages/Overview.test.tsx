import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionSummary, Timeseries } from "../api/types";
import { envelope, installFetchMock, serverError } from "../test/mockApi";
import { renderWithClient } from "../test/renderWithClient";
import { Overview } from "./Overview";

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

function trendSeries(total_cost: number | null = 41.1): Timeseries {
  return {
    range: "30d",
    bucket: "day",
    since: "",
    until: "",
    points: [{ bucket: "2026-09-25", calls: 12, tokens: 184204, cost: 12.4 }],
    total_tokens: 184204,
    total_cost,
  };
}

function calendarSeries(): Timeseries {
  return {
    range: "13w",
    bucket: "day",
    since: "",
    until: "",
    points: [{ bucket: "2026-09-25", calls: 12, tokens: 184204, cost: 12.4 }],
    total_tokens: 184204,
    total_cost: 41.1,
  };
}

function baseHandlers(overrides: Record<string, ReturnType<typeof envelope> | { status: number; body: unknown }> = {}) {
  return {
    "/api/projects": () =>
      overrides["/api/projects"] ?? envelope({ hostname: "test-host", projects: [{ label: "cairn-2.0", parent: null }] }),
    "/api/rollup/session": (params: URLSearchParams) => {
      if (params.get("range") === "life" && overrides["/api/rollup/session:life"]) {
        return overrides["/api/rollup/session:life"] as ReturnType<typeof envelope>;
      }
      if (params.get("range") === "life") return envelope([SESSION]);
      return overrides["/api/rollup/session"] ?? envelope([SESSION]);
    },
    "/api/rollup/timeseries": (params: URLSearchParams) => {
      if (params.get("range") === "13w") return overrides["/api/rollup/timeseries:13w"] ?? envelope(calendarSeries());
      return overrides["/api/rollup/timeseries"] ?? envelope(trendSeries());
    },
    "/api/rollup/tool": () => overrides["/api/rollup/tool"] ?? envelope([{ key: "Edit", count: 12 }]),
    "/api/rollup/agent": () => overrides["/api/rollup/agent"] ?? envelope([{ key: "builder", calls: 12, tokens: 184204, cost: 12.4 }]),
    "/api/rollup/model": () => overrides["/api/rollup/model"] ?? envelope([{ key: "sonnet-5", calls: 12, tokens: 184204, cost: 12.4 }]),
    "/api/rollup/day-detail": () =>
      overrides["/api/rollup/day-detail"] ??
      envelope({
        date: "2026-09-25",
        total_tokens: 184204,
        total_cost: 12.4,
        by_model: [{ key: "sonnet-5", calls: 12, tokens: 184204, cost: 12.4 }],
        by_tool: [{ key: "Edit", count: 12 }],
        by_agent: [{ key: "builder", calls: 12, tokens: 184204, cost: 12.4 }],
      }),
    "/api/usage-limit-events": () => overrides["/api/usage-limit-events"] ?? envelope([]),
  };
}

describe("Overview", () => {
  it("shows the disconnected state and a retry when /api/projects fails", async () => {
    installFetchMock(baseHandlers({ "/api/projects": serverError() }));
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    expect(await screen.findByTestId("overview-disconnected")).toBeInTheDocument();
    expect(screen.getByTitle("Can't reach the local server")).toBeInTheDocument();
  });

  it("shows the empty state when backfill found no history anywhere", async () => {
    installFetchMock(baseHandlers({ "/api/rollup/session:life": envelope([]) }));
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    expect(await screen.findByTestId("overview-empty")).toBeInTheDocument();
  });

  it("O1: renders the Trend chart and a Cost/Tokens/Sessions breakdown once every rollup resolves", async () => {
    installFetchMock(baseHandlers());
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    await waitFor(() => expect(screen.getByTestId("chart-bars")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("breakdown-cost")).toHaveTextContent("$41.10"));
    expect(screen.getByTestId("breakdown-tokens")).toHaveTextContent("184k");
    expect(screen.getByTestId("breakdown-sessions")).toHaveTextContent("1");
    // Goal 4: per-project cost renders even for a single seeded project.
    await waitFor(() => expect(screen.getByTestId("project-row-cairn-2.0")).toHaveTextContent("$12.40"));
  });

  it("O1: shows an unpriced-model cost as unknown on the Breakdown panel", async () => {
    installFetchMock(baseHandlers({ "/api/rollup/timeseries": envelope(trendSeries(null)) }));
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    await waitFor(() => expect(screen.getByTestId("breakdown-cost")).toHaveTextContent("unknown"));
  });

  it("O1: switching to Calendar re-fetches every range-scoped panel at the 13w window", async () => {
    const fetchMock = installFetchMock(baseHandlers());
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    await waitFor(() => expect(screen.getByTestId("chart-bars")).toBeInTheDocument());
    fetchMock.mockClear();

    fireEvent.click(screen.getByTestId("view-seg-calendar"));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("/api/rollup/timeseries") && u.includes("range=13w"))).toBe(true);
      expect(urls.some((u) => u.includes("/api/rollup/tool") && u.includes("range=13w"))).toBe(true);
      expect(urls.some((u) => u.includes("/api/rollup/agent") && u.includes("range=13w"))).toBe(true);
    });
    expect(await screen.findByTestId("contribution-calendar")).toBeInTheDocument();
  });

  it("O2: clicking a bar drills the Breakdown into that day, and a repeat click clears it", async () => {
    installFetchMock(baseHandlers());
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    await waitFor(() => expect(screen.getByTestId("breakdown-cost")).toHaveTextContent("$41.10"));

    fireEvent.click(screen.getByTestId("chart-bar-2026-09-25"));
    await waitFor(() => expect(screen.getByTestId("breakdown-cost")).toHaveTextContent("$12.40"));
    // Sole seeded session overlaps 2026-09-25 - still counted on drill-in.
    expect(screen.getByTestId("breakdown-sessions")).toHaveTextContent("1");

    fireEvent.click(screen.getByTestId("chart-bar-2026-09-25"));
    await waitFor(() => expect(screen.getByTestId("breakdown-cost")).toHaveTextContent("$41.10"));
  });

  it("O3: renders aggregate By models/tools/agents, then drills them into the selected day", async () => {
    installFetchMock(baseHandlers());
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    await waitFor(() => expect(screen.getByTestId("by-models")).toHaveTextContent("sonnet-5"));
    expect(screen.getByTestId("by-tools")).toHaveTextContent("12 calls");
    expect(screen.getByTestId("by-agents")).toHaveTextContent("builder");

    fireEvent.click(screen.getByTestId("chart-bar-2026-09-25"));
    // Same seeded rollup rows come back from /api/rollup/day-detail's
    // by_model/by_tool/by_agent (baseHandlers' default) - still visible,
    // now sourced from the day-detail fetch instead of the range rollups.
    await waitFor(() => expect(screen.getByTestId("breakdown-cost")).toHaveTextContent("$12.40"));
    expect(screen.getByTestId("by-models")).toHaveTextContent("sonnet-5");
    expect(screen.getByTestId("by-tools")).toHaveTextContent("12 calls");
    expect(screen.getByTestId("by-agents")).toHaveTextContent("builder");
  });

  it("O2: switching views clears the selected day", async () => {
    installFetchMock(baseHandlers());
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    await waitFor(() => expect(screen.getByTestId("breakdown-cost")).toHaveTextContent("$41.10"));
    fireEvent.click(screen.getByTestId("chart-bar-2026-09-25"));
    await waitFor(() => expect(screen.getByTestId("breakdown-cost")).toHaveTextContent("$12.40"));

    fireEvent.click(screen.getByTestId("view-seg-calendar"));
    await waitFor(() => expect(screen.getByTestId("breakdown-cost")).toHaveTextContent("$41.10"));
  });

  it("shows PanelError with a working retry when the Trend chart's timeseries fails", async () => {
    const fetchMock = installFetchMock(baseHandlers({ "/api/rollup/timeseries": serverError() }));
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    expect(await screen.findByTestId("chart-error-text")).toHaveTextContent("Couldn't load — request failed");
    const callsBeforeRetry = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByTestId("chart-error-retry"));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeRetry));
  });
});
