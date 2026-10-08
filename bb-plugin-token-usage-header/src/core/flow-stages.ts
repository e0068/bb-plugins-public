// Flow stage markers under the token-usage chart: the schema of Flow's
// `getStageTimeline` answer (another plugin's data — parsed once, at the
// service boundary), one mark per stage pass, and the placement of each mark
// on the chart's displayed columns — the same column windows git events use.
// No I/O: the cross-plugin call lives in src/service/threads-timeline-service.ts.
import { z } from "zod";

/** A Hugeicons drawing — tag/attribute pairs, rendered by HugeiconsIcon as is. */
const glyphSchema = z.array(z.tuple([z.string(), z.record(z.string(), z.union([z.string(), z.number()]))]));

/** One stage of a thread's Flow run: its passes in order, `to: null` — the pass is still running. */
export const flowStageSchema = z.object({
  id: z.string(),
  name: z.string(),
  glyph: glyphSchema,
  passes: z.array(z.object({ from: z.string(), to: z.string().nullable() })),
});

export type FlowStage = z.infer<typeof flowStageSchema>;

/** One pass of one stage, numbered within its stage (`pass` of `of`). */
export interface FlowStageMark {
  stageId: string;
  name: string;
  glyph: FlowStage["glyph"];
  from: string;
  to: string | null;
  pass: number;
  of: number;
}

/** Every pass of every stage as its own mark, ordered by start. */
export function flowStageMarks(stages: readonly FlowStage[]): FlowStageMark[] {
  return stages
    .flatMap((stage) =>
      stage.passes.map((pass, index) => ({ stageId: stage.id, name: stage.name, glyph: stage.glyph, from: pass.from, to: pass.to, pass: index + 1, of: stage.passes.length })),
    )
    .sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
}

/** A displayed chart column: start of its window and how many unit-sized raw bins it stands for (see computeDisplayBins). */
export interface ChartColumn {
  t: string;
  gapUnits: number;
}

/** A mark placed on the chart: the columns its pass starts and ends in. */
export interface PlacedFlowMark {
  mark: FlowStageMark;
  start: number;
  end: number;
}

/**
 * One tag of the stage lane: every pass that starts in column `start`, the
 * first of them leading it with its icon, drawn up to column `end`; `reach` is
 * the furthest column its passes ran in, which may lie under the next tag.
 */
export interface FlowLaneChip {
  start: number;
  end: number;
  reach: number;
  marks: readonly [PlacedFlowMark, ...PlacedFlowMark[]];
}

/** What placement needs beyond the columns: the raw bin size in seconds, and whether the session is working right now. */
export interface FlowMarkPlacement {
  unit: number;
  live: boolean;
}

/**
 * Index of the column whose window [t, t + gapUnits*unit) holds `ms`; a moment
 * in no window — inside a dropped gap or before the first column — goes to the
 * next column on its right, a moment past every column to the last one.
 */
function columnAt(windows: ReadonlyArray<{ startMs: number; endMs: number }>, ms: number): number {
  const right = windows.findIndex((w) => ms < w.endMs);
  return right === -1 ? windows.length - 1 : right;
}

/**
 * Places every pass that overlaps the chart's time span on its columns; a pass
 * only partly inside is clamped to the edge. A pass wholly outside gets no
 * mark — a run handed over between threads shares its stages, and the other
 * thread's passes don't belong on this chart. A running pass that began after
 * the last column still shows while the session is working: its first bin
 * just hasn't been read yet.
 */
export function placeFlowMarks(columns: readonly ChartColumn[], marks: readonly FlowStageMark[], { unit, live }: FlowMarkPlacement): PlacedFlowMark[] {
  const windows = columns.map((column) => {
    const startMs = Date.parse(column.t);
    return { startMs, endMs: startMs + column.gapUnits * unit * 1000 };
  });
  if (windows.length === 0 || windows.some((w) => Number.isNaN(w.startMs))) return [];
  const chartStart = windows[0]!.startMs;
  const chartEnd = windows[windows.length - 1]!.endMs;
  return marks.flatMap((mark) => {
    const fromMs = Date.parse(mark.from);
    const toMs = mark.to === null ? Number.POSITIVE_INFINITY : Date.parse(mark.to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return [];
    const overlaps = toMs >= chartStart && (fromMs < chartEnd || (mark.to === null && live));
    if (!overlaps) return [];
    const start = columnAt(windows, fromMs);
    return [{ mark, start, end: Math.max(start, columnAt(windows, toMs)) }];
  });
}

/**
 * Groups placed passes into lane tags, one per column a pass starts in — a
 * column shows at most one icon; within a column passes keep their given
 * order. A tag is drawn to the furthest end of its passes but stops short of
 * the next tag's column, so tags never overlap.
 */
export function flowLaneChips(placed: readonly PlacedFlowMark[]): FlowLaneChip[] {
  const groups = [...placed].sort((a, b) => a.start - b.start).reduce<Array<[PlacedFlowMark, ...PlacedFlowMark[]]>>((acc, p) => {
    const last = acc[acc.length - 1];
    return last !== undefined && last[0].start === p.start ? [...acc.slice(0, -1), [...last, p]] : [...acc, [p]];
  }, []);
  return groups.map((marks, i) => {
    const start = marks[0].start;
    const reach = Math.max(...marks.map((p) => p.end));
    const next = groups[i + 1];
    return { start, end: next === undefined ? reach : Math.min(reach, next[0].start - 1), reach, marks };
  });
}
