/**
 * Time in whole minutes and money in dollars — the five planning fields of a
 * task (planned/actual time, budget/limit/cost). Pure and dependency-free so
 * the frontend bundle, the file mapper and the CLI read and print the same way.
 */

export const AMOUNT_FIELDS = [
  "plannedMinutes",
  "actualMinutes",
  "budget",
  "budgetLimit",
  "cost",
] as const;

export type AmountField = (typeof AMOUNT_FIELDS)[number];

/** Dollars kept on whole cents, so sums never drift to 10.299999…. */
export function roundToCents(value: number): number {
  // Shift by the decimal string, not by `* 100`: 12.345 * 100 is 1234.4999…
  // and would round down, while "12.345e2" is exactly 1234.5.
  const shifted = Number(`${value}e2`);
  return Math.round(Number.isNaN(shifted) ? value * 100 : shifted) / 100;
}

/** A non-negative safe whole number of minutes, from a number or a string of plain digits; anything else is null. */
export function readMinutes(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

/** Non-negative dollars rounded to cents, from a number or a string with an optional leading "$"; anything else is null. */
export function readDollars(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\$?\s*\d+(\.\d+)?$/.test(value.trim())
        ? Number(value.trim().replace(/^\$\s*/, ""))
        : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? roundToCents(number) : null;
}

/** 45 → "45m", 120 → "2h", 150 → "2h 30m". */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** 34 → "$34", 34.1 → "$34.10". */
export function formatDollars(dollars: number): string {
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
