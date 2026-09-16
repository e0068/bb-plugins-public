// Pure decision step for "remember where the panel was".
//
// A panel that keeps its place in the route has two things to get right, and
// both are timing, not storage: restore the remembered route when the panel
// opens with no address of its own, and do not record the empty route it
// mounts with — that would erase the memory it is about to restore.
//
// Those rules are this function. The hook around it (see ./react) only
// carries the phase between renders, navigates, and writes to storage.

export interface RouteMemoryPhase {
  /** A route this panel asked for and is waiting to see; null — none. */
  pending: string | null;
  /** The mount step has run. */
  started: boolean;
}

export const IDLE_PHASE: RouteMemoryPhase = { pending: null, started: false };

export type RouteMemoryReason = "mount" | "route-change";

export interface RouteMemoryInput {
  phase: RouteMemoryPhase;
  reason: RouteMemoryReason;
  /** The route the panel is showing right now ("" — no address). */
  subPath: string;
  /** What's stored for the current key, or null. */
  remembered: string | null;
}

export interface RouteMemoryStep {
  phase: RouteMemoryPhase;
  /** Navigate here; null — stay where we are. */
  restore: string | null;
  /**
   * Store this against the current key — a string to remember, null to
   * forget. Absent — leave storage alone (this step wasn't the user's doing).
   */
  record?: string | null;
}

/** What a route to remember looks like: "" is "nothing open", not a route. */
function asMemory(subPath: string): string | null {
  return subPath === "" ? null : subPath;
}

export function routeMemoryStep({
  phase,
  reason,
  subPath,
  remembered,
}: RouteMemoryInput): RouteMemoryStep {
  if (reason === "mount") {
    // A deep link is an explicit address and beats the memory; it also
    // becomes the panel's new place.
    if (subPath !== "" || remembered === null) {
      return {
        phase: { pending: null, started: true },
        restore: null,
        record: asMemory(subPath),
      };
    }
    return {
      phase: { pending: remembered, started: true },
      restore: remembered,
    };
  }

  if (phase.pending !== null) {
    // Waiting for a restore: only its arrival clears the wait, and it isn't
    // recorded — nothing about it is news to storage.
    return subPath === phase.pending
      ? { phase: { ...phase, pending: null }, restore: null }
      : { phase, restore: null };
  }

  return { phase, restore: null, record: asMemory(subPath) };
}
