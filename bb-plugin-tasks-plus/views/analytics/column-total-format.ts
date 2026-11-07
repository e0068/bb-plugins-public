// Layer: views, pure. A column's total as the footer under the table writes it:
// money and time as the task table writes them, a count of values as a plain number.
import { formatDollars, formatMinutes } from "../../shared/amounts.js";
import type { TotalFn } from "../../shared/analytics-tile.js";
import type { QueryField } from "../../shared/enums.js";

const writers: Partial<Record<QueryField, (value: number) => string>> = {
  plannedMinutes: formatMinutes,
  actualMinutes: formatMinutes,
  budget: formatDollars,
  budgetLimit: formatDollars,
  cost: formatDollars,
};

/** The number a total shows; a dash where there was nothing to total. */
export function totalText(column: QueryField, fn: TotalFn, value: number | null): string {
  if (value === null) return "—";
  return fn === "unique" ? String(value) : (writers[column] ?? String)(value);
}
