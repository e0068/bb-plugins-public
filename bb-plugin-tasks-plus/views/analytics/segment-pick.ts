// What a pick on a tile's chart covers and how its segments look: a pure
// rule shared by the columns, the diverging columns and the bars. A target
// names one segment of a column, or — series null — the whole column; the
// hover shows what a click would pick, over whatever is picked now.

/** A segment of a column, or the whole column when `seriesId` is null. */
export interface PickTarget {
  column: number;
  seriesId: string | null;
}

/** Whether a target takes in the segment of `seriesId` in `column`. */
export const covers = (target: PickTarget, column: number, seriesId: string): boolean =>
  target.column === column && (target.seriesId === null || target.seriesId === seriesId);

/** A segment lit, or dimmed because the hovered — else the picked — target leaves it out. */
export function lookOf(hover: PickTarget | null, selected: PickTarget | null, column: number, seriesId: string): "lit" | "dim" {
  const target = hover ?? selected;
  return target === null || covers(target, column, seriesId) ? "lit" : "dim";
}

/** The pick after a click: what was clicked, or nothing when it was picked already. */
export const togglePick = (current: PickTarget | null, clicked: PickTarget): PickTarget | null =>
  current !== null && current.column === clicked.column && current.seriesId === clicked.seriesId ? null : clicked;
