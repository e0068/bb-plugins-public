// Calendar weeks for time-series charts: where a local week starts, which
// column of a chart a new week opens, and week columns over a whole history.
// Weeks start on Monday at the viewer's local midnight.
//
// Pure and total: no clock. "Now" arrives as a number from the caller; the
// local calendar is read through Date, so the viewer's time zone applies.

const DAYS_IN_WEEK = 7;
const WEEK_MS = DAYS_IN_WEEK * 86_400_000;

/** Local midnight of the Monday opening the week that holds `atMs`. */
export function mondayOf(atMs: number): number {
  const date = new Date(atMs);
  const sinceMonday = (date.getDay() + DAYS_IN_WEEK - 1) % DAYS_IN_WEEK;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - sinceMonday).getTime();
}

/** A new week inside a chart: the column it opens and its Monday. */
export interface WeekBreak {
  column: number;
  mondayMs: number;
}

/**
 * The columns a new week opens. `times` are the columns' own moments,
 * ascending — the starts of calendar columns or the ends of rolling ones:
 * column `i` opens a week when a Monday midnight lies in `(times[i-1], times[i]]`.
 * The first column has nothing before it and is never marked.
 */
export function weekBreaks(times: readonly number[]): WeekBreak[] {
  return times.flatMap((atMs, column) => {
    if (column === 0) return [];
    const mondayMs = mondayOf(atMs);
    return mondayMs > times[column - 1]! ? [{ column, mondayMs }] : [];
  });
}

/**
 * Week columns over a history: Monday midnights from the week holding
 * `startMs` through the one after the week holding `nowMs` — column `i` is
 * `[edges[i], edges[i + 1])`. A start after now gives now's week alone.
 */
export function weekEdgesSince(startMs: number, nowMs: number): number[] {
  const first = new Date(mondayOf(Math.min(startMs, nowMs)));
  // Rounded: a daylight-saving turn makes a week an hour longer or shorter.
  const weeks = Math.round((mondayOf(nowMs) - first.getTime()) / WEEK_MS) + 1;
  return Array.from({ length: weeks + 1 }, (_, week) =>
    new Date(first.getFullYear(), first.getMonth(), first.getDate() + week * DAYS_IN_WEEK).getTime(),
  );
}
