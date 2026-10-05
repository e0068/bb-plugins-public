// Layer 1 — pure: how the one window above BB's sidebar footer row reacts to
// hover, leave, a click on an item or inside its window, and how tall it is.
// BB shows a single disclosure at a time, so "a window over the pinned one"
// means showing it in the pinned one's place and bringing the pinned one back
// when the pointer leaves.

/** `<pluginId>/<itemId>` of a sidebar-footer item. */
export type ItemKey = string;

export interface WindowState {
  /** The window a click fixed in place. */
  readonly pinned: ItemKey | null;
  /** The window BB is showing now. */
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
  /** BB or the window itself closed it (Escape, dismiss). */
  | { readonly kind: "closed"; readonly key: ItemKey }
  /** A click inside the item's window: the window stays until its item is clicked. */
  | { readonly kind: "clickInside"; readonly key: ItemKey };

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
      // BB's own toggle closes the pinned window and opens a closed one.
      if (state.shown !== event.key) return stay({ pinned: event.key, shown: event.key });
      return state.pinned === event.key
        ? stay(CLOSED)
        : { state: { pinned: event.key, shown: event.key }, command: NONE, swallowClick: true };
    case "closed":
      if (state.shown === event.key) return stay(CLOSED);
      return state.pinned === event.key ? stay({ ...state, pinned: null }) : stay(state);
    case "clickInside":
      return state.shown === event.key ? stay({ pinned: event.key, shown: event.key }) : stay(state);
  }
}

/** A window either hugs its content or keeps a height the user dragged it to. */
export type WindowHeight = { readonly kind: "hug" } | { readonly kind: "fixed"; readonly px: number };

export const HUG: WindowHeight = { kind: "hug" };

/**
 * The height a window shows at: the pinned one keeps its own; while one is
 * pinned, a window shown in its place takes the pinned one's height, so moving
 * between items does not jump; with nothing pinned a window hugs its content.
 */
export const windowHeight = (key: ItemKey, state: WindowState, own: WindowHeight, pinnedPx: number | null): WindowHeight => {
  if (state.pinned === key) return own;
  return state.pinned !== null && pinnedPx !== null ? { kind: "fixed", px: pinnedPx } : HUG;
};

/** BB's page of a plugin in Tools, where its settings sections render. */
export const pluginSettingsPath = (pluginId: string): string => `/extensions/plugins/${encodeURIComponent(pluginId)}`;

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
