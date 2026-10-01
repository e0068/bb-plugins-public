// @vitest-environment jsdom
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";

import { ALL_TIME, GANTT_MODES, MAX_CARD_CHART_DAYS } from "../../shared/enums.js";
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
      fc.property(fc.integer({ min: 0, max: MAX_CARD_CHART_DAYS }), (days) => {
        expect(parseChartPeriod(days)).toBe(days);
      }),
    );
  });

  it("refuses anything else, the first value past each end included", () => {
    for (const raw of [-1, MAX_CARD_CHART_DAYS + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "7", null, undefined]) {
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
      }),
    );
  });

  it("keeps a valid field when its neighbour is junk", () => {
    expect(parseChartPreference({ period: 14, ganttMode: 42 })).toEqual({ period: 14, ganttMode: DEFAULT_CHART_PREFERENCE.ganttMode });
    expect(parseChartPreference({ period: -3, ganttMode: "plan" })).toEqual({ period: DEFAULT_CHART_PREFERENCE.period, ganttMode: "plan" });
  });

  it("reads a period stored by name as its days, all time as 0", () => {
    expect(parseChartPreference({ period: "week" }).period).toBe(7);
    expect(parseChartPreference({ period: "month" }).period).toBe(30);
    expect(parseChartPreference({ period: "all" }).period).toBe(ALL_TIME);
    expect(parseChartPreference({ period: "toString" }).period).toBe(DEFAULT_CHART_PREFERENCE.period);
  });

  it("opens on the last 7 days and the facts", () => {
    expect(DEFAULT_CHART_PREFERENCE).toEqual({ period: 7, ganttMode: "fact" });
  });
});

describe("a board's chart preference", () => {
  it("survives a reload, board by board", () => {
    setChartPreference("board:A", { period: 45, ganttMode: "both" });
    setChartPreference("board:B", { period: ALL_TIME, ganttMode: "plan" });
    expect(loadChartPreference("board:A")).toEqual({ period: 45, ganttMode: "both" });
    expect(loadChartPreference("board:B")).toEqual({ period: ALL_TIME, ganttMode: "plan" });
    expect(loadChartPreference("board:C")).toEqual(DEFAULT_CHART_PREFERENCE);
  });

  it("reads broken storage as the defaults", () => {
    window.localStorage.setItem(CHART_PREFERENCE_STORAGE_KEY, "{not json");
    expect(loadChartPreference("board:A")).toEqual(DEFAULT_CHART_PREFERENCE);
  });
});
