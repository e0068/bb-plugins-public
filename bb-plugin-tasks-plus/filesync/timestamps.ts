/** The two times a filesystem keeps for a file, in epoch milliseconds. */
export interface FileTimes {
  readonly birthtimeMs: number;
  readonly mtimeMs: number;
}

export interface TaskTimestamps {
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The moment a frontmatter `created:` names — a string or the date YAML made of it; null when it names none. */
function declaredMs(declared: unknown): number | null {
  const ms = declared instanceof Date ? declared.getTime() : typeof declared === "string" ? Date.parse(declared) : Number.NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * When a task was created: the `created:` its text declares, when that is
 * a date no later than the last change, else `recorded` — what the store
 * recorded, as it spelled it. A file copied, a row migrated or a checkout rewritten records
 * the moment of the copy; the text keeps the moment the task was made.
 */
export function createdFrom(declared: unknown, recorded: string, updatedMs: number): string {
  const named = declaredMs(declared);
  return named !== null && named <= updatedMs ? new Date(named).toISOString() : recorded;
}

/**
 * When a task was created and last changed.
 *
 * The change comes from the file's modification time. The creation comes
 * from the `created:` the file declares, when it has one no later than the
 * last change: most files carry it, and git gives a file a new birth time
 * every time a checkout or a pull rewrites it, so a birth time alone counts
 * old tasks as made this week. A file without `created:` falls back to the
 * filesystem (see decisions/tasks-every-file-in-a-status-folder-is-a-task.md).
 *
 * Two guards, because birth time is the less reliable of the pair:
 * filesystems that do not keep one report 0, and a file copied into place
 * gets a birth time later than the content it carries. In both cases the
 * modification time is the honest answer.
 */
export function taskTimestamps(times: FileTimes, declared?: unknown): TaskTimestamps {
  const born = times.birthtimeMs > 0 && times.birthtimeMs < times.mtimeMs ? times.birthtimeMs : times.mtimeMs;
  return { createdAt: createdFrom(declared, new Date(born).toISOString(), times.mtimeMs), updatedAt: new Date(times.mtimeMs).toISOString() };
}
