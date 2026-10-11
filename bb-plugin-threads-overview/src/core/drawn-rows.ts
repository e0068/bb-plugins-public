// How many rows of a queue are drawn. Every row is two dozen elements, and bb
// restyles each of them against the styles of every plugin on each way to
// Home, so a list of forty threads held up the page by a tenth of a second.
// The list is drawn a batch at a time, as the end of what is drawn comes into
// reach of the screen. Layer 1, no effects and no SDK.

/** Rows drawn as Home opens: a screen of them and some to spare. */
export const FIRST_ROWS = 16;

/** Rows added each time the end of the drawn ones comes into reach. */
export const ROW_STEP = 16;

/** Rows of a list of `total` drawn after the end of the drawn ones came into reach `reaches` times. */
export const drawnRows = (total: number, reaches: number): number => Math.min(total, FIRST_ROWS + reaches * ROW_STEP);
