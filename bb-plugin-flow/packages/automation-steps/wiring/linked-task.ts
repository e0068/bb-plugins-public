// Layer 3 (shell), the testable part — reads the task linked to a thread so
// the PR can be named after the work instead of after the branch.
//
// Every outcome that is not a task degrades to "no task", including the one
// mark-task-status.ts deliberately keeps apart: `bb` not being runnable at
// all. There the distinction matters because a promise ("linked tasks get
// their status moved") was silently broken; here it does not — nothing was
// promised about the name, and a missing task only means the name comes from
// a poorer source (see choosePrTitle in ../core/pr-title.ts). Failing to open
// the PR because the board could not be reached would be the worse trade.
import { currentTasksArgs, linkedTaskEnv, parseLinkedTasks, type LinkedTask } from "../core/bb-tasks-commands";
import type { CliPorts } from "./bb-cli-run";

export async function readLinkedTask(
  ports: CliPorts,
  threadId: string,
): Promise<LinkedTask | null> {
  const listed = await ports.run(currentTasksArgs(threadId), linkedTaskEnv(threadId));
  if (listed.kind !== "ran" || listed.code !== 0) return null;
  return parseLinkedTasks(listed.stdout)[0] ?? null;
}
