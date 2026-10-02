import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { formatDuration, trendOf } from "./flow-model";

describe("trendOf — least-squares line through a series", () => {
  it("recovers a straight line exactly", () => {
    fc.assert(
      fc.property(fc.integer({ min: -50, max: 50 }), fc.integer({ min: -100, max: 100 }), fc.integer({ min: 2, max: 40 }), (slope, start, length) => {
        const line = Array.from({ length }, (_, x) => start + slope * x);
        const trend = trendOf(line)!;
        expect(trend.slope).toBeCloseTo(slope, 9);
        expect(trend.start).toBeCloseTo(start, 9);
      }),
    );
  });

  it("has no trend for fewer than two points", () => {
    expect(trendOf([])).toBeNull();
    expect(trendOf([4])).toBeNull();
  });
});

describe("formatDuration", () => {
  it("speaks in minutes under an hour, hours under a day, days above", () => {
    expect(formatDuration(25 * 60_000)).toBe("25 min");
    expect(formatDuration(5.5 * 3_600_000)).toBe("5.5 h");
    expect(formatDuration(1.84 * 86_400_000)).toBe("1.8 d");
  });
});
