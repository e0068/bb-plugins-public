// The sideways swipes that start at the edges of the screen, on Home and in a
// thread alike, over whatever lies there — the composer, a code block, the
// project slides. From the left edge to the right a finger asks for bb's left
// panel. From the right edge to the left it asks, in a thread, for the thread's
// right panel, and on Home for the actions of the row on its line. They have to
// be heard for the whole screen and not row by row: a finger slid in from
// beyond the screen lands in the margin beside the rows, on the project slides
// that would turn under it, or on the composer. The rules live in
// `src/core/edge-swipe.ts`; this is the hand on the screen.
//
// bb opens its left panel on a swipe to the right by itself, following the
// finger, but not from inside something that scrolls sideways — the slides,
// the project pills, a code block — not from a field to type in, and not from
// the strip nearest the edge. So for the length of the swipe whatever scrolls
// sideways under the finger is told not to, and bb sees an ordinary swipe; a
// finger bb would still leave alone is told to bb's swipe as a touch of its
// own, put down on bb's page itself and shifted onto the floor bb listens
// from, so the panel follows that finger too from its first move.
//
// The right panel bb opens only with its button; it follows the finger through
// `dragThreadPanel`. Open, it is closed by bb's own swipe, from anywhere on it;
// the page that swipe carries is lifted over the panel to be seen. A row is
// handed the swipe as an `ADOPT_ROW_SWIPE` event: the row takes the pointer
// from there, as if the finger had landed on it.
//
// On the composer the edges reach across it: a sideways swipe from anywhere on
// it is taken as from the edge it heads away from — to the right for the left
// panel, to the left for the right panel of a thread — and decided on its
// first move. What scrolls sideways there, the project pills, keeps its own.
import {
  bbTakesSidebarSwipe,
  claimsPanelSwipe,
  claimsSidebarSwipe,
  edgeStrip,
  intoBbSidebarSwipe,
  rowAt,
} from "./src/core/edge-swipe";
import type { Point } from "./src/core/home-swipe";
import { inHomeLayer } from "./home-layer";
import { INSET_SELECTOR, SHELF_SELECTOR, abandonPanelSettle, dragThreadPanel, liftPageOverPanel } from "./panel-swipe";

/** The event a row hears when a swipe from the right edge on its line is handed to it. */
export const ADOPT_ROW_SWIPE = "threads-overview:adopt-row-swipe";

/** What a row is handed with the swipe, and what it answers. */
export interface RowAdoption {
  readonly pointerId: number;
  readonly start: Point;
  /** Set by the row that takes the swipe: whether the move under way is the row's, kept from the page. */
  holds: (() => boolean) | null;
}

/** Threads Overview on Home. */
const SECTION_SELECTOR = "[data-threads-overview-section]";

/** The part of a row that slides under the finger. */
const SWIPE_ROW_SELECTOR = "[data-swipe-row]";

/** An open row: a touch outside it is spent on closing it, and starts nothing. */
const OPEN_ROW_SELECTOR = "[data-swipe-open]";

/** What a finger drags itself, or what bb marks as no place for a swipe — no edge swipe starts there. */
const OWN_GESTURE_SELECTOR = 'select, [role="slider"], [data-no-sidebar-swipe], [data-vaul-no-drag]';

/** bb's composer shell, where a sideways swipe from anywhere counts as from the edge. */
const COMPOSER_SELECTOR = "[data-app-composer]";

/** A field to type in: bb's own swipe for its left panel will not start there, so a finger there is told to it. */
const FIELD_SELECTOR = 'input, textarea, [contenteditable="true"]';

/** What opens over bb's page from inside it: a finger there is theirs, not an edge swipe's. */
const OVER_PAGE_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** The pointer of a finger told to bb's swipe: one no real finger has, so bb hears none of the finger's own. */
const RELAYED_POINTER_ID = 2 ** 31 - 1;

/** A swipe under way from one of the edges. */
interface EdgeGesture {
  readonly pointerId: number;
  readonly start: Point;
  last: Point;
  /** Whether the move to `last` is the gesture's, kept from the page. */
  readonly holds: () => boolean;
  /** The finger's pointer moved to `last`. */
  readonly moved: () => void;
  /** The finger is gone: lifted when `completed`, taken away or abandoned when not. */
  readonly end: (completed: boolean) => void;
}

/** Whether one of bb's panels stands open, its page pushed aside. */
function panelOpen(): boolean {
  const inset = document.querySelector(INSET_SELECTOR);
  return inset?.getAttribute("data-sidebar-shelf") === "open" || rightPanelOpen();
}

/** Whether the right panel of a thread stands open over bb's page. */
function rightPanelOpen(): boolean {
  return document.querySelector(INSET_SELECTOR)?.getAttribute("data-panel-shelf") === "full";
}

/** Whether text is selected in what the finger landed on: a finger there drags the selection. */
function dragsSelection(target: Element): boolean {
  const selection = document.getSelection();
  if (selection === null || selection.isCollapsed || selection.anchorNode === null) return false;
  return (target.closest('[contenteditable="true"]') ?? target).contains(selection.anchorNode);
}

/** Threads Overview on Home as the screen shows it — not its copy in the layer under the card — or `null` off Home. */
function homeSection(): HTMLElement | null {
  const sections = Array.from(document.querySelectorAll<HTMLElement>(SECTION_SELECTOR));
  return sections.find((section) => !inHomeLayer(section)) ?? null;
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

/**
 * Tell bb's own swipe of the told finger at `point`, on `to`: the press on
 * bb's page, the rest on the window, where bb hears them.
 */
function relay(type: string, point: Point, to: EventTarget): void {
  to.dispatchEvent(
    new PointerEvent(type, {
      pointerId: RELAYED_POINTER_ID,
      pointerType: "touch",
      isPrimary: true,
      clientX: point.x,
      clientY: point.y,
      bubbles: true,
      cancelable: true,
    }),
  );
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

/** A swipe from the left edge, for bb's left panel. */
function sidebarSwipe(target: Element, pointerId: number, start: Point): EdgeGesture {
  const scrollers = sidewaysScrollers(target);
  const bbIgnores = !bbTakesSidebarSwipe(start.x) || target.closest(FIELD_SELECTOR) !== null;
  // Pressed on bb's page itself, which bb's swipe never refuses — not on the field under the finger.
  const pressOn = document.querySelector(INSET_SELECTOR) ?? target;
  let unlock: (() => void) | null = null;
  let relaying = false;
  const swipe: EdgeGesture = {
    pointerId,
    start,
    last: start,
    // Locked on the first move to the right, not on the touch: a swipe to
    // the left from the same strip still turns the slides. A finger told to
    // bb is held to the end, wherever it wanders: bb hears no touch of it to
    // hold the page by itself.
    holds: () => {
      const claims = claimsSidebarSwipe(start, swipe.last);
      if (claims && unlock === null) unlock = lockSideways(scrollers);
      return relaying || claims;
    },
    // Told to bb from the first move to the right, with the slides already
    // locked: bb gives up a swipe that starts on something scrolling sideways.
    moved: () => {
      if (swipe.holds() && bbIgnores && !relaying) {
        relaying = true;
        relay("pointerdown", intoBbSidebarSwipe(start, start), pressOn);
      }
      if (relaying) relay("pointermove", intoBbSidebarSwipe(start, swipe.last), window);
    },
    end: (completed) => {
      unlock?.();
      if (relaying) relay(completed ? "pointerup" : "pointercancel", intoBbSidebarSwipe(start, swipe.last), window);
    },
  };
  return swipe;
}

/** A swipe from the right edge of a thread, for its right panel; `null` when the thread has none to open. */
function panelSwipe(pointerId: number, start: Point): EdgeGesture | null {
  const drag = dragThreadPanel(start);
  if (drag === null) return null;
  const swipe: EdgeGesture = {
    pointerId,
    start,
    last: start,
    holds: () => drag.holds(swipe.last),
    moved: () => drag.move(swipe.last),
    end: drag.end,
  };
  return swipe;
}

/**
 * A swipe from anywhere on the composer: to the right it is the left edge's,
 * to the left the right edge's in a thread; any other way, or to the left on
 * Home, it is nobody's. Decided on the first move and kept to the end.
 */
function composerSwipe(target: Element, pointerId: number, start: Point, inThread: boolean): EdgeGesture {
  let chosen: EdgeGesture | null | undefined;
  const choose = (): EdgeGesture | null => {
    if (chosen === undefined && (swipe.last.x !== start.x || swipe.last.y !== start.y)) {
      if (claimsSidebarSwipe(start, swipe.last)) chosen = sidebarSwipe(target, pointerId, start);
      else if (inThread && claimsPanelSwipe(start, swipe.last)) chosen = panelSwipe(pointerId, start);
      else chosen = null;
    }
    if (chosen) chosen.last = swipe.last;
    return chosen ?? null;
  };
  const swipe: EdgeGesture = {
    pointerId,
    start,
    last: start,
    holds: () => choose()?.holds() ?? false,
    moved: () => choose()?.moved(),
    end: (completed) => chosen?.end(completed),
  };
  return swipe;
}

/** A finger on the open right panel: bb's swipe closes it, carrying the page lifted over the panel. */
function closingSwipe(pointerId: number, start: Point): EdgeGesture {
  const lower = liftPageOverPanel();
  return { pointerId, start, last: start, holds: () => false, moved: () => {}, end: lower };
}

/** A swipe from the right edge of Home, for the row on its line; `null` when no row takes it. */
function rowSwipe(target: Element, pointerId: number, start: Point): EdgeGesture | null {
  // A finger on a row is the row's own; one beside it is handed to it.
  const section = homeSection();
  if (section === null || target.closest(SWIPE_ROW_SELECTOR) !== null) return null;
  const holds = adoptRow(section, pointerId, start);
  if (holds === null) return null;
  return { pointerId, start, last: start, holds, moved: () => void holds(), end: () => {} };
}

/**
 * Whether a finger landing on `target` may start an edge swipe at all: on bb's
 * page and nowhere else — not on a modal, a toast or a panel laid over it.
 */
function startsEdgeSwipe(target: Element): boolean {
  if (target.closest(INSET_SELECTOR) === null || target.closest(OVER_PAGE_SELECTOR) !== null) return false;
  if (inHomeLayer(target) || panelOpen()) return false;
  if (target.closest(OWN_GESTURE_SELECTOR) !== null || dragsSelection(target)) return false;
  return homeSection()?.querySelector(OPEN_ROW_SELECTOR) == null;
}

/**
 * Hear the edge swipes over the whole screen, and return what stops hearing
 * them. `inThread` says, at the touch, whether a thread is open: its right edge
 * is the right panel's, Home's the rows'. A finger counts anywhere on bb's
 * page, while none of bb's panels stands open and nothing is laid over it.
 */
export function watchEdgeSwipes(inThread: () => boolean): () => void {
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
  const onPointerMove = (event: PointerEvent) => follow(event)?.moved();
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

  const onPointerDown = (event: PointerEvent) => {
    // The touch told to bb is bb's. Any other new finger — a second one, or
    // the next touch after a lift nobody heard — leaves the swipe before it
    // unfinished.
    if (event.pointerId === RELAYED_POINTER_ID) return;
    finish(false);
    if (event.pointerType !== "touch" || !event.isPrimary) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target === null) return;
    const start = { x: event.clientX, y: event.clientY };
    if (rightPanelOpen() && target.closest(SHELF_SELECTOR) !== null) gesture = closingSwipe(event.pointerId, start);
    else if (!startsEdgeSwipe(target)) return;
    else if (target.closest(COMPOSER_SELECTOR) !== null && sidewaysScrollers(target).length === 0) {
      gesture = composerSwipe(target, event.pointerId, start, inThread());
    } else {
      const strip = edgeStrip(start.x, window.innerWidth);
      if (strip === "sidebar") gesture = sidebarSwipe(target, event.pointerId, start);
      else if (strip === "row") gesture = inThread() ? panelSwipe(event.pointerId, start) : rowSwipe(target, event.pointerId, start);
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
    abandonPanelSettle();
  };
}
