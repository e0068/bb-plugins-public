// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { formatDueDate } from "./lib.js";

describe("formatDueDate — a plan date with a time", () => {
  it("shows the time beside the day", () => {
    const year = new Date().getFullYear();
    expect(formatDueDate(`${year}-10-03T09:05`)).toMatch(/, 09:05$/);
  });

  it("shows a day without a time as a day alone", () => {
    const year = new Date().getFullYear();
    expect(formatDueDate(`${year}-10-03`)).not.toMatch(/:/);
  });
});
