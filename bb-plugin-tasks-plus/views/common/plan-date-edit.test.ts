import { describe, expect, it } from "vitest";
import { dayOf, timeOf, withDay, withTime } from "./plan-date-edit.js";

const TODAY = new Date(2026, 9, 4, 18, 20);

describe("plan date edits", () => {
  it("reads the day and the time apart, both empty for no value", () => {
    expect([dayOf("2026-10-05T15:30"), timeOf("2026-10-05T15:30")]).toEqual(["2026-10-05", "15:30"]);
    expect([dayOf("2026-10-05"), timeOf("2026-10-05")]).toEqual(["2026-10-05", ""]);
    expect([dayOf(null), timeOf(null)]).toEqual(["", ""]);
  });

  it("moves to another day and keeps the time", () => {
    expect(withDay("2026-10-05T15:30", "2026-10-07")).toBe("2026-10-07T15:30");
    expect(withDay("2026-10-05", "2026-10-07")).toBe("2026-10-07");
    expect(withDay(null, "2026-10-07")).toBe("2026-10-07");
  });

  it("sets a time on the value's own day", () => {
    expect(withTime("2026-10-05", "09:00", TODAY)).toBe("2026-10-05T09:00");
    expect(withTime("2026-10-05T15:30", "09:00", TODAY)).toBe("2026-10-05T09:00");
  });

  it("puts a time set before any day on today", () => {
    expect(withTime(null, "09:00", TODAY)).toBe("2026-10-04T09:00");
  });

  it("clearing the time keeps the day, and leaves no value where there was none", () => {
    expect(withTime("2026-10-05T15:30", "", TODAY)).toBe("2026-10-05");
    expect(withTime(null, "", TODAY)).toBeNull();
  });
});
