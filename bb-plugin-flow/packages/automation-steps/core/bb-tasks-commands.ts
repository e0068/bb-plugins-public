// Layer 1 — builds argv for the `bb tasks` CLI and parses its JSON output.
// Zero effects: the actual process is spawned by src/wiring/bb-cli-client.ts.

export type LinkedTaskStatus = "in_review" | "done";

export function currentTasksArgs(threadId: string): string[] {
  return ["tasks", "current", "--thread", threadId, "--json"];
}

export function markTaskStatusArgs(key: string, status: LinkedTaskStatus): string[] {
  return ["tasks", "update", key, "--status", status, "--json"];
}

/**
 * The environment a `bb tasks` call needs, on top of the caller's own.
 *
 * A task file written from a thread with a worktree lives in that worktree
 * until the branch lands in main, and `bb tasks` only looks into the tree of
 * the thread named by BB_THREAD_ID. `--thread` alone picks WHOSE tasks to
 * list, not WHERE to look for them: without the variable the CLI sees main
 * and nothing else, exits 0 and reports an empty list. The plugin host's
 * process has no thread of its own, so the call has to carry one — which is
 * how `bb.tasks-done` came to tick green while the task stayed in progress.
 */
export function linkedTaskEnv(threadId: string): Record<string, string> {
  return { BB_THREAD_ID: threadId };
}

export interface LinkedTask {
  key: string;
  /** Empty when the CLI reports no title — a key alone still names the task. */
  title: string;
  /** The task file's name, from the id `<project>:<slug>`; absent when the CLI gives no such id. */
  slug?: string;
}

const slugOf = (id: unknown): string | undefined => {
  if (typeof id !== "string") return undefined;
  const at = id.indexOf(":");
  return at < 0 || at === id.length - 1 ? undefined : id.slice(at + 1);
};

/**
 * The tasks linked to a thread, read from `bb tasks current --json`'s stdout
 * (`{"threadId": "...", "tasks": [{"key": "...", "title": "...", ...}, ...]}`).
 * Malformed JSON, an unexpected shape, or a task without a string `key`
 * degrades to an omission rather than a throw — Tasks+ being absent or the
 * CLI's shape changing must not break archiving or PR creation, which is
 * what this feeds.
 */
export function parseLinkedTasks(stdout: string): LinkedTask[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const tasks = (parsed as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks.flatMap((task) => {
    if (typeof task !== "object" || task === null) return [];
    const { key, title, id } = task as { key?: unknown; title?: unknown; id?: unknown };
    if (typeof key !== "string") return [];
    const slug = slugOf(id);
    return [{ key, title: typeof title === "string" ? title : "", ...(slug === undefined ? {} : { slug }) }];
  });
}
