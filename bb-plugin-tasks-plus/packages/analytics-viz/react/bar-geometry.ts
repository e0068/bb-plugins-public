// The "own shape" of the Recharts hybrid: pure SVG-path geometry for a bar
// with rounded top corners. Recharts owns the axes, scales, ticks, tooltip and
// legend; this owns exactly the pixel gaps and corner radii the declarative
// <Bar> props can't express (see BBPL-256). No React, no DOM — a string in, so
// it is property-testable on its own.

/**
 * SVG path `d` for a bar filling `[x, x+width] × [y, y+height]` with only its
 * two TOP corners rounded to `radius`; the bottom stays square because a bar
 * sits flush on an axis. `radius` is clamped to what actually fits —
 * `min(radius, width/2, height)` — and a negative radius reads as 0, so no
 * input can produce a self-intersecting or inverted path.
 *
 * Total: a non-positive or non-finite `width`/`height` (nothing to draw)
 * returns `""` rather than a degenerate path, and a caller can branch on the
 * empty string to render nothing.
 */
export function roundedTopBarPath(x: number, y: number, width: number, height: number, radius: number): string {
  if (![x, y, width, height, radius].every(Number.isFinite)) return "";
  if (width <= 0 || height <= 0) return "";

  const r = Math.max(0, Math.min(radius, width / 2, height));
  const right = x + width;
  const bottom = y + height;

  if (r === 0) {
    return `M${x},${y} H${right} V${bottom} H${x} Z`;
  }
  // Up the left edge, round into the top, across, round down the right edge,
  // down to the baseline, and close along the bottom.
  return (
    `M${x},${bottom} ` +
    `V${y + r} ` +
    `Q${x},${y} ${x + r},${y} ` +
    `H${right - r} ` +
    `Q${right},${y} ${right},${y + r} ` +
    `V${bottom} ` +
    `Z`
  );
}
