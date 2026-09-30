// Layer 2 — what the Reduced Colors setting is, how a stored blob becomes
// one, and how a chart's palette turns into ramp steps. Pure, no zod: this
// package may not carry third-party imports (see
// docs/decisions/packages-shared-code-must-be-pure-or-shimmed.md), so the
// parse is written out by hand and is total — any input gives a value.
import { isHexColor, rampColors } from "./ramp";

/** The two ends of a ramp: `low` paints the first series, `high` the last. */
export interface ColorPair {
  readonly low: string;
  readonly high: string;
}

/** bb's two themes; a chart paints with the pair of the theme it is drawn in. */
export type ColorMode = "light" | "dark";

/** A pair per theme — one pair never reads on both backgrounds (docs/decisions/reduced-colors-pair-per-theme.md). */
export interface ReducedColors {
  readonly enabled: boolean;
  readonly light: ColorPair;
  readonly dark: ColorPair;
}

/** The plugin kv key the setting is stored under — one per plugin, same name in each. */
export const REDUCED_COLORS_KV_KEY = "reduced-colors";

/** Off until the owner turns it on; blue into pale blue, the pale end still visible on white. */
export const DEFAULT_REDUCED_COLORS: ReducedColors = {
  enabled: false,
  light: { low: "#1d4ed8", high: "#bfdbfe" },
  dark: { low: "#2563eb", high: "#dbeafe" },
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const colorOr = (raw: unknown, fallback: string): string => (typeof raw === "string" && isHexColor(raw) ? raw : fallback);

function parsePair(raw: unknown, fallback: ColorPair): ColorPair {
  const pair = isRecord(raw) ? raw : {};
  return { low: colorOr(pair.low, fallback.low), high: colorOr(pair.high, fallback.high) };
}

/**
 * A stored blob → the setting. Field by field: whatever is missing or of the
 * wrong shape comes from the defaults, the rest is kept, so a hand-edited or
 * half-written blob loses only its broken part.
 */
export function parseReducedColors(raw: unknown): ReducedColors {
  const value = isRecord(raw) ? raw : {};
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_REDUCED_COLORS.enabled,
    light: parsePair(value.light, DEFAULT_REDUCED_COLORS.light),
    dark: parsePair(value.dark, DEFAULT_REDUCED_COLORS.dark),
  };
}

/**
 * How a chart paints its series right now: with its own palette, or with
 * `steps(count)` of the theme's ramp. For charts whose colours are not one
 * flat list — some series join the ramp, some keep a colour of their own,
 * like the alarm red of canceled tasks.
 */
export type SeriesPainting =
  | { readonly kind: "palette" }
  | { readonly kind: "ramp"; readonly steps: (count: number) => readonly string[] };

export function seriesPainting(settings: ReducedColors, mode: ColorMode): SeriesPainting {
  if (!settings.enabled) return { kind: "palette" };
  const { low, high } = settings[mode];
  return { kind: "ramp", steps: (count) => rampColors(low, high, count) };
}

/**
 * A chart's series colours, in legend order → what to paint them with. Off:
 * the palette as it is, own agent colours and all. On: one ramp step per
 * series from the theme's low to its high, the palette's own colours ignored.
 */
export function seriesColors(settings: ReducedColors, mode: ColorMode, palette: readonly string[]): readonly string[] {
  const painting = seriesPainting(settings, mode);
  return painting.kind === "palette" ? palette : painting.steps(palette.length);
}
