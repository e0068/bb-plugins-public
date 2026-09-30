// A box on the screen, shared by the rules that place layers over it.
// Layer 0: depends on nothing.

/** A box on the screen: its top and left edges and its size, in px. */
export interface Box {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}
