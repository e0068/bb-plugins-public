// Shell — a same-origin BroadcastChannel that carries "a PR/Merge/Archive
// operation is in flight for thread X" from the header buttons to the sidebar
// row-status content script.
//
// The two surfaces are separate React roots but the same bb page and origin, so
// a BroadcastChannel reaches across them where a component's local state can't.
// Everything here is best-effort: a browser without the API (or one that throws
// constructing the channel) makes publish and subscribe no-ops, and the row
// simply doesn't pulse — never a thrown error on either side. The decisions
// (message shape, busy-set fold) live in the pure core (src/core/op-busy.ts).
import { isOpBusyMessage, type OpBusyMessage } from "../core/op-busy";

const CHANNEL_NAME = "bb-plugin-zz-pull-request:op-busy";

function openChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

/**
 * Announces one edge of an operation. A fresh channel per call, closed right
 * after posting: the publisher lives in a header button that mounts and
 * unmounts with the active thread, and holding a channel open across that
 * churn buys nothing — the message is delivered synchronously to every channel
 * already open (the sidebar's) before this one closes.
 */
export function publishOpBusy(message: OpBusyMessage): void {
  const channel = openChannel();
  if (!channel) return;
  try {
    channel.postMessage(message);
  } catch {
    // A structured-clone or closed-channel failure just drops this one edge.
  } finally {
    channel.close();
  }
}

/**
 * Subscribes to operation edges. Returns an unsubscribe that closes the
 * channel; a browser without the API yields a no-op unsubscribe. Malformed
 * payloads (a stray post from other code on the same channel name) are ignored
 * by the core's type guard rather than trusted.
 */
export function subscribeOpBusy(onMessage: (message: OpBusyMessage) => void): () => void {
  const channel = openChannel();
  if (!channel) return () => {};
  channel.onmessage = (event: MessageEvent) => {
    if (isOpBusyMessage(event.data)) onMessage(event.data);
  };
  return () => {
    try {
      channel.close();
    } catch {
      // Already closed — nothing to undo.
    }
  };
}
