// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatDay, formatHour } from "./closed-model";

describe("column labels", () => {
  it("name a day by its month and date, across a month's turn", () => {
    expect(formatDay(new Date(2026, 8, 30).getTime())).toBe(new Date(2026, 8, 30).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    expect(formatDay(new Date(2026, 9, 1).getTime())).not.toBe(formatDay(new Date(2026, 8, 30).getTime()));
  });

  it("name an hour by its clock time, midnight included", () => {
    const midnight = new Date(2026, 9, 1, 0, 0).getTime();
    expect(formatHour(midnight)).toBe(new Date(midnight).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
  });
});
