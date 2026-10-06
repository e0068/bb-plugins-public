// How wide a board column may be dragged, and how wide it is drawn untouched:
// three numbers the owner sets in the plugin's settings. Pure and zod-free,
// so the client may import it (shared/frontend-bundle.test.ts).

export interface ColumnWidthBounds {
  readonly min: number;
  readonly max: number;
  readonly initial: number;
}

/** The hard range any width lives in, whatever the owner sets and whatever a saved view carries. */
export const COLUMN_WIDTH_LIMITS = { floor: 80, ceiling: 2000 } as const;

/** What the board drew before the bounds became settings. */
export const DEFAULT_COLUMN_WIDTH_BOUNDS: ColumnWidthBounds = { min: 200, max: 480, initial: 230 };

/** The plugin kv key the bounds are stored under. */
export const COLUMN_WIDTH_BOUNDS_KV_KEY = "board-column-width-bounds";

export type ColumnWidthBoundsCheck =
  | { readonly ok: true; readonly bounds: ColumnWidthBounds }
  | { readonly ok: false; readonly reason: string };

const isPixels = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

const refuse = (reason: string): ColumnWidthBoundsCheck => ({ ok: false, reason });

/** Three numbers → the bounds, or the one reason they cannot be saved. */
export function checkColumnWidthBounds(raw: unknown): ColumnWidthBoundsCheck {
  const { min, initial, max } = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (!isPixels(min) || !isPixels(initial) || !isPixels(max)) return refuse("Enter whole numbers of pixels.");
  const { floor, ceiling } = COLUMN_WIDTH_LIMITS;
  if ([min, initial, max].some((width) => width < floor || width > ceiling)) {
    return refuse(`Keep every width between ${floor} and ${ceiling} px.`);
  }
  if (min > max) return refuse("Minimum must not exceed maximum.");
  if (initial < min || initial > max) return refuse("Default width must lie between minimum and maximum.");
  return { ok: true, bounds: { min, max, initial } };
}

/** A stored value → the bounds; anything that fails the check is the default. */
export function parseColumnWidthBounds(raw: unknown): ColumnWidthBounds {
  const checked = checkColumnWidthBounds(raw);
  return checked.ok ? checked.bounds : DEFAULT_COLUMN_WIDTH_BOUNDS;
}

/** A width held inside the bounds, in whole pixels. */
export const clampToBounds = (bounds: ColumnWidthBounds, width: number): number =>
  Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));

/** A width held inside the hard limits only — for a width kept before the owner's bounds are known. */
export const clampToLimits = (width: number): number =>
  clampToBounds({ min: COLUMN_WIDTH_LIMITS.floor, max: COLUMN_WIDTH_LIMITS.ceiling, initial: COLUMN_WIDTH_LIMITS.floor }, width);
