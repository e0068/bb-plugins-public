// Where a box placed at a point ends up once it's kept inside the window.
// Pure: the window size and the box size are arguments, not read from the DOM.

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Gap kept between a tooltip and the window edge — the same as Radix tooltips' `collisionPadding`. */
export const VIEWPORT_MARGIN_PX = 8;

const clampAxis = (start: number, length: number, room: number, margin: number): number =>
  Math.min(Math.max(start, margin), Math.max(margin, room - length - margin));

/**
 * The top-left corner closest to `natural` at which a box of `size` stays
 * `margin` away from every edge of `viewport`. A box too big for the window is
 * pinned to its left or top margin, so its start is always readable.
 */
export function clampToViewport(natural: Point, size: Size, viewport: Size, margin: number = VIEWPORT_MARGIN_PX): Point {
  return {
    x: clampAxis(natural.x, size.width, viewport.width, margin),
    y: clampAxis(natural.y, size.height, viewport.height, margin),
  };
}
