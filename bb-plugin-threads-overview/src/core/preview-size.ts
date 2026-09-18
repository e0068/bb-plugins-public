// The preview window's size, parsed out of the plugin's own settings. Like the
// delay, a size is a numeric string at the boundary — setting descriptors have
// no number type. Layer 1, no effects and no SDK.

export const PREVIEW_SIZE_BOUNDS = {
  width: { default: 512, min: 280, max: 1600 },
  height: { default: 900, min: 200, max: 2400 },
} as const;

type Raw = string | number | boolean | undefined;
type Bounds = { default: number; min: number; max: number };

function pixels(raw: Raw, bounds: Bounds): number {
  const value =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(value)) return bounds.default;
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, value)));
}

/** Width and height in pixels; the height is a ceiling the conversation grows up to. */
export function parsePreviewSize(width: Raw, height: Raw): { width: number; height: number } {
  return {
    width: pixels(width, PREVIEW_SIZE_BOUNDS.width),
    height: pixels(height, PREVIEW_SIZE_BOUNDS.height),
  };
}
