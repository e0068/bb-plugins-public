// Joins the window's rail-collapse hub and the selected thread while the
// plugin's settings are on. The plugin passes its own `app` and `useSettings`:
// this package imports nothing from the SDK, so a plugin installed from git
// still bundles it.
import { useEffect, useRef, useSyncExternalStore, type ComponentType } from "react";

import { browserEnv, joinRailCollapse } from "./dom";
import { followStep } from "./selection";
import { followSelectedThread, selectionOf, subscribeSelection } from "./selection-dom";
import { RAIL_COLLAPSE_SETTING, SELECTED_THREAD_SETTING } from "./setting";

type SettingsHook = () => { readonly values: Readonly<Record<string, string | number | boolean>> | undefined };

type OverlaySlot = (registration: { id: string; component: ComponentType }) => void;

/** The SDK's `app.slots.experimental_appOverlay`, or undefined on an SDK without app overlays. */
const overlaySlotOf = (slots: object): OverlaySlot | undefined => {
  const slot = (slots as { experimental_appOverlay?: unknown }).experimental_appOverlay;
  return typeof slot === "function" ? (slot.bind(slots) as OverlaySlot) : undefined;
};

export function registerRailCollapse(app: { readonly slots: object }, pluginId: string, useSettings: SettingsHook): void {
  function RailCollapse() {
    const enabled = useSettings().values?.[RAIL_COLLAPSE_SETTING] === true;
    useEffect(() => (enabled ? joinRailCollapse(pluginId, browserEnv(window)) : undefined), [enabled]);
    return null;
  }
  overlaySlotOf(app.slots)?.({ id: "rail-collapse", component: RailCollapse });
}

/** Follows the window's selected thread and takes thread clicks on this plugin's pages while its setting is on. */
export function registerSelectedThread(app: { readonly slots: object }, pluginId: string, useSettings: SettingsHook): void {
  function SelectedThread() {
    const enabled = useSettings().values?.[SELECTED_THREAD_SETTING] === true;
    useEffect(() => (enabled ? followSelectedThread(pluginId, browserEnv(window)) : undefined), [enabled]);
    return null;
  }
  overlaySlotOf(app.slots)?.({ id: "selected-thread", component: SelectedThread });
}

/** How a page shows a thread. */
export interface ThreadPage {
  /** The page's own navigation to the thread's item — its task, flow, session — or null: the thread has none. */
  readonly resolve: (threadId: string) => Promise<(() => void) | null>;
  /** Opens the thread itself: a thread picked in the panel never leads nowhere. */
  readonly openThread: (threadId: string) => void;
}

const subscribe = (listener: () => void) => subscribeSelection(window, listener);
const snapshot = () => selectionOf(window);

/**
 * The page's side: while the setting is on, the page goes to the selected
 * thread's item when it was entered at its root, and to every thread picked
 * afterwards — a picked thread without an item opens itself. Only the latest
 * answer of a still-open page moves it. `enteredAtRoot` is read once, at
 * mount: settings that load later still count the entry.
 */
export function useFollowSelectedThread(useSettings: SettingsHook, enteredAtRoot: boolean, page: ThreadPage): void {
  const enabled = useSettings().values?.[SELECTED_THREAD_SETTING] === true;
  const selection = useSyncExternalStore(subscribe, snapshot);
  const entry = useRef(enteredAtRoot);
  const seenPicks = useRef<number | null>(null);
  const latest = useRef(0);
  const pageRef = useRef(page);
  pageRef.current = page;
  // Unmounting outdates every answer still on its way; a remount of the same
  // page (React's development double mount) asks for its entry again.
  useEffect(
    () => () => {
      latest.current += 1;
      seenPicks.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!enabled) return;
    const follow = followStep(seenPicks.current, entry.current, selection);
    seenPicks.current = selection.picks;
    if (follow === null) return;
    const request = (latest.current += 1);
    const settle = (go: (() => void) | null) => {
      if (request !== latest.current) return;
      if (go !== null) go();
      else if (follow.kind === "pick") pageRef.current.openThread(follow.threadId);
    };
    pageRef.current.resolve(follow.threadId).then(settle, () => settle(null));
  }, [enabled, selection]);
}
