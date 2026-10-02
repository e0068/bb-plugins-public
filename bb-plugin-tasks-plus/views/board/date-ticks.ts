// Pure core of the dates written under a card's charts: which round moments
// inside the window get a date, as thickly as the board asks. Round on the
// viewer's calendar — whole minutes and hours of the day, midnights, Mondays,
// the first of a month — so a date stays put as the window slides.
import type { DateDensity } from "../../shared/enums.js";
import { placeIn, type TimeWindow } from "./chart-window.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** At most this many dates in a window, by density. */
const MOST_DATES: Record<DateDensity, number> = { few: 3, some: 5, many: 8 };

/** A run of round moments: every `count` minutes of the day, midnights, Mondays or firsts of a month. */
type Step = { kind: "minutes" | "days" | "weeks" | "months"; count: number };

/** The steps from finest to coarsest; a window too long for the last one steps by round numbers of years (`yearsStep`). */
const STEPS: readonly Step[] = [
  ...[1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720].map((count) => ({ kind: "minutes" as const, count })),
  ...[1, 2].map((count) => ({ kind: "days" as const, count })),
  ...[1, 2].map((count) => ({ kind: "weeks" as const, count })),
  ...[1, 3, 6, 12, 24, 60, 120].map((count) => ({ kind: "months" as const, count })),
];

/** The shortest a step can be on the calendar — a day loses an hour to summer time, a month is 28 days at least. */
function shortestMs({ kind, count }: Step): number {
  switch (kind) {
    case "minutes":
      return count * MINUTE_MS;
    case "days":
      return count * (DAY_MS - HOUR_MS);
    case "weeks":
      return count * (7 * DAY_MS - HOUR_MS);
    case "months":
      return count * 28 * DAY_MS;
  }
}

/** Whole years a step takes so a window writes no more than `most` dates: 1, 2 or 5 times a power of ten. */
function yearsStep(spanMs: number, most: number): Step {
  const years = Math.ceil(spanMs / (most * shortestMs({ kind: "months", count: 12 })));
  const power = 10 ** Math.floor(Math.log10(years));
  const round = [1, 2, 5, 10].map((times) => times * power).find((candidate) => candidate >= years)!;
  return { kind: "months", count: 12 * round };
}

/** A day's own number, counted from 1970 on the viewer's calendar — what days and weeks are counted by. */
const dayNumber = (date: Date) => Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);

/** The step's round moments from the window's first day on, past its end: generous, the caller cuts. */
function roundMoments(step: Step, { fromMs, toMs }: TimeWindow): number[] {
  const start = new Date(fromMs);
  const [year, month, day] = [start.getFullYear(), start.getMonth(), start.getDate()];
  // Minutes count `count` at a time from the round moment at or before the
  // window's start, on the first day's clock; the calendar steps go one at a
  // time and keep every `count`-th.
  const firstMinute = Math.floor((start.getHours() * 60 + start.getMinutes()) / step.count) * step.count;
  const length =
    step.kind === "minutes"
      ? Math.ceil((toMs - fromMs) / shortestMs(step)) + 2
      : Math.ceil((toMs - fromMs) / shortestMs({ ...step, count: 1 })) + 2 * step.count + 2;
  const nth = (index: number): Date => {
    switch (step.kind) {
      case "minutes":
        return new Date(year, month, day, 0, firstMinute + index * step.count);
      case "days":
        return new Date(year, month, day + index);
      case "weeks":
        // Mondays, the first on or before the window's first day.
        return new Date(year, month, day - ((start.getDay() + 6) % 7) + 7 * index);
      case "months":
        return new Date(year, month + index, 1);
    }
  };
  const counted = (date: Date): boolean => {
    switch (step.kind) {
      case "minutes":
        return true;
      case "days":
        return dayNumber(date) % step.count === 0;
      case "weeks":
        return Math.floor(dayNumber(date) / 7) % step.count === 0;
      case "months":
        return (date.getFullYear() * 12 + date.getMonth()) % step.count === 0;
    }
  };
  return Array.from({ length }, (_, index) => nth(index)).filter(counted).map((date) => date.getTime());
}

/** A date under the charts: when, where across them, and whether it names a time of day rather than a day. */
export interface DateTick {
  ms: number;
  at: number;
  withTime: boolean;
}

/**
 * The dates inside the window, oldest first: the finest step that writes no
 * more than the density allows — past the table, a round number of years. A
 * step of minutes or hours writes the time, except at midnight, where it
 * names the day.
 */
export function dateTicks(window: TimeWindow, density: DateDensity): DateTick[] {
  const spanMs = window.toMs - window.fromMs;
  const most = MOST_DATES[density];
  const step = STEPS.find((candidate) => Math.ceil(spanMs / shortestMs(candidate)) <= most) ?? yearsStep(spanMs, most);
  const inside = [...new Set(roundMoments(step, window))].filter((ms) => ms > window.fromMs && ms < window.toMs);
  return inside.map((ms) => {
    const date = new Date(ms);
    const midnight = date.getHours() === 0 && date.getMinutes() === 0;
    return { ms, at: placeIn(window, ms), withTime: step.kind === "minutes" && !midnight };
  });
}
