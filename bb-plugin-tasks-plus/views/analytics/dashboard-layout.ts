// The pure model behind the customisable dashboard shell (BBPL-257): what a
// saved layout IS, its zod schema, and the total operations that add, remove,
// move and (de)serialise sections. No React, no react-grid-layout — the shell
// component (react/dashboard-grid.tsx) renders this; the model is what gets
// persisted and what the tests pin down.
import { z } from "zod";

/** A section's placement on the grid — the four numbers react-grid-layout tracks. */
export const gridRectSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  })
  .strict();
export type GridRect = z.infer<typeof gridRectSchema>;

/**
 * One section of the dashboard: a stable id, its grid rect, the widget `kind`
 * the consumer maps to a component, and a flat bag of primitive `settings` the
 * widget reads (which metric, which window, a colour). The model stays
 * domain-neutral: it never interprets `kind` or `settings`, only carries them.
 */
export const sectionSchema = gridRectSchema
  .extend({
    id: z.string().min(1),
    kind: z.string().min(1),
    settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  })
  .strict();
export type DashboardSection = z.infer<typeof sectionSchema>;

/** A whole saved dashboard: a schema version and its sections. */
export const dashboardSchema = z
  .object({
    version: z.literal(1),
    sections: z.array(sectionSchema),
  })
  .strict();
export type DashboardConfig = z.infer<typeof dashboardSchema>;

/** A total outcome for parsing — no exception crosses the boundary. */
export type ParseResult = { ok: true; config: DashboardConfig } | { ok: false; error: string };

/** A total outcome for serialising — symmetric with {@link ParseResult}. */
export type SerializeResult = { ok: true; json: string } | { ok: false; error: string };

/** An empty dashboard — the starting point before any section is added. */
export function emptyDashboard(): DashboardConfig {
  return { version: 1, sections: [] };
}

/**
 * Adds `section`, but only if its id is new — adding is idempotent, so a
 * double-fire of an "add" handler can't plant two sections with the same id
 * (which would make removal ambiguous). An existing id leaves the config
 * unchanged.
 */
export function addSection(config: DashboardConfig, section: DashboardSection): DashboardConfig {
  if (config.sections.some((s) => s.id === section.id)) return config;
  return { ...config, sections: [...config.sections, section] };
}

/** Removes the section with `id`; an id that isn't present leaves the config unchanged. */
export function removeSection(config: DashboardConfig, id: string): DashboardConfig {
  return { ...config, sections: config.sections.filter((s) => s.id !== id) };
}

/**
 * Replaces the grid rect of the section with `id`, leaving its kind and
 * settings untouched; an absent id is a no-op. This is how a react-grid-layout
 * drag/resize of a single section folds back into the model.
 */
export function updateSectionRect(config: DashboardConfig, id: string, rect: GridRect): DashboardConfig {
  return {
    ...config,
    sections: config.sections.map((s) => (s.id === id ? { ...s, ...rect } : s)),
  };
}

/** A layout item as react-grid-layout emits it on change: the section id in `i`, plus its rect. */
export interface GridLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Folds a whole react-grid-layout `onLayoutChange` array back into the model:
 * every section named by an item takes that item's rect; sections no item
 * mentions keep their current rect; items naming an unknown id are ignored.
 * Only positions move — kind and settings are preserved.
 */
export function applyGridLayout(config: DashboardConfig, items: readonly GridLayoutItem[]): DashboardConfig {
  const byId = new Map(items.map((item) => [item.i, item]));
  return {
    ...config,
    sections: config.sections.map((s) => {
      const item = byId.get(s.id);
      return item ? { ...s, x: item.x, y: item.y, w: item.w, h: item.h } : s;
    }),
  };
}

/**
 * Serialises a dashboard to JSON, total and symmetric with {@link
 * parseDashboard}: the config is validated first (its inferred type can't carry
 * zod's `.positive()`/`.min(1)` invariants, so a caller could hand in a
 * `w: 0`), and a violation returns `{ ok: false, error }` rather than throwing.
 * Nothing malformed reaches storage, and nothing malformed is silently written
 * either — the write boundary fails closed.
 */
export function serializeDashboard(config: DashboardConfig): SerializeResult {
  const parsed = dashboardSchema.safeParse(config);
  return parsed.success ? { ok: true, json: JSON.stringify(parsed.data) } : { ok: false, error: parsed.error.message };
}

/**
 * Parses JSON text back into a dashboard, total on every input: malformed JSON
 * or a schema violation returns `{ ok: false, error }` rather than throwing, so
 * a corrupted saved layout degrades to a handled error instead of crashing the
 * screen.
 */
export function parseDashboard(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "invalid JSON" };
  }
  const parsed = dashboardSchema.safeParse(raw);
  return parsed.success ? { ok: true, config: parsed.data } : { ok: false, error: parsed.error.message };
}
