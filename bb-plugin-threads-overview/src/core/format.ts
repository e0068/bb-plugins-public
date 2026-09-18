// Pure relative-time label for "how long a thread has been waiting". Coarse on
// purpose — the queue cares about order of magnitude, not seconds. Layer 1.

/** A short Russian label: "только что", "5 мин", "2 ч", "3 дн". */
export function formatWaitingSince(nowMs: number, sinceMs: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - sinceMs) / 60000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.floor(hours / 24);
  return `${days} дн`;
}
