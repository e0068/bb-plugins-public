// Layer 1 — pure logic. No DOM, no SDK calls: turns one provider's usage
// window from bb.sdk.system.usageLimits() into a display-ready model.
// See memory/decisions/usage-rings-window-duration.md for why duration is
// inferred from the label instead of window position — and its 2026-08-21
// correction: live data labels the 5-hour window "Current session", not
// "5-hour limit", so an explicit hour count in the label is a fallback, not
// the primary signal.

/** "unknown" only in pace mode: too little of the window has passed to judge the pace. */
export type UsageTier = "blue" | "yellow" | "red" | "unknown";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const DEFAULT_SESSION_HOURS = 5;

const HOUR_LABEL_PATTERN = /(\d+)\s*-?\s*hour/i;
const SESSION_LABEL_PATTERN = /session/i;

export interface UsageWindowInput {
  label: string;
  usedPercent: number;
  resetsAt: string | null;
}

export interface UsageWindowModel {
  label: string;
  usedPercent: number;
  tier: UsageTier;
  /** 1 for an hour-cycle window (continuous arc), 7 for a weekly one (day segments). */
  segmentCount: 1 | 7;
  /** Share of the window elapsed since it last reset, 0..1; null when resetsAt is unknown. */
  elapsedFraction: number | null;
  /** How many of `segmentCount` segments are fully elapsed; null when resetsAt is unknown. */
  segmentsElapsed: number | null;
  resetsAt: string | null;
  resetRelativeLabel: string;
  resetAbsoluteLabel: string;
}

// ---------------------------------------------------------------------------
// Ring color. Two modes, each read against its own yellow/red pair:
// "usage" by the share of the limit burned, "pace" by how many times faster
// the limit burns than the window's time runs out. See
// memory/specs/BBPL-302-usage-circles-codex-limits.md.

export interface Thresholds {
  readonly yellow: number;
  readonly red: number;
}

export interface Coloring {
  readonly mode: "usage" | "pace";
  /** Percent of the limit burned. */
  readonly usage: Thresholds;
  /** Percent by which usage runs ahead of elapsed time: 20 means 1.2x. */
  readonly pace: Thresholds;
}

/** The "Ring color" dropdown, as the settings page shows and stores it. */
export const COLORING_OPTIONS = ["Share of limit used", "Usage ahead of time"] as const;

const DEFAULT_USAGE_THRESHOLDS: Thresholds = { yellow: 60, red: 90 };
const DEFAULT_PACE_THRESHOLDS: Thresholds = { yellow: 20, red: 50 };

export const DEFAULT_COLORING: Coloring = {
  mode: "usage",
  usage: DEFAULT_USAGE_THRESHOLDS,
  pace: DEFAULT_PACE_THRESHOLDS,
};

/**
 * Below this share of the window elapsed the pace is not judged at all — the
 * ratio of usage to a near-zero time says nothing. 0.001% of the window: under
 * a fifth of a second of a 5-hour session, six seconds of a week.
 */
export const PACE_MIN_ELAPSED = 0.00001;

/**
 * Red is checked first, so swapped thresholds leave an empty yellow band rather
 * than an error. `reaches` says whether the window's measure has hit a threshold.
 */
function tierByThresholds(reaches: (threshold: number) => boolean, thresholds: Thresholds): UsageTier {
  if (reaches(thresholds.red)) return "red";
  if (reaches(thresholds.yellow)) return "yellow";
  return "blue";
}

export function tierForWindow(usedPercent: number, elapsedFraction: number | null, coloring: Coloring): UsageTier {
  if (coloring.mode === "usage") return tierByThresholds((threshold) => usedPercent >= threshold, coloring.usage);
  if (elapsedFraction === null || elapsedFraction < PACE_MIN_ELAPSED) return "unknown";
  // Usage is `lead`% ahead of time when used / elapsed >= 1 + lead / 100.
  // Cross-multiplied rather than divided: (60 / 50 - 1) * 100 is
  // 19.999999999999996 in floating point, which would drop a window sitting
  // exactly on the yellow threshold back to blue.
  const elapsedPercent = elapsedFraction * 100;
  return tierByThresholds((lead) => usedPercent * 100 >= elapsedPercent * (100 + lead), coloring.pace);
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The coloring settings as the host stores them — a dropdown label and four
 * numbers — into a Coloring. Parse, don't validate: anything unreadable falls
 * back to the default, so a broken setting never takes the colors away.
 */
export function parseColoring(raw: {
  mode: unknown;
  usageYellow: unknown;
  usageRed: unknown;
  paceYellow: unknown;
  paceRed: unknown;
}): Coloring {
  const percent = (value: unknown, fallback: number) => clamp(finiteOr(value, fallback), 0, 100);
  const lead = (value: unknown, fallback: number) => Math.max(0, finiteOr(value, fallback));
  return {
    mode: raw.mode === COLORING_OPTIONS[1] ? "pace" : "usage",
    usage: {
      yellow: percent(raw.usageYellow, DEFAULT_USAGE_THRESHOLDS.yellow),
      red: percent(raw.usageRed, DEFAULT_USAGE_THRESHOLDS.red),
    },
    pace: {
      yellow: lead(raw.paceYellow, DEFAULT_PACE_THRESHOLDS.yellow),
      red: lead(raw.paceRed, DEFAULT_PACE_THRESHOLDS.red),
    },
  };
}

export function inferWindowDurationMs(label: string): number {
  const hourMatch = HOUR_LABEL_PATTERN.exec(label);
  if (hourMatch !== null) {
    const hours = Number(hourMatch[1]);
    if (hours > 0) return hours * HOUR_MS;
  }
  if (SESSION_LABEL_PATTERN.test(label)) return DEFAULT_SESSION_HOURS * HOUR_MS;
  return WEEK_MS;
}

export function segmentCountForDuration(durationMs: number): 1 | 7 {
  return durationMs < WEEK_MS ? 1 : 7;
}

/**
 * Per-segment share of a segmented window that is already elapsed, 0..1 each:
 * 1 for a finished segment, a fraction for the one currently running, 0 for
 * the rest. Lets the weekly bar show progress inside the current day instead
 * of standing still until the day flips.
 */
export function segmentFillFractions(elapsedFraction: number | null, segmentCount: number): number[] {
  const elapsedSegments = Math.min(1, Math.max(0, elapsedFraction ?? 0)) * segmentCount;
  return Array.from({ length: segmentCount }, (_, index) => Math.min(1, Math.max(0, elapsedSegments - index)));
}

const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatAbsoluteReset(resetsAt: string | null): string {
  if (resetsAt === null) return "—";
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return "—";
  const weekday = WEEKDAYS_EN[date.getDay()];
  return `${weekday} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatRelativeReset(resetsAt: string | null, nowMs: number): string {
  if (resetsAt === null) return "—";
  const target = new Date(resetsAt).getTime();
  if (Number.isNaN(target)) return "—";
  const remainingMs = target - nowMs;
  if (remainingMs <= 0) return "less than a minute";

  const days = Math.floor(remainingMs / DAY_MS);
  const hours = Math.floor((remainingMs % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((remainingMs % HOUR_MS) / 60_000);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function buildUsageWindowModel(window: UsageWindowInput, nowMs: number, coloring: Coloring = DEFAULT_COLORING): UsageWindowModel {
  const usedPercent = Math.min(100, Math.max(0, window.usedPercent));
  const durationMs = inferWindowDurationMs(window.label);
  const segmentCount = segmentCountForDuration(durationMs);

  let elapsedFraction: number | null = null;
  let segmentsElapsed: number | null = null;
  if (window.resetsAt !== null) {
    const resetsAtMs = new Date(window.resetsAt).getTime();
    if (!Number.isNaN(resetsAtMs)) {
      const fraction = 1 - (resetsAtMs - nowMs) / durationMs;
      elapsedFraction = Math.min(1, Math.max(0, fraction));
      // elapsedFraction is already clamped to <= 1, so this can't exceed segmentCount.
      segmentsElapsed = Math.floor(elapsedFraction * segmentCount);
    }
  }

  return {
    label: window.label,
    usedPercent,
    tier: tierForWindow(usedPercent, elapsedFraction, coloring),
    segmentCount,
    elapsedFraction,
    segmentsElapsed,
    resetsAt: window.resetsAt,
    resetRelativeLabel: formatRelativeReset(window.resetsAt, nowMs),
    resetAbsoluteLabel: formatAbsoluteReset(window.resetsAt),
  };
}

/** Statuses `bb.sdk.system.usageLimits()` reports for a provider besides "ok". */
export type UsageProviderErrorStatus = "not_installed" | "unauthenticated" | "expired" | "error";

export function statusLabel(status: UsageProviderErrorStatus, message?: string): string {
  switch (status) {
    case "not_installed":
      return "Claude Code is not installed";
    case "unauthenticated":
      return "Not authenticated";
    case "expired":
      return "Authentication session expired";
    case "error":
      return message ?? "Failed to fetch data";
  }
}

// ---------------------------------------------------------------------------
// Narrowing the SDK response. bb.sdk.system.usageLimits()'s providers also
// carry accountEmail/planLabel/cost we don't render; server.ts maps each one
// down to just what the RPC contract exposes with normalizeUsage below, and
// both server and sidebar-widget share the wire shapes declared here, so the
// frontend never imports server.ts.

export type UsageResultWire =
  | { status: "ok"; windows: UsageWindowInput[] }
  | { status: "not_installed" }
  | { status: "unauthenticated" }
  | { status: "expired" }
  | { status: "error"; message: string };

export interface ProviderUsageInput {
  status: "ok" | UsageProviderErrorStatus;
  windows?: Array<{ label: string; usedPercent: number; resetsAt: string | null }>;
  message?: string;
}

/** The provider's declared brand color, per theme. */
export interface ProviderTint {
  readonly light: string;
  readonly dark: string;
}

/** Footer ring switches of one provider; `fable` only where the provider has that window. */
export interface ProviderToggles {
  readonly session: boolean;
  readonly weekly: boolean;
  readonly fable?: boolean;
}

export interface ProviderStateWire {
  id: string;
  title: string;
  logoUrl: string;
  tint: ProviderTint | null;
  toggles: ProviderToggles;
  usage: UsageResultWire;
}

export interface StateWire {
  openOnHover: boolean;
  coloring: Coloring;
  providers: ProviderStateWire[];
}

// bb.sdk.system.usageLimits() returns a dictionary keyed by providerId, where
// the keys are the hyphenated provider ids ("claude-code", "codex"), not
// camelCase. The SDK type declares a "claudeCode" field, so reading it
// directly silently gave undefined and the rings always showed "not
// installed" — see decisions/usage-provider-key-is-hyphenated.md. The
// camelCase key is kept as a fallback for claude-code on host builds still
// using the old key.
export function selectProvider(
  providers: Record<string, ProviderUsageInput | undefined> | undefined,
  providerId: string,
): ProviderUsageInput | undefined {
  if (!providers) return undefined;
  return providers[providerId] ?? (providerId === "claude-code" ? providers.claudeCode : undefined);
}

export function normalizeUsage(
  provider: ProviderUsageInput | undefined,
): UsageResultWire {
  // bb.sdk.system.usageLimits() may not return a provider at all (not
  // installed / not in this session / the host doesn't report subscription
  // data) — in that case provider === undefined. We treat it as not_installed
  // instead of failing on reading .status off undefined (otherwise getState
  // throws on every call and the rings never render — BP-52).
  if (!provider) return { status: "not_installed" };
  if (provider.status === "ok") {
    return {
      status: "ok",
      windows: (provider.windows ?? []).map((window) => ({
        label: window.label,
        usedPercent: window.usedPercent,
        resetsAt: window.resetsAt,
      })),
    };
  }
  if (provider.status === "error") {
    return { status: "error", message: provider.message ?? "Failed to fetch data" };
  }
  return { status: provider.status };
}
