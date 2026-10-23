// Layer 1 — pure logic. No IO, no SDK: the Kimi coding API's quota payload
// (GET {base}/usages, see docs/specs/BBPL-935-usage-circles-kolca-limitov-kimi.md)
// becomes the same window model the host reports for Claude Code and Codex,
// and its HTTP failures become the same provider statuses. The API reports
// only each window's used ratio and reset time — never the window's start.
import type { UsageResultWire, UsageWindowInput } from "./usage-model";

/**
 * The quota windows of a Kimi membership, in the order the limits window
 * shows them. Labels deliberately match the patterns inferWindowDurationMs
 * and windowKindOf already read: "Current session" is the 5-hour window,
 * "Weekly limit" the legacy-plan weekly one, and both monthly ones carry
 * "month" in their label.
 */
const KIMI_WINDOWS = [
  { key: "limit_5h", label: "Current session" },
  { key: "limit_7d", label: "Weekly limit" },
  { key: "limit_month_total", label: "Monthly limit" },
  { key: "limit_month_code", label: "Monthly limit (Kimi Code)" },
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** used_ratio 0..1 (the odd server sends it as a string) as a whole percent; unreadable — undefined. */
function ratioPercent(value: unknown): number | undefined {
  const ratio = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(ratio) ? Math.round(ratio * 100) : undefined;
}

/** The windows the payload reports, in KIMI_WINDOWS order; unknown keys and unreadable entries are skipped. */
export function parseKimiUsages(payload: unknown): UsageWindowInput[] {
  if (!isRecord(payload)) return [];
  const usages = payload.usages;
  if (!isRecord(usages)) return [];
  return KIMI_WINDOWS.flatMap(({ key, label }) => {
    const entry = usages[key];
    if (!isRecord(entry)) return [];
    const usedPercent = ratioPercent(entry.used_ratio);
    if (usedPercent === undefined) return [];
    const reset = entry.reset_time;
    return [{ label, usedPercent, resetsAt: typeof reset === "string" && reset.length > 0 ? reset : null }];
  });
}

/**
 * The quota endpoint's non-200 answer as a provider status: 401/403 is a
 * signed-out account, 404 is how the API answers an account without a Kimi
 * For Coding plan (the CLI reads it the same way), anything else is a plain
 * failure with its status in the message.
 */
export function mapKimiHttpError(status: number): UsageResultWire {
  if (status === 401 || status === 403) return { status: "unauthenticated" };
  if (status === 404) return { status: "error", message: "No Kimi For Coding plan on this account" };
  return { status: "error", message: `Failed to fetch usage: HTTP ${status}` };
}
