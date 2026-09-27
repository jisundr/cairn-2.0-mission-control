import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionTrace, TraceCall } from "../api/types";
import { envelope, installFetchMock } from "../test/mockApi";
import { renderWithClient } from "../test/renderWithClient";
import { Drilldown } from "./Drilldown";

const SESSION_ID = "big-session";
const CALL_COUNT = 20;

function makeTrace(): SessionTrace {
  const trace: TraceCall[] = Array.from({ length: CALL_COUNT }, (_, i) => ({
    position: i + 1,
    global_position: i + 1,
    request_id: `req-${i + 1}`,
    timestamp: "2026-09-25T11:58:00Z",
    model: "sonnet-5",
    input_tokens: 10,
    output_tokens: 10,
    cache_read_tokens: 0,
    cache_write_5m_tokens: 0,
    cache_write_1h_tokens: 0,
    cost: 0.1,
    duration_seconds: 1,
  }));
  return {
    session_id: SESSION_ID,
    started: "2026-09-25T11:58:00Z",
    ended: "2026-09-25T12:39:00Z",
    agents: [{ agent: "builder", calls: CALL_COUNT, tokens: 200, cost: 2, trace }],
  };
}

// Goal 7: a large session's call details should load only for what's
// scrolled into view, not every call up front - the shape of the bug this
// covers (the transcript failing outright on a big session) only shows up
// with enough calls to exceed a viewport's worth.
describe("Drilldown - scroll-triggered call-detail loading", () => {
  it("fetches call detail only for calls scrolled into view, not the whole session up front", async () => {
    const fetchMock = installFetchMock({
      [`/api/session/${SESSION_ID}/trace`]: () => envelope(makeTrace()),
      ...Object.fromEntries(
        Array.from({ length: CALL_COUNT }, (_, i) => [
          `/api/call/${SESSION_ID}/${i + 1}`,
          () =>
            envelope({
              position: i + 1,
              total: CALL_COUNT,
              session_id: SESSION_ID,
              project: "cairn-2.0",
              agent: "builder",
              request_id: `req-${i + 1}`,
              timestamp: "2026-09-25T11:58:00Z",
              model: "sonnet-5",
              input_tokens: 10,
              output_tokens: 10,
              cache_read_tokens: 0,
              cache_write_5m_tokens: 0,
              cache_write_1h_tokens: 0,
              cost: 0.1,
              available: true,
              prompt: `prompt ${i + 1}`,
              response: `response ${i + 1}`,
              tool_calls: [],
            }),
        ]),
      ),
    });

    renderWithClient(<Drilldown sessionId={SESSION_ID} onBack={() => {}} />);

    await waitFor(() => expect(screen.getByTestId("chat-thread")).toHaveTextContent(/prompt \d+/));

    const callDetailRequests = () =>
      fetchMock.mock.calls.filter((c) => String(c[0]).includes(`/api/call/${SESSION_ID}/`)).length;

    await waitFor(() => expect(callDetailRequests()).toBeGreaterThan(0));
    expect(callDetailRequests()).toBeLessThan(CALL_COUNT);

    fireEvent.scroll(screen.getByTestId("chat-thread"), { target: { scrollTop: 5000 } });

    await waitFor(() => expect(callDetailRequests()).toBeGreaterThan(0));
  });
});
