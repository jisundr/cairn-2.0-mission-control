import { describe, expect, it } from "vitest";
import { formatDateLabel } from "./format";

describe("formatDateLabel", () => {
  it("renders a short month, unpadded day, parenthesized year, and abbreviated weekday", () => {
    expect(formatDateLabel("2026-09-28")).toEqual("Sep 28 (2026), Mon");
  });

  it("shows the literal year from the input, not the current year", () => {
    expect(formatDateLabel("2019-01-05")).toEqual("Jan 5 (2019), Sat");
  });
});
