// Whether a scroller stands at the foot of what it scrolls. Layer 0: depends
// on nothing.

/** A scroller as the browser measures it, in px. */
export interface ScrollPosition {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}

/** How far short of the foot still counts as at it, in px: a phone stops a scroll on a fraction of a pixel. */
const END_SLACK = 1;

/** Whether `scroller` shows the foot of what it scrolls — or has nothing to scroll. */
export function scrolledToEnd(scroller: ScrollPosition): boolean {
  return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= END_SLACK;
}
