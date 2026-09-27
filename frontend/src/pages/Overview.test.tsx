import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../api/types";
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
      if (params.get("range") === "today") return overrides["/api/rollup/timeseries:today"] ?? envelope(todaySeries());
      return overrides["/api/rollup/timeseries"] ?? envelope(rangeSeries());
    },
    "/api/rollup/tool": () => overrides["/api/rollup/tool"] ?? envelope([{ key: "Edit", count: 12 }]),
    "/api/rollup/agent": () => overrides["/api/rollup/agent"] ?? envelope([{ key: "builder", calls: 12, tokens: 184204, cost: 12.4 }]),
    "/api/rollup/model": () => overrides["/api/rollup/model"] ?? envelope([{ key: "sonnet-5", calls: 12, tokens: 184204, cost: 12.4 }]),
    "/api/heatmap": () => overrides["/api/heatmap"] ?? envelope([{ timestamp: "2026-09-25T11:58:00Z", tokens: 184204 }]),
    "/api/usage-limit-events": () => overrides["/api/usage-limit-events"] ?? envelope([]),
  };
}

function todaySeries(total_cost: number | null = 12.4) {
  return { range: "today", bucket: "hour", since: "", until: "", points: [], total_tokens: 184000, total_cost };
}

function rangeSeries(total_cost: number | null = 41.1) {
  return {
    range: "7d",
    bucket: "day",
    since: "",
    until: "",
    points: [{ bucket: "2026-09-25", calls: 12, tokens: 184204, cost: 12.4 }],
    total_tokens: 184204,
    total_cost,
  };
}

describe("Overview", () => {
  it("shows the disconnected state and a retry when /api/projects fails", async () => {
    installFetchMock(baseHandlers({ "/api/projects": serverError() }));
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    expect(await screen.findByTestId("overview-disconnected")).toBeInTheDocument();
    expect(screen.getByTitle("Can't reach the local server")).toBeInTheDocument();
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
  });

  it("shows the empty state when backfill found no history anywhere", async () => {
    installFetchMock(baseHandlers({ "/api/rollup/session:life": envelope([]) }));
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    expect(await screen.findByTestId("overview-empty")).toBeInTheDocument();
  });

  it("renders stats and the By-tool panel once every rollup resolves", async () => {
    installFetchMock(baseHandlers());
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    await waitFor(() => expect(screen.getByTestId("stat-cost-today")).toHaveTextContent("$12.40"));
    await waitFor(() => expect(screen.getByTestId("tool-rollup")).toHaveTextContent("Edit"));
    // Goal 4: per-project cost renders even for a single seeded project.
    await waitFor(() => expect(screen.getByTestId("project-row-cairn-2.0")).toHaveTextContent("$12.40"));
  });

  it("shows an unpriced-model cost as unknown with an info-dot on the Cost stat", async () => {
    installFetchMock(baseHandlers({ "/api/rollup/timeseries": envelope(rangeSeries(null)) }));
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    await waitFor(() => expect(screen.getByTestId("stat-cost-range")).toHaveTextContent("unknown"));
    expect(screen.getByTitle("Model not yet priced")).toBeInTheDocument();
  });

  it("shows an unpriced-model cost as unknown with an info-dot on the Cost today stat", async () => {
    installFetchMock(baseHandlers({ "/api/rollup/timeseries:today": envelope(todaySeries(null)) }));
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    await waitFor(() => expect(screen.getByTestId("stat-cost-today")).toHaveTextContent("unknown"));
    expect(screen.getByTitle("Model not yet priced")).toBeInTheDocument();
  });

  it("shows an info-dot on a By-model row whose cost is unresolved", async () => {
    installFetchMock(
      baseHandlers({ "/api/rollup/model": envelope([{ key: "sonnet-5", calls: 12, tokens: 184204, cost: null }]) }),
    );
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    await waitFor(() => expect(screen.getByTestId("model-rollup")).toHaveTextContent("unknown"));
    expect(screen.getByTitle("Model not yet priced")).toBeInTheDocument();
  });

  it("goal 1: changing the shared range control re-fetches every range-scoped panel", async () => {
    const fetchMock = installFetchMock(baseHandlers());
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    await waitFor(() => expect(screen.getByTestId("tool-rollup")).toHaveTextContent("Edit"));
    fetchMock.mockClear();

    fireEvent.click(screen.getByTestId("range-seg-30d"));

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("/api/rollup/tool") && u.includes("range=30d"))).toBe(true);
      expect(urls.some((u) => u.includes("/api/rollup/agent") && u.includes("range=30d"))).toBe(true);
      expect(urls.some((u) => u.includes("/api/heatmap") && u.includes("range=30d"))).toBe(true);
    });
  });

  it("shows PanelError with a working retry when the By-tool rollup fails", async () => {
    const fetchMock = installFetchMock(baseHandlers({ "/api/rollup/tool": serverError() }));
    renderWithClient(<Overview activeTab="overview" onTabChange={noop} onSelectSession={noop} />);

    expect(await screen.findByTestId("by-tool-error-text")).toHaveTextContent("Couldn't load — request failed");
    const callsBeforeRetry = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByTestId("by-tool-error-retry"));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeRetry));
  });
});
