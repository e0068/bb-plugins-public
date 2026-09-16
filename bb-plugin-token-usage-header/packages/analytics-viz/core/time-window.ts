// Rolling day/week/month windows — the D/W/M cuts every analytics surface
// offers, lifted out of bb-plugin-token-usage-header (project-costs.ts) so it
// no longer belongs to any one plugin.
//
// Pure and total: no clock. "Now" arrives as a number from the caller — the
// same convention that lets the windows be tested without freezing time.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The rolling cuts, shortest first — the order a D / W / M switch renders them in. */
export const WINDOWS = ["day", "week", "month"] as const;
export type Window = (typeof WINDOWS)[number];

/**
 * Length of each window. Rolling, not calendar: "day" is the last 24 hours,
 * not today since midnight — the same call token-usage made in
 * memory/decisions/usage-pie-rolling-windows.md, now shared.
 */
export const WINDOW_MS: Readonly<Record<Window, number>> = Object.freeze({
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
});

/** Epoch ms the window opens at, given "now". */
export function windowStartMs(window: Window, nowMs: number): number {
  return nowMs - WINDOW_MS[window];
}
