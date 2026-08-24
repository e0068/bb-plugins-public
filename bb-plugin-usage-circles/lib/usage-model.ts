// Layer 1 — pure logic. No DOM, no SDK calls: turns one Claude Code usage
// window from bb.sdk.system.usageLimits() into a display-ready model.
// See memory/decisions/usage-rings-window-duration.md for why duration is
// inferred from the label instead of window position — and its 2026-08-21
// correction: live data labels the 5-hour window "Current session", not
// "5-hour limit", so an explicit hour count in the label is a fallback, not
// the primary signal.

export type UsageTier = "blue" | "yellow" | "red";

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

export function tierForUsedPercent(usedPercent: number): UsageTier {
  if (usedPercent >= 90) return "red";
  if (usedPercent >= 60) return "yellow";
  return "blue";
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

const WEEKDAYS_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"] as const;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function formatAbsoluteReset(resetsAt: string | null): string {
  if (resetsAt === null) return "—";
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return "—";
  const weekday = WEEKDAYS_RU[date.getDay()];
  return `${weekday} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatRelativeReset(resetsAt: string | null, nowMs: number): string {
  if (resetsAt === null) return "—";
  const target = new Date(resetsAt).getTime();
  if (Number.isNaN(target)) return "—";
  const remainingMs = target - nowMs;
  if (remainingMs <= 0) return "меньше минуты";

  const days = Math.floor(remainingMs / DAY_MS);
  const hours = Math.floor((remainingMs % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((remainingMs % HOUR_MS) / 60_000);

  if (days > 0) return `${days}д ${hours}ч`;
  if (hours > 0) return `${hours}ч ${minutes}мин`;
  return `${minutes}мин`;
}

export function buildUsageWindowModel(window: UsageWindowInput, nowMs: number): UsageWindowModel {
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
    tier: tierForUsedPercent(usedPercent),
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
      return "Claude Code не установлен";
    case "unauthenticated":
      return "Не авторизовано";
    case "expired":
      return "Сессия авторизации истекла";
    case "error":
      return message ?? "Не удалось получить данные";
  }
}

// ---------------------------------------------------------------------------
// Narrowing the SDK response. bb.sdk.system.usageLimits()'s `claudeCode` field
// also carries accountEmail/planLabel/cost we don't render; server.ts maps it
// down to just what the RPC contract exposes with normalizeUsage below, and
// both server and sidebar-widget share UsageResultWire as that wire shape.

export type UsageResultWire =
  | { status: "ok"; windows: UsageWindowInput[] }
  | { status: "not_installed" }
  | { status: "unauthenticated" }
  | { status: "expired" }
  | { status: "error"; message: string };

interface ClaudeCodeUsageInput {
  status: "ok" | UsageProviderErrorStatus;
  windows?: Array<{ label: string; usedPercent: number; resetsAt: string | null }>;
  message?: string;
}

export function normalizeUsage(claudeCode: ClaudeCodeUsageInput): UsageResultWire {
  if (claudeCode.status === "ok") {
    return {
      status: "ok",
      windows: (claudeCode.windows ?? []).map((window) => ({
        label: window.label,
        usedPercent: window.usedPercent,
        resetsAt: window.resetsAt,
      })),
    };
  }
  if (claudeCode.status === "error") {
    return { status: "error", message: claudeCode.message ?? "Не удалось получить данные" };
  }
  return { status: claudeCode.status };
}
