import { ALL_TIME, GANTT_MODES, MAX_CARD_CHART_DAYS, type CardChartPeriod, type GanttMode } from "../../shared/enums.js";
import { isRecord, oneOf, perBoardStore } from "./per-board-store.js";

/**
 * How a board's cards draw their charts — the days the burndown and the
 * Gantt look back over, and what the Gantt shows — one per board, in the
 * browser profile. Kept apart from the board layout: a chart setting is not
 * a filter, and changing it must not offer to save a view.
 */
export const CHART_PREFERENCE_STORAGE_KEY = "bb-tasks:board-charts";

export interface ChartPreference {
  period: CardChartPeriod;
  ganttMode: GanttMode;
}

export const DEFAULT_CHART_PREFERENCE: ChartPreference = { period: 7, ganttMode: "fact" };

/** The periods the board offered by name before it took a day count. */
const NAMED_PERIODS: ReadonlyMap<unknown, CardChartPeriod> = new Map([["week", 7], ["month", 30], ["all", ALL_TIME]]);

/** A day count as the board takes it: a whole number from 0 (all time) to the longest period; anything else is null. */
export function parseChartPeriod(raw: unknown): CardChartPeriod | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= MAX_CARD_CHART_DAYS ? raw : null;
}

/** Any stored value as a whole preference: each field that is not one of its options falls back on its own; a period stored by name reads as its days. */
export function parseChartPreference(raw: unknown): ChartPreference {
  const record = isRecord(raw) ? raw : {};
  return {
    period: parseChartPeriod(record.period) ?? NAMED_PERIODS.get(record.period) ?? DEFAULT_CHART_PREFERENCE.period,
    ganttMode: oneOf(GANTT_MODES, record.ganttMode, DEFAULT_CHART_PREFERENCE.ganttMode),
  };
}

const store = perBoardStore(CHART_PREFERENCE_STORAGE_KEY, parseChartPreference);

export const loadChartPreference = store.load;
export const setChartPreference = store.set;
/** Reactive chart preference of one board. */
export const useChartPreference = store.use;
