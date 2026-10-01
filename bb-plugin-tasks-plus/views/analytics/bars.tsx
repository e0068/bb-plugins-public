// Column charts of the analytics screen, drawn with divs the way Usage
// Analytics draws its token bars (thread-chart.tsx, hourly-burn-chart.tsx):
// no axes and no grid, 2px-rounded columns 2px apart, stacked segments 1px
// apart, an empty column as a floor line, the hovered column highlighted and
// a popover by the pointer naming every series in it. Heights are
// percentages, so a chart follows its section's size without measuring. A
// column that opens a week carries a line and the week's label, when the
// section says where weeks start (WeekBreaksScope).
import { createContext, useContext, useState, type ReactNode } from "react";
import { useViewportClamp } from "@bb-plugins/viewport-clamp";

import { cn } from "../../lib/utils";

export interface BarSeries {
  id: string;
  label: string;
  color: string;
}

export interface BarSelection {
  column: number;
  seriesId: string;
}

interface Hover {
  column: number;
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

/** A column that opens a week, and the label the week goes by. */
export interface ColumnWeekBreak {
  column: number;
  label: string;
}

const WeekBreaksContext = createContext<readonly ColumnWeekBreak[]>([]);

/** Where the charts inside mark a new week — a section's columns are its own, so the section sets them. */
export function WeekBreaksScope({ breaks, children }: { breaks: readonly ColumnWeekBreak[]; children: ReactNode }) {
  return <WeekBreaksContext.Provider value={breaks}>{children}</WeekBreaksContext.Provider>;
}

/** The label of the week a column opens, per column. */
function useWeekLabels(): ReadonlyMap<number, string> {
  const breaks = useContext(WeekBreaksContext);
  return new Map(breaks.map((entry) => [entry.column, entry.label]));
}

/** A line down the left edge of a column that opens a week, the week's label at its top. */
function WeekMark({ label }: { label: string | undefined }) {
  if (label === undefined) return null;
  return (
    <span data-week-break aria-hidden className="pointer-events-none absolute inset-y-0 -left-px w-px bg-border">
      <span className="absolute left-1 top-0 whitespace-nowrap text-2xs leading-none text-subtle-foreground">{label}</span>
    </span>
  );
}

/** Hover state shared by both charts: which column the pointer is over, and where. */
function useHover() {
  const [hover, setHover] = useState<Hover | null>(null);
  const bind = (column: number) => ({
    onMouseMove: (event: React.MouseEvent) => setHover({ column, x: event.clientX, y: event.clientY }),
    onMouseLeave: () => setHover(null),
  });
  return { hover, bind };
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
  /** Drawn over the columns, filling the chart box — a trend line. */
  overlay?: ReactNode;
  /** px; a fixed chart width. Omitted, the chart fills its section. */
  width?: number;
}

export function StackedBars({ columns, series, columnLabel, ticks, selected = null, onSelect, overlay, width }: StackedBarsProps) {
  const { hover, bind } = useHover();
  const weekLabels = useWeekLabels();
  const totals = columns.map((values) => values.reduce((sum, value) => sum + value, 0));
  const max = Math.max(1, ...totals);
  const hovered = hover === null ? undefined : columns[hover.column];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1" style={width === undefined ? undefined : { width }}>
      <div className={cn("relative flex min-h-24 flex-1 items-end", columns.length > FEW_COLUMNS ? "gap-0.5" : "gap-1.5")}>
        {columns.map((values, column) => (
          <div
            key={column}
            data-column={column}
            className={cn(COLUMN_CLASS, hover?.column === column && "bg-state-hover")}
            {...bind(column)}
          >
            <WeekMark label={weekLabels.get(column)} />
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
                  const isSelected = selected?.column === column && selected.seriesId === entry.id;
                  const dimmed = selected !== null && !isSelected;
                  const mark = {
                    "data-segment": `${column}:${entry.id}`,
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
                      aria-label={`${columnLabel(column)} · ${entry.label}: ${value}`}
                      className={cn(look, "transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring")}
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
      <Ticks ticks={ticks} />
      {hover !== null && hovered !== undefined ? (
        <Tip
          hover={hover}
          heading={columnLabel(hover.column)}
          rows={series.flatMap((entry, index) =>
            (hovered[index] ?? 0) > 0 ? [{ color: entry.color, label: entry.label, value: hovered[index] }] : [],
          )}
        />
      ) : null}
    </div>
  );
}

export interface DivergingSide {
  label: string;
  color: string;
  values: readonly number[];
}

export interface DivergingBarsProps {
  up: DivergingSide;
  down: DivergingSide;
  columnLabel: (column: number) => string;
  ticks: readonly string[];
}

/** Two series from one axis: `up` grows upward, `down` downward, both on one scale. */
export function DivergingBars({ up, down, columnLabel, ticks }: DivergingBarsProps) {
  const { hover, bind } = useHover();
  const weekLabels = useWeekLabels();
  const max = Math.max(1, ...up.values, ...down.values);
  const half = (side: "up" | "down", entry: DivergingSide, column: number) => {
    const value = entry.values[column] ?? 0;
    return (
      <div className={cn("relative flex-1", side === "up" ? "flex items-end" : "flex items-start")}>
        {value > 0 ? (
          <div
            data-side={side}
            className="w-full rounded-sm"
            style={{ height: `${(value / max) * 100}%`, backgroundColor: entry.color }}
          />
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className={cn("flex min-h-24 flex-1", up.values.length > FEW_COLUMNS ? "gap-0.5" : "gap-1.5")}>
        {up.values.map((_, column) => (
          <div
            key={column}
            data-column={column}
            className={cn(COLUMN_CLASS, "flex flex-col", hover?.column === column && "bg-state-hover")}
            {...bind(column)}
          >
            <WeekMark label={weekLabels.get(column)} />
            {half("up", up, column)}
            <div className="h-px w-full bg-border" />
            {half("down", down, column)}
          </div>
        ))}
      </div>
      <Ticks ticks={ticks} />
      {hover !== null ? (
        <Tip
          hover={hover}
          heading={columnLabel(hover.column)}
          rows={[up, down].map((entry) => ({ color: entry.color, label: entry.label, value: entry.values[hover.column] ?? 0 }))}
        />
      ) : null}
    </div>
  );
}

/** A section's frame, as a Usage Analytics card: title on the left, its figure on the right. */
export function ChartCard({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2 overflow-hidden rounded-md border border-border p-3">
      <header className="flex items-baseline gap-3 text-xs text-muted-foreground">
        <h2 className="text-xs font-medium text-foreground">{title}</h2>
        {aside === undefined ? null : <span className="ml-auto truncate tabular-nums">{aside}</span>}
      </header>
      {children}
    </section>
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
