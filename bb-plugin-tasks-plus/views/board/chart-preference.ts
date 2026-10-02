import {
  ALL_TIME,
  CHART_UNITS,
  DATE_DENSITIES,
  DATE_PLACES,
  GANTT_MODES,
  MAX_CARD_CHART_PERIOD,
  TODAY_PLACES,
  type CardChartPeriod,
  type ChartUnit,
  type DateDensity,
  type DatePlace,
  type GanttMode,
  type TodayPlace,
} from "../../shared/enums.js";
import { isRecord, oneOf, perBoardStore } from "./per-board-store.js";

/**
 * How a board's cards draw their charts — how many days, hours or minutes
 * the burndown and the Gantt cover, where today stands among them, what the
 * Gantt shows, and where and how thickly the dates are written — one per
 * board, in the browser profile. Kept apart from the board layout: a chart setting is not
 * a filter, and changing it must not offer to save a view.
 */
export const CHART_PREFERENCE_STORAGE_KEY = "bb-tasks:board-charts";

export interface ChartPreference {
  period: CardChartPeriod;
  unit: ChartUnit;
  ganttMode: GanttMode;
  today: TodayPlace;
  dates: DatePlace;
  dateDensity: DateDensity;
}

/** A few dates under each chart: where the burndown wrote its weeks before dates were a choice. */
export const DEFAULT_CHART_PREFERENCE: ChartPreference = {
  period: 7,
  unit: "days",
  ganttMode: "fact",
  today: "right",
  dates: "charts",
  dateDensity: "few",
};

/** The periods the board offered by name before it took a day count. */
const NAMED_PERIODS: ReadonlyMap<unknown, CardChartPeriod> = new Map([["week", 7], ["month", 30], ["all", ALL_TIME]]);

/** A period as the board takes it: a whole number of units from 0 (all time) to the longest period; anything else is null. */
export function parseChartPeriod(raw: unknown): CardChartPeriod | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= MAX_CARD_CHART_PERIOD ? raw : null;
}

/** Any stored value as a whole preference: each field that is not one of its options falls back on its own; a period stored by name reads as its days. */
export function parseChartPreference(raw: unknown): ChartPreference {
  const record = isRecord(raw) ? raw : {};
  return {
    period: parseChartPeriod(record.period) ?? NAMED_PERIODS.get(record.period) ?? DEFAULT_CHART_PREFERENCE.period,
    unit: oneOf(CHART_UNITS, record.unit, DEFAULT_CHART_PREFERENCE.unit),
    ganttMode: oneOf(GANTT_MODES, record.ganttMode, DEFAULT_CHART_PREFERENCE.ganttMode),
    today: oneOf(TODAY_PLACES, record.today, DEFAULT_CHART_PREFERENCE.today),
    dates: oneOf(DATE_PLACES, record.dates, DEFAULT_CHART_PREFERENCE.dates),
    dateDensity: oneOf(DATE_DENSITIES, record.dateDensity, DEFAULT_CHART_PREFERENCE.dateDensity),
  };
}

const store = perBoardStore(CHART_PREFERENCE_STORAGE_KEY, parseChartPreference);

export const loadChartPreference = store.load;
export const setChartPreference = store.set;
/** Reactive chart preference of one board. */
export const useChartPreference = store.use;
