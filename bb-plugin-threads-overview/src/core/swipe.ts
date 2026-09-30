// Pure swipe-to-reveal rule for a row on a touch screen: which way a drag
// goes, where the row sits under the finger, and whether it stays open once
// the finger lifts. Layer 1: depends on nothing but the shape of a point.
import type { Point } from "./home-swipe";

/** How far a finger moves before the drag counts as a swipe or a scroll, in px. */
export const SWIPE_SLOP = 8;

/** Which way a drag goes: sideways swipes the row, upright scrolls the page. */
export type SwipeAxis = "undecided" | "horizontal" | "vertical";

export function swipeAxis(dx: number, dy: number, slop: number = SWIPE_SLOP): SwipeAxis {
  if (Math.hypot(dx, dy) < slop) return "undecided";
  return Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
}

/**
 * Whether the row keeps a move to itself instead of letting it scroll the page:
 * a drag that has gone sideways is the row's, and only while the browser still
 * takes no for an answer — once a scroll has begun the move is no longer
 * cancellable and the answer is no.
 */
export function holdsGesture(axis: SwipeAxis, cancelable: boolean): boolean {
  return axis === "horizontal" && cancelable;
}

/**
 * The row's shift under the finger: from its resting place — closed at 0, open
 * at `-width` — by the drag, never past either end.
 */
export function swipeOffset(open: boolean, dx: number, width: number): number {
  const start = open ? -width : 0;
  return Math.min(0, Math.max(-width, start + dx));
}

/** Whether the row rests open once the finger lifts: past half of the actions it does. */
export function swipeSettlesOpen(open: boolean, dx: number, width: number): boolean {
  return swipeOffset(open, dx, width) <= -width / 2;
}

/**
 * The share of the screen's width, along its right edge, where a sideways
 * swipe belongs to a row: put down there, a finger brings out the row's
 * actions; put down anywhere left of it, the same swipe turns the project
 * slides, over the rows too.
 */
export const ROW_SWIPE_EDGE_SHARE = 0.15;

/** Whether a finger put down at `x` on a screen `screenWidth` wide lands on the strip that swipes rows. */
export function startsRowSwipe(x: number, screenWidth: number): boolean {
  return x >= screenWidth * (1 - ROW_SWIPE_EDGE_SHARE);
}

/**
 * Whether a move of a finger the row has taken is kept from the page, from
 * the first pixel on — iOS hands the whole touch to a scroll of the slides
 * the moment it sees one move nobody stopped. A closed row keeps a swipe to
 * the left, which opens it; a swipe to the right has nothing to open and is
 * the slides'. An open row keeps a swipe either way, so a swipe to the right
 * closes it. A move more upright than sideways is the page's scroll.
 */
export function claimsRowSwipe(start: Point, now: Point, open: boolean): boolean {
  const dx = now.x - start.x;
  const sideways = Math.abs(dx) > Math.abs(now.y - start.y);
  return sideways && (open || dx < 0);
}
