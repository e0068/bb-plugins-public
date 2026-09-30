// Pure row-status model: which of a queued thread's states the row shows, and
// what that means for archiving it.
//
// A status on a row says the thread still holds something for the user — a
// result not yet read or a question not yet answered — or still runs a process
// that archiving would cut short, so the row shows the status in place of
// Archive. Layer 1: depends on nothing.

/** The states a queue row can show; "working" only when the queue is asked to show running threads. */
export type RowStatus =
  | "unread-success"
  | "unread-error"
  | "waiting-for-input"
  | "working"
  | "background-command";

/** The minimal thread facts the status rule reads. */
export interface StatusFacts {
  /** The host's compact per-row state; unknown values mean "none". */
  readonly indicator: string;
  /** The agent is blocked on the user: an approval or a question. */
  readonly hasPendingInteraction: boolean;
  /** The agent is doing work right now — `isWorking` of the attention model. */
  readonly working?: boolean;
  /** A background command is still running — `runsBackgroundCommand` of the attention model. */
  readonly backgroundCommand?: boolean;
}

function isRowStatus(
  indicator: string,
): indicator is Exclude<RowStatus, "working" | "background-command"> {
  return (
    indicator === "unread-success" ||
    indicator === "unread-error" ||
    indicator === "waiting-for-input"
  );
}

/** The status a row shows, or null when there is nothing to show. */
export function rowStatus(thread: StatusFacts): RowStatus | null {
  if (thread.hasPendingInteraction) return "waiting-for-input";
  if (thread.working === true) return "working";
  if (isRowStatus(thread.indicator)) return thread.indicator;
  return thread.backgroundCommand === true ? "background-command" : null;
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

/**
 * Whether a row shows how long its thread has waited since its last activity.
 * A working thread's spinner already says it is active right now, so it
 * shows no time.
 */
export function showsWaitingTime(status: RowStatus | null): boolean {
  return status !== "working";
}
