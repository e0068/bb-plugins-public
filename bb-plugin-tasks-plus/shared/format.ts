/** Presentation formatters shared by the app: pure, no clock of their own. */
import { formatPlanDate, planMomentOf } from "./plan-date.js";

const MINUTE_MS = 60_000;

/**
 * "just now" / "4m ago" / "3h ago" / "2d ago"; the date with its hours and
 * minutes once the moment is 30 days or older. Timestamps in the future read as "just now".
 * Unparseable input renders as an empty string.
 */
export function formatRelativeTime(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.round((nowMs - then) / MINUTE_MS));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatPlanDate(planMomentOf(new Date(then)), new Date(nowMs));
}

/** "512 B" / "204 KB" / "2.5 MB" — the attachment size cadence. */
export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** A board task's file name without `.md`: its id is `<board id>:<slug>`. */
export function slugOf(taskId: string): string {
  return taskId.slice(taskId.indexOf(":") + 1);
}

/** Whether a value is shaped like a board task's id: a board id, a colon, a slug. */
export function isTaskId(value: string): boolean {
  const colon = value.indexOf(":");
  return colon > 0 && colon < value.length - 1;
}

/** The board — the project — a board task's id names: the part before the colon. */
export function boardIdOf(taskId: string): string {
  return taskId.slice(0, Math.max(0, taskId.indexOf(":")));
}
