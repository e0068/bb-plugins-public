// Layer 3 (shell), the testable part — moves every task linked to a thread
// to a given status (`in_review` on PR creation, `done` before archiving).
// The sequence (list linked tasks → update each) is verified with a fake
// CliPorts, no real `bb` process; the actual spawn is in bb-cli-client.ts.
//
// A listing that RAN and refused (no Tasks+ installed, the thread was never
// linked) still degrades to "no linked tasks" rather than throwing: from
// here that case is indistinguishable from "genuinely nothing to link", and
// it is the common case for a thread with no Tasks+ in play at all, so it
// stays silent. A listing that could not run AT ALL is a different fact and
// is reported as `unavailable`: it means the promise "linked tasks get their
// status moved" was not kept and nobody would otherwise know — exactly how
// every transition died silently while `bb` was unreachable from the plugin
// host (see src/core/bb-cli-path.ts). Once a task IS found, a failed status
// update is likewise kept — the caller now knows there was a promise to
// keep; see archiveThread/createPr in server.ts, which surface both instead
// of reporting a plain success.
import { commentTaskArgs, currentTasksArgs, linkedTaskEnv, markTaskStatusArgs, parseLinkedTasks, parseSubtasks, showTaskArgs, type LinkedTask, type LinkedTaskStatus } from "../core/bb-tasks-commands";
import type { DoneHold } from "../core/branch-in-main";
import { cliRunMessage, type CliPorts } from "./bb-cli-run";

/** `slug` — the moved task's file name, when the CLI named it. */
export type TaskStatusResult = { key: string; ok: true; slug?: string } | { key: string; ok: false; reason: string };

export interface TaskStatusReport {
  /** Why no task could even be looked up, or null when the lookup ran. */
  unavailable: string | null;
  results: readonly TaskStatusResult[];
}

/** One task's update: the argv, and what to keep once the task took it. */
export interface TaskWrite {
  readonly args: string[];
  readonly written?: () => Promise<void>;
}

type Listed = { unavailable: string; tasks?: undefined } | { unavailable: null; tasks: LinkedTask[] };

/** The tasks linked to a thread; a listing that ran and refused reads as no tasks. */
async function listLinkedTasks(ports: CliPorts, threadId: string): Promise<Listed> {
  const listed = await ports.run(currentTasksArgs(threadId), linkedTaskEnv(threadId));
  if (listed.kind === "unavailable") return { unavailable: listed.reason };
  return { unavailable: null, tasks: listed.code === 0 ? parseLinkedTasks(listed.stdout) : [] };
}

/**
 * Lists the tasks linked to a thread and runs one `bb tasks update` per task,
 * with the thread named for the CLI. Shared by every step that edits the
 * thread's tasks: the status moves here, the plan and the spend in
 * ./task-figures.ts.
 */
export async function updateLinkedTasks(
  ports: CliPorts,
  threadId: string,
  writeOf: (task: LinkedTask, all: readonly LinkedTask[]) => Promise<TaskWrite>,
): Promise<TaskStatusReport> {
  const env = linkedTaskEnv(threadId);
  const listed = await listLinkedTasks(ports, threadId);
  if (listed.unavailable !== null) return { unavailable: listed.unavailable, results: [] };

  const results: TaskStatusResult[] = [];
  const tasks = listed.tasks;
  for (const task of tasks) {
    const write = await writeOf(task, tasks);
    const updated = await ports.run(write.args, env);
    if (updated.kind === "ran" && updated.code === 0) {
      await write.written?.();
      results.push({ key: task.key, ok: true, ...(task.slug === undefined ? {} : { slug: task.slug }) });
    } else results.push({ key: task.key, ok: false, reason: cliRunMessage(updated) });
  }
  return { unavailable: null, results };
}

/**
 * Moves every linked task to `done` together with its whole tree of sub-tasks:
 * a task is done only when everything nested in it is. Sub-tasks go first,
 * deepest first; a task whose sub-task did not take `done` (or whose sub-tasks
 * could not be read) stays as it was and says which ones held it back, so a
 * parent never turns green over open work. Canceled sub-tasks are neither
 * touched nor descended into; done ones are not written again, but what is
 * open under them is still closed.
 */
async function markLinkedTasksDone(ports: CliPorts, threadId: string, gate: DoneGate): Promise<TaskStatusReport> {
  const env = linkedTaskEnv(threadId);
  const listed = await listLinkedTasks(ports, threadId);
  if (listed.unavailable !== null) return { unavailable: listed.unavailable, results: [] };

  // Asked only when there is something to close: a thread with no task never pays for the check.
  const hold = listed.tasks.length === 0 ? null : await gate();
  if (hold !== null) return holdTasks(ports, env, listed.tasks, hold);

  const results: TaskStatusResult[] = [];
  const settled = new Map<string, boolean>();

  // `status` is known for a sub-task only; a linked task is always written.
  const close = async (task: { key: string; slug?: string; status?: string }): Promise<boolean> => {
    const known = settled.get(task.key);
    if (known !== undefined) return known;
    // A task met again while its own tree is still open (a cycle) counts as not done.
    settled.set(task.key, false);
    const fail = (reason: string): boolean => {
      results.push({ key: task.key, ok: false, reason });
      return false;
    };

    const shown = await ports.run(showTaskArgs(task.key), env);
    const subtasks = shown.kind === "ran" && shown.code === 0 ? parseSubtasks(shown.stdout) : null;
    if (subtasks === null) return fail(`sub-tasks unreadable: ${shown.kind === "ran" && shown.code === 0 ? "unexpected answer" : cliRunMessage(shown)}`);

    const held: string[] = [];
    for (const subtask of subtasks.filter(({ status }) => status !== "canceled")) {
      if (!(await close(subtask))) held.push(subtask.key);
    }
    if (held.length > 0) return fail(`sub-tasks not done: ${held.join(", ")}`);

    if (task.status !== "done") {
      const updated = await ports.run(markTaskStatusArgs(task.key, "done"), env);
      if (!(updated.kind === "ran" && updated.code === 0)) return fail(cliRunMessage(updated));
      results.push({ key: task.key, ok: true, ...(task.slug === undefined ? {} : { slug: task.slug }) });
    }
    settled.set(task.key, true);
    return true;
  };

  for (const task of listed.tasks) await close(task);
  return { unavailable: null, results };
}

/** `null` lets the tasks go to `done`; a hold keeps them where they are and says why. */
export type DoneGate = () => Promise<DoneHold | null>;

/** The gate that lets everything through — for a caller with no condition on `done`. */
const OPEN_GATE: DoneGate = async () => null;

/** Every task stays as it was and gets the reason as a comment; a comment that did not take is named next to the reason. */
async function holdTasks(ports: CliPorts, env: Record<string, string>, tasks: readonly LinkedTask[], hold: DoneHold): Promise<TaskStatusReport> {
  const results: TaskStatusResult[] = [];
  for (const { key } of tasks) {
    const commented = await ports.run(commentTaskArgs(key, hold.comment), env);
    const written = commented.kind === "ran" && commented.code === 0;
    results.push({ key, ok: false, reason: written ? hold.reason : `${hold.reason}; comment not written: ${cliRunMessage(commented)}` });
  }
  return { unavailable: null, results };
}

export function markLinkedTasksStatus(ports: CliPorts, threadId: string, status: LinkedTaskStatus, gate: DoneGate = OPEN_GATE): Promise<TaskStatusReport> {
  return status === "done"
    ? markLinkedTasksDone(ports, threadId, gate)
    : updateLinkedTasks(ports, threadId, async ({ key }) => ({ args: markTaskStatusArgs(key, status) }));
}

// Pure split of markLinkedTasksStatus's result into the two shapes every RPC
// handler returns to the front end (doneTasks/inReviewTasks + failedTasks) —
// shared by createPr, createAndMergePr, createMergeArchivePr and
// archiveThread in server.ts, which otherwise duplicated the same filter/map.
export function splitTaskStatusResults(
  results: readonly TaskStatusResult[],
): { successKeys: string[]; failedTasks: { key: string; reason: string }[] } {
  return {
    successKeys: results.filter((result) => result.ok).map((result) => result.key),
    failedTasks: results
      .filter((result): result is { key: string; ok: false; reason: string } => !result.ok)
      .map(({ key, reason }) => ({ key, reason })),
  };
}
