// Layer 1 — pure core for "a pull-request operation is in flight on thread X".
//
// The header buttons (Pull Request / Merge / Archive) know a PR/Merge/Archive
// RPC is running, but they are mounted only on the active thread; the sidebar
// row glyph is painted by a separate content-script root for every thread. The
// shell carries the fact between them over a same-origin BroadcastChannel (see
// src/wiring/op-busy-channel.ts); this module holds the two pure pieces — the
// message shape, and how the set of busy threads folds one message in — so the
// deciding is testable without a channel.

/** One edge of a thread's operation: it started (busy) or finished (idle). */
export interface OpBusyMessage {
  threadId: string;
  busy: boolean;
}

/** A value carried on the channel is only a message if it has both fields. */
export function isOpBusyMessage(value: unknown): value is OpBusyMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { threadId?: unknown }).threadId === "string" &&
    typeof (value as { busy?: unknown }).busy === "boolean"
  );
}

/**
 * Folds one message into the set of busy threads: `busy` adds the thread,
 * `!busy` removes it. Always returns a fresh set (never mutates `prev`) so a
 * React state setter sees a new reference on every applied edge.
 */
export function nextBusyThreads(
  prev: ReadonlySet<string>,
  message: OpBusyMessage,
): Set<string> {
  const next = new Set(prev);
  if (message.busy) next.add(message.threadId);
  else next.delete(message.threadId);
  return next;
}
