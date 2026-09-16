import { useEffect, useRef } from "react";
import {
  IDLE_PHASE,
  routeMemoryStep,
  type RouteMemoryPhase,
  type RouteMemoryReason,
} from "./route-memory";

// One localStorage key per panel key. Reading is parsing, not casting: the
// browser profile outlives builds, so a stored value of the wrong shape (an
// enum member that no longer exists, half a record) becomes null and the
// panel falls back — it never becomes a value of a type that can't hold it.

const storageKey = (key: string) => `bb-plugins:panel-state:${key}`;

function loadPanelState<T>(
  key: string,
  parse: (value: unknown) => T | null,
): T | null {
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    return raw === null ? null : parse(JSON.parse(raw));
  } catch {
    // Private mode, storage off, or text that isn't JSON — the panel works,
    // it just forgets.
    return null;
  }
}

function savePanelState(key: string, value: unknown): void {
  try {
    if (value === null) window.localStorage.removeItem(storageKey(key));
    else window.localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // Best-effort: remembering is a convenience, not the feature.
  }
}

const asRoute = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/**
 * Keeps a panel's place: the route it was showing is remembered under `key`
 * and put back when the panel is entered again. `key` is one panel's constant
 * — everything that varies within a panel belongs in the route, which is what
 * makes each place a link (see bb-plugin-claude-config/src/panel-route.ts).
 * `navigateTo` should replace the current entry: restoring a place is not a
 * step in the user's history.
 *
 * The timing rules are the pure step in ./route-memory; this only carries the
 * phase across renders.
 */
export function useRememberedRoute(
  key: string,
  subPath: string,
  navigateTo: (subPath: string) => void,
): void {
  const phase = useRef<RouteMemoryPhase>(IDLE_PHASE);
  const navigateRef = useRef(navigateTo);
  navigateRef.current = navigateTo;

  useEffect(() => {
    const reason: RouteMemoryReason = phase.current.started
      ? "route-change"
      : "mount";
    const step = routeMemoryStep({
      phase: phase.current,
      reason,
      subPath,
      remembered: loadPanelState(key, asRoute),
    });
    phase.current = step.phase;
    if (step.record !== undefined) savePanelState(key, step.record);
    if (step.restore !== null) navigateRef.current(step.restore);
  }, [key, subPath]);
}
