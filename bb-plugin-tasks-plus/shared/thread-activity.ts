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
}

/**
 * Threads whose agent waits for its own workflow or background agents — work
 * bb's thread status does not see, sorted so an unchanged set reads the same.
 * A background command is not work: a dev server outlives the agent's turn. A
 * thread blocked on the owner waits for them, whatever runs under it, and an
 * archived thread is out of every view.
 */
export function backgroundBusyThreadIds(threads: readonly SidebarThreadWork[]): string[] {
  return threads
    .filter((thread) => !thread.isArchived && !thread.hasPendingInteraction && thread.activity.workflows + thread.activity.backgroundAgents > 0)
    .map((thread) => thread.id)
    .sort();
}
