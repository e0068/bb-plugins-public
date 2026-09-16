import { describe, expect, it } from "vitest";

import { parseDashboard, serializeDashboard } from "./dashboard-layout";
import {
  type AnalyticsFilter,
  DEFAULT_FILTER,
  defaultAnalyticsDashboard,
  SECTION_KINDS,
  seriesWindowFor,
} from "./default-dashboard";

describe("defaultAnalyticsDashboard", () => {
  it("has one section per widget kind, all within the 12-column grid", () => {
    const dashboard = defaultAnalyticsDashboard();
    expect(dashboard.sections.map((s) => s.kind).sort()).toEqual([...SECTION_KINDS].sort());
    for (const section of dashboard.sections) {
      expect(section.x + section.w).toBeLessThanOrEqual(12);
    }
  });

  it("serialises and parses back unchanged — it is a valid saved layout", () => {
    const dashboard = defaultAnalyticsDashboard();
    const serialized = serializeDashboard(dashboard);
    expect(serialized.ok).toBe(true);
    if (serialized.ok) expect(parseDashboard(serialized.json)).toEqual({ ok: true, config: dashboard });
  });
});

describe("seriesWindowFor", () => {
  const now = 1_000_000_000_000;

  it("opens the rolling window before now and closes at now", () => {
    for (const window of ["day", "week", "month"] as const) {
      const w = seriesWindowFor({ window, projectId: null }, now);
      expect(w.toMs).toBe(now);
      expect(w.fromMs).toBeLessThan(now);
      expect(w.binMs).toBeGreaterThan(0);
    }
  });

  it("bins the day cut by the hour and wider cuts by the day", () => {
    expect(seriesWindowFor({ window: "day", projectId: null }, now).binMs).toBe(3_600_000);
    expect(seriesWindowFor({ window: "week", projectId: null }, now).binMs).toBe(86_400_000);
    expect(seriesWindowFor({ window: "month", projectId: null }, now).binMs).toBe(86_400_000);
  });

  it("keeps the default filter on the week cut across every project", () => {
    const filter: AnalyticsFilter = DEFAULT_FILTER;
    expect(filter.window).toBe("week");
    expect(filter.projectId).toBeNull();
  });
});
