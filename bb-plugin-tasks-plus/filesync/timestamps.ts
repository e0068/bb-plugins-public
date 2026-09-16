/** The two times a filesystem keeps for a file, in epoch milliseconds. */
export interface FileTimes {
  readonly birthtimeMs: number;
  readonly mtimeMs: number;
}

export interface TaskTimestamps {
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * When a task was created and last changed, taken from the file itself.
 *
 * The filesystem is the authority here, not the frontmatter: almost no task
 * file carries `created`/`updated` — they were only ever written by the
 * board — while every file on disk has both times, and they are true by
 * construction (see
 * decisions/tasks-every-file-in-a-status-folder-is-a-task.md).
 *
 * Two guards, because birth time is the less reliable of the pair:
 * filesystems that do not keep one report 0, and a file copied into place
 * gets a birth time later than the content it carries. In both cases the
 * modification time is the honest answer.
 */
export function taskTimestamps(times: FileTimes): TaskTimestamps {
  const updatedAt = new Date(times.mtimeMs).toISOString();
  const born =
    times.birthtimeMs > 0 && times.birthtimeMs < times.mtimeMs
      ? times.birthtimeMs
      : times.mtimeMs;
  return { createdAt: new Date(born).toISOString(), updatedAt };
}
