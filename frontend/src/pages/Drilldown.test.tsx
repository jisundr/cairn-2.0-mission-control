import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CallDetail, SessionTrace } from "../api/types";
import { envelope, installFetchMock, serverError } from "../test/mockApi";
import { renderWithClient } from "../test/renderWithClient";
import { Drilldown } from "./Drilldown";

const SESSION_ID = "a8de42aabbccddeeffgg1234c884";

const TRACE: SessionTrace = {
  session_id: SESSION_ID,
  started: "2026-09-25T11:58:00Z",
  ended: "2026-09-25T12:39:00Z",
  agents: [
    {
      agent: "builder",
      calls: 1,
      tokens: 184204,
      cost: 12.4,
      trace: [
        {
          position: 1,
          global_position: 1,
          request_id: "req-1",
          timestamp: "2026-09-25T11:58:00Z",
          model: "sonnet-5",
          input_tokens: 100,
          output_tokens: 200,
          cache_read_tokens: 0,
          cache_write_5m_tokens: 0,
          cache_write_1h_tokens: 0,
          cost: 12.4,
          duration_seconds: 1.2,
        },
      ],
    },
  ],
};

function callDetail(position: number): CallDetail {
  return {
    position,
    total: 1,
    session_id: SESSION_ID,
    project: "cairn-2.0",
    agent: "builder",
    request_id: `req-${position}`,
    timestamp: "2026-09-25T11:58:00Z",
    model: "sonnet-5",
    input_tokens: 100,
    output_tokens: 200,
    cache_read_tokens: 0,
    cache_write_5m_tokens: 0,
    cache_write_1h_tokens: 0,
    cost: 12.4,
    available: true,
    prompt: "I think we need to have backfill",
    response: "Confirmed: added automatic backfill.",
    tool_calls: [{ name: "Bash", summary: 'grep -n "backfill" parser.py' }],
  };
}

describe("Drilldown", () => {
  it("renders the agent breakdown and transcript once the trace and call detail resolve", async () => {
    installFetchMock({
      [`/api/session/${SESSION_ID}/trace`]: () => envelope(TRACE),
      [`/api/call/${SESSION_ID}/1`]: () => envelope(callDetail(1)),
    });

    renderWithClient(<Drilldown sessionId={SESSION_ID} onBack={() => {}} />);

    expect(await screen.findByTestId("agent-row-builder")).toHaveTextContent("$12.40");
    await waitFor(() => expect(screen.getByTestId("chat-thread")).toHaveTextContent("I think we need to have backfill"));
    expect(screen.getByText(/grep -n "backfill" parser.py/)).toBeInTheDocument();
  });

  it("shows an unpriced agent cost with an info-dot", async () => {
    installFetchMock({
      [`/api/session/${SESSION_ID}/trace`]: () =>
        envelope({ ...TRACE, agents: [{ ...TRACE.agents[0], cost: null }] }),
      [`/api/call/${SESSION_ID}/1`]: () => envelope(callDetail(1)),
    });

    renderWithClient(<Drilldown sessionId={SESSION_ID} onBack={() => {}} />);

    expect(await screen.findByTestId("agent-row-builder")).toHaveTextContent("unknown");
    expect(screen.getAllByTitle("Model not yet priced").length).toBeGreaterThan(0);
  });

  it("shows a partial-failure banner with a working retry when a call detail fails, while the trace still renders", async () => {
    const fetchMock = installFetchMock({
      [`/api/session/${SESSION_ID}/trace`]: () => envelope(TRACE),
      [`/api/call/${SESSION_ID}/1`]: () => serverError("connection interrupted"),
    });

    renderWithClient(<Drilldown sessionId={SESSION_ID} onBack={() => {}} />);

    expect(await screen.findByTestId("agent-row-builder")).toBeInTheDocument();
    expect(await screen.findByTestId("drilldown-partial-error-text")).toHaveTextContent("Couldn't load the last 1 call");

    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByTestId("drilldown-partial-error-retry"));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });

  it("navigates back via the drill-back link", async () => {
    installFetchMock({
      [`/api/session/${SESSION_ID}/trace`]: () => envelope(TRACE),
      [`/api/call/${SESSION_ID}/1`]: () => envelope(callDetail(1)),
    });
    const onBack = vi.fn();
    renderWithClient(<Drilldown sessionId={SESSION_ID} onBack={onBack} />);

    fireEvent.click(await screen.findByText("← Overview"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
