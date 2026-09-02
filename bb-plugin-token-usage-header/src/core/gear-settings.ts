// Chart geometry/behaviour settings — the former "gear popover" fields.
// Declared via `bb.settings.define` in server.ts and rendered by bb's own
// Settings page (Tools → plugin detail), not a custom in-app popover — see
// memory/decisions/token-usage-gear-to-native-settings.md for why these 14
// fields moved out of the bb.storage.kv blob in viz-settings.ts while
// agentColors stayed behind.
//
// The SDK's setting values are only ever `string | boolean` (no number or
// colour type), so every numeric or colour field here is declared as a
// "string"/"select" descriptor and parsed/clamped back into its real type by
// parseGearSettings — the same "parse, don't validate" boundary
// viz-settings.ts's parseVizSettings uses for the kv blob. Pure — no I/O, no
// SDK dependency; the barrel (index.ts) requires that of every core module.

export const GEAR_UNIT_OPTIONS = ["30", "60", "300", "900", "3600"] as const;
export const GEAR_HEIGHT_MODE_OPTIONS = ["shared", "perCard"] as const;
export type GearHeightMode = (typeof GEAR_HEIGHT_MODE_OPTIONS)[number];

export interface GearSettings {
  /** Bin width in seconds — one of GEAR_UNIT_OPTIONS. */
  unit: number;
  /** Usage Analytics feed page (ThreadsTimelinePage) — one card per thread. */
  fillWidthFeed: boolean;
  /** Header popover's session chart (app.tsx). */
  fillWidthPopover: boolean;
  /** Thread/agent breakdown page's session chart (AgentTimelinePage). */
  fillWidthSession: boolean;
  /** Meaningful only on a view where that view's own fillWidth field above is off — see thread-chart.tsx's ThreadRow doc. */
  hugWidth: boolean;
  /** true = the whole content area spans the full window width; false = capped at contentMaxWidthPx. */
  contentFullWidth: boolean;
  contentMaxWidthPx: number;
  heightMode: GearHeightMode;
  collapseEmpty: boolean;
  /** px, used only on a view where that view's own fillWidth field is off. */
  colWidthPx: number;
  heightScale: number;
  colGap: number;
  segGap: number;
  colRadius: number;
  segRadius: number;
  /** hex; tint of the chart frame's subtle background lift. */
  frameLiftColor: string;
}

export const DEFAULT_GEAR_SETTINGS: GearSettings = {
  unit: 60,
  fillWidthFeed: false,
  fillWidthPopover: false,
  fillWidthSession: false,
  hugWidth: true,
  contentFullWidth: true,
  contentMaxWidthPx: 1400,
  heightMode: "perCard",
  collapseEmpty: true,
  colWidthPx: 8,
  heightScale: 1,
  colGap: 1,
  segGap: 1,
  colRadius: 2,
  segRadius: 2,
  frameLiftColor: "#e3e3dd",
};

/**
 * Per-agent-key legend colour overrides layered on top of `GearSettings` —
 * every chart on this plugin (feed, header popover, session page) renders
 * with this combined shape. `agentColors` deliberately isn't part of
 * `GearSettings`/`bb.settings.define`: its keys are agent ids discovered
 * from session data, unknown ahead of time, so it stays in the kv blob (see
 * viz-settings.ts) instead of a declared settings descriptor.
 */
export interface ChartSettings extends GearSettings {
  agentColors: Record<string, string>;
}

type RawSettingsValues = Record<string, string | boolean> | undefined;

function parseNumber(raw: string | boolean | undefined, fallback: number, min: number, max: number): number {
  const n = typeof raw === "string" ? Number.parseFloat(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseBoolean(raw: string | boolean | undefined, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

function parseEnum<T extends string>(raw: string | boolean | undefined, options: readonly T[], fallback: T): T {
  return typeof raw === "string" && (options as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function parseColor(raw: string | boolean | undefined, fallback: string): string {
  return typeof raw === "string" && HEX_COLOR_RE.test(raw) ? raw : fallback;
}

/**
 * `useSettings().values` (frontend) → the typed, clamped `GearSettings`
 * every chart renders with. `values` is `undefined` while the host is still
 * loading settings, and any individual key can be missing (predates a
 * schema change), wrong-typed, or out of its declared range — all of that
 * falls back to `DEFAULT_GEAR_SETTINGS`'s own field instead of failing,
 * mirroring parseVizSettings's fallback behaviour for the kv-backed blob.
 */
export function parseGearSettings(values: RawSettingsValues): GearSettings {
  return {
    unit: parseNumber(values?.unit, DEFAULT_GEAR_SETTINGS.unit, 1, 24 * 3600),
    fillWidthFeed: parseBoolean(values?.fillWidthFeed, DEFAULT_GEAR_SETTINGS.fillWidthFeed),
    fillWidthPopover: parseBoolean(values?.fillWidthPopover, DEFAULT_GEAR_SETTINGS.fillWidthPopover),
    fillWidthSession: parseBoolean(values?.fillWidthSession, DEFAULT_GEAR_SETTINGS.fillWidthSession),
    hugWidth: parseBoolean(values?.hugWidth, DEFAULT_GEAR_SETTINGS.hugWidth),
    contentFullWidth: parseBoolean(values?.contentFullWidth, DEFAULT_GEAR_SETTINGS.contentFullWidth),
    contentMaxWidthPx: parseNumber(values?.contentMaxWidthPx, DEFAULT_GEAR_SETTINGS.contentMaxWidthPx, 600, 4000),
    heightMode: parseEnum(values?.heightMode, GEAR_HEIGHT_MODE_OPTIONS, DEFAULT_GEAR_SETTINGS.heightMode),
    collapseEmpty: parseBoolean(values?.collapseEmpty, DEFAULT_GEAR_SETTINGS.collapseEmpty),
    colWidthPx: parseNumber(values?.colWidthPx, DEFAULT_GEAR_SETTINGS.colWidthPx, 1, 40),
    heightScale: parseNumber(values?.heightScale, DEFAULT_GEAR_SETTINGS.heightScale, 0.3, 3),
    colGap: parseNumber(values?.colGap, DEFAULT_GEAR_SETTINGS.colGap, 0, 8),
    segGap: parseNumber(values?.segGap, DEFAULT_GEAR_SETTINGS.segGap, 0, 6),
    colRadius: parseNumber(values?.colRadius, DEFAULT_GEAR_SETTINGS.colRadius, 0, 8),
    segRadius: parseNumber(values?.segRadius, DEFAULT_GEAR_SETTINGS.segRadius, 0, 8),
    frameLiftColor: parseColor(values?.frameLiftColor, DEFAULT_GEAR_SETTINGS.frameLiftColor),
  };
}
