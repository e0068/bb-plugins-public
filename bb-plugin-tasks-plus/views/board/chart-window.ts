// Pure core of where a card's charts lie around today: the one stretch of
// time its burndown and its Gantt both draw, so today falls at the same spot
// across the card in every chart. No clock — "now" is handed in.
import { ALL_TIME, CHART_UNIT_MS, type CardChartPeriod, type ChartUnit, type TodayPlace } from "../../shared/enums.js";

const DAY_MS = 86_400_000;

/** A stretch of time, `[fromMs, toMs)`. */
export interface TimeWindow {
  fromMs: number;
  toMs: number;
}

export interface ChartWindowInput {
  period: CardChartPeriod;
  unit: ChartUnit;
  today: TodayPlace;
  nowMs: number;
  /** When the card's oldest sub-task was made — where all time opens. */
  oldestMs: number;
  /** Where the latest plan among the card's sub-tasks ends; null without plans. */
  latestPlanMs: number | null;
}

/**
 * The stretch a card's charts draw. A period of units is that long, today at
 * its right edge, in its exact middle or at its left edge. All time runs back
 * to the oldest sub-task and ahead to the latest plan — each at least a day,
 * so the window never closes up and today never sits on the far edge: today
 * right draws the past alone, today left the plans alone, and today centered
 * both halves as long as the longer of the two, today staying in the middle.
 */
export function chartWindow({ period, unit, today, nowMs, oldestMs, latestPlanMs }: ChartWindowInput): TimeWindow {
  const back = period === ALL_TIME ? Math.max(nowMs - oldestMs, DAY_MS) : period * CHART_UNIT_MS[unit];
  const ahead = period === ALL_TIME ? Math.max((latestPlanMs ?? nowMs) - nowMs, DAY_MS) : back;
  switch (today) {
    case "right":
      return { fromMs: nowMs - back, toMs: nowMs };
    case "center": {
      const half = period === ALL_TIME ? Math.max(back, ahead) : back / 2;
      return { fromMs: nowMs - half, toMs: nowMs + half };
    }
    case "left":
      return { fromMs: nowMs, toMs: nowMs + ahead };
  }
}

/** Where `ms` falls across the window: 0 at its start, 1 at its end. */
export const placeIn = ({ fromMs, toMs }: TimeWindow, ms: number): number => (ms - fromMs) / (toMs - fromMs);
