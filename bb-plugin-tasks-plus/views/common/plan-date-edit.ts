// Layer: views/common, pure. The edits a plan date picker makes to a value —
// a day, optionally with a time (shared/plan-date.ts) — kept apart from the
// picker so every place that sets Start or Due edits the value the same way.
import { planDayOf } from "../../shared/plan-date.js";

/** The value's day, YYYY-MM-DD, or "" for no value. */
export const dayOf = (value: string | null): string => value?.slice(0, 10) ?? "";

/** The value's time, HH:mm, or "" for a day without one. */
export const timeOf = (value: string | null): string => value?.slice(11) ?? "";

const joined = (day: string, time: string): string => (time === "" ? day : `${day}T${time}`);

/** The value moved to `day`, its time kept. */
export const withDay = (value: string | null, day: string): string => joined(day, timeOf(value));

/**
 * The value at `time` — "" drops the time and keeps the day. A value with no
 * day yet takes `today`'s: a time alone is not a plan date. Dropping the time
 * of no value leaves no value.
 */
export function withTime(value: string | null, time: string, today: Date): string | null {
  if (value === null && time === "") return null;
  return joined(value === null ? planDayOf(today) : dayOf(value), time);
}
