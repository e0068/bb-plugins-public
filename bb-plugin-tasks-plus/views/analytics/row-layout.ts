// Pure model of the analytics rows: which rows there are, how tall each one
// is, how its width splits between its tiles, and how a tile moves, comes and
// goes. The owner resizes by the splitters and moves a tile by its header
// (row-board.tsx); the layout is kept with the tiles in the plugin's KV
// (AnalyticsDashboard.tsx). Every change leaves each row's shares summing to
// 1 and no row empty.

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

/** Shares scaled to sum to 1, the order kept. */
const normalized = (row: Row): Row => {
  const sum = row.cells.reduce((total, cell) => total + cell.weight, 0);
  return { ...row, cells: row.cells.map((cell) => ({ ...cell, weight: sum > 0 ? cell.weight / sum : 1 / row.cells.length })) };
};

/** Rows without the cell, emptied rows dropped, the rest rescaled. */
export function removeCell(layout: RowLayout, cellId: string): RowLayout {
  return {
    rows: layout.rows
      .map((row) => (row.cells.some((cell) => cell.id === cellId) ? normalized({ ...row, cells: row.cells.filter((cell) => cell.id !== cellId) }) : row))
      .filter((row) => row.cells.length > 0),
  };
}

/** A cell set into a row at `index`, taking an equal share of it. */
const withCellAt = (row: Row, cellId: string, index: number): Row => {
  const share = 1 / (row.cells.length + 1);
  const cells = row.cells.map((cell) => ({ ...cell, weight: cell.weight * (1 - share) }));
  const at = Math.max(0, Math.min(index, cells.length));
  return normalized({ ...row, cells: [...cells.slice(0, at), { id: cellId, weight: share }, ...cells.slice(at)] });
};

/** Where a moved tile lands: a place in a row, or a row of its own under a row (null — on top). */
export type CellTarget = { kind: "row"; rowId: string; index: number } | { kind: "newRow"; afterRowId: string | null };

/** px; the height a tile's own new row opens with. */
export const NEW_ROW_HEIGHT = 260;
const NEW_ROW_MIN = 180;

const rowFor = (cellId: string, height: number): Row => ({ id: `row-${cellId}`, height, minHeight: NEW_ROW_MIN, cells: [{ id: cellId, weight: 1 }] });

/** A cell moved to `target`; a target row that is gone leaves the layout as it was. */
export function moveCell(layout: RowLayout, cellId: string, target: CellTarget): RowLayout {
  const source = layout.rows.find((row) => row.cells.some((cell) => cell.id === cellId));
  if (source === undefined) return layout;
  const rest = removeCell(layout, cellId);
  if (target.kind === "row") {
    if (!rest.rows.some((row) => row.id === target.rowId)) return layout;
    const from = source.cells.findIndex((cell) => cell.id === cellId);
    // Within its own row, a place past the cell's old one shifts down by the cell itself.
    const index = source.id === target.rowId && target.index > from ? target.index - 1 : target.index;
    return { rows: rest.rows.map((row) => (row.id === target.rowId ? withCellAt(row, cellId, index) : row)) };
  }
  const own = rowFor(cellId, source.cells.length === 1 ? source.height : NEW_ROW_HEIGHT);
  const fresh = { ...own, id: rest.rows.some((row) => row.id === own.id) ? `${own.id}-${rest.rows.length}` : own.id };
  const after = target.afterRowId === null ? -1 : rest.rows.findIndex((row) => row.id === target.afterRowId);
  if (target.afterRowId !== null && after < 0) return layout;
  return { rows: [...rest.rows.slice(0, after + 1), fresh, ...rest.rows.slice(after + 1)] };
}

/** A new cell right after `afterCellId` in its row — a duplicated tile beside its original. */
export function insertCell(layout: RowLayout, afterCellId: string, cellId: string): RowLayout {
  return {
    rows: layout.rows.map((row) => {
      const at = row.cells.findIndex((cell) => cell.id === afterCellId);
      return at < 0 ? row : withCellAt(row, cellId, at + 1);
    }),
  };
}

/** A new row at the bottom holding one cell — a tile just added. */
export function insertRow(layout: RowLayout, cellId: string, height: number = NEW_ROW_HEIGHT): RowLayout {
  return { rows: [...layout.rows, rowFor(cellId, height)] };
}

/** A row and its cells as they lie on screen, px. */
export interface RowBox {
  id: string;
  top: number;
  bottom: number;
  cells: readonly { id: string; left: number; right: number }[];
}

/**
 * Where a tile dragged to (x, y) lands: inside a row, before the first cell
 * whose middle lies right of the pointer; between rows, above the first or
 * under the last — in a row of its own there.
 */
export function dropTarget(rows: readonly RowBox[], x: number, y: number): CellTarget {
  const inside = rows.find((row) => y >= row.top && y < row.bottom);
  if (inside !== undefined) {
    return { kind: "row", rowId: inside.id, index: inside.cells.filter((cell) => (cell.left + cell.right) / 2 < x).length };
  }
  const above = rows.filter((row) => row.bottom <= y).at(-1);
  return { kind: "newRow", afterRowId: above?.id ?? null };
}

/** The layout with only the cells named in `ids`; the others go as removeCell takes them. */
export function keepCells(layout: RowLayout, ids: readonly string[]): RowLayout {
  return layout.rows
    .flatMap((row) => row.cells.map((cell) => cell.id))
    .filter((id) => !ids.includes(id))
    .reduce(removeCell, layout);
}
