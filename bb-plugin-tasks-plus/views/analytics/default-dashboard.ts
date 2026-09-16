// Pure model of the analytics screen (BBPL-259): the default section layout,
// the filter state, and the time window each D/W/M cut resolves to. No React —
// the view (AnalyticsDashboard.tsx) renders this, and it stays testable on its
// own. Imports the shared engine by subpath so this pulls no chart/react code.
import { addSection, type DashboardConfig, emptyDashboard } from "./dashboard-layout";
import { type Window, windowStartMs } from "../../packages/analytics-viz/core/time-window";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The widget kinds this dashboard maps its sections to. */
export const SECTION_KINDS = ["status-snapshot", "throughput", "status-distribution"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** What the screen is filtered to: a rolling window and, optionally, one project. */
export interface AnalyticsFilter {
  window: Window;
  /** null = every project the board knows. */
  projectId: string | null;
}

export const DEFAULT_FILTER: AnalyticsFilter = { window: "week", projectId: null };

/** The bucketed window the series RPC is asked for, given a filter and "now". */
export interface SeriesWindow {
  fromMs: number;
  toMs: number;
  binMs: number;
}

/**
 * The concrete `[fromMs, toMs)` and bin size a filter resolves to at `nowMs`.
 * Rolling, from the shared windowStartMs; the bin is an hour for the day cut
 * (24 columns) and a day for the wider cuts (7 / 30 columns) — enough
 * resolution to read a trend without a column per minute.
 */
export function seriesWindowFor(filter: AnalyticsFilter, nowMs: number): SeriesWindow {
  return {
    fromMs: windowStartMs(filter.window, nowMs),
    toMs: nowMs,
    binMs: filter.window === "day" ? HOUR_MS : DAY_MS,
  };
}

/**
 * The dashboard a user sees before touching anything: a snapshot tile row
 * across the top, a throughput chart, and a status-distribution lane. Ids are
 * the section kinds — this dashboard has one section per kind, so kind doubles
 * as a stable id. Every rect fits the 12-column grid.
 */
export function defaultAnalyticsDashboard(): DashboardConfig {
  const sections = [
    { id: "status-snapshot", kind: "status-snapshot" satisfies SectionKind, x: 0, y: 0, w: 12, h: 2, settings: {} },
    { id: "throughput", kind: "throughput" satisfies SectionKind, x: 0, y: 2, w: 8, h: 4, settings: {} },
    { id: "status-distribution", kind: "status-distribution" satisfies SectionKind, x: 8, y: 2, w: 4, h: 4, settings: {} },
  ];
  return sections.reduce((config, section) => addSection(config, section), emptyDashboard());
}
