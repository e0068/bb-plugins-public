// Layer 3 (shell) — writes the plan and the spend of a run into every task
// linked to the thread, through the same updateLinkedTasks that moves their
// status, and backfills the spend of runs that ended before the spend step
// existed.
//
// The spend of a task is the sum over the runs that worked on it — runs of
// other threads, and earlier runs of the same thread. Each run's own part is
// kept in the runner's kv under the task's file name — a key the task gets
// later must not split its history — and replaced, not added, when the step
// runs again: a retry or a rework must not count the same run twice. A run
// with several tasks gives each an even share, so the tasks together show
// what the run spent.
import { currentTasksArgs, linkedTaskEnv, parseLinkedTasks, type LinkedTask } from "../core/bb-tasks-commands";
import { factArgs, parseContributions, planArgs, shareOf, totalOf, withContribution, type Contributions, type PlannedFigures, type RunSpend, type SpentFigures } from "../core/task-figures";
import { cliRunMessage, type CliPorts } from "./bb-cli-run";
import { updateLinkedTasks, type TaskStatusReport } from "./mark-task-status";

/** The part of the plugin kv the spend needs. */
export interface FiguresKv {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

const spentKey = (task: LinkedTask): string => `task-spent:${task.slug ?? task.key}`;

export function writeTaskPlan(ports: CliPorts, threadId: string, planned: PlannedFigures): Promise<TaskStatusReport> {
  return updateLinkedTasks(ports, threadId, async (task) => ({ args: planArgs(task.key, planned) }));
}

export function writeTaskFact(ports: CliPorts, kv: FiguresKv, threadId: string, spent: RunSpend): Promise<TaskStatusReport> {
  return updateLinkedTasks(ports, threadId, async (task, all) => {
    const contributions = withContribution(parseContributions(await kv.get(spentKey(task))), spent.run, shareOf(spent, all.length), spent.aliases);
    return { args: factArgs(task.key, totalOf(contributions)), written: () => kv.set(spentKey(task), contributions) };
  });
}

/** A run of the past: the thread that carried it — its tasks are looked up by it — and what it spent. */
export interface PastRun {
  readonly thread: string;
  readonly spent: RunSpend;
}

/** What the backfill did with one task of one run; `written` — the task's total after it; `unlisted` — the run's tasks could not be read. */
export type BackfillLine =
  | { run: string; key: string; written: SpentFigures }
  | { run: string; key: string; skipped: "counted" | "recorded" }
  | { run: string; key: string; failed: string }
  | { run: string; thread: string; unlisted: string };

/**
 * Writes the spend of past runs into their tasks. A run already counted for
 * a task is left alone, so the backfill may run again; a task that carries
 * figures no step wrote — an agent typed them — keeps them. Writes go
 * through `writer`, the calling thread: the task files land in its tree and
 * reach main with its commit. `dryRun` — reports the same lines, writes
 * nothing.
 */
export async function backfillTaskSpend(ports: CliPorts, kv: FiguresKv, runs: readonly PastRun[], writer: string, dryRun: boolean): Promise<BackfillLine[]> {
  const known = new Map<string, Contributions>();
  const storedOf = async (task: LinkedTask): Promise<Contributions> => known.get(spentKey(task)) ?? parseContributions(await kv.get(spentKey(task)));
  const lines: BackfillLine[] = [];
  for (const { thread, spent } of runs) {
    const listed = await ports.run(currentTasksArgs(thread), linkedTaskEnv(thread));
    // A listing that could not run is a promise not kept; one that ran and refused is a thread without tasks.
    if (listed.kind === "unavailable") lines.push({ run: spent.run, thread, unlisted: listed.reason });
    if (listed.kind !== "ran" || listed.code !== 0) continue;
    const tasks = parseLinkedTasks(listed.stdout);
    for (const task of tasks) {
      const stored = await storedOf(task);
      const line = { run: spent.run, key: task.key };
      if (Object.hasOwn(stored, spent.run)) lines.push({ ...line, skipped: "counted" });
      else if (Object.keys(stored).length === 0 && task.spentRecorded === true) lines.push({ ...line, skipped: "recorded" });
      else {
        const contributions = withContribution(stored, spent.run, shareOf(spent, tasks.length), spent.aliases);
        const written = totalOf(contributions);
        const updated = dryRun ? null : await ports.run(factArgs(task.key, written), linkedTaskEnv(writer));
        if (updated !== null && (updated.kind !== "ran" || updated.code !== 0)) {
          lines.push({ ...line, failed: cliRunMessage(updated) });
          continue;
        }
        known.set(spentKey(task), contributions);
        if (!dryRun) await kv.set(spentKey(task), contributions);
        lines.push({ ...line, written });
      }
    }
  }
  return lines;
}
