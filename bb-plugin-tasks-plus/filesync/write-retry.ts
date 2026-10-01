import { WriteConflict } from "./task-repo.js";

/** A write that lost the race more often than the retries allow. */
export class TaskWriteConflict extends Error {
  readonly code = "task_write_conflict" as const;
  constructor() {
    super("the task was changed on another machine while it was being written; try again");
    this.name = "TaskWriteConflict";
  }
}

const DEFAULT_ATTEMPTS = 3;

/**
 * Runs a write; when it loses a race (`WriteConflict`) catches up with
 * `resync` and runs it again from a fresh read — at most `attempts` runs in
 * all, then gives up with `TaskWriteConflict`. Any other failure passes at once.
 */
export async function retryOnConflict<T>(
  run: () => Promise<T>,
  resync: () => Promise<void>,
  attempts: number = DEFAULT_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof WriteConflict)) throw error;
      if (attempt >= attempts) throw new TaskWriteConflict();
      await resync();
    }
  }
}
