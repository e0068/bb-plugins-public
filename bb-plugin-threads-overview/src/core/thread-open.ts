// Pure rule of the row growing into its thread on a tap: a layer over the
// whole screen is clipped to the row's box, then opened out to the screen.
// A clip, not a resize: nothing in the layer is laid out again on any frame.
// Layer 1: depends only on the box.

import type { Box } from "./box";

/** The screen's size, in px. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** How round the row's corners are while the layer shows only the row, in px. */
const ROW_RADIUS = 8;

/** The clip that shows the whole of the layer. */
export const SCREEN_CLIP = "inset(0px 0px 0px 0px round 0px)";

/** The clip that shows only `row`'s box of a layer over the screen, never past the screen's edges. */
export function rowClip(row: Box, viewport: Viewport): string {
  const top = Math.max(0, row.top);
  const left = Math.max(0, row.left);
  const right = Math.max(0, viewport.width - row.left - row.width);
  const bottom = Math.max(0, viewport.height - row.top - row.height);
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${ROW_RADIUS}px)`;
}
