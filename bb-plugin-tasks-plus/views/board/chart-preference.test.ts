// @vitest-environment jsdom
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import { ALL_TIME, CHART_UNITS, DATE_DENSITIES, DATE_PLACES, GANTT_MODES, MAX_CARD_CHART_PERIOD, TODAY_PLACES } from "../../shared/enums.js";
import {
  CHART_PREFERENCE_STORAGE_KEY,
  DEFAULT_CHART_PREFERENCE,
  loadChartPreference,
  parseChartPeriod,
  parseChartPreference,
  setChartPreference,
} from "./chart-preference.js";

afterEach(() => window.localStorage.clear());

describe("parseChartPeriod", () => {
  it("takes a whole number of days from 0 to the longest period", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_CARD_CHART_PERIOD }), (days) => {
        expect(parseChartPeriod(days)).toBe(days);
      }),
    );
  });

  it("refuses anything else, the first value past each end included", () => {
    for (const raw of [-1, MAX_CARD_CHART_PERIOD + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "7", null, undefined]) {
      expect(parseChartPeriod(raw)).toBeNull();
    }
  });
});

describe("parseChartPreference", () => {
  it("reads any stored value as a whole preference — junk falls back field by field", () => {
    fc.assert(
      fc.property(fc.anything(), (raw) => {
        const preference = parseChartPreference(raw);
        expect(parseChartPeriod(preference.period)).toBe(preference.period);
        expect(GANTT_MODES).toContain(preference.ganttMode);
        expect(TODAY_PLACES).toContain(preference.today);
        expect(CHART_UNITS).toContain(preference.unit);
        expect(DATE_PLACES).toContain(preference.dates);
        expect(DATE_DENSITIES).toContain(preference.dateDensity);
      }),
    );
  });

  it("keeps a valid field when its neighbours are junk", () => {
    expect(parseChartPreference({ period: 14, ganttMode: 42, today: "up", unit: "hours", dates: "card", dateDensity: "lots" })).toEqual({
      ...DEFAULT_CHART_PREFERENCE,
      period: 14,
      unit: "hours",
      dates: "card",
    });
  });

  it("reads a preference stored before units and dates with the days and the dates under the charts, as the burndown wrote its weeks", () => {
    expect(parseChartPreference({ period: 30, ganttMode: "both", today: "center" })).toEqual({
      period: 30,
      ganttMode: "both",
      today: "center",
      unit: "days",
      dates: "charts",
      dateDensity: "few",
    });
  });

  it("reads a period stored by name as its days, all time as 0", () => {
    expect(parseChartPreference({ period: "week" }).period).toBe(7);
    expect(parseChartPreference({ period: "month" }).period).toBe(30);
    expect(parseChartPreference({ period: "all" }).period).toBe(ALL_TIME);
    expect(parseChartPreference({ period: "toString" }).period).toBe(DEFAULT_CHART_PREFERENCE.period);
  });

  it("opens on the last 7 days and the facts, today on the right, a few dates under the charts", () => {
    expect(DEFAULT_CHART_PREFERENCE).toEqual({ period: 7, unit: "days", ganttMode: "fact", today: "right", dates: "charts", dateDensity: "few" });
  });
});

describe("a board's chart preference", () => {
  it("survives a reload, board by board", () => {
    const a = { period: 45, unit: "minutes", ganttMode: "both", today: "center", dates: "card", dateDensity: "many" } as const;
    const b = { period: ALL_TIME, unit: "days", ganttMode: "plan", today: "left", dates: "off", dateDensity: "some" } as const;
    setChartPreference("board:A", a);
    setChartPreference("board:B", b);
    expect(loadChartPreference("board:A")).toEqual(a);
    expect(loadChartPreference("board:B")).toEqual(b);
    expect(loadChartPreference("board:C")).toEqual(DEFAULT_CHART_PREFERENCE);
  });

  it("reads broken storage as the defaults", () => {
    window.localStorage.setItem(CHART_PREFERENCE_STORAGE_KEY, "{not json");
    expect(loadChartPreference("board:A")).toEqual(DEFAULT_CHART_PREFERENCE);
  });
});
