// Pure model of a thread's message queue in the host (bb 0.48): the state its
// row reports in `queuedWork`. The host's `indicator` carries only the one
// highest priority state, so a dev server or an unread reply hides the queue
// there; `queuedWork` is the only place the queue is read from. Layer 1:
// depends on nothing.

/** A message held back by the Concurrency limit ("waiting"), one that could not be sent ("failed"), or none. */
export type QueuedWork = "none" | "waiting" | "failed";

/**
 * Parse the row's `queuedWork`, which the SDK types do not know and so reach us
 * as an untyped value: anything but "waiting" and "failed" is "none".
 */
export function queuedWorkOf(raw: unknown): QueuedWork {
  return raw === "waiting" || raw === "failed" ? raw : "none";
}
