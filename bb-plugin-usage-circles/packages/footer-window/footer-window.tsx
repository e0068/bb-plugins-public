// Layer 2 — DOM and React shell around core.ts: one window above BB's sidebar
// footer row, shared by every plugin that registers an item there.
//
// Each plugin bundle carries its own copy of this module, but the window is one
// for the whole app, so the state, the item controllers and the document
// listeners live in a registry on `globalThis` under a well-known symbol: the
// first plugin to register installs the listeners, the rest join the registry.
// BB draws the footer and the window frame outside any plugin root, so every
// style here is inline, on BB's theme tokens.
import { useCallback, useEffect, useLayoutEffect, useRef, type ComponentType } from "react";

import {
  CLOSED,
  HUG,
  dragHeight,
  heightFromStorage,
  heightToStorage,
  step,
  type Command,
  type ItemKey,
  type WindowEvent,
  type WindowHeight,
  type WindowState,
} from "./core";

/** How long the pointer may stay off a hovered window before it closes. */
export const HOVER_LEAVE_MS = 400;
/** A pointer that cannot hover (a finger) never opens a window by hovering. */
const HOVER_QUERY = "(hover: hover)";
/** How long to wait for BB to move focus to the item's button after a close. */
const FOCUS_RETURN_MS = 500;
const MIN_HEIGHT_PX = 80;
/** Gap between the window's top and the thread list. */
const TOP_GAP_PX = 8;
/** Thread list top, should BB change the sidebar markup. */
const FALLBACK_LIST_TOP_PX = 160;
const HANDLE_HEIGHT_PX = 6;
const STORAGE_PREFIX = "bb-plugins.footer-window.height:";
/** The same line BB draws between the top menu and the thread list (`border-sidebar-border/25`). */
const SEPARATOR = "1px solid color-mix(in oklab, var(--sidebar-border) 25%, transparent)";

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
  state: WindowState;
  removeListeners: (() => void) | null;
}

const REGISTRY = Symbol.for("bb-plugins.footer-window.v1");

function registry(): Registry {
  const scope = globalThis as typeof globalThis & { [REGISTRY]?: Registry };
  scope[REGISTRY] ??= { entries: new Map(), openOnHover: new Map(), listeners: new Set(), state: CLOSED, removeListeners: null };
  return scope[REGISTRY];
}

const keyOf = ({ pluginId, itemId }: FooterItem): ItemKey => `${pluginId}/${itemId}`;
const pluginOf = (key: ItemKey): string => key.slice(0, key.indexOf("/"));

function run(command: Command): void {
  if (command.kind === "none") return;
  const controller = registry().entries.get(command.key)?.controller;
  if (command.kind === "open") controller?.open();
  else controller?.close();
}

/** Feeds one event to the core, carries out its command; true when the click must not reach BB. */
function dispatch(event: WindowEvent): boolean {
  const r = registry();
  const next = step(r.state, event);
  r.state = next.state;
  run(next.command);
  r.listeners.forEach((listener) => listener());
  return next.swallowClick;
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
  /** The pointer is at `target`; `null` — it left the app. */
  const pointerAt = (target: EventTarget | null) => {
    const { shown, pinned } = registry().state;
    if (shown === null || shown === pinned || (target !== null && isOver(target, shown))) return cancelLeave();
    leaveTimer ??= setTimeout(() => {
      leaveTimer = null;
      keepFocusWhereItWas();
      dispatch({ kind: "leave" });
    }, HOVER_LEAVE_MS);
  };
  const onMove = (event: MouseEvent) => pointerAt(event.target);
  // The sidebar sits at the window's edge: a pointer leaving the app from the
  // item fires no further mousemove, only a mouseout into nowhere.
  const onOut = (event: MouseEvent) => {
    if (event.relatedTarget === null) pointerAt(null);
  };
  // A click inside the shown window pins it: only its item closes it.
  const clickInside = (target: EventTarget | null) => {
    const { shown } = registry().state;
    if (shown !== null && target instanceof Node && sectionOf(shown)?.contains(target)) dispatch({ kind: "clickInside", key: shown });
  };
  const onClick = (event: MouseEvent) => {
    const key = itemKeyAt(event.target);
    if (key === null) return clickInside(event.target);
    cancelLeave();
    if (!dispatch({ kind: "click", key })) return;
    if (buttonKey(event.target) === null) {
      // A menu row's click also closes the menu, so it goes through; BB's
      // toggle then shuts the window, which forgets the pin on unmount. Right
      // after, the core opens it again and pins it.
      setTimeout(() => {
        dispatch({ kind: "hover", key });
        dispatch({ kind: "click", key });
      }, 0);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onKey = (event: KeyboardEvent) => {
    const { shown } = registry().state;
    if (event.key === "Escape" && shown !== null) dispatch({ kind: "closed", key: shown });
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
 * Put one footer item under the shared window: hover opens it, a click pins it.
 * Call it in the plugin's setup with the controller `experimental_sidebarFooter.register`
 * returned. Returns the unregistration.
 */
export function registerFooterWindow(item: FooterItemEntry, controller: DisclosureController): () => void {
  const r = registry();
  const key = keyOf(item);
  r.entries.set(key, { ...item, controller });
  r.removeListeners ??= installListeners();
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

/** Drop every registration and listener — between tests. */
export function resetFooterWindowsForTests(): void {
  const r = registry();
  r.removeListeners?.();
  r.removeListeners = null;
  r.entries.clear();
  r.openOnHover.clear();
  r.listeners.clear();
  r.state = CLOSED;
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
 * Restyle BB's window frame for one item while its component is mounted: a
 * line on top instead of the rounded frame, no 320 px ceiling, no height
 * animation, the remembered height while pinned and a handle on the top edge
 * to drag it. Returns the restoration.
 */
function attachFrame(node: HTMLElement, key: ItemKey): () => void {
  const section = node.closest("section");
  const frame = section?.firstElementChild;
  if (!section || !(frame instanceof HTMLElement)) return () => undefined;
  const saved = [
    ...setStyles(section, {
      position: "relative",
      border: "0",
      "border-top": SEPARATOR,
      "border-radius": "0",
      background: "transparent",
      transition: "none",
    }),
    ...setStyles(frame, { height: "", "max-height": "" }),
  ];

  let dragged: WindowHeight | null = null;
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
    const pinned = registry().state.pinned === key;
    handle.style.display = pinned ? "block" : "none";
    apply(pinned ? (dragged ?? readHeight(key)) : HUG);
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
  const listeners = registry().listeners;
  listeners.add(fit);
  window.addEventListener("resize", fit);
  fit();
  return () => {
    listeners.delete(fit);
    window.removeEventListener("resize", fit);
    handle.remove();
    saved.forEach(([element, name, value]) => element.style.setProperty(name, value));
  };
}

/**
 * Wrap a footer item's disclosure component in the shared window: BB's frame
 * becomes a line, the window keeps its height while pinned and can be resized,
 * and `dismiss` also forgets the pin.
 */
export function withFooterWindow<P extends { dismiss(): void }>(Component: ComponentType<P>, item: FooterItem): ComponentType<P> {
  const key = keyOf(item);
  function FooterWindow(props: P) {
    const anchor = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      const detach = anchor.current ? attachFrame(anchor.current, key) : undefined;
      return () => {
        detach?.();
        // Closed by anyone — BB, another plugin, the item hidden — rather than
        // replaced by a hovered window: the pin must not outlive the window.
        if (registry().state.shown === key) dispatch({ kind: "closed", key });
      };
    }, []);
    const { dismiss } = props;
    const close = useCallback(() => {
      dispatch({ kind: "closed", key });
      dismiss();
    }, [dismiss]);
    return (
      <div ref={anchor} style={{ display: "contents" }}>
        <Component {...props} dismiss={close} />
      </div>
    );
  }
  FooterWindow.displayName = `FooterWindow(${Component.displayName ?? Component.name})`;
  return FooterWindow;
}
