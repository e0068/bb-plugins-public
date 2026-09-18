// Pure swipe-to-reveal rule for a row on a touch screen: which way a drag
// goes, where the row sits under the finger, and whether it stays open once
// the finger lifts. Layer 1: depends on nothing.

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
