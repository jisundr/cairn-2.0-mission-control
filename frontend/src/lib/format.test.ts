import { describe, expect, it } from "vitest";
import { formatDateLabel, formatLastTouched, taskDisplayName } from "./format";

describe("formatDateLabel", () => {
  it("omits the year when the date falls in the given now's year", () => {
    expect(formatDateLabel("2026-09-28", new Date(Date.UTC(2026, 5, 1)))).toEqual("Sep 28, Mon");
  });

  it("shows the literal year, unparenthesized, when it differs from the given now's year", () => {
    expect(formatDateLabel("2019-01-05", new Date(Date.UTC(2026, 5, 1)))).toEqual("Jan 5 2019, Sat");
  });
});

describe("taskDisplayName", () => {
  it("strips a top-level task folder's date/time prefix", () => {
    expect(taskDisplayName("docs/tasks/2026-09-28-1345-build-kanban-board")).toBe("build-kanban-board");
  });

  it("leaves a sub-task folder's numeric prefix as-is (it has no date to strip)", () => {
    expect(taskDisplayName("docs/tasks/2026-09-28-1345-build-kanban-board/02-heartbeat-hooks")).toBe(
      "02-heartbeat-hooks",
    );
  });
});

describe("formatLastTouched", () => {
  it("renders relative time from the date and UTC time when a time is present", () => {
    const now = new Date("2026-09-29T10:00:00Z");
    expect(formatLastTouched("2026-09-28", "11:00", now)).toBe("23h ago");
    expect(formatLastTouched("2026-09-29", "09:45", now)).toBe("15m ago");
  });

  it("falls back to the date label when the time is empty", () => {
    const now = new Date("2026-09-29T10:00:00Z");
    expect(formatLastTouched("2019-01-05", "", now)).toBe(formatDateLabel("2019-01-05"));
  });
});
