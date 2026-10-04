// Layer: views/common, pure. A date field's value in one of the table's
// column formats (shared/enums.ts DATE_FORMATS). Two kinds of value meet
// here: a plan date — Start or Due, a day with an optional time on the
// viewer's calendar — and a moment — Created or Edited, an ISO timestamp.
import type { DateFormat } from "../../shared/enums.js";
import { formatPlanDate, planDateMs, planDayOf, planMomentOf } from "../../shared/plan-date.js";

export type DateValue = { kind: "plan"; value: string } | { kind: "moment"; iso: string };

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** "in 5m" / "3h ago" / "in 2d" / "4mo ago" — the distance between two moments, "now" under a minute. */
function formatDistance(ms: number, nowMs: number): string {
  const minutes = Math.round((ms - nowMs) / MINUTE_MS);
  const span = Math.abs(minutes);
  if (span === 0) return "now";
  const amount =
    span < 60
      ? `${span}m`
      : span < 60 * 24
        ? `${Math.round(span / 60)}h`
        : span < 60 * 24 * 60
          ? `${Math.round(span / (60 * 24))}d`
          : span < 60 * 24 * 365
            ? `${Math.round(span / (60 * 24 * 30))}mo`
            : `${Math.round(span / (60 * 24 * 365))}y`;
  return minutes > 0 ? `in ${amount}` : `${amount} ago`;
}

/** "today" / "tomorrow" / "yesterday" / "in 3d" / "3d ago" — a day with no time, counted in calendar days. */
function formatDayDistance(day: string, today: Date): string {
  const [dayMs, todayMs] = [planDateMs(day, "start"), planDateMs(planDayOf(today), "start")];
  const days = Math.round((dayMs - todayMs) / DAY_MS);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return formatDistance(dayMs, todayMs);
}

/** A plan date or a moment as the local plan string it reads as: a moment keeps its hours and minutes. */
const planStringOf = (value: DateValue): string | null => {
  if (value.kind === "plan") return value.value;
  const date = new Date(value.iso);
  return Number.isNaN(date.valueOf()) ? null : planMomentOf(date);
};

/**
 * A date field's label in `format`: "Oct 4, 14:34" for day and time — a plan
 * date without a time reads as its day —, "Oct 4" for the day alone, and the
 * distance from `now` for relative. An unreadable moment reads as "".
 */
export function formatDateValue(value: DateValue, format: DateFormat, now: Date): string {
  const plan = planStringOf(value);
  if (plan === null) return "";
  switch (format) {
    case "dateTime":
      return formatPlanDate(plan, now);
    case "date":
      return formatPlanDate(plan.slice(0, 10), now);
    case "relative":
      return plan.length === 10 ? formatDayDistance(plan, now) : formatDistance(planDateMs(plan, "start"), now.getTime());
  }
}
