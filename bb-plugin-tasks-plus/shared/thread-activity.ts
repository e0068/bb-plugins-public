import type { TaskThread } from "./contract.js";

/** A thread whose agent is starting or working right now — what the board's
 *  and the list's live-agent chips show. */
export const isWorkingThread = (thread: Pick<TaskThread, "liveStatus">): boolean =>
  thread.liveStatus === "starting" || thread.liveStatus === "working";

/** What the sidebar's live view tells about one thread's work — the fields of
 *  the SDK's `PluginSidebarThread` this rule reads. */
export interface SidebarThreadWork {
  readonly id: string;
  readonly isArchived: boolean;
  readonly hasPendingInteraction: boolean;
  readonly activity: { readonly workflows: number; readonly backgroundAgents: number };
  readonly parentThreadId: string | null;
  readonly originKind: "fork" | null;
  readonly indicator: "runtime" | "plan-mode" | "goal" | (string & {});
}

/** A turn is running: bb paints plan mode and a goal over the plain spinner. */
const TURN_INDICATORS: ReadonlySet<string> = new Set(["runtime", "plan-mode", "goal"]);

/**
 * Threads whose agent waits for its own workflow or background agents — work
 * bb's thread status does not see — and the ancestors, at any depth, of a
 * thread that works so, or runs a turn: a parent waits for the child it
 * spawned. Sorted so an unchanged set reads the same. A thread with only a
 * running turn is not listed itself: bb's status shows that. A background
 * command is not work: a dev server outlives the agent's turn. A thread
 * blocked on the owner waits for them, whatever runs under it, and an
 * archived thread is out of every view — the climb stops at either, and at a
 * fork: its source does not wait for it.
 */
export function backgroundBusyThreadIds(threads: readonly SidebarThreadWork[]): string[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const available = (thread: SidebarThreadWork) => !thread.isArchived && !thread.hasPendingInteraction;
  const ownWork = (thread: SidebarThreadWork) => available(thread) && thread.activity.workflows + thread.activity.backgroundAgents > 0;
  const working = (thread: SidebarThreadWork) => ownWork(thread) || (!thread.isArchived && TURN_INDICATORS.has(thread.indicator));
  const ancestors = (thread: SidebarThreadWork, seen: ReadonlySet<string>): string[] => {
    const parent = thread.originKind === "fork" || thread.parentThreadId === null ? undefined : byId.get(thread.parentThreadId);
    return parent && available(parent) && !seen.has(parent.id) ? [parent.id, ...ancestors(parent, new Set([...seen, parent.id]))] : [];
  };
  const busy = threads.flatMap((thread) => [...(ownWork(thread) ? [thread.id] : []), ...(working(thread) ? ancestors(thread, new Set([thread.id])) : [])]);
  return [...new Set(busy)].sort();
}
