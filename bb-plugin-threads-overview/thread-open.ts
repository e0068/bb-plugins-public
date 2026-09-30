// The row growing into its thread on a tap. bb holds Home on the screen until
// the thread it was asked for has loaded — over a remote connection a second
// or two with nothing to show for the tap — and then draws the thread at once.
// So the moment a row is tapped a layer opens out of it over the whole screen,
// with the thread's title and the outline of a conversation, and gives way the
// moment bb has left Home. Plain DOM on `body`, not a React tree: the section
// that starts it is gone with Home, and the layer has to outlive it.

import { HOME_SELECTOR, awaitHome } from "./home-screen";
import { portalScopeProps } from "./lib/portal-scope";
import { SCREEN_CLIP, rowClip } from "./src/core/thread-open";

/** Marks the layer. */
const LAYER_ATTRIBUTE = "data-thread-open";

/** Above everything bb and other plugins put on the screen. */
const TOPMOST = "2147483000";

/** How long the row takes to open out to the screen, in ms. */
const OPEN_MS = 240;

/**
 * How long the layer waits for bb to leave Home before it gives way anyway, in
 * ms: long enough for a slow connection, short enough not to leave a thread
 * that never comes — a deleted one, a dropped connection — standing for long.
 */
const WAIT_MS = 5000;

/** How long the layer takes to fade into the thread under it, in ms. */
const FADE_MS = 150;

/** A piece of the thread screen's outline: its top and height in px, its sides as CSS lengths. */
interface Piece {
  readonly top: number;
  readonly left: string;
  readonly right: string;
  readonly height: number;
  readonly radius: number;
}

/** A bar of text `short` px shy of the right-hand margin. */
const line = (top: number, short: number): Piece => ({ top, left: "24px", right: `${24 + short}px`, height: 14, radius: 7 });

/** A point of a list: its marker and its text, `width` px long. */
const point = (top: number, width: number): Piece[] => [
  { top, left: "24px", right: "calc(100% - 38px)", height: 14, radius: 4 },
  { top: top + 1, left: "46px", right: `calc(100% - ${46 + width}px)`, height: 12, radius: 6 },
];

// The shape of bb's own thread screen while its messages load — the prompt's
// bubble on the right, lines of the answer, a short list, more lines — so the
// thread bb draws at once in its place, fading in under the layer, lands on
// the same header, margins and composer.
const OUTLINE: readonly Piece[] = [
  { top: 88, left: "45%", right: "24px", height: 48, radius: 12 },
  line(156, 26),
  line(178, 0),
  line(200, 83),
  ...point(235, 138),
  ...point(259, 172),
  ...point(283, 115),
  line(316, 54),
  line(338, 112),
];

/** bb's thread header: the title where bb sets it, over a hairline. */
const HEADER_HEIGHT = 47;

/** bb's composer at the bottom of a thread: its gap to the screen's edges and its height, in px. */
const COMPOSER_INSET = 16;
const COMPOSER_HEIGHT = 50;

function piece({ top, left, right, height, radius }: Piece): HTMLElement {
  const bar = document.createElement("div");
  Object.assign(bar.style, {
    position: "absolute",
    top: `${top}px`,
    left,
    right,
    height: `${height}px`,
    borderRadius: `${radius}px`,
    backgroundColor: "var(--muted)",
    opacity: "0.6",
  });
  return bar;
}

function header(title: string): HTMLElement {
  const bar = document.createElement("div");
  bar.textContent = title;
  Object.assign(bar.style, {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    height: `${HEADER_HEIGHT}px`,
    lineHeight: `${HEADER_HEIGHT}px`,
    padding: "0 136px 0 56px",
    fontSize: "15px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    borderBottom: "1px solid var(--border)",
  });
  return bar;
}

function composer(): HTMLElement {
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "absolute",
    left: `${COMPOSER_INSET}px`,
    right: `${COMPOSER_INSET}px`,
    bottom: `calc(${COMPOSER_INSET}px + var(--bb-safe-area-bottom, env(safe-area-inset-bottom)))`,
    height: `${COMPOSER_HEIGHT}px`,
    borderRadius: "16px",
    border: "1px solid var(--border)",
  });
  return box;
}

/** The header and the conversation, below the status bar as bb's own screen sets them. */
function page(title: string): HTMLElement {
  const box = document.createElement("div");
  Object.assign(box.style, { position: "absolute", inset: "0", top: "env(safe-area-inset-top)" });
  box.append(header(title), ...OUTLINE.map(piece));
  return box;
}

/**
 * The layer for `title`, clipped to `row`'s box, not yet on the page. It
 * takes the touches that land on it: under it is Home, which the thread
 * pictured on it has already replaced for the eye, so a tap there would
 * open, type into or scroll something no longer seen.
 */
function createLayer(title: string, row: DOMRect): HTMLElement {
  const layer = document.createElement("div");
  for (const [name, value] of Object.entries(portalScopeProps())) layer.setAttribute(name, value);
  layer.setAttribute(LAYER_ATTRIBUTE, "");
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    zIndex: TOPMOST,
    overflow: "hidden",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    clipPath: rowClip(row, { width: window.innerWidth, height: window.innerHeight }),
  });
  layer.append(page(title), composer());
  return layer;
}

/**
 * Open `row` out over the screen as the thread `title` it leads to, if Home is
 * on the screen: only there does bb hold the screen while the thread loads. A
 * layer still up from an earlier tap goes at once: one tap, one layer. It
 * fades away once bb has taken Home off the screen, or after a while if it
 * never does, and leaves the page.
 */
export function openRowIntoThread(row: Element, title: string): void {
  if (document.querySelector(HOME_SELECTOR) === null) return;
  document.querySelectorAll(`[${LAYER_ATTRIBUTE}]`).forEach((earlier) => earlier.remove());
  const layer = createLayer(title, row.getBoundingClientRect());
  document.body.append(layer);
  // The clip it starts from is laid down before the transition is set, so the
  // opening is animated from the row and not snapped to the screen.
  void layer.getBoundingClientRect();
  layer.style.transition = `clip-path ${OPEN_MS}ms cubic-bezier(0.2, 0, 0, 1)`;
  layer.style.clipPath = SCREEN_CLIP;
  // A layer a later tap has replaced stops waiting at once: off the page, it
  // reads as Home gone.
  awaitHome(false, () => (layer.isConnected ? document : null), WAIT_MS, () => {
    layer.style.transition = `opacity ${FADE_MS}ms ease-out`;
    layer.style.opacity = "0";
    window.setTimeout(() => layer.remove(), FADE_MS);
  });
}
