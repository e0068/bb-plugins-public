// Layer 1 — pure: how the one window above BB's sidebar footer row reacts to
// hover, leave, a click on an item, the pin in its header, and how tall it is.
// BB shows a single disclosure at a time, so "a window over the pinned one"
// means showing it in the pinned one's place and bringing the pinned one back
// when the pointer leaves. Only the pin unpins: a pinned window BB closes —
// Escape, a window of its own footer, a reload — waits off screen and comes
// back once the footer is free.

/** `<pluginId>/<itemId>` of a sidebar-footer item. */
export type ItemKey = string;

export interface WindowState {
  /** The window the pin in its header fixed in place. */
  readonly pinned: ItemKey | null;
  /** The window BB is showing now; `null` with a pinned one — it waits for the footer to be free. */
  readonly shown: ItemKey | null;
}

export const CLOSED: WindowState = { pinned: null, shown: null };

export type WindowEvent =
  /** The pointer entered an item whose plugin opens on hover. */
  | { readonly kind: "hover"; readonly key: ItemKey }
  /** The pointer stayed off the shown item and its window for the grace period. */
  | { readonly kind: "leave" }
  /** The item's button or its row in the overflow menu was clicked. */
  | { readonly kind: "click"; readonly key: ItemKey }
  /** BB closed it (Escape, another window of its footer, a reload): a pinned window waits to come back. */
  | { readonly kind: "closed"; readonly key: ItemKey }
  /** Its plugin closed it on purpose: the pin goes with it. */
  | { readonly kind: "dismissed"; readonly key: ItemKey }
  /** BB's footer shows no window. */
  | { readonly kind: "free" }
  /** The pin in the item's window header: pins the shown window, or unpins it and leaves it shown until the pointer leaves. */
  | { readonly kind: "pin"; readonly key: ItemKey };

/** What to ask BB's disclosure controllers to do. */
export type Command = { readonly kind: "none" } | { readonly kind: "open"; readonly key: ItemKey } | { readonly kind: "close"; readonly key: ItemKey };

export interface Step {
  readonly state: WindowState;
  readonly command: Command;
  /** BB toggles a disclosure on click; a click that only pins must not reach it. */
  readonly swallowClick: boolean;
}

const NONE: Command = { kind: "none" };
const stay = (state: WindowState): Step => ({ state, command: NONE, swallowClick: false });

export function step(state: WindowState, event: WindowEvent): Step {
  switch (event.kind) {
    case "hover":
      return state.shown === event.key
        ? stay(state)
        : { state: { ...state, shown: event.key }, command: { kind: "open", key: event.key }, swallowClick: false };
    case "leave":
      if (state.shown === null || state.shown === state.pinned) return stay(state);
      return state.pinned === null
        ? { state: CLOSED, command: { kind: "close", key: state.shown }, swallowClick: false }
        : { state: { ...state, shown: state.pinned }, command: { kind: "open", key: state.pinned }, swallowClick: false };
    case "click":
      // Only the pin pins and unpins. BB's own toggle opens a closed window,
      // shown like a hovered one; a shown one, hovered or pinned, stays as it is.
      return state.shown === event.key ? { state, command: NONE, swallowClick: true } : stay({ ...state, shown: event.key });
    case "closed":
      return stay(state.shown === event.key ? { ...state, shown: null } : state);
    case "dismissed":
      if (state.shown === event.key) return stay(CLOSED);
      return stay(state.pinned === event.key ? { ...state, pinned: null } : state);
    case "free":
      return state.pinned !== null && state.shown === null
        ? { state: { ...state, shown: state.pinned }, command: { kind: "open", key: state.pinned }, swallowClick: false }
        : stay(state);
    case "pin":
      if (state.shown !== event.key) return stay(state);
      return stay({ pinned: state.pinned === event.key ? null : event.key, shown: event.key });
  }
}

/**
 * A window its plugin opened for the time something runs — Aloud's player
 * while it reads — and the window pinned before it, to bring back after. It
 * takes the pin's place, so every copy of this package, older ones included,
 * keeps it on screen when the pointer leaves.
 */
export interface Presented {
  readonly key: ItemKey;
  readonly restore: ItemKey | null;
}

export interface PresentStep {
  readonly state: WindowState;
  readonly presented: Presented | null;
  readonly command: Command;
}

/** Show the item's window until `release`; a window the user pinned is left as it is. */
export function present(state: WindowState, presented: Presented | null, key: ItemKey): PresentStep {
  if (state.pinned === key) return { state, presented, command: NONE };
  return {
    state: { pinned: key, shown: key },
    presented: { key, restore: state.pinned },
    command: state.shown === key ? NONE : { kind: "open", key },
  };
}

/**
 * Close the window `present` opened, or bring back the one pinned before it.
 * A window the user pinned meanwhile, or that was closed, is left as it is.
 */
export function release(state: WindowState, presented: Presented | null, key: ItemKey): PresentStep {
  if (presented?.key !== key) return { state, presented, command: NONE };
  if (state.pinned !== key) return { state, presented: null, command: NONE };
  const { restore } = presented;
  if (state.shown !== key) return { state: { pinned: restore, shown: state.shown }, presented: null, command: NONE };
  return {
    state: { pinned: restore, shown: restore },
    presented: null,
    command: restore === null ? { kind: "close", key } : { kind: "open", key: restore },
  };
}

/** The item's window is pinned by the pin in its header, not held by `present`. */
export const pinnedByUser = (state: WindowState, presented: Presented | null, key: ItemKey): boolean =>
  state.pinned === key && presented?.key !== key;

/** A window either hugs its content or keeps a height the user dragged it to. */
export type WindowHeight = { readonly kind: "hug" } | { readonly kind: "fixed"; readonly px: number };

export const HUG: WindowHeight = { kind: "hug" };

/** BB's page of a plugin in Tools, where its settings sections render. */
export const pluginSettingsPath = (pluginId: string): string => `/settings/plugins/${encodeURIComponent(pluginId)}`;

export interface Drag {
  readonly startPx: number;
  readonly startY: number;
  readonly y: number;
}

export interface Bounds {
  readonly min: number;
  readonly max: number;
}

/** The window grows upward: dragging its top edge up by N px adds N px. */
export const dragHeight = ({ startPx, startY, y }: Drag, { min, max }: Bounds): number =>
  Math.max(min, Math.min(max, Math.round(startPx + startY - y)));

export const heightFromStorage = (raw: string | null): WindowHeight => {
  const px = Number(raw ?? "");
  return raw !== null && raw !== "" && Number.isFinite(px) && px > 0 ? { kind: "fixed", px: Math.round(px) } : HUG;
};

export const heightToStorage = (height: WindowHeight): string | null => (height.kind === "fixed" ? String(height.px) : null);
