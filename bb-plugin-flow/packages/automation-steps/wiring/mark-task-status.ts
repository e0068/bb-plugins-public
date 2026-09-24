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
import { currentTasksArgs, linkedTaskEnv, markTaskStatusArgs, parseLinkedTaskKeys, type LinkedTaskStatus } from "../core/bb-tasks-commands";
import { cliRunMessage, type CliPorts } from "./bb-cli-run";

export type TaskStatusResult = { key: string; ok: true } | { key: string; ok: false; reason: string };

export interface TaskStatusReport {
  /** Why no task could even be looked up, or null when the lookup ran. */
  unavailable: string | null;
  results: readonly TaskStatusResult[];
}

export async function markLinkedTasksStatus(
  ports: CliPorts,
  threadId: string,
  status: LinkedTaskStatus,
): Promise<TaskStatusReport> {
  const env = linkedTaskEnv(threadId);
  const listed = await ports.run(currentTasksArgs(threadId), env);
  if (listed.kind === "unavailable") return { unavailable: listed.reason, results: [] };
  if (listed.code !== 0) return { unavailable: null, results: [] };

  const keys = parseLinkedTaskKeys(listed.stdout);
  const results: TaskStatusResult[] = [];
  for (const key of keys) {
    const updated = await ports.run(markTaskStatusArgs(key, status), env);
    results.push(
      updated.kind === "ran" && updated.code === 0
        ? { key, ok: true }
        : { key, ok: false, reason: cliRunMessage(updated) },
    );
  }
  return { unavailable: null, results };
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
