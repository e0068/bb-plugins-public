// Layer: shared, pure. A task's plan date — Start or Due — is a day,
// YYYY-MM-DD, or a day with a time, YYYY-MM-DDTHH:mm, both on the viewer's
// local calendar with no zone, the way the day alone always was. The one
// place the two forms are told apart: the schema, the file reader, the CLI
// and every label take them from here.

/** A day, optionally followed by a 24-hour time. */
export const PLAN_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

interface PlanDateParts {
  year: number;
  month: number;
  day: number;
  /** Minutes past midnight; null for a day without a time. */
  minutes: number | null;
}

/** The parts of a plan date, or null when it is not one: a malformed string, a day the calendar has not, or a time past 23:59. */
function partsOf(value: string): PlanDateParts | null {
  const match = PLAN_DATE_PATTERN.exec(value);
  if (match === null) return null;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number) as [number, number, number];
  const real = new Date(Date.UTC(year, month - 1, day));
  if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) return null;
  if (match[4] === undefined) return { year, month, day, minutes: null };
  const [hours, minutes] = [Number(match[4]), Number(match[5])];
  return hours > 23 || minutes > 59 ? null : { year, month, day, minutes: hours * 60 + minutes };
}

/** Whether a string is a plan date in either form. */
export const isPlanDate = (value: string): boolean => partsOf(value) !== null;

/**
 * A plan date as a local moment. A day spans its own midnight to the next
 * one, so its start edge is the first and its end edge the second; a time is
 * that moment at either edge. A string that is not a plan date reads as NaN.
 */
export function planDateMs(value: string, edge: "start" | "end"): number {
  const parts = partsOf(value);
  if (parts === null) return Number.NaN;
  const { year, month, day, minutes } = parts;
  return minutes === null
    ? new Date(year, month - 1, day + (edge === "end" ? 1 : 0)).getTime()
    : new Date(year, month - 1, day, Math.floor(minutes / 60), minutes % 60).getTime();
}

/** The viewer's own locale, as Intl reads an empty list. */
export const VIEWER_LOCALE: Intl.LocalesArgument = [];

/**
 * "Oct 3", "Oct 3, 09:05", "Jan 2, 2027" — the year only outside `today`'s;
 * the day in `locale`, the time always 24-hour; a string that is not a plan
 * date as it is.
 */
export function formatPlanDate(value: string, today: Date = new Date(), locale: Intl.LocalesArgument = "en-US"): string {
  const parts = partsOf(value);
  if (parts === null) return value;
  const date = new Date(parts.year, parts.month - 1, parts.day);
  const label = date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(parts.year === today.getFullYear() ? {} : { year: "numeric" }),
  });
  if (parts.minutes === null) return label;
  const time = `${String(Math.floor(parts.minutes / 60)).padStart(2, "0")}:${String(parts.minutes % 60).padStart(2, "0")}`;
  return `${label}, ${time}`;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** A local moment's day as a plan date, YYYY-MM-DD. */
export const planDayOf = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/** A local moment as a plan date with its time, YYYY-MM-DDTHH:mm — seconds dropped. */
export const planMomentOf = (date: Date): string => `${planDayOf(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

/** The day `days` calendar days after `today`'s, as a plan date. */
export function planDayFrom(today: Date, days: number): string {
  return planDayOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
}
