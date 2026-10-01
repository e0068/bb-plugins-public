// The sideways swipes that start at the edges of Home. From the left edge to
// the right a finger asks for bb's left panel; from the right edge to the left,
// for the actions of the row on its line. Both have to be heard for the whole
// screen and not row by row: a finger slid in from beyond the screen lands in
// the margin beside the rows — on the project slides, which would turn under
// it, or on bb's page around the section. The rules live in
// `src/core/edge-swipe.ts`; this is the hand on the screen.
//
// bb opens its left panel on a swipe to the right by itself, following the
// finger, but not from inside something that scrolls sideways — the slides,
// the project pills — and not from the strip nearest the edge. So for the
// length of the swipe whatever scrolls sideways under the finger is told not
// to, and bb sees an ordinary swipe; from the strip bb leaves alone, the panel
// is opened here with bb's own button once the finger lets go.
//
// A row is handed the swipe as an `ADOPT_ROW_SWIPE` event: the row takes the
// pointer from there, as if the finger had landed on it.
import {
  bbTakesSidebarSwipe,
  claimsSidebarSwipe,
  edgeStrip,
  opensSidebar,
  rowAt,
} from "./src/core/edge-swipe";
import type { Point } from "./src/core/home-swipe";
import { inHomeLayer } from "./home-layer";

/** The event a row hears when a swipe from the right edge on its line is handed to it. */
export const ADOPT_ROW_SWIPE = "threads-overview:adopt-row-swipe";

/** What a row is handed with the swipe, and what it answers. */
export interface RowAdoption {
  readonly pointerId: number;
  readonly start: Point;
  /** Set by the row that takes the swipe: whether the move under way is the row's, kept from the page. */
  holds: (() => boolean) | null;
}

/** The part of a row that slides under the finger. */
const SWIPE_ROW_SELECTOR = "[data-swipe-row]";

/** An open row: a touch outside it is spent on closing it, and starts nothing. */
const OPEN_ROW_SELECTOR = "[data-swipe-open]";

/** What a finger types into or drags itself — no edge swipe starts there. */
const OWN_GESTURE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="slider"]';

/** bb's button that opens its left panel. */
const SIDEBAR_TRIGGER_SELECTOR = '[data-sidebar="trigger"]';

/** bb's page beside its left panel: the farthest a sideways scroller under the finger is looked for. */
const INSET_SELECTOR = '[data-sidebar="inset"]';

/** A swipe under way from one of the edges. */
interface EdgeGesture {
  readonly pointerId: number;
  readonly start: Point;
  last: Point;
  /** Whether the move to `last` is the gesture's, kept from the page. */
  readonly holds: () => boolean;
  /** The finger is gone: lifted when `completed`, taken away or abandoned when not. */
  readonly end: (completed: boolean) => void;
}

/**
 * Whatever scrolls sideways between the finger and bb's page — the same test
 * bb puts to a swipe before it opens its left panel, and turns it down on.
 */
function sidewaysScrollers(from: Element): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let node: Element | null = from; node !== null; node = node.parentElement) {
    if (node.matches(INSET_SELECTOR)) break;
    if (!(node instanceof HTMLElement)) continue;
    const overflow = getComputedStyle(node).overflowX;
    const scrolls = overflow === "auto" || overflow === "scroll" || overflow === "overlay";
    if (scrolls && node.scrollWidth > node.clientWidth + 1) found.push(node);
  }
  return found;
}

/** Stop `scrollers` scrolling sideways, and return what lets them again. */
function lockSideways(scrollers: readonly HTMLElement[]): () => void {
  const before = scrollers.map((scroller) => scroller.style.overflowX);
  for (const scroller of scrollers) scroller.style.overflowX = "hidden";
  return () => scrollers.forEach((scroller, index) => (scroller.style.overflowX = before[index] ?? ""));
}

/** The rows a finger can reach: those of a dimmed slide are inert. */
function reachableRows(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(SWIPE_ROW_SELECTOR)).filter(
    (row) => row.closest("[inert]") === null,
  );
}

/** Hand a swipe from the right edge to the row on its line; the swipe's hold, or `null` when no row took it. */
function adoptRow(root: HTMLElement, pointerId: number, start: Point): (() => boolean) | null {
  const rows = reachableRows(root);
  const index = rowAt(rows.map((row) => row.getBoundingClientRect()), start.y);
  if (index === null) return null;
  const adoption: RowAdoption = { pointerId, start, holds: null };
  rows[index]?.dispatchEvent(new CustomEvent(ADOPT_ROW_SWIPE, { detail: adoption }));
  return adoption.holds;
}

/**
 * Hear the edge swipes over Home while `root`, the section, is on it, and
 * return what stops hearing them. A finger counts when it lands in the section
 * or in the margin around it — bb's page under the section, not its top bar or
 * its composer.
 */
export function watchEdgeSwipes(root: HTMLElement): () => void {
  let gesture: EdgeGesture | null = null;

  const finish = (completed: boolean) => {
    if (gesture === null) return;
    const ended = gesture;
    gesture = null;
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerCancel, true);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("touchcancel", onTouchCancel);
    ended.end(completed);
  };
  const follow = (event: PointerEvent): EdgeGesture | null => {
    if (gesture === null || event.pointerId !== gesture.pointerId) return null;
    gesture.last = { x: event.clientX, y: event.clientY };
    return gesture;
  };
  // The finger is read off the pointer, on the window's capture, which comes
  // before anyone listening on the document — bb's own swipe among them — so
  // the slides are locked by the time bb looks at them; and the pointer moves
  // before the touch that the page could still be told to hold.
  const onPointerMove = (event: PointerEvent) => void follow(event)?.holds();
  const onTouchMove = (event: TouchEvent) => {
    if (gesture !== null && event.cancelable && gesture.holds()) event.preventDefault();
  };
  // The lift is heard twice, on the pointer and on the touch, whichever comes:
  // a touch whose node left the page mid-swipe never gets its end to the window.
  const onPointerUp = (event: PointerEvent) => {
    if (follow(event) !== null) finish(true);
  };
  const onPointerCancel = (event: PointerEvent) => {
    if (gesture !== null && event.pointerId === gesture.pointerId) finish(false);
  };
  const onTouchEnd = () => finish(true);
  const onTouchCancel = () => finish(false);

  const sidebarSwipe = (target: Element, pointerId: number, start: Point): EdgeGesture => {
    const scrollers = sidewaysScrollers(target);
    let unlock: (() => void) | null = null;
    const swipe: EdgeGesture = {
      pointerId,
      start,
      last: start,
      // Locked on the first move to the right, not on the touch: a swipe to
      // the left from the same strip still turns the slides.
      holds: () => {
        const claims = claimsSidebarSwipe(start, swipe.last);
        if (claims && unlock === null) unlock = lockSideways(scrollers);
        return claims;
      },
      end: (completed) => {
        unlock?.();
        if (completed && !bbTakesSidebarSwipe(start.x) && opensSidebar(start, swipe.last)) {
          document.querySelector<HTMLElement>(SIDEBAR_TRIGGER_SELECTOR)?.click();
        }
      },
    };
    return swipe;
  };

  const onPointerDown = (event: PointerEvent) => {
    // Any new finger — a second one, or the next touch after a lift nobody
    // heard — leaves the swipe before it unfinished.
    finish(false);
    if (event.pointerType !== "touch" || !event.isPrimary || inHomeLayer(root)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target === null || !(root.contains(target) || target.contains(root))) return;
    if (target.closest(OWN_GESTURE_SELECTOR) !== null || root.querySelector(OPEN_ROW_SELECTOR) !== null) return;
    const start = { x: event.clientX, y: event.clientY };
    const strip = edgeStrip(start.x, window.innerWidth);
    if (strip === "sidebar") {
      gesture = sidebarSwipe(target, event.pointerId, start);
    } else if (strip === "row" && target.closest(SWIPE_ROW_SELECTOR) === null) {
      // A finger on a row is the row's own; one beside it is handed to it.
      const holds = adoptRow(root, event.pointerId, start);
      if (holds !== null) gesture = { pointerId: event.pointerId, start, last: start, holds, end: () => {} };
    }
    if (gesture === null) return;
    // Hung before the first move: a move nobody stopped is the scroll's for good.
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchCancel);
  };

  document.addEventListener("pointerdown", onPointerDown, true);
  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    finish(false);
  };
}
