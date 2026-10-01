import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { mondayOf, weekBreaks, weekEdgesSince } from "./weeks";

const DAY_MS = 86_400_000;
// Years 2000–2040: wide enough for daylight-saving turns, narrow enough for exact dates.
const timeArb = fc.integer({ min: 946_684_800_000, max: 2_208_988_800_000 });

const isLocalMondayMidnight = (ms: number) => {
  const date = new Date(ms);
  return date.getDay() === 1 && date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
};

/** Local midnights of `count` days from the given calendar day. */
const localDays = (year: number, month: number, day: number, count: number) =>
  Array.from({ length: count }, (_, index) => new Date(year, month, day + index).getTime());

describe("mondayOf", () => {
  it("is a local Monday midnight no later than the moment and less than a week before it", () => {
    fc.assert(
      fc.property(timeArb, (atMs) => {
        const monday = mondayOf(atMs);
        expect(isLocalMondayMidnight(monday)).toBe(true);
        expect(monday).toBeLessThanOrEqual(atMs);
        expect(atMs - monday).toBeLessThan(7 * DAY_MS + 2 * 3_600_000);
      }),
    );
  });

  it("gives a Monday midnight back unchanged", () => {
    const monday = new Date(2026, 8, 21).getTime();
    expect(mondayOf(monday)).toBe(monday);
  });
});

describe("weekBreaks", () => {
  it("marks the day column each Monday opens, and nothing else", () => {
    // Wed 2026-09-16 … Tue 2026-10-06: Mondays on the 21st, the 28th and the 5th.
    const days = localDays(2026, 8, 16, 21);
    const breaks = weekBreaks(days);
    expect(breaks.map((entry) => new Date(entry.mondayMs).getDate())).toEqual([21, 28, 5]);
    expect(breaks.map((entry) => entry.column)).toEqual([5, 12, 19]);
  });

  it("never marks the first column: nothing stands before it", () => {
    expect(weekBreaks(localDays(2026, 8, 21, 7))).toEqual([]);
  });

  it("marks a column whose span holds a Monday midnight, for rolling day ends too", () => {
    fc.assert(
      fc.property(timeArb, fc.integer({ min: 2, max: 60 }), (nowMs, count) => {
        const ends = Array.from({ length: count }, (_, index) => nowMs - (count - 1 - index) * DAY_MS);
        const breaks = weekBreaks(ends);
        for (const entry of breaks) {
          expect(isLocalMondayMidnight(entry.mondayMs)).toBe(true);
          expect(entry.mondayMs).toBeGreaterThan(ends[entry.column - 1]!);
          expect(entry.mondayMs).toBeLessThanOrEqual(ends[entry.column]!);
        }
        // One Monday in every seven days: a break at most a week apart from the next.
        expect(breaks.length).toBeGreaterThanOrEqual(Math.floor((count - 1) / 7));
        expect(breaks.length).toBeLessThanOrEqual(Math.ceil((count - 1) / 7));
      }),
    );
  });

  it("is empty for no columns and for one", () => {
    expect(weekBreaks([])).toEqual([]);
    expect(weekBreaks([Date.now()])).toEqual([]);
  });
});

describe("weekEdgesSince", () => {
  it("runs Monday to Monday from the start's week through the week holding now", () => {
    fc.assert(
      fc.property(timeArb, fc.integer({ min: 0, max: 400 * DAY_MS }), (startMs, span) => {
        const nowMs = startMs + span;
        const edges = weekEdgesSince(startMs, nowMs);
        expect(edges.length).toBeGreaterThanOrEqual(2);
        expect(edges.every(isLocalMondayMidnight)).toBe(true);
        expect(edges[0]).toBe(mondayOf(startMs));
        expect(edges[edges.length - 2]).toBeLessThanOrEqual(nowMs);
        expect(edges[edges.length - 1]).toBeGreaterThan(nowMs);
        edges.slice(1).forEach((edge, index) => {
          expect(Math.round((edge - edges[index]!) / DAY_MS)).toBe(7);
        });
      }),
    );
  });

  it("gives one week when the start comes after now", () => {
    const nowMs = new Date(2026, 8, 23, 12).getTime();
    expect(weekEdgesSince(nowMs + 30 * DAY_MS, nowMs)).toEqual([new Date(2026, 8, 21).getTime(), new Date(2026, 8, 28).getTime()]);
  });
});
