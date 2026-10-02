import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CHART_UNIT_MS, CHART_UNITS, TODAY_PLACES, type TodayPlace } from "../../shared/enums.js";
import { chartWindow, placeIn } from "./chart-window.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 2, 12);

const window = (period: number, today: TodayPlace, unit: (typeof CHART_UNITS)[number] = "days") =>
  chartWindow({ period, unit, today, nowMs: NOW, oldestMs: NOW - 90 * DAY, latestPlanMs: NOW + 40 * DAY });
const todayAt = (span: { fromMs: number; toMs: number }) => placeIn(span, NOW);

describe("chartWindow — the one stretch of time every chart on a card draws", () => {
  it("looks back over the period with today right, ahead with today left, and half each way centered", () => {
    expect(window(10, "right")).toEqual({ fromMs: NOW - 10 * DAY, toMs: NOW });
    expect(window(10, "center")).toEqual({ fromMs: NOW - 5 * DAY, toMs: NOW + 5 * DAY });
    expect(window(10, "left")).toEqual({ fromMs: NOW, toMs: NOW + 10 * DAY });
  });

  it("counts the period in the board's unit — days, hours or minutes", () => {
    expect(window(6, "right", "hours")).toEqual({ fromMs: NOW - 6 * HOUR, toMs: NOW });
    expect(window(30, "center", "minutes")).toEqual({ fromMs: NOW - 15 * 60_000, toMs: NOW + 15 * 60_000 });
  });

  it("keeps a period as long wherever today stands, today at the right edge, the exact middle or the left edge", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3650 }), fc.constantFrom(...CHART_UNITS), fc.constantFrom(...TODAY_PLACES), (period, unit, today) => {
        const span = window(period, today, unit);
        expect(span.toMs - span.fromMs).toBe(period * CHART_UNIT_MS[unit]);
        expect(todayAt(span)).toBe({ right: 1, center: 0.5, left: 0 }[today]);
      }),
    );
  });

  it("opens all time at the oldest sub-task with today right, and ends it at the latest plan with today left", () => {
    expect(window(0, "right")).toEqual({ fromMs: NOW - 90 * DAY, toMs: NOW });
    expect(window(0, "left")).toEqual({ fromMs: NOW, toMs: NOW + 40 * DAY });
  });

  it("keeps today in the exact middle of all time too, the longer of the past and the plans ahead setting both halves", () => {
    expect(window(0, "center")).toEqual({ fromMs: NOW - 90 * DAY, toMs: NOW + 90 * DAY });
    const far = chartWindow({ period: 0, unit: "days", today: "center", nowMs: NOW, oldestMs: NOW - 3 * DAY, latestPlanMs: NOW + 40 * DAY });
    expect(far).toEqual({ fromMs: NOW - 40 * DAY, toMs: NOW + 40 * DAY });
  });

  it("runs all time at least a day past today when no plan lies ahead", () => {
    const ahead = (latestPlanMs: number | null) =>
      chartWindow({ period: 0, unit: "hours", today: "left", nowMs: NOW, oldestMs: NOW - DAY, latestPlanMs });
    expect(ahead(null)).toEqual({ fromMs: NOW, toMs: NOW + DAY });
    expect(ahead(NOW - 3 * DAY)).toEqual({ fromMs: NOW, toMs: NOW + DAY });
  });
});

describe("placeIn — where a moment falls across a window", () => {
  it("is 0 at the window's start and 1 at its end, straight in between", () => {
    const span = { fromMs: 1000, toMs: 3000 };
    expect([placeIn(span, 1000), placeIn(span, 2500), placeIn(span, 3000)]).toEqual([0, 0.75, 1]);
  });
});
