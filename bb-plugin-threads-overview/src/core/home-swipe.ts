// Pure rule for the gesture that leaves a thread: a finger put down at the
// bottom edge of the screen and pushed up takes the screen home, the way a
// phone sends an app away. Layer 1: depends on nothing.

/** A point under the finger, in the screen's own coordinates. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** How tall the strip along the bottom edge is where the gesture may start, in px. */
export const HOME_SWIPE_EDGE = 96;

/** How far up the finger travels before the screen goes home, in px. */
export const HOME_SWIPE_REACH = 80;

/**
 * Whether a finger landing here can start the gesture at all. The strip is
 * measured from the screen's own height, so it stays a strip on a phone held
 * either way and on a window of any size.
 */
export function startsHomeSwipe(start: Point, screenHeight: number): boolean {
  return start.y >= screenHeight - HOME_SWIPE_EDGE;
}

/** What a box says about its own scrolling — an element answers this shape as it is. */
export interface ScrollBox {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}

/**
 * How many pixels short of the end still count as the end, in px. Four,
 * because that is the slack bb's own shell uses to decide a conversation sits
 * at its newest message: a thread bb calls "at the bottom" has to be one the
 * gesture calls that too, or the swipe would quietly do nothing.
 */
export const HOME_SWIPE_SCROLL_SLACK = 4;

/**
 * Whether a box still has content below what it shows. A finger pushed up over
 * such a box is asking it to scroll, not asking for the home screen, so the
 * gesture stays out of its way; a conversation resting at its newest message
 * has no room left and lets the gesture through.
 */
export function hasRoomBelow(box: ScrollBox): boolean {
  return box.scrollHeight - box.clientHeight - box.scrollTop > HOME_SWIPE_SCROLL_SLACK;
}

/**
 * Whether the finger has gone far enough, and upright enough, to go home. A
 * drag that wanders sideways more than it climbs is somebody else's gesture —
 * a row's swipe, a slide of project groups — and is left to them.
 */
export function reachesHome(start: Point, now: Point): boolean {
  const up = start.y - now.y;
  return up >= HOME_SWIPE_REACH && up > Math.abs(now.x - start.x);
}
