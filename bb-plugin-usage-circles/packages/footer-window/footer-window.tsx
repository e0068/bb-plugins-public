// Layer 2 — DOM and React shell around core.ts: one window above BB's sidebar
// footer row, shared by every plugin that registers an item there.
//
// Each plugin bundle carries its own copy of this module, but the window is one
// for the whole app, so the state, the item controllers and the document
// listeners live in a registry on `globalThis` under a well-known symbol: the
// first plugin to register installs the listeners, the rest join the registry.
// BB draws the footer and the window frame outside any plugin root, so every
// style here is inline, on BB's theme tokens.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ComponentType } from "react";

import {
  CLOSED,
  HUG,
  dragHeight,
  heightFromStorage,
  heightToStorage,
  pinnedByUser,
  present,
  release,
  step,
  type Command,
  type ItemKey,
  type Presented,
  type PresentStep,
  type WindowEvent,
  type WindowHeight,
  type WindowState,
} from "./core";

/** How long the pointer may stay in the footer's gaps, off a hovered window, before it closes. */
export const HOVER_LEAVE_MS = 400;
/** A pointer that cannot hover (a finger) never opens a window by hovering. */
const HOVER_QUERY = "(hover: hover)";
/** How long to wait for BB to move focus to the item's button after a close. */
const FOCUS_RETURN_MS = 500;
/** How long BB may take to draw a window it was asked to open. */
const OPEN_SETTLE_MS = 500;
const MIN_HEIGHT_PX = 80;
/** Gap between the window's top and the thread list. */
const TOP_GAP_PX = 8;
/** Thread list top, should BB change the sidebar markup. */
const FALLBACK_LIST_TOP_PX = 160;
const HANDLE_HEIGHT_PX = 6;
const STORAGE_PREFIX = "bb-plugins.footer-window.height:";
/** The line between the thread list and the window: BB's sidebar border at full strength, so the edge reads at a glance. */
const SEPARATOR = "1px solid var(--sidebar-border)";

/** BB's controller of a `kind: "disclosure"` footer item. */
export interface DisclosureController {
  open(): void;
  close(): void;
  toggle(): void;
}

export interface FooterItem {
  readonly pluginId: string;
  readonly itemId: string;
}

export interface FooterItemEntry extends FooterItem {
  /** The item's label — BB shows it on the item's row in the overflow menu. */
  readonly label: string;
}

interface Entry extends FooterItemEntry {
  readonly controller: DisclosureController;
}

interface Registry {
  readonly entries: Map<ItemKey, Entry>;
  readonly openOnHover: Map<string, boolean>;
  readonly listeners: Set<() => void>;
  /** Per mounted window: keep the height it shows now, unpinned, until it closes. */
  holds: Map<ItemKey, () => void>;
  state: WindowState;
  /** The window a plugin opened itself until it releases it. */
  presented: Presented | null;
  removeListeners: (() => void) | null;
  /** Stops watching BB's footer for the moment a pinned window off screen can come back. */
  stopWaiting: (() => void) | null;
}

const REGISTRY = Symbol.for("bb-plugins.footer-window.v1");

function registry(): Registry {
  const scope = globalThis as typeof globalThis & { [REGISTRY]?: Registry };
  const r = (scope[REGISTRY] ??= {
    entries: new Map(),
    openOnHover: new Map(),
    listeners: new Set(),
    holds: new Map(),
    state: CLOSED,
    presented: null,
    removeListeners: null,
    stopWaiting: null,
  });
  // A plugin with an older copy of this module may have made the registry first.
  r.holds ??= new Map();
  r.presented ??= null;
  r.stopWaiting ??= null;
  return r;
}

const keyOf = ({ pluginId, itemId }: FooterItem): ItemKey => `${pluginId}/${itemId}`;
const pluginOf = (key: ItemKey): string => key.slice(0, key.indexOf("/"));

function run(command: Command): void {
  if (command.kind === "none") return;
  const controller = registry().entries.get(command.key)?.controller;
  if (command.kind === "open") controller?.open();
  else controller?.close();
}

/** Any window of BB's footer is open — a footer plugin's, or one this package does not hold. */
const footerShowsWindow = (): boolean => document.querySelector('section[id^="plugin-sidebar-footer-disclosure-"]') !== null;

/** Customize footer hides the row of items, and BB draws no window until it is done. */
const footerRowHidden = (): boolean => document.querySelector('[data-sidebar="footer"] li[data-footer-item]')?.closest(".hidden") != null;

/**
 * The pinned window BB was asked to bring back is on screen by now; when it is not —
 * its plugin turned off, its controller gone — the pin is forgotten, so hover works again.
 */
function confirmShown(key: ItemKey): void {
  const { pinned, shown } = registry().state;
  if (pinned === key && shown === key && sectionOf(key) === null && !footerRowHidden()) dispatch({ kind: "dismissed", key });
}

/**
 * A pinned window BB closed waits off screen: watch the page — BB may draw
 * the footer anew — and bring it back once no window is open in the footer.
 * BB removes the closed one after this runs, so the first look is a tick later.
 */
function followFooter(): void {
  const r = registry();
  const waiting = r.state.pinned !== null && r.state.shown === null;
  if (!waiting) return r.stopWaiting?.();
  if (r.stopWaiting !== null) return;
  const look = () => {
    if (footerShowsWindow()) return;
    stop();
    dispatch({ kind: "free" });
    const { shown } = r.state;
    if (shown !== null) setTimeout(() => confirmShown(shown), OPEN_SETTLE_MS);
  };
  const observer = new MutationObserver(look);
  observer.observe(document.body, { childList: true, subtree: true });
  const timer = setTimeout(look, 0);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    r.stopWaiting = null;
  };
  r.stopWaiting = stop;
}

/** Feeds one event to the core, carries out its command; true when the click must not reach BB. */
function dispatch(event: WindowEvent): boolean {
  const r = registry();
  const next = step(r.state, event);
  r.state = next.state;
  // Closed or unpinned meanwhile, the presented window is no longer held.
  if (r.presented !== null && r.state.pinned !== r.presented.key) r.presented = null;
  run(next.command);
  followFooter();
  r.listeners.forEach((listener) => listener());
  return next.swallowClick;
}

function apply(next: PresentStep): void {
  const r = registry();
  r.state = next.state;
  r.presented = next.presented;
  run(next.command);
  followFooter();
  r.listeners.forEach((listener) => listener());
}

/**
 * BB closed the item's window: a presented one ends there, as at release — the
 * window pinned before it waits to come back —, a pinned one waits itself.
 */
function closedByBb(key: ItemKey): void {
  const r = registry();
  if (r.presented?.key === key) apply(release({ ...r.state, shown: null }, r.presented, key));
  else dispatch({ kind: "closed", key });
}

/**
 * Open the item's window by itself — for the time something runs, Aloud's
 * reading for one — until `releaseFooterWindow`. The pointer leaving keeps it;
 * a window pinned before it comes back at release.
 */
export function presentFooterWindow(item: FooterItem): void {
  const r = registry();
  apply(present(r.state, r.presented, keyOf(item)));
}

/** Close the item's window and forget its pin: its item left the footer, so the window must not come back. */
export function dismissFooterWindow(item: FooterItem): void {
  const key = keyOf(item);
  const shown = registry().state.shown === key;
  dispatch({ kind: "dismissed", key });
  if (shown) registry().entries.get(key)?.controller.close();
}

/** Close the window `presentFooterWindow` opened, unless the user pinned it meanwhile. */
export function releaseFooterWindow(item: FooterItem): void {
  const r = registry();
  const next = release(r.state, r.presented, keyOf(item));
  // Reading ends while the user may be typing: BB's focus hand-off after a close must not take the caret.
  if (next.command.kind !== "none") keepFocusWhereItWas();
  apply(next);
}

/** The registered item whose footer button holds `target`. */
function buttonKey(target: EventTarget | null): ItemKey | null {
  if (!(target instanceof Element)) return null;
  const attribute = target.closest("li[data-footer-item]")?.getAttribute("data-footer-item") ?? "";
  const key = attribute.startsWith("plugin:") ? attribute.slice("plugin:".length) : "";
  return registry().entries.has(key) ? key : null;
}

/** The registered item whose row in the overflow menu holds `target`. */
function menuRowKey(target: EventTarget | null): ItemKey | null {
  if (!(target instanceof Element)) return null;
  const text = target.closest('[role="menuitem"]')?.textContent?.trim();
  if (!text) return null;
  const entry = [...registry().entries.values()].find(({ label }) => label === text);
  return entry ? keyOf(entry) : null;
}

const itemKeyAt = (target: EventTarget | null): ItemKey | null => buttonKey(target) ?? menuRowKey(target);

const opensOnHover = (key: ItemKey): boolean =>
  registry().openOnHover.get(pluginOf(key)) === true && window.matchMedia(HOVER_QUERY).matches;

function sectionOf(key: ItemKey): HTMLElement | null {
  const [pluginId, itemId] = [pluginOf(key), key.slice(key.indexOf("/") + 1)];
  return document.querySelector<HTMLElement>(`section[data-testid="plugin-sidebar-footer-disclosure-${CSS.escape(pluginId)}-${CSS.escape(itemId)}"]`);
}

/** The pointer is over the item's button, its menu row or its window. */
const isOver = (target: EventTarget | null, key: ItemKey): boolean =>
  itemKeyAt(target) === key || (target instanceof Node && !!sectionOf(key)?.contains(target));

/**
 * The footer's gaps between an item and its window, and an open overflow menu:
 * the pointer crosses them on its way to the window, so leaving waits there.
 * Anywhere else the hovered window closes at once.
 */
const inGrace = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('[data-sidebar="footer"], [role="menu"]') !== null;

/**
 * Closing a window, BB hands focus to its item's button. A window that closed
 * because the pointer left must not pull focus out of the field the user types
 * in: the first focus move after the close goes back where focus was.
 */
function keepFocusWhereItWas(): void {
  const previous = document.activeElement;
  if (!(previous instanceof HTMLElement) || previous === document.body) return;
  const stop = () => {
    document.removeEventListener("focusin", onFocus);
    clearTimeout(timer);
  };
  const onFocus = (event: FocusEvent) => {
    stop();
    if (event.target !== previous && previous.isConnected) previous.focus({ preventScroll: true });
  };
  document.addEventListener("focusin", onFocus);
  const timer = setTimeout(stop, FOCUS_RETURN_MS);
}

function installListeners(): () => void {
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelLeave = () => {
    if (leaveTimer !== null) clearTimeout(leaveTimer);
    leaveTimer = null;
  };

  const onOver = (event: MouseEvent) => {
    const key = itemKeyAt(event.target);
    if (key === null || !opensOnHover(key)) return;
    cancelLeave();
    dispatch({ kind: "hover", key });
  };
  const leave = () => {
    cancelLeave();
    keepFocusWhereItWas();
    dispatch({ kind: "leave" });
  };
  /** The pointer is at `target`; `null` — it left the app. */
  const pointerAt = (target: EventTarget | null) => {
    const { shown, pinned } = registry().state;
    if (shown === null || shown === pinned || (target !== null && isOver(target, shown))) return cancelLeave();
    if (!inGrace(target)) return leave();
    leaveTimer ??= setTimeout(leave, HOVER_LEAVE_MS);
  };
  const onMove = (event: MouseEvent) => pointerAt(event.target);
  // The sidebar sits at the window's edge: a pointer leaving the app from the
  // item fires no further mousemove, only a mouseout into nowhere.
  const onOut = (event: MouseEvent) => {
    if (event.relatedTarget === null) pointerAt(null);
  };
  const onClick = (event: MouseEvent) => {
    const key = itemKeyAt(event.target);
    if (key === null) return;
    cancelLeave();
    if (!dispatch({ kind: "click", key })) return;
    if (buttonKey(event.target) === null) {
      // A menu row's click also closes the menu, so it goes through; BB's
      // toggle then shuts the window. Right after, the core opens it again.
      setTimeout(() => dispatch({ kind: "hover", key }), 0);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onKey = (event: KeyboardEvent) => {
    const { shown } = registry().state;
    if (event.key !== "Escape" || shown === null) return;
    closedByBb(shown);
    // The pinned window comes back: BB's focus hand-off to its button must not take the caret.
    if (registry().state.pinned !== null) keepFocusWhereItWas();
  };
  // BB opens the item's tooltip on pointermove; with a window opening on hover
  // the tooltip is noise. Not while a button is held: that is a drag reorder.
  const onPointerMove = (event: PointerEvent) => {
    const key = buttonKey(event.target);
    if (key !== null && opensOnHover(key) && event.buttons === 0) event.stopPropagation();
  };

  document.addEventListener("mouseover", onOver);
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseout", onOut);
  document.addEventListener("click", onClick, { capture: true });
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointermove", onPointerMove, { capture: true });
  return () => {
    cancelLeave();
    document.removeEventListener("mouseover", onOver);
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseout", onOut);
    document.removeEventListener("click", onClick, { capture: true });
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointermove", onPointerMove, { capture: true });
  };
}

/**
 * Put one footer item under the shared window: hover opens it, the pin in its
 * header pins it.
 * Call it in the plugin's setup with the controller `experimental_sidebarFooter.register`
 * returned. Returns the unregistration.
 */
export function registerFooterWindow(item: FooterItemEntry, controller: DisclosureController): () => void {
  const r = registry();
  const key = keyOf(item);
  r.entries.set(key, { ...item, controller });
  r.removeListeners ??= installListeners();
  // Reloaded while its window was due on screen: the old controller is gone, the new one opens it.
  if (r.state.shown === key && sectionOf(key) === null) controller.open();
  return () => {
    if (r.entries.get(key)?.controller === controller) r.entries.delete(key);
  };
}

/** Whether the plugin's items open on hover — its "Open on hover" setting. */
export function setOpenOnHover(pluginId: string, enabled: boolean): void {
  registry().openOnHover.set(pluginId, enabled);
}

/** `setOpenOnHover` for a component that reads the plugin's settings. */
export function useOpenOnHover(pluginId: string, enabled: boolean): void {
  useEffect(() => setOpenOnHover(pluginId, enabled), [pluginId, enabled]);
}

/** The item whose window a component renders in — set by `withFooterWindow`. */
const ItemContext = createContext<FooterItem | null>(null);

export const useFooterItem = (): FooterItem | null => useContext(ItemContext);

const subscribe = (listener: () => void) => {
  const listeners = registry().listeners;
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Whether the item's window is pinned; follows the pin and closing. */
export function usePinned(item: FooterItem | null): boolean {
  const key = item ? keyOf(item) : null;
  const read = () => key !== null && pinnedByUser(registry().state, registry().presented, key);
  return useSyncExternalStore(subscribe, read, read);
}

/** The window's frame — the box whose height the user sees. */
const frameOf = (key: ItemKey): HTMLElement | null => {
  const frame = sectionOf(key)?.firstElementChild;
  return frame instanceof HTMLElement ? frame : null;
};

/**
 * The pin in the window's header: pins the shown window at the height it shows now, or unpins it and holds that
 * height, so the header stays under the pointer until it leaves.
 */
export function togglePin(item: FooterItem): void {
  const key = keyOf(item);
  const r = registry();
  const { pinned, shown } = r.state;
  const px = frameOf(key)?.getBoundingClientRect().height ?? 0;
  // A presented window an older copy of this package closed meanwhile leaves its record behind: a pin on a window
  // that is not pinned now is the user's own, whatever the record says.
  if (pinned !== key && r.presented?.key === key) r.presented = null;
  const held = r.presented?.key === key && pinned === key;
  if ((pinned !== key || held) && shown === key && px > 0) writeHeight(key, { kind: "fixed", px: Math.round(px) });
  if (held) {
    // The presented window already holds the pin's place: the user's pin only keeps it there after release.
    r.presented = null;
    r.listeners.forEach((listener) => listener());
    return;
  }
  if (pinned === key) r.holds.get(key)?.();
  dispatch({ kind: "pin", key });
}

/**
 * Keep the window at the height it shows now until it closes, without pinning it:
 * for content that swaps in place, so the window neither jumps nor grows over the
 * thread list. Outside a footer window it does nothing.
 */
export function useHoldHeight(): () => void {
  const item = useFooterItem();
  return useCallback(() => {
    if (item) registry().holds.get(keyOf(item))?.();
  }, [item]);
}

/** Drop every registration and listener — between tests. */
export function resetFooterWindowsForTests(): void {
  const r = registry();
  r.removeListeners?.();
  r.removeListeners = null;
  r.entries.clear();
  r.openOnHover.clear();
  r.listeners.clear();
  r.holds.clear();
  r.state = CLOSED;
  r.presented = null;
  r.stopWaiting?.();
}

// localStorage throws where storage is disabled; the window then simply hugs.
function readHeight(key: ItemKey): WindowHeight {
  try {
    return heightFromStorage(window.localStorage.getItem(STORAGE_PREFIX + key));
  } catch {
    return HUG;
  }
}

function writeHeight(key: ItemKey, height: WindowHeight): void {
  const raw = heightToStorage(height);
  try {
    if (raw === null) window.localStorage.removeItem(STORAGE_PREFIX + key);
    else window.localStorage.setItem(STORAGE_PREFIX + key, raw);
  } catch {
    // Storage is off: the height lives until the window closes.
  }
}

/** Room for the window: from the thread list's top down to the footer's button row. */
function roomAbove(section: HTMLElement): number {
  const footer = section.closest('[data-sidebar="footer"]');
  const list = footer?.parentElement?.querySelector('[data-sidebar="content"]');
  const listTop = list?.getBoundingClientRect().top ?? FALLBACK_LIST_TOP_PX;
  const row = footer ? footer.getBoundingClientRect().height - section.getBoundingClientRect().height : 0;
  return Math.max(MIN_HEIGHT_PX, window.innerHeight - row - listTop - TOP_GAP_PX);
}

type Saved = ReadonlyArray<readonly [HTMLElement, string, string]>;

function setStyles(element: HTMLElement, styles: Readonly<Record<string, string>>): Saved {
  const saved = Object.keys(styles).map((name) => [element, name, element.style.getPropertyValue(name)] as const);
  Object.entries(styles).forEach(([name, value]) => element.style.setProperty(name, value));
  return saved;
}

/**
 * Restyle BB's window frame for one item while its component is mounted: the
 * full width of the sidebar, a line on top instead of the rounded frame, no 320 px ceiling, no opening
 * animation — the window is there at once, its content fills in as it loads —,
 * the height it had when pinned (or was dragged to) while pinned, a held height
 * while unpinned, and a handle on the top edge to drag it.
 * Returns the restoration.
 */
function attachFrame(node: HTMLElement, key: ItemKey): () => void {
  const section = node.closest("section");
  const frame = section?.firstElementChild;
  if (!section || !(frame instanceof HTMLElement)) return () => undefined;
  // Edge to edge over BB's footer padding: the pin then sits as far from the panel's edge as from the line above it.
  const footer = section.closest<HTMLElement>('[data-sidebar="footer"]');
  const pad = footer === null ? null : getComputedStyle(footer);
  const saved = [
    ...setStyles(section, {
      ...(pad === null ? {} : { "margin-left": `-${pad.paddingLeft}`, "margin-right": `-${pad.paddingRight}` }),
      position: "relative",
      border: "0",
      "border-top": SEPARATOR,
      "border-radius": "0",
      background: "transparent",
      transition: "none",
      animation: "none",
    }),
    ...setStyles(frame, { height: "", "max-height": "", transition: "none", animation: "none" }),
  ];

  let dragged: WindowHeight | null = null;
  let held: WindowHeight = HUG;
  const apply = (height: WindowHeight) => {
    const room = roomAbove(section);
    const px = height.kind === "fixed" ? `${Math.min(height.px, room)}px` : "";
    frame.style.height = px;
    frame.style.maxHeight = px || `${room}px`;
  };
  const handle = document.createElement("div");
  handle.setAttribute("data-footer-window-handle", "");
  handle.title = "Drag to resize · double-click to fit";
  Object.assign(handle.style, {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    height: `${HANDLE_HEIGHT_PX}px`,
    cursor: "ns-resize",
    zIndex: "1",
    touchAction: "none",
  });
  const fit = () => {
    const pinned = pinnedByUser(registry().state, registry().presented, key);
    handle.style.display = pinned ? "block" : "none";
    apply(pinned ? (dragged ?? readHeight(key)) : held);
  };
  // An unpinned window keeps the first height it was held at; a pinned one being let go keeps the height it shows now.
  const hold = () => {
    const px = Math.round(frame.getBoundingClientRect().height);
    if ((held.kind === "hug" || pinnedByUser(registry().state, registry().presented, key)) && px > 0) held = { kind: "fixed", px };
    fit();
  };

  handle.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    handle.setPointerCapture?.(down.pointerId);
    const start = { startPx: frame.getBoundingClientRect().height, startY: down.clientY };
    const onMove = (move: PointerEvent) => {
      dragged = { kind: "fixed", px: dragHeight({ ...start, y: move.clientY }, { min: MIN_HEIGHT_PX, max: roomAbove(section) }) };
      fit();
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      if (dragged !== null) writeHeight(key, dragged);
      dragged = null;
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
  handle.addEventListener("dblclick", () => {
    writeHeight(key, HUG);
    fit();
  });

  section.append(handle);
  const { listeners, holds } = registry();
  listeners.add(fit);
  holds.set(key, hold);
  window.addEventListener("resize", fit);
  fit();
  return () => {
    listeners.delete(fit);
    if (holds.get(key) === hold) holds.delete(key);
    window.removeEventListener("resize", fit);
    handle.remove();
    saved.forEach(([element, name, value]) => element.style.setProperty(name, value));
  };
}

/**
 * Wrap a footer item's disclosure component in the shared window: BB's frame
 * becomes a line, the window keeps its height while pinned and can be resized,
 * and `dismiss` also forgets the pin — the one way besides the pin itself.
 */
export function withFooterWindow<P extends { dismiss(): void }>(Component: ComponentType<P>, item: FooterItem): ComponentType<P> {
  const key = keyOf(item);
  function FooterWindow(props: P) {
    const anchor = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      const detach = anchor.current ? attachFrame(anchor.current, key) : undefined;
      return () => {
        detach?.();
        // Closed by anyone — BB, another plugin, a reload — rather than
        // replaced by a hovered window: a pinned one waits to come back.
        if (registry().state.shown === key) closedByBb(key);
      };
    }, []);
    const { dismiss } = props;
    const close = useCallback(() => {
      dispatch({ kind: "dismissed", key });
      dismiss();
    }, [dismiss]);
    return (
      <ItemContext.Provider value={item}>
        <div ref={anchor} style={{ display: "contents" }}>
          <Component {...props} dismiss={close} />
        </div>
      </ItemContext.Provider>
    );
  }
  FooterWindow.displayName = `FooterWindow(${Component.displayName ?? Component.name})`;
  return FooterWindow;
}
