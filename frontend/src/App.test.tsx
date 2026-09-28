import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";
import type { SessionSummary } from "./api/types";
import { envelope, installFetchMock } from "./test/mockApi";
import { renderWithClient } from "./test/renderWithClient";

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

function installSessionsHandlers() {
  return installFetchMock({
    "/api/projects": () => envelope({ hostname: "test-host", projects: [{ label: "cairn-2.0", parent: null }] }),
    "/api/rollup/session": () => envelope([SESSION]),
  });
}

describe("App", () => {
  // A path/search set by an earlier test in this file would otherwise leak
  // into the next one's initial read.
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  // Regression: the mount effect that normalizes the URL (pathForView) used
  // to rebuild it from the pathname alone, silently dropping any query
  // string the page just loaded with - stripping the URL-state work done
  // in Overview/SessionsList right after it restored state from that same
  // query string.
  it("preserves the query string already in the URL when it mounts", async () => {
    window.history.pushState(null, "", "/sessions?sort=tokens&dir=desc&page=1");
    installSessionsHandlers();
    renderWithClient(<App />);

    await waitFor(() => expect(screen.getByTestId("sessions-table")).toBeInTheDocument());
    expect(window.location.pathname).toBe("/sessions");
    // SessionsList's own mount effect fills in its other params (e.g.
    // `range`) alongside these - this only asserts the ones already in the
    // URL before mount survive the App-level normalization effect.
    const params = new URLSearchParams(window.location.search);
    expect(params.get("sort")).toBe("tokens");
    expect(params.get("dir")).toBe("desc");
    expect(params.get("page")).toBe("1");
  });
});
