// Persisted visualization settings for the two nav-panel pages
// (pages/ThreadsTimelinePage.tsx, pages/AgentTimelinePage.tsx). Pure schema +
// parsing only — no I/O, no bb SDK dependency (see src/core/index.ts's barrel
// doc comment): the RPC layer in server.ts owns reading/writing
// `bb.storage.kv`, this module only owns the shape and how to make a raw blob
// safe to use.
//
// See memory/decisions/token-usage-viz-settings-persist-kv.md for why this is
// a kv-backed blob rather than `bb.settings.define` or localStorage: it's a
// free-form live state object (agent colour map, geometry numbers), not a
// small set of declared user settings.
import { z } from "zod";

/** kv key both RPC methods read/write under — one place so the two call sites in server.ts can't drift on the string. */
export const VIZ_SETTINGS_KV_KEY = "viz-settings";

/**
 * `pages/ThreadsTimelinePage.tsx`'s frame-lift default reads the theme's
 * live `--foreground` CSS variable, falling back to this exact value when
 * unresolvable (jsdom, no stylesheet yet). This module has no DOM access —
 * it mirrors that same fallback hex as its own default, so a first-ever
 * `loadVizSettings` (empty kv) hands the page the identical colour it would
 * have picked itself.
 */
const DEFAULT_FRAME_LIFT_COLOR = "#e3e3dd";

/** 3- or 6-digit hex, with leading `#` — the only shape `<input type="color">` and `hexToRgba` in ThreadsTimelinePage.tsx ever produce/consume. */
const hexColorSchema = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "expected a hex color like #3b82f6");

export const THREADS_SORT_MODES = ["recent", "tokens", "duration"] as const;
export type ThreadsSortMode = (typeof THREADS_SORT_MODES)[number];

/**
 * Mirrors ThreadsTimelinePage.tsx's own `useState` calls one-for-one:
 * unit, fillWidth, collapseEmpty, colWidthPx, heightScale (row 1 controls),
 * colGap/segGap/colRadius/segRadius/frameLiftColor (geometry popover),
 * agentColors (per-agent legend colour picker), sortMode. Search/project-filter
 * state is deliberately absent — see the decision doc: transient query state,
 * not a visual preference.
 */
const threadsVizSettingsSchema = z
  .object({
    /** Bin width in seconds — mirrors the UNIT_OPTIONS group (30/60/300/900/3600). */
    unit: z.number().int().positive().default(60),
    fillWidth: z.boolean().default(true),
    /** true = consecutive empty bins collapse into one displayed gap column carrying their summed duration; false = one column per bin (including empty ones), as before. */
    collapseEmpty: z.boolean().default(false),
    /** px width of a single column (bin), used only when fillWidth is off — not px per second of duration. */
    colWidthPx: z.number().int().min(1).max(40).default(6),
    heightScale: z.number().min(0.3).max(3).default(1),
    /** px, gap between bin columns. */
    colGap: z.number().min(0).max(8).default(1),
    /** px, gap between an agent's stacked segments inside one bin. */
    segGap: z.number().min(0).max(6).default(0),
    /** px, corner radius of a bin's segment stack as a whole. */
    colRadius: z.number().min(0).max(8).default(0),
    /** px, corner radius of each individual agent segment. */
    segRadius: z.number().min(0).max(8).default(0),
    /** hex; tint of the chart frame's subtle background lift. */
    frameLiftColor: hexColorSchema.default(DEFAULT_FRAME_LIFT_COLOR),
    /** Per-agent-key legend colour overrides; keys not present fall back to the row's own default palette cycling. */
    agentColors: z.record(z.string(), hexColorSchema).default({}),
    sortMode: z.enum(THREADS_SORT_MODES).default("recent"),
  })
  .strict();

/**
 * Mirrors AgentTimelinePage.tsx's three persistable display toggles
 * (showHooks, relativeTime, groupedByTurn). `expanded`/`collapsedTurns` are
 * deliberately absent — per-timeline UI state, reset on every agent switch
 * already, not a standing preference.
 */
const agentDetailVizSettingsSchema = z
  .object({
    showHooks: z.boolean().default(true),
    /** false = absolute clock time, true = relative to the timeline's first event. */
    relativeTime: z.boolean().default(false),
    groupedByTurn: z.boolean().default(false),
  })
  .strict();

// zod's `.default(value)` substitutes `value` as-is when the key is missing
// entirely — it does NOT re-run that value through the inner schema. So a
// literal `.default({})` here would leave `threads`/`agentDetail` as bare
// `{}` whenever the *whole section* is absent (as opposed to present-but-
// partial, where the section object // does get parsed and its own
// per-field `.default()`s apply normally). Precomputing each section's own
// fully-resolved defaults and handing *those* to `.default()` sidesteps
// that gap, so a blob missing an entire section merges exactly like one
// missing just a few fields inside it.
const threadsDefaults = threadsVizSettingsSchema.parse({});
const agentDetailDefaults = agentDetailVizSettingsSchema.parse({});

export const vizSettingsSchema = z
  .object({
    threads: threadsVizSettingsSchema.default(threadsDefaults),
    agentDetail: agentDetailVizSettingsSchema.default(agentDetailDefaults),
  })
  .strict();

export type ThreadsVizSettings = z.infer<typeof threadsVizSettingsSchema>;
export type AgentDetailVizSettings = z.infer<typeof agentDetailVizSettingsSchema>;
export type VizSettings = z.infer<typeof vizSettingsSchema>;

/**
 * Reference defaults — e.g. for callers wanting a plain object without going
 * through `parseVizSettings`. `parseVizSettings` itself never returns this
 * shared instance (see its own comment below): each call gets a fresh
 * object, so nothing downstream can mutate a shared default by accident.
 */
export const DEFAULT_VIZ_SETTINGS: VizSettings = vizSettingsSchema.parse({});

/**
 * Turns a raw kv blob into a always-valid `VizSettings`. Used on the load
 * path (server.ts's `loadVizSettings`), where the blob may be `undefined`
 * (never saved yet), a stale shape from a previous version, or outright
 * corrupt — none of that is allowed to fail the page, only to fall back to
 * defaults. A partially-valid object (known keys, some fields missing) is
 * *not* garbage: zod's per-field `.default()` fills the gaps, so a blob
 * saved before a new field existed still merges cleanly into a full
 * `VizSettings` instead of being discarded wholesale.
 *
 * Returns a fresh object on every call (via `.safeParse`, not the shared
 * `DEFAULT_VIZ_SETTINGS`) so callers can freely treat the result as
 * theirs to hold onto.
 */
export function parseVizSettings(raw: unknown): VizSettings {
  const result = vizSettingsSchema.safeParse(raw);
  if (result.success) return result.data;
  return vizSettingsSchema.parse({});
}
