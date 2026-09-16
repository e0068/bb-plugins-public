// Layer 1, zero imports: the shade that covers the app around an unsaved
// document, as four rectangles framing the hole the document sits in.
//
// Four rectangles rather than one full-screen layer with a hole cut by
// clip-path or a giant box-shadow: a box-shadow catches no clicks, and a
// clip-path hole is invisible to anyone reading the markup. Four plain boxes
// are hit-tested by the browser as boxes, and the document inside the hole
// stays clickable because nothing is on top of it.

export type Box = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };

const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max);

/**
 * Top and bottom run the full width; left and right fill the band between
 * them beside the hole. The hole is clipped to the viewport first, so a panel
 * that sticks out past the window edge leaves no negative box behind.
 */
export function shadeRects(hole: Box, viewport: Size): readonly Box[] {
  const left = clamp(hole.left, viewport.width);
  const right = clamp(hole.left + hole.width, viewport.width);
  const top = clamp(hole.top, viewport.height);
  const bottom = clamp(hole.top + hole.height, viewport.height);
  const band = bottom - top;
  return [
    { left: 0, top: 0, width: viewport.width, height: top },
    { left: 0, top: bottom, width: viewport.width, height: viewport.height - bottom },
    { left: 0, top, width: left, height: band },
    { left: right, top, width: viewport.width - right, height: band },
  ];
}
