// A straight line through a series, for the burndown forecasts: the flow
// charts (views/analytics) and a card's sub-task burndown (burndown.ts). Pure.

/** A straight line through a series: its value at the first column and its change per column. */
export interface Trend {
  start: number;
  slope: number;
}

/** Least-squares fit over column indices; none for fewer than two points. */
export function trendOf(values: readonly number[]): Trend | null {
  const n = values.length;
  if (n < 2) return null;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  const spread = values.reduce((sum, _, x) => sum + (x - meanX) ** 2, 0);
  const slope = values.reduce((sum, value, x) => sum + (x - meanX) * (value - meanY), 0) / spread;
  return { start: meanY - slope * meanX, slope };
}
