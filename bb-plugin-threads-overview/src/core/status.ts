// Pure row-status model: which of a queued thread's states the row shows, and
// what that means for archiving it.
//
// A status on a row says the thread still holds something for the user — a
// result not yet read or a question not yet answered — so the row shows the
// status in place of Archive. Layer 1: depends on nothing.

/** The states a queue row can show. Working states never reach the queue. */
export type RowStatus = "unread-success" | "unread-error" | "waiting-for-input";

/** The minimal thread facts the status rule reads. */
export interface StatusFacts {
  /** The host's compact per-row state; unknown values mean "none". */
  readonly indicator: string;
  /** The agent is blocked on the user: an approval or a question. */
  readonly hasPendingInteraction: boolean;
}

function isRowStatus(indicator: string): indicator is RowStatus {
  return (
    indicator === "unread-success" ||
    indicator === "unread-error" ||
    indicator === "waiting-for-input"
  );
}

/** The status a row shows, or null when there is nothing to show. */
export function rowStatus(thread: StatusFacts): RowStatus | null {
  if (thread.hasPendingInteraction) return "waiting-for-input";
  return isRowStatus(thread.indicator) ? thread.indicator : null;
}

/** How a thread's environment presents its workspace, as the host reports it. */
export type WorkspaceKind = "managed-worktree" | "unmanaged-worktree" | "other";

/** The minimal environment facts the worktree rule reads. */
export interface EnvironmentFacts {
  readonly workspaceDisplayKind: WorkspaceKind;
  readonly branchName: string | null;
}

/** A worktree a thread runs in; the branch is null when the host does not know it. */
export interface Worktree {
  readonly branch: string | null;
}

/**
 * The worktree a thread runs in — one bb manages or one the user does — or
 * null for a plain checkout and for a thread with no environment yet.
 */
export function worktreeOf(environment: EnvironmentFacts | null): Worktree | null {
  if (environment === null || environment.workspaceDisplayKind === "other") return null;
  return { branch: environment.branchName };
}
