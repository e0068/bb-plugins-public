// Persisted state for the two nav-panel pages (pages/ThreadsTimelinePage.tsx,
// pages/AgentTimelinePage.tsx) that ISN'T declared via `bb.settings.define` —
// pure schema + parsing only, no I/O, no bb SDK dependency (see
// src/core/index.ts's barrel doc comment): the RPC layer in server.ts owns
// reading/writing `bb.storage.kv`, this module only owns the shape and how
// to make a raw blob safe to use.
//
// See memory/decisions/token-usage-viz-settings-persist-kv.md for the
// original kv-vs-settings.define call, and
// memory/decisions/token-usage-gear-to-native-settings.md for why the
// former gear popover's 14 geometry/behaviour fields later moved OUT of
// this blob into src/core/gear-settings.ts's `bb.settings.define`
// descriptors, leaving only what genuinely can't be declared ahead of time
// (agentColors — keys are agent ids discovered from session data) plus the
// toolbar's own transient-but-persisted query state.
import { z } from "zod";

/** kv key both RPC methods read/write under — one place so the two call sites in server.ts can't drift on the string. */
export const VIZ_SETTINGS_KV_KEY = "viz-settings";

/** 3- or 6-digit hex, with leading `#` — the only shape `<input type="color">` in ThreadsTimelinePage.tsx's agent-colour picker ever produces/consumes. */
const hexColorSchema = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "expected a hex color like #3b82f6");

export const THREADS_SORT_MODES = ["recent", "tokens", "duration"] as const;
export type ThreadsSortMode = (typeof THREADS_SORT_MODES)[number];

/**
 * Mirrors ThreadsTimelinePage.tsx's own remaining `useState` calls:
 * agentColors (per-agent legend colour picker, dynamic keys — see this
 * module's doc comment for why it can't be a declared setting), sortMode,
 * and the filter state — searchQuery, projectFilter, costMin, costMax. The
 * filters used to be deliberately transient; they're now persisted at the
 * owner's request so a chosen slice survives a reload (reverses the earlier
 * "transient query state" carve-out in the decision doc). Each field
 * carries its own `.default`, so a blob saved before it existed still
 * merges cleanly.
 */
const threadsVizSettingsSchema = z
  .object({
    /** Per-agent-key legend colour overrides; keys not present fall back to the row's own default palette cycling. */
    agentColors: z.record(z.string(), hexColorSchema).default({}),
    sortMode: z.enum(THREADS_SORT_MODES).default("recent"),
    /** Free-text search over thread title / session id / BB thread title. */
    searchQuery: z.string().default(""),
    /** Selected project keys; `null` is the "Threads" bucket (sessions with no BB thread). Empty = all projects. */
    projectFilter: z.array(z.string().nullable()).default([]),
    /** Cost bounds in USD as raw input strings — "" means unbounded on that end. */
    costMin: z.string().default(""),
    costMax: z.string().default(""),
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
