import type { TaskThread } from "./contract.js";

/** A thread whose agent is starting or working right now — what the board's
 *  and the list's live-agent chips show. */
export const isWorkingThread = (thread: Pick<TaskThread, "liveStatus">): boolean =>
  thread.liveStatus === "starting" || thread.liveStatus === "working";
