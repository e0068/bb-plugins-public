// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatPlanDate, isPlanDate, planDateMs } from "./plan-date";

const pad = (value: number) => String(value).padStart(2, "0");
const day = fc.date({ min: new Date(2000, 0, 1), max: new Date(2099, 11, 31), noInvalidDate: true }).map(
  (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
);
const time = fc.tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 })).map(([h, m]) => `${pad(h)}:${pad(m)}`);
const planDate = fc.oneof(day, fc.tuple(day, time).map(([d, t]) => `${d}T${t}`));

describe("plan dates", () => {
  it("accept a day and a day with a time", () => {
    fc.assert(fc.property(planDate, (value) => isPlanDate(value)));
  });

  it("reject what is not a real day or time", () => {
    for (const value of ["2026-02-30", "2026-13-01", "2026-10-01T24:00", "2026-10-01T23:60", "2026-10-01T9:00", "2026-10-01 15:00", "2026-10-01T15:00Z", ""]) {
      expect(isPlanDate(value), value).toBe(false);
    }
    expect(isPlanDate("2026-10-01T23:59")).toBe(true);
  });

  it("start no later than end", () => {
    fc.assert(fc.property(planDate, (value) => planDateMs(value, "start") <= planDateMs(value, "end")));
  });

  it("read a day as its local midnight through the next one", () => {
    expect(planDateMs("2026-10-01", "start")).toBe(new Date(2026, 9, 1).getTime());
    expect(planDateMs("2026-10-01", "end")).toBe(new Date(2026, 9, 2).getTime());
  });

  it("read a time as that moment at either edge", () => {
    const moment = new Date(2026, 9, 1, 15, 45).getTime();
    expect(planDateMs("2026-10-01T15:45", "start")).toBe(moment);
    expect(planDateMs("2026-10-01T15:45", "end")).toBe(moment);
  });

  it("show the time beside the day, and the year only outside this one", () => {
    const today = new Date(2026, 9, 1);
    expect(formatPlanDate("2026-10-03", today)).toBe("Oct 3");
    expect(formatPlanDate("2026-10-03T09:05", today)).toBe("Oct 3, 09:05");
    expect(formatPlanDate("2027-01-02", today)).toBe("Jan 2, 2027");
  });
});
