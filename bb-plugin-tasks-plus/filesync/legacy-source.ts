/** A source file reference recovered from a task's description text. */
export interface LegacySource {
  filePath: string;
  slug: string;
}

// Tasks created before file_tasks-backed sync existed had their source
// appended to the description as plain text: "Источник: <path> · slug:
// <slug>". Real sync (filesync/sync.ts) never writes this — it links
// file_tasks instead — so this only matches that earlier, superseded
// convention.
const SOURCE_MARKER = /Источник:\s*(\S+)\s*·\s*slug:\s*(\S+)/;

/**
 * Recovers a legacy "Источник: …" marker from a task description, so a task
 * seeded that way can still resolve a clickable source before it has (or
 * without ever getting) a real file_tasks link. Returns null when the
 * marker is absent or malformed.
 */
export function parseLegacySourceMarker(description: string): LegacySource | null {
  const match = SOURCE_MARKER.exec(description);
  if (!match) return null;
  const filePath = match[1]?.trim();
  const slug = match[2]?.trim();
  if (!filePath || !slug) return null;
  return { filePath, slug };
}
