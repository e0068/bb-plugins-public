// Where bb's composer is held on the carried card. Out of sticky, the composer
// lies in the flow of the conversation and moves with it: a scroll, a message
// growing or folding above it. Held, it is brought back each time to where
// sticky would have it — its bottom on the bottom of the conversation, as far
// above it as it stood on the flat screen.

/** A box held by a relative offset, as the screen shows it now. */
export interface HeldBox {
  /** The box's relative offset, in its own px. */
  readonly top: number;
  /** The box's bottom on the screen. */
  readonly bottom: number;
  /** The bottom of the conversation that scrolls it, on the screen. */
  readonly floor: number;
  /** How far above the floor the box stood on the flat screen, in its own px. */
  readonly gap: number;
  /** Screen px per own px: how much the card is shrunk. */
  readonly scale: number;
}

/**
 * The relative offset that stands `box` where it stood above its floor. A
 * screen with no size to measure by leaves the offset as it is.
 */
export function heldTop(box: HeldBox): number {
  if (box.scale <= 0) return box.top;
  return box.top + (box.floor - box.bottom) / box.scale - box.gap;
}
