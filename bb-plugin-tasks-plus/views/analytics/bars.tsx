// Column charts of the analytics screen, drawn with divs the way Usage
// Analytics draws its token bars (thread-chart.tsx, hourly-burn-chart.tsx):
// 2px-rounded columns 2px apart, stacked segments 1px
// apart, an empty column as a floor line, what a click would pick lit and the
// rest dimmed while hovered, and a popover by the pointer naming every series
// in it. Heights are
// percentages, so a chart follows its section's size without measuring. A
// column that opens a week carries a line, when the section says where weeks
// start (WeekBreaksScope); dates are written only under the chart. The frame
// (PlotFrame) keeps a column for the Y labels left of the plot box and the X
// labels under it; the grid comes from the caller, laid under the columns.
import { createContext, useContext, useState, type CSSProperties, type ReactNode } from "react";
import { useViewportClamp } from "@bb-plugins/viewport-clamp";

import { cn } from "../../lib/utils";
import { lookOf, type PickTarget } from "./segment-pick";

export interface BarSeries {
  id: string;
  label: string;
  color: string;
}

/** The picked segment, or — series null — the whole picked column. */
export type BarSelection = PickTarget;

interface Hover {
  column: number;
  /** The segment under the pointer; null over the column's empty part. */
  seriesId: string | null;
  x: number;
  y: number;
}

/** A legend or tooltip swatch. */
export function Swatch({ color }: { color: string }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />;
}

export interface TipRow {
  color: string;
  label: string;
  value: ReactNode;
}

/** The popover by the pointer, kept inside the window: a heading, then a row per series. */
function Tip({ hover, heading, rows }: { hover: Hover; heading: string; rows: readonly TipRow[] }) {
  const { ref, position } = useViewportClamp<HTMLDivElement>({ x: hover.x + 14, y: hover.y + 16 });
  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-50 w-max max-w-[min(90vw,20rem)] rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
      style={{ left: position.x, top: position.y }}
    >
      <div className="font-medium tabular-nums">{heading}</div>
      {rows.length === 0 ? (
        <div className="mt-1 text-subtle-foreground">Nothing</div>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center gap-3">
              <Swatch color={row.color} />
              <span className="whitespace-nowrap">{row.label}</span>
              <span className="ml-auto pl-3 tabular-nums text-muted-foreground">{row.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Ticks({ ticks }: { ticks: readonly string[] }) {
  if (ticks.length === 0) return null;
  return (
    <div className="flex justify-between text-2xs tabular-nums text-subtle-foreground">
      {ticks.map((tick, index) => (
        <span key={`${index}-${tick}`}>{tick}</span>
      ))}
    </div>
  );
}

/** A column that opens a week. */
export interface ColumnWeekBreak {
  column: number;
}

const WeekBreaksContext = createContext<readonly ColumnWeekBreak[]>([]);

/** Where the charts inside mark a new week — a section's columns are its own, so the section sets them. */
export function WeekBreaksScope({ breaks, children }: { breaks: readonly ColumnWeekBreak[]; children: ReactNode }) {
  return <WeekBreaksContext.Provider value={breaks}>{children}</WeekBreaksContext.Provider>;
}

/** The columns that open a week. */
function useWeekColumns(): ReadonlySet<number> {
  return new Set(useContext(WeekBreaksContext).map((entry) => entry.column));
}

/** A line down the left edge of a column that opens a week. Dates stay under the chart; none is written over it. */
function WeekMark({ opens }: { opens: boolean }) {
  return opens ? <span data-week-break aria-hidden className="pointer-events-none absolute inset-y-0 -left-px w-px bg-border" /> : null;
}

/** Hover state shared by both charts: which column — and segment of it — the pointer is over, and where. */
function useHover() {
  const [hover, setHover] = useState<Hover | null>(null);
  const bind = (column: number) => ({
    onMouseMove: (event: React.MouseEvent) => {
      const segment = event.target instanceof Element ? event.target.closest("[data-series]") : null;
      setHover({ column, seriesId: segment?.getAttribute("data-series") ?? null, x: event.clientX, y: event.clientY });
    },
    onMouseLeave: () => setHover(null),
  });
  return { hover, bind };
}

/**
 * What a column does when its segments can be picked: a click on its empty
 * part picks the whole column — a segment's own click picks the segment.
 */
function columnPick(column: number, onSelectColumn: ((column: number) => void) | undefined) {
  if (onSelectColumn === undefined) return {};
  return {
    "data-pickable": true,
    onClick: (event: React.MouseEvent) => {
      if (!(event.target instanceof Element && event.target.closest("[data-series]") !== null)) onSelectColumn(column);
    },
  };
}

/** Up to this many columns stand wider apart, so a week of seven reads as seven days, not a wall. */
const FEW_COLUMNS = 12;

const COLUMN_CLASS = "relative h-full min-w-0 flex-1 rounded-sm transition-colors";

export interface StackedBarsProps {
  /** Per column, a value per series in `series` order. */
  columns: readonly (readonly number[])[];
  series: readonly BarSeries[];
  /** Heading of a column's tooltip. */
  columnLabel: (column: number) => string;
  /** Labels spread under the chart, first to last. */
  ticks: readonly string[];
  selected?: BarSelection | null;
  onSelect?: (column: number, seriesId: string) => void;
  /** A click on a column's empty part: the whole column is picked. */
  onSelectColumn?: (column: number) => void;
  /** Drawn under the columns, filling the chart box — the grid. */
  underlay?: ReactNode;
  /** Drawn over the columns, filling the chart box — a trend line. */
  overlay?: ReactNode;
  /** The Y labels' gutter to the left of the chart box: it moves the columns aside, as the labels under them do. */
  axis?: ReactNode;
  /** px; a fixed chart width. Omitted, the chart fills its section. */
  width?: number;
}

/**
 * A plot box with its Y labels to the left and its X labels under it: the
 * labels take their own room and the box keeps what is left.
 */
export function PlotFrame({ axis, ticks, plot, style }: { axis: ReactNode | undefined; ticks: readonly string[]; plot: ReactNode; style?: CSSProperties }) {
  const plotColumn = axis === undefined ? 1 : 2;
  return (
    <div
      className="grid min-h-0 flex-1 gap-x-1.5 gap-y-1"
      style={{ ...style, gridTemplateColumns: axis === undefined ? "minmax(0, 1fr)" : "auto minmax(0, 1fr)", gridTemplateRows: "minmax(6rem, 1fr) auto" }}
    >
      {axis === undefined ? null : <div style={{ gridColumn: 1, gridRow: 1 }}>{axis}</div>}
      <div className="flex min-h-0 min-w-0 flex-col" style={{ gridColumn: plotColumn, gridRow: 1 }}>
        {plot}
      </div>
      <div className="min-w-0" style={{ gridColumn: plotColumn, gridRow: 2 }}>
        <Ticks ticks={ticks} />
      </div>
    </div>
  );
}

export function StackedBars({ columns, series, columnLabel, ticks, selected = null, onSelect, onSelectColumn, underlay, overlay, axis, width }: StackedBarsProps) {
  const { hover, bind } = useHover();
  const weekColumns = useWeekColumns();
  const totals = columns.map((values) => values.reduce((sum, value) => sum + value, 0));
  const max = Math.max(1, ...totals);
  const hovered = hover === null ? undefined : columns[hover.column];
  // The hover shows what a click would pick — only where a click picks: a pickable chart, a column with something in it.
  const aim = onSelect === undefined || hover === null || totals[hover.column] === 0 ? null : hover;

  const plot = (
    <div data-plot className={cn("relative flex min-h-24 flex-1 items-end", columns.length > FEW_COLUMNS ? "gap-0.5" : "gap-1.5")}>
      {underlay}
      {columns.map((values, column) => (
        <div
          key={column}
          data-column={column}
          className={COLUMN_CLASS}
          {...bind(column)}
          {...columnPick(column, totals[column] === 0 ? undefined : onSelectColumn)}
        >
          <WeekMark opens={weekColumns.has(column)} />
          {totals[column] === 0 ? (
            <div data-empty className="absolute bottom-0 h-0.5 w-full rounded-sm bg-muted/50" />
          ) : (
            <div
              data-stack
              className="absolute bottom-0 flex w-full flex-col-reverse gap-px overflow-hidden rounded-sm"
              style={{ height: `${(totals[column]! / max) * 100}%` }}
            >
              {series.map((entry, index) => {
                const value = values[index] ?? 0;
                if (value <= 0) return null;
                const dimmed = lookOf(aim, selected, column, entry.id) === "dim";
                const mark = {
                  "data-segment": `${column}:${entry.id}`,
                  "data-series": entry.id,
                  "data-dimmed": String(dimmed),
                  style: { flexGrow: value, flexBasis: 0, minHeight: 1, backgroundColor: entry.color },
                };
                const look = cn("block w-full rounded-sm", dimmed && "opacity-30");
                // Only a segment that can be picked is a button; the rest are marks the tooltip reads out.
                return onSelect === undefined ? (
                  <span key={entry.id} {...mark} className={look} />
                ) : (
                  <button
                    key={entry.id}
                    type="button"
                    {...mark}
                    data-pickable
                    aria-label={`${columnLabel(column)} · ${entry.label}: ${value}`}
                    className={cn(look, "transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring")}
                    onClick={() => onSelect(column, entry.id)}
                  />
                );
              })}
            </div>
          )}
        </div>
      ))}
      {overlay}
    </div>
  );
  return (
    <>
      <PlotFrame
        axis={axis}
        ticks={ticks}
        style={width === undefined ? undefined : { width }}
        plot={plot}
      />
      {hover !== null && hovered !== undefined ? (
        <Tip
          hover={hover}
          heading={columnLabel(hover.column)}
          rows={series.flatMap((entry, index) =>
            (hovered[index] ?? 0) > 0 ? [{ color: entry.color, label: entry.label, value: hovered[index] }] : [],
          )}
        />
      ) : null}
    </>
  );
}

export interface DivergingSide {
  /** What a pick names the side by; its label when absent. */
  id?: string;
  label: string;
  color: string;
  values: readonly number[];
}

export interface DivergingBarsProps {
  up: DivergingSide;
  down: DivergingSide;
  columnLabel: (column: number) => string;
  ticks: readonly string[];
  /** The value at the top and at the bottom; the larger of the two sides when absent. Pass the scale a grid laid under it uses. */
  max?: number;
  selected?: BarSelection | null;
  onSelect?: (column: number, seriesId: string) => void;
  /** A click beside a column's halves: the whole column is picked. */
  onSelectColumn?: (column: number) => void;
  /** Drawn under the columns, filling the chart box — the grid. */
  underlay?: ReactNode;
  /** Drawn over the columns, filling the chart box. */
  overlay?: ReactNode;
  /** The Y labels' gutter to the left of the chart box. */
  axis?: ReactNode;
}

/** Two series from one axis: `up` grows upward, `down` downward, both on one scale. */
export function DivergingBars({ up, down, columnLabel, ticks, max = Math.max(1, ...up.values, ...down.values), selected = null, onSelect, onSelectColumn, underlay, overlay, axis }: DivergingBarsProps) {
  const { hover, bind } = useHover();
  const weekColumns = useWeekColumns();
  const columnTotal = (column: number) => (up.values[column] ?? 0) + (down.values[column] ?? 0);
  const aim = onSelect === undefined || hover === null || columnTotal(hover.column) === 0 ? null : hover;
  const half = (side: "up" | "down", entry: DivergingSide, column: number) => {
    const value = entry.values[column] ?? 0;
    const id = entry.id ?? entry.label;
    const dimmed = lookOf(aim, selected, column, id) === "dim";
    const mark = {
      "data-side": side,
      "data-segment": `${column}:${id}`,
      "data-series": id,
      "data-dimmed": String(dimmed),
      style: { height: `${(value / max) * 100}%`, backgroundColor: entry.color },
    };
    const look = cn("block w-full rounded-sm", dimmed && "opacity-30");
    return (
      <div className={cn("relative flex-1", side === "up" ? "flex items-end" : "flex items-start")}>
        {value <= 0 ? null : onSelect === undefined ? (
          <div {...mark} className={look} />
        ) : (
          <button
            type="button"
            {...mark}
            data-pickable
            aria-label={`${columnLabel(column)} · ${entry.label}: ${value}`}
            className={cn(look, "transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring")}
            onClick={() => onSelect(column, id)}
          />
        )}
      </div>
    );
  };

  const plot = (
    <div data-plot className={cn("relative flex min-h-24 flex-1", up.values.length > FEW_COLUMNS ? "gap-0.5" : "gap-1.5")}>
      {underlay}
      {up.values.map((_, column) => (
        <div
          key={column}
          data-column={column}
          className={cn(COLUMN_CLASS, "flex flex-col")}
          {...bind(column)}
          {...columnPick(column, columnTotal(column) === 0 ? undefined : onSelectColumn)}
        >
          <WeekMark opens={weekColumns.has(column)} />
          {half("up", up, column)}
          <div className="h-px w-full bg-border" />
          {half("down", down, column)}
        </div>
      ))}
      {overlay}
    </div>
  );
  return (
    <>
      <PlotFrame
        axis={axis}
        ticks={ticks}
        plot={plot}
      />
      {hover !== null ? (
        <Tip
          hover={hover}
          heading={columnLabel(hover.column)}
          rows={[up, down].map((entry) => ({ color: entry.color, label: entry.label, value: entry.values[hover.column] ?? 0 }))}
        />
      ) : null}
    </>
  );
}

export function Legend({ items }: { items: readonly { color: string; label: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <Swatch color={item.color} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** One quiet line in place of a chart that has nothing to draw. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="flex flex-1 items-center justify-center py-6 text-center text-xs text-subtle-foreground">{children}</p>;
}

/** First, middle and last of `count` column labels — what the charts print under themselves. */
export function edgeTicks(count: number, label: (column: number) => string): string[] {
  return count === 0 ? [] : [...new Set([0, Math.floor((count - 1) / 2), count - 1])].map(label);
}
