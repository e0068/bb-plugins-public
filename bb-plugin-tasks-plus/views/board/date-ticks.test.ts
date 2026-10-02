import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DATE_DENSITIES } from "../../shared/enums.js";
import { dateTicks } from "./date-ticks.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Friday 2026-10-02, 12:00 local. */
const NOON = new Date(2026, 9, 2, 12).getTime();

describe("dateTicks — the dates written under a card's charts", () => {
  it("writes more dates the denser the board asks, never more than few 3, some 5, many 8", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2 * MINUTE, max: 3650 * DAY }), fc.integer({ min: -400 * DAY, max: 400 * DAY }), (spanMs, shiftMs) => {
        const fromMs = NOON + shiftMs;
        const counts = DATE_DENSITIES.map((density) => dateTicks({ fromMs, toMs: fromMs + spanMs }, density).length);
        expect(counts[0]).toBeLessThanOrEqual(3);
        expect(counts[1]).toBeLessThanOrEqual(5);
        expect(counts[2]).toBeLessThanOrEqual(8);
        expect(counts[0]).toBeLessThanOrEqual(counts[1]!);
        expect(counts[1]).toBeLessThanOrEqual(counts[2]!);
      }),
    );
  });

  it("puts every date strictly inside the window, where it falls across it, oldest first", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2 * MINUTE, max: 3650 * DAY }), fc.constantFrom(...DATE_DENSITIES), (spanMs, density) => {
        const span = { fromMs: NOON, toMs: NOON + spanMs };
        const ticks = dateTicks(span, density);
        ticks.forEach((tick, index) => {
          expect(tick.ms).toBeGreaterThan(span.fromMs);
          expect(tick.ms).toBeLessThan(span.toMs);
          expect(tick.at).toBeCloseTo((tick.ms - span.fromMs) / spanMs);
          if (index > 0) expect(tick.ms).toBeGreaterThan(ticks[index - 1]!.ms);
        });
      }),
    );
  });

  it("writes each midnight over a week, thickly", () => {
    const ticks = dateTicks({ fromMs: NOON - 3.5 * DAY, toMs: NOON + 3.5 * DAY }, "many");
    expect(ticks.map((tick) => tick.ms)).toEqual([-2, -1, 0, 1, 2, 3].map((day) => new Date(2026, 9, 2 + day).getTime()));
    expect(ticks.every((tick) => !tick.withTime)).toBe(true);
  });

  it("writes Mondays over a couple of months", () => {
    const ticks = dateTicks({ fromMs: NOON - 30 * DAY, toMs: NOON + 30 * DAY }, "many");
    expect(ticks.every((tick) => new Date(tick.ms).getDay() === 1 && new Date(tick.ms).getHours() === 0)).toBe(true);
  });

  it("writes the first of a month over years", () => {
    const ticks = dateTicks({ fromMs: NOON - 400 * DAY, toMs: NOON }, "some");
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.every((tick) => new Date(tick.ms).getDate() === 1)).toBe(true);
  });

  it("writes round times of day over hours and minutes, with the time, and the day itself at midnight", () => {
    const hours = dateTicks({ fromMs: NOON - 6 * HOUR, toMs: NOON + 6 * HOUR }, "some");
    expect(hours.map((tick) => tick.ms)).toEqual([9, 12, 15].map((hour) => new Date(2026, 9, 2, hour).getTime()));
    expect(hours.every((tick) => tick.withTime)).toBe(true);
    const minutes = dateTicks({ fromMs: NOON - 15 * MINUTE, toMs: NOON + 15 * MINUTE }, "some");
    expect(minutes.every((tick) => new Date(tick.ms).getMinutes() % 5 === 0 && tick.withTime)).toBe(true);
    const night = dateTicks({ fromMs: new Date(2026, 9, 2, 21).getTime(), toMs: new Date(2026, 9, 3, 3).getTime() }, "few");
    expect(night.find((tick) => tick.ms === new Date(2026, 9, 3).getTime())?.withTime).toBe(false);
  });
});

describe("dateTicks over windows longer than ten years", () => {
  it("keeps to the density however long the window, a centered all time over a far plan included", () => {
    fc.assert(
      fc.property(fc.integer({ min: 3650, max: 200 * 365 }), fc.constantFrom(...DATE_DENSITIES), (days, density) => {
        const count = dateTicks({ fromMs: NOON - days * DAY, toMs: NOON + days * DAY }, density).length;
        expect(count).toBeLessThanOrEqual({ few: 3, some: 5, many: 8 }[density]);
        expect(count).toBeGreaterThan(0);
      }),
    );
  });
});
