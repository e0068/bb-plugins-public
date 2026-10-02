import type { CSSProperties } from "react";

/**
 * A tag drawn in its own colour: the colour fills the whole chip and the
 * text on it turns black on a light colour and white on a dark one. The
 * choice is CSS's own relative colour — the colour's OKLCH lightness against
 * a midpoint — so any colour a tag holds, hex or named, reads.
 */
export function labelFill(color: string): CSSProperties {
  return { backgroundColor: color, color: `oklch(from ${color} clamp(0, (0.7 - l) * 1000, 1) 0 0)` };
}
