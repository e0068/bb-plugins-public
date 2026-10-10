// The analytics page's cut and filters, shared by the topbar that sets them
// and the tiles that read them — two mounts with no state of their own in
// common. Kept for the session: leaving Analytics and coming back finds the
// page as it was left.
import { useSyncExternalStore } from "react";

import { DEFAULT_FILTER, type AnalyticsFilter } from "./default-dashboard";

let current: AnalyticsFilter = DEFAULT_FILTER;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Sets the page's cut and filters from what they are now. */
export function setAnalyticsFilter(change: (filter: AnalyticsFilter) => AnalyticsFilter): void {
  current = change(current);
  listeners.forEach((listener) => listener());
}

/** The page's cut and filters, re-read on every change. */
export function useAnalyticsFilter(): AnalyticsFilter {
  return useSyncExternalStore(subscribe, () => current);
}
