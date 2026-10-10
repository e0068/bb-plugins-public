// The window's selected thread, kept once for every plugin bundle under a
// global symbol, like the rail-collapse hub. While a plugin that shows the
// selected thread has joined, every route moves the selection, and a plain
// click on a thread row in bb's threads panel, made on that plugin's page, is
// taken from bb: the page switches to the thread instead of leaving for it.
// The selected thread's row is marked there the way bb marks an open thread.
import { ownsPath } from "./core";
import type { RailEnv } from "./dom";
import { joinCounted } from "./membership";
import { NO_SELECTION, isPlainClick, markedThread, pick, routed, type Selection } from "./selection";

/** bb marks the overlay link of each threads-panel row with its thread id; the row's buttons sit beside it. */
const THREAD_ROW = "[data-sidebar-thread-id]";
const STORE_KEY = Symbol.for("bb-plugins.selected-thread.v1");
/** The style element that marks the selected thread's row. */
const MARK_ATTRIBUTE = "data-bb-selected-thread";

/**
 * bb's row container holds the overlay link one level down; a section of rows
 * carries the same attribute, so only the direct holder matches. The mark is
 * bb's own for a selected row: the translucent `--state-active` laid over the
 * panel's opaque fill, so a parent row stuck to the top stays opaque.
 */
const markRule = (threadId: string): string =>
  `[data-sidebar-rename-row]:has(> * > a[data-sidebar-thread-id=${JSON.stringify(threadId)}]) ` +
  "{ background-image: linear-gradient(var(--state-active), var(--state-active)), linear-gradient(var(--sidebar), var(--sidebar)); }";

/** Mark the thread's row with a style rule — bb re-renders the row's classes, a rule outlives that; null takes the mark away. */
function showMark(document: Document, threadId: string | null): void {
  const found = document.head.querySelector<HTMLStyleElement>(`style[${MARK_ATTRIBUTE}]`);
  if (threadId === null) return void found?.remove();
  const style = found ?? document.head.appendChild(document.createElement("style"));
  style.setAttribute(MARK_ATTRIBUTE, "");
  const rule = markRule(threadId);
  if (style.textContent !== rule) style.textContent = rule;
}

interface Store {
  selection: Selection;
  readonly listeners: Set<() => void>;
  /** Plugins whose pages take thread clicks, with how many times each joined. */
  readonly followers: Map<string, number>;
  /** Stops watching clicks and routes; null while no plugin follows. */
  stopWatching: (() => void) | null;
}

const storeOf = (window: Window): Store => {
  const slot = window as unknown as Record<symbol, Store | undefined>;
  return (slot[STORE_KEY] ??= { selection: NO_SELECTION, listeners: new Set(), followers: new Map(), stopWatching: null });
};

const update = (store: Store, next: Selection): void => {
  if (next === store.selection) return;
  store.selection = next;
  store.listeners.forEach((listener) => listener());
};

function watch(env: RailEnv, store: Store): () => void {
  const { document, location } = env.window;
  const followerIds = () => [...store.followers.keys()];
  const followerPage = () => ownsPath(followerIds(), location.pathname);
  const mark = () => showMark(document, markedThread(store.selection, location.pathname, followerIds()));
  const onClick = (event: MouseEvent): void => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>(THREAD_ROW) : null;
    const threadId = row?.dataset.sidebarThreadId;
    if (!threadId || !isPlainClick(event) || !followerPage()) return;
    event.preventDefault();
    event.stopPropagation();
    update(store, pick(store.selection, threadId));
    mark();
  };
  const onRoute = () => {
    update(store, routed(store.selection, location.pathname, followerIds()));
    mark();
  };
  // Capture on the document: the click is taken before bb's own handlers see it.
  document.addEventListener("click", onClick, true);
  const stopRoutes = env.onRouteChange(onRoute);
  onRoute();
  return () => {
    document.removeEventListener("click", onClick, true);
    stopRoutes();
    showMark(document, null);
  };
}

/** Make this plugin's pages follow the selected thread; returns the leave function. */
export function followSelectedThread(pluginId: string, env: RailEnv): () => void {
  const store = storeOf(env.window);
  const leave = joinCounted(store.followers, pluginId, () => {
    store.stopWatching?.();
    store.stopWatching = null;
  });
  store.stopWatching ??= watch(env, store);
  return leave;
}

export const selectionOf = (window: Window): Selection => storeOf(window).selection;

export function subscribeSelection(window: Window, listener: () => void): () => void {
  const { listeners } = storeOf(window);
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
