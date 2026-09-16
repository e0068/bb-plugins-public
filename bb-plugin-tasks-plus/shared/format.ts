/** Presentation formatters shared by the app: pure, no clock of their own. */

const MINUTE_MS = 60_000;

/**
 * "just now" / "4m ago" / "3h ago" / "2d ago"; a calendar date once the
 * moment is 30 days or older. Timestamps in the future read as "just now".
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
  return new Date(then).toLocaleDateString();
}

/** "512 B" / "204 KB" / "2.5 MB" — the attachment size cadence. */
export function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
