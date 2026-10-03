// Layer 3 (shell), the testable part — reads the task linked to a thread so
// the PR and the thread can be named after the work instead of after the branch.
//
// readLinkedTask degrades every outcome that is not a task to "no task",
// including the one mark-task-status.ts deliberately keeps apart: `bb` not
// being runnable at all. For the PR title that is the right trade — nothing
// was promised about the name, and a missing task only means the name comes
// from a poorer source (see choosePrTitle in ../core/pr-title.ts); failing to
// open the PR because the board could not be reached would be worse.
// findLinkedTask keeps the outcomes apart for the thread rename step, which
// does promise a name taken from the task.
import { currentTasksArgs, linkedTaskEnv, parseLinkedTasks, type LinkedTask } from "../core/bb-tasks-commands";
import { cliRunMessage, type CliPorts } from "./bb-cli-run";

export async function readLinkedTask(
  ports: CliPorts,
  threadId: string,
): Promise<LinkedTask | null> {
  const lookup = await findLinkedTask(ports, threadId);
  return lookup.kind === "found" ? lookup.task : null;
}

export type LinkedTaskLookup =
  | { kind: "found"; task: LinkedTask }
  | { kind: "none" }
  | { kind: "unavailable"; reason: string };

/**
 * The same lookup for a caller that promised something about the task — the
 * thread rename. A thread with no task answers code 0 and an empty list, so
 * `bb` failing to run or refusing (no Tasks+, the board's RPC down) is a
 * failure with its own text: read as "no task", it would send the owner to
 * link a task that is already linked.
 */
export async function findLinkedTask(ports: CliPorts, threadId: string): Promise<LinkedTaskLookup> {
  const listed = await ports.run(currentTasksArgs(threadId), linkedTaskEnv(threadId));
  if (listed.kind === "unavailable" || listed.code !== 0) return { kind: "unavailable", reason: cliRunMessage(listed) };
  const task = parseLinkedTasks(listed.stdout)[0];
  return task === undefined ? { kind: "none" } : { kind: "found", task };
}
