import { describe, expect, it } from "vitest";
import { formatDateValue } from "./date-display.js";

const NOW = new Date(2026, 9, 4, 12, 0);
const moment = (date: Date) => ({ kind: "moment", iso: date.toISOString() }) as const;
const plan = (value: string) => ({ kind: "plan", value }) as const;

describe("a date in a column format", () => {
  it("date and time: a moment always with hours and minutes, a plan date with its time when it has one", () => {
    expect(formatDateValue(moment(new Date(2026, 8, 26, 9, 5)), "dateTime", NOW)).toBe("Sep 26, 09:05");
    expect(formatDateValue(plan("2026-10-05T15:30"), "dateTime", NOW)).toBe("Oct 5, 15:30");
    expect(formatDateValue(plan("2026-10-05"), "dateTime", NOW)).toBe("Oct 5");
  });

  it("date: the day alone, the year outside this one", () => {
    expect(formatDateValue(moment(new Date(2026, 8, 26, 9, 5)), "date", NOW)).toBe("Sep 26");
    expect(formatDateValue(plan("2027-01-02T08:00"), "date", NOW)).toBe("Jan 2, 2027");
  });

  it("relative: a moment by its distance from now, either way", () => {
    expect(formatDateValue(moment(new Date(2026, 9, 4, 11, 40)), "relative", NOW)).toBe("20m ago");
    expect(formatDateValue(moment(new Date(2026, 9, 4, 9, 0)), "relative", NOW)).toBe("3h ago");
    expect(formatDateValue(plan("2026-10-04T15:00"), "relative", NOW)).toBe("in 3h");
    expect(formatDateValue(plan("2026-10-09T12:00"), "relative", NOW)).toBe("in 5d");
    expect(formatDateValue(moment(new Date(2026, 9, 4, 12, 0, 20)), "relative", NOW)).toBe("now");
  });

  it("relative: a day without a time by calendar days", () => {
    expect(formatDateValue(plan("2026-10-04"), "relative", NOW)).toBe("today");
    expect(formatDateValue(plan("2026-10-05"), "relative", NOW)).toBe("tomorrow");
    expect(formatDateValue(plan("2026-10-03"), "relative", NOW)).toBe("yesterday");
    expect(formatDateValue(plan("2026-09-30"), "relative", NOW)).toBe("4d ago");
  });

  it("an unreadable moment reads as nothing", () => {
    expect(formatDateValue({ kind: "moment", iso: "not-a-date" }, "dateTime", NOW)).toBe("");
  });
});
