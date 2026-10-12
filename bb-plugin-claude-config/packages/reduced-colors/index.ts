export { isHexColor, rampColors } from "./core/ramp";
export { DEFAULT_REDUCED_COLORS, parseReducedColors, REDUCED_COLORS_KV_KEY, seriesColors, seriesPainting } from "./core/settings";
export type { ColorMode, ColorPair, ReducedColors, SeriesPainting } from "./core/settings";

export { ReducedColorsProvider, useSeriesColors, useSeriesPainting } from "./react/provider";
export type { ReducedColorsProviderProps } from "./react/provider";
export { ReducedColorsSection } from "./react/reduced-colors-section";
export type { ReducedColorsSectionProps } from "./react/reduced-colors-section";
