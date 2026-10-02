// Pure helpers of the analytics tiles (tile-charts.tsx): a least-squares
// trend for the burndown forecast, and durations in words. No React.

// The trend moved to the analytics core, where the card burndown forecasts with it too.
export { trendOf, type Trend } from "../../analytics/trend.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A duration the way the charts print it: "25 min", "5.5 h", "1.8 d". */
export function formatDuration(ms: number): string {
  if (ms < HOUR_MS) return `${Math.round(ms / MINUTE_MS)} min`;
  if (ms < DAY_MS) return `${(ms / HOUR_MS).toFixed(1)} h`;
  return `${(ms / DAY_MS).toFixed(1)} d`;
}
