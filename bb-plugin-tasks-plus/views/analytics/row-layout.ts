// Pure model of the analytics rows: which rows there are, how tall each one
// is and how its width splits between its sections. The order and the set of
// sections are fixed by the screen's defaults; the owner changes sizes only,
// by the splitters between sections and under rows (row-board.tsx). Only the
// sizes are remembered — a saved layout never adds, drops or reorders.
import { z } from "zod";

/** The narrowest share a section keeps when a splitter squeezes it. */
export const MIN_SHARE = 0.15;

export interface RowCell {
  id: string;
  /** Share of the row's width; a row's weights sum to 1. */
  weight: number;
}

export interface Row {
  id: string;
  /** px. The last row takes at least this and grows to the bottom of the screen. */
  height: number;
  minHeight: number;
  cells: readonly RowCell[];
}

export interface RowLayout {
  rows: readonly Row[];
}

const savedSchema = z.object({
  version: z.literal(2),
  rows: z.array(
    z.object({
      id: z.string(),
      height: z.number().finite(),
      cells: z.array(z.object({ id: z.string(), weight: z.number().finite().positive() })),
    }),
  ),
});

/** Sizes read back from storage; unreadable storage reads as nothing saved. */
export type SavedLayout = z.infer<typeof savedSchema> | null;

const withRow = (layout: RowLayout, rowId: string, change: (row: Row) => Row): RowLayout =>
  layout.rows.some((row) => row.id === rowId)
    ? { rows: layout.rows.map((row) => (row.id === rowId ? change(row) : row)) }
    : layout;

/**
 * Moves `delta` of the row's width across splitter `index` — the one between
 * cells `index − 1` and `index`: positive widens the left one. Neither
 * neighbour drops below {@link MIN_SHARE} of the row; the other cells keep
 * theirs. A splitter the row does not have changes nothing.
 */
export function resizeCells(layout: RowLayout, rowId: string, index: number, delta: number): RowLayout {
  const row = layout.rows.find((candidate) => candidate.id === rowId);
  if (row === undefined || index < 1 || index >= row.cells.length) return layout;
  const left = row.cells[index - 1]!.weight;
  const right = row.cells[index]!.weight;
  const moved = Math.min(right - MIN_SHARE, Math.max(MIN_SHARE - left, delta));
  return withRow(layout, rowId, (target) => ({
    ...target,
    cells: target.cells.map((cell, i) =>
      i === index - 1 ? { ...cell, weight: left + moved } : i === index ? { ...cell, weight: right - moved } : cell,
    ),
  }));
}

/** Sets the row's height in whole pixels, never below its minimum. */
export function resizeRow(layout: RowLayout, rowId: string, height: number): RowLayout {
  return withRow(layout, rowId, (row) => ({ ...row, height: Math.max(row.minHeight, Math.round(height)) }));
}

export function serializeLayout(layout: RowLayout): string {
  return JSON.stringify({
    version: 2,
    rows: layout.rows.map((row) => ({ id: row.id, height: row.height, cells: row.cells.map(({ id, weight }) => ({ id, weight })) })),
  });
}

/** Reads stored sizes; anything unreadable — no value, bad JSON, an older layout — is nothing saved. */
export function parseSaved(text: string | null): SavedLayout {
  if (text === null) return null;
  try {
    const parsed = savedSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const sameCells = (a: readonly { id: string }[], b: readonly { id: string }[]) =>
  a.length === b.length && a.every((cell, index) => cell.id === b[index]!.id);

/**
 * The default layout with the saved sizes laid over it: a saved row's height
 * (lifted to the row's minimum) and — while the row still holds the same
 * sections in the same order — its widths, rescaled to sum to 1. Rows the
 * defaults no longer have are dropped.
 */
export function mergeSaved(defaults: RowLayout, saved: SavedLayout): RowLayout {
  if (saved === null) return defaults;
  const byId = new Map(saved.rows.map((row) => [row.id, row]));
  return {
    rows: defaults.rows.map((row) => {
      const stored = byId.get(row.id);
      if (stored === undefined) return row;
      const sum = stored.cells.reduce((acc, cell) => acc + cell.weight, 0);
      return {
        ...row,
        height: Math.max(row.minHeight, Math.round(stored.height)),
        cells: sameCells(row.cells, stored.cells) ? stored.cells.map((cell) => ({ id: cell.id, weight: cell.weight / sum })) : row.cells,
      };
    }),
  };
}
