// Layer 1 — decides whether a `thread:changed` event should make the front
// end refetch PR state. Zero effects.
//
// A PR in bb is a property of the environment (`environments.pullRequest`);
// the thread sees it via the thread→environment link. So out of the whole
// stream of thread change kinds, exactly one can affect PR state — a change
// to that link. The rest (status, title, read, pin, queue…) have nothing to
// do with the PR, and refetching on them would fire uselessly on every
// heartbeat of an active thread.

/** The kind of thread change after which the environment/PR link may have changed. */
const ENVIRONMENT_LINK_CHANGE = "environment-changed";

export function threadChangeTouchesPr(changes: readonly string[]): boolean {
  return changes.includes(ENVIRONMENT_LINK_CHANGE);
}
