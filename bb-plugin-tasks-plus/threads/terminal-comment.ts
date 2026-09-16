import type { TaskThreadLiveStatus } from "../db/types.js";

/** The two live statuses a thread does not come back from, and which are
 *  worth a comment on the task. */
export type TerminalLiveStatus = Extract<TaskThreadLiveStatus, "completed" | "failed">;

export function terminalCommentBody(
  thread: { title: string; threadId: string },
  liveStatus: TerminalLiveStatus,
): string {
  return `Thread "${thread.title}" ${liveStatus} — final message posted · ${thread.threadId}`;
}

/**
 * Whether the task still needs this report. The task's own comments are the
 * record, not the thread's live status: live status is process memory now
 * (see threads/live-state.ts), so after a restart it cannot remember that
 * the report was already posted.
 */
export function needsTerminalComment(
  comments: readonly { body: string }[],
  body: string,
): boolean {
  return !comments.some((comment) => comment.body === body);
}
