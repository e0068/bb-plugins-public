// What a tile draws from its answer (analytics/tile.ts): columns, bars or
// the Gantt, a line, a ring, a list of tasks, a pivot table or figures — the
// one drawer for every tile. Columns reuse bars.tsx; the Gantt reuses
// gantt-chart.tsx; the grid is laid under the plot box, the Y labels and the
// trend over it. Which segment is picked is the frame's: it lists the
// segment's tasks — the frame around it, title, menu, switch, legend and the
// list, is tile-card.tsx.
import { Fragment, useState, type MouseEvent, type ReactNode } from "react";

import { GRID_LINES_MAX, NONE_KEY, OTHER_KEY, type Figure } from "../../shared/analytics-tile.js";
import { formatDollars, formatMinutes } from "../../shared/amounts.js";
import type { TaskStatus, TaskType } from "../../shared/enums.js";
import type { Tile, TileAnswer } from "../../shared/contract.js";
import { cn } from "../../lib/utils";
import { PRIORITY_LABELS } from "../common/lib.js";
import { DivergingBars, edgeTicks, Empty, PlotFrame, StackedBars, Swatch, type BarSeries } from "./bars";
import { useChartColors, type ChartColors } from "./chart-colors";
import { formatDay, formatHour } from "./closed-model";
import type { ColumnUnit } from "./default-dashboard";
import { formatDuration, trendOf } from "./flow-model";
import { GanttChart } from "./gantt-chart";
import { lookOf, type PickTarget } from "./segment-pick";
import { STATUS_LABEL } from "./palette";

/** A picked segment: a column's one series, or — series null — the whole column, as a ring's slice is. */
export type SegmentPick = PickTarget;

export interface TileChartProps {
  tile: Tile;
  answer: TileAnswer;
  /** The edges the answer was asked for: what time columns are named by. */
  edges: readonly number[];
  unit: ColumnUnit;
  nowMs: number;
  onOpenTask: (taskKey: string) => void;
  selected?: SegmentPick | null;
  /** Absent, segments are marks nobody can click. */
  onSelect?: (pick: SegmentPick) => void;
}

/** What a column chart calls when a segment, or a column's empty part, is clicked — when anything listens. */
const barSelect = (onSelect: TileChartProps["onSelect"]) =>
  onSelect === undefined
    ? {}
    : { onSelect: (column: number, seriesId: string) => onSelect({ column, seriesId }), onSelectColumn: (column: number) => onSelect({ column, seriesId: null }) };

/* ---------- names, colours, numbers ---------- */

const DOLLAR_FIELDS: ReadonlySet<string> = new Set(["budget", "budgetLimit", "cost"]);
const MINUTE_FIELDS: ReadonlySet<string> = new Set(["plannedMinutes", "actualMinutes"]);

/** A category's name: statuses and priorities by their labels, the rest as the server named them. */
export function valueName(field: Tile["x"] | null, key: string, label: string): string {
  if (key === NONE_KEY || key === OTHER_KEY) return label;
  if (field === "status" && key in STATUS_LABEL) return STATUS_LABEL[key as TaskStatus];
  if (field === "priority" && key in PRIORITY_LABELS) return PRIORITY_LABELS[key as keyof typeof PRIORITY_LABELS];
  return label;
}

/** A value as the tile's measure reads: a duration, a ratio, money, minutes or a count. */
export function formatValue(tile: Tile, value: number): string {
  const { metric, field } = tile.y;
  if (metric === "cycle") return formatDuration(value);
  if (metric === "accuracy") return `×${value.toFixed(1)}`;
  if ((metric === "sum" || metric === "avg") && field !== null) {
    if (DOLLAR_FIELDS.has(field)) return formatDollars(value);
    if (MINUTE_FIELDS.has(field)) return formatMinutes(Math.round(value));
    return metric === "avg" ? value.toFixed(1) : String(Math.round(value));
  }
  return String(Math.round(value));
}

/** Whether the X axis reads the window's columns. */
export const timeAxis = (tile: Tile) => tile.x === "time" || ["dueDate", "startDate", "createdAt", "updatedAt"].includes(tile.x);

/** A column's name: its time on a time axis, with the day when the columns run past one; its category otherwise. */
export function columnName(tile: Tile, answer: TileAnswer, edges: readonly number[], unit: ColumnUnit, column: number): string {
  const entry = answer.columns[column];
  if (entry === undefined) return "";
  if (!timeAxis(tile)) return valueName(tile.x, entry.key, entry.label);
  const start = edges[Number(entry.key)] ?? 0;
  if (unit === "hour" || unit === "minute") return (edges.at(-1) ?? 0) - (edges[0] ?? 0) > DAY_MS ? `${formatDay(start)} ${formatHour(start)}` : formatHour(start);
  return unit === "week" ? `Week of ${formatDay(start)}` : formatDay(start);
}

/** The field whose values a tile's series are, when they are a field's. */
const seriesField = (tile: Tile): Tile["breakdown"] => (tile.y.metric === "createdClosed" ? null : tile.breakdown);

/** A series' colour: a project's, a status', a type's by their own scheme; the measure's own series and other fields by place. */
function seriesColor(tile: Tile, answer: TileAnswer, colors: ChartColors, key: string, index: number): string {
  if (key === OTHER_KEY || key === NONE_KEY) return "var(--muted-foreground)";
  if (tile.y.metric === "createdClosed") return key === "created" ? colors.createdClosed.created : colors.createdClosed.closed;
  switch (seriesField(tile)) {
    case "project":
      return colors.project(answer.projects.findIndex((project) => project.id === key));
    case "status":
      return colors.status(key as TaskStatus);
    case "type":
      return colors.type(key as TaskType);
    default:
      return colors.project(index);
  }
}

export function tileSeries(tile: Tile, answer: TileAnswer, colors: ChartColors): BarSeries[] {
  return answer.series.map((entry, index) => ({
    id: entry.key,
    label: valueName(seriesField(tile), entry.key, entry.label),
    color: seriesColor(tile, answer, colors, entry.key, index),
  }));
}

/** A category's colour on a ring: by its own field's scheme, as a series of that field would be. */
function categoryColor(tile: Tile, answer: TileAnswer, colors: ChartColors, key: string, index: number): string {
  return seriesColor({ ...tile, breakdown: tile.x === "time" ? null : tile.x }, answer, colors, key, index);
}

/** The legend a tile shows: its series; none for a single series, a list, a table, figures — or a ring, which lists its slices with their values itself. */
export function tileLegend(tile: Tile, answer: TileAnswer, colors: ChartColors): { color: string; label: string }[] {
  if (tile.type === "list" || tile.type === "table" || tile.type === "big" || tile.type === "ring" || (tile.type === "bars" && tile.bars.length === "range")) return [];
  const series = tileSeries(tile, answer, colors);
  return series.length < 2 ? [] : series.map(({ color, label }) => ({ color, label }));
}

const totals = (answer: TileAnswer) => answer.values.map((row) => row.reduce((sum, value) => sum + value, 0));

/** How many columns of a unit make a day — what turns a per-column pace into a per-day one. */
const COLUMNS_A_DAY: Record<ColumnUnit, number> = { minute: 1440, hour: 24, day: 1, week: 1 / 7 };

/** The trend's word in the header: what is left, the pace a day and when it empties, as the burndown said it. */
export function trendAside(tile: Tile, answer: TileAnswer, unit: ColumnUnit): string | null {
  if (!tile.display.trend || !timeAxis(tile)) return null;
  const values = totals(answer);
  const left = values.at(-1) ?? 0;
  const trend = trendOf(values);
  const perDay = trend === null ? 0 : trend.slope * COLUMNS_A_DAY[unit];
  const pace = perDay < 0 ? ` · −${Math.abs(perDay).toFixed(1)} / day · empty in ~${Math.ceil(left / -perDay)} days` : " · not burning down";
  return `${Math.round(left)} now${pace}`;
}

/* ---------- axes, grid and trend over the plot box ---------- */

const DAY_MS = 86_400_000;

/** What one unit of a grid step is in the measure's own numbers: a day of a cycle, one of anything else. */
const stepUnit = (tile: Tile): number => (tile.y.metric === "cycle" ? DAY_MS : 1);

/** Three round values from zero to the top, or every `step` when the grid sets one — coarsened so no more than GRID_LINES_MAX lines are drawn. */
function yMarks(max: number, step: number | null): number[] {
  if (step !== null && step > 0) {
    const every = step * Math.max(1, Math.ceil(max / step / GRID_LINES_MAX));
    return Array.from({ length: Math.floor(max / every) }, (_, index) => (index + 1) * every);
  }
  if (max <= 0) return [];
  const magnitude = 10 ** Math.floor(Math.log10(max / 2));
  const nice = Math.max(1, Math.round(max / 2 / magnitude)) * magnitude;
  return [nice, nice * 2].filter((value) => value <= max);
}

/** The values a plot whose top is `max` marks up its side: the grid's step, or two round values. */
const yMarksOf = (tile: Tile, max: number): number[] => yMarks(max, tile.display.grid.y === null ? null : tile.display.grid.y * stepUnit(tile));

/** Where a value stands up the plot, in % from the bottom: once from the floor, or both ways from the middle line of a mirrored plot. */
const levels = (value: number, max: number, mirrored: boolean): number[] => (mirrored ? [50 + (value / max) * 50, 50 - (value / max) * 50] : [(value / max) * 100]);

/** The grid lines of a plot whose top is `max` and that has `columns` columns — laid under the chart. */
function PlotGrid({ tile, max, columns, mirrored = false }: { tile: Tile; max: number; columns: number; mirrored?: boolean }) {
  const { grid } = tile.display;
  const xLines = gridPlaces(columns, grid.x);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {grid.y === null
        ? null
        : yMarksOf(tile, max).flatMap((value) =>
            levels(value, max, mirrored).map((level) => <div key={level} data-grid-y className="absolute inset-x-0 h-px bg-border" style={{ bottom: `${level}%` }} />),
          )}
      {xLines.map((column) => (
        <div key={column} data-grid-x className="absolute inset-y-0 w-px bg-border" style={{ left: `${(column / columns) * 100}%` }} />
      ))}
    </div>
  );
}

/**
 * The values up the plot's side, in a gutter of their own left of the plot
 * box — each level with its grid line. A hidden stack of every label gives
 * the gutter its width; the plot box keeps the rest. Undefined when the
 * labels are off, so no gutter is laid out.
 */
function yAxis(tile: Tile, max: number, mirrored = false): ReactNode | undefined {
  if (!tile.display.yLabels) return undefined;
  const marks = yMarksOf(tile, max).map((value) => ({ text: formatValue(tile, value), levels: levels(value, max, mirrored) }));
  return (
    <div data-y-axis aria-hidden className="pointer-events-none relative h-full text-right text-2xs leading-none tabular-nums text-subtle-foreground">
      <div className="invisible flex h-0 flex-col overflow-hidden">
        {marks.map((mark) => (
          <span key={mark.text}>{mark.text}</span>
        ))}
      </div>
      {marks.flatMap((mark) =>
        mark.levels.map((level) => (
          <span key={level} data-y-label className="absolute right-0 translate-y-1/2" style={{ bottom: `${level}%` }}>
            {mark.text}
          </span>
        )),
      )}
    </div>
  );
}

/** The dashed trend over the columns, when the tile asks for it. */
function TrendLine({ tile, answer, max, columns }: { tile: Tile; answer: TileAnswer; max: number; columns: number }) {
  const line = tile.display.trend ? trendOf(totals(answer)) : null;
  return line === null || columns < 2 ? null : (
    <svg aria-hidden className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
      <line
        x1={50 / columns}
        x2={100 - 50 / columns}
        y1={100 - (line.start / max) * 100}
        y2={100 - ((line.start + line.slope * (columns - 1)) / max) * 100}
        stroke="var(--foreground)"
        strokeOpacity={0.7}
        strokeWidth={1.2}
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Labels under a plot: none, first-middle-last, or every column the X grid marks. */
function xTicks(tile: Tile, count: number, name: (column: number) => string): string[] {
  if (!tile.display.xLabels) return [];
  if (tile.display.grid.x === null) return edgeTicks(count, name);
  const every = tile.display.grid.x;
  return Array.from({ length: count }, (_, column) => column).filter((column) => column % every === 0).map(name);
}

/* ---------- the types ---------- */

/** Every `every`-th place of `count`, past the first — where a grid line falls; coarsened so no more than GRID_LINES_MAX are drawn. */
function gridPlaces(count: number, every: number | null): number[] {
  if (every === null) return [];
  const step = Math.max(every, Math.ceil(count / GRID_LINES_MAX));
  return Array.from({ length: Math.floor((count - 1) / step) }, (_, index) => (index + 1) * step);
}

function ColumnsChart({ tile, answer, edges, unit, selected, onSelect }: TileChartProps) {
  const colors = useChartColors();
  const name = (column: number) => columnName(tile, answer, edges, unit, column);
  const series = tileSeries(tile, answer, colors);
  const ticks = xTicks(tile, answer.columns.length, name);
  const count = answer.columns.length;
  if (tile.y.metric === "createdClosed") {
    const max = Math.max(1, ...answer.values.flat());
    const side = (index: number) => ({ id: series[index]!.id, label: series[index]!.label, color: series[index]!.color, values: answer.values.map((row) => row[index] ?? 0) });
    return (
      <DivergingBars
        up={side(0)}
        down={side(1)}
        columnLabel={name}
        ticks={ticks}
        max={max}
        selected={selected ?? null}
        {...barSelect(onSelect)}
        underlay={<PlotGrid tile={tile} max={max} columns={count} mirrored />}
        axis={yAxis(tile, max, true)}
      />
    );
  }
  const max = Math.max(1, ...totals(answer));
  return (
    <StackedBars
      columns={answer.values}
      series={series}
      columnLabel={name}
      ticks={ticks}
      selected={selected ?? null}
      {...barSelect(onSelect)}
      underlay={<PlotGrid tile={tile} max={max} columns={count} />}
      overlay={<TrendLine tile={tile} answer={answer} max={max} columns={count} />}
      axis={yAxis(tile, max)}
    />
  );
}

export const ROW_CLASS = "flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-state-hover";

/** A bar row's least height: what the rows keep before the chart scrolls. */
const BAR_ROW_MIN_PX = 20;

const SEGMENT_LOOK = "h-full transition-opacity";

function BarsChart(props: TileChartProps) {
  const { tile, answer, edges, nowMs, onOpenTask, selected, onSelect } = props;
  const colors = useChartColors();
  const [hover, setHover] = useState<SegmentPick | null>(null);
  // A row whose segments can be picked: the pointer over it shows what a click picks, a click beside its segments picks the whole row.
  const rowPick = (column: number, row: readonly number[]) =>
    onSelect === undefined || row.every((value) => value <= 0)
      ? {}
      : {
          "data-pickable": true,
          onMouseMove: (event: MouseEvent) => {
            const segment = event.target instanceof Element ? event.target.closest("[data-series]") : null;
            setHover({ column, seriesId: segment?.getAttribute("data-series") ?? null });
          },
          onMouseLeave: () => setHover(null),
          onClick: (event: MouseEvent) => {
            if (!(event.target instanceof Element && event.target.closest("[data-series]") !== null)) onSelect({ column, seriesId: null });
          },
        };
  if (tile.bars.length === "range") {
    const rows = answer.rows.map(({ sinceMs: _since, ...row }) => row);
    return <GanttChart rows={rows} fromMs={edges[0] ?? nowMs} toMs={nowMs} mode={tile.bars.gantt} onOpenTask={onOpenTask} />;
  }
  const series = tileSeries(tile, answer, colors);
  const max = Math.max(1, ...totals(answer).map(Math.abs), ...answer.values.flat());
  const stacked = tile.y.metric !== "cycle" && tile.y.metric !== "accuracy";
  const { xLabels, yLabels, grid } = tile.display;
  const count = answer.columns.length;
  const track = xLabels ? 2 : 1;
  // A segment of a bar: a button when a pick is listened for, a plain mark otherwise; the hover shows what a click would pick.
  const segment = (column: number, index: number, value: number) => {
    const entry = series[index];
    if (entry === undefined || value <= 0) return null;
    const dimmed = lookOf(onSelect === undefined ? null : hover, selected ?? null, column, entry.id) === "dim";
    const mark = { "data-segment": `${column}:${entry.id}`, "data-series": entry.id, "data-dimmed": String(dimmed), style: { width: `${(value / max) * 100}%`, backgroundColor: entry.color } };
    const look = cn(SEGMENT_LOOK, dimmed && "opacity-30");
    return onSelect === undefined ? (
      <span key={entry.id} {...mark} className={look} />
    ) : (
      <button
        key={entry.id}
        type="button"
        {...mark}
        data-pickable
        aria-label={`${columnName(tile, answer, edges, props.unit, column)} · ${entry.label}: ${formatValue(tile, value)}`}
        className={cn(look, "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring")}
        onClick={() => onSelect({ column, seriesId: entry.id })}
      />
    );
  };
  return (
    // Names and values take their text's width, the bars the rest; the rows share the height.
    <div
      data-bar-grid
      className="relative grid min-h-0 flex-1 gap-x-2 overflow-y-auto text-xs"
      style={{
        gridTemplateColumns: [xLabels ? "fit-content(40%)" : null, "minmax(0, 1fr)", yLabels ? "auto" : null].filter((column) => column !== null).join(" "),
        gridTemplateRows: `repeat(${count}, minmax(${BAR_ROW_MIN_PX}px, 1fr))`,
      }}
    >
      <div aria-hidden className="pointer-events-none relative" style={{ gridColumn: track, gridRow: "1 / -1" }}>
        {grid.y === null
          ? null
          : yMarksOf(tile, max).map((value) => <div key={value} data-grid-y className="absolute inset-y-0 w-px bg-border" style={{ left: `${(value / max) * 100}%` }} />)}
        {gridPlaces(count, grid.x).map((row) => (
          <div key={row} data-grid-x className="absolute inset-x-0 h-px bg-border" style={{ top: `${(row / count) * 100}%` }} />
        ))}
      </div>
      {answer.columns.map((column, index) => {
        const row = answer.values[index] ?? [];
        const tracks = stacked ? [row.map((value, valueIndex) => ({ value, seriesIndex: valueIndex }))] : row.map((value, valueIndex) => [{ value, seriesIndex: valueIndex }]);
        return (
          <Fragment key={column.key}>
            {xLabels ? (
              <span data-bar-label className="min-w-0 self-center truncate text-muted-foreground" style={{ gridColumn: 1, gridRow: index + 1 }}>
                {columnName(tile, answer, edges, props.unit, index)}
              </span>
            ) : null}
            <span
              data-bar-row
              className="flex min-w-0 flex-col justify-center gap-0.5 py-1"
              style={{ gridColumn: track, gridRow: index + 1 }}
              {...rowPick(index, row)}
            >
              {tracks.map((parts, trackIndex) => (
                <span key={trackIndex} className="relative flex min-h-1.5 max-h-4 flex-1 overflow-hidden rounded-full bg-muted">
                  {parts.map(({ value, seriesIndex }) => segment(index, seriesIndex, value))}
                </span>
              ))}
            </span>
            {yLabels ? (
              <span data-bar-value className="self-center text-right tabular-nums text-muted-foreground" style={{ gridColumn: track + 1, gridRow: index + 1 }}>
                {stacked ? formatValue(tile, row.reduce((sum, value) => sum + value, 0)) : formatValue(tile, row[0] ?? 0)}
              </span>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

function LineChart({ tile, answer, edges, unit }: TileChartProps) {
  const colors = useChartColors();
  const series = tileSeries(tile, answer, colors);
  const max = Math.max(1, ...answer.values.flat());
  const count = answer.columns.length;
  const x = (column: number) => (count < 2 ? 50 : (column / (count - 1)) * 100);
  const name = (column: number) => columnName(tile, answer, edges, unit, column);
  const plot = (
    <div data-plot className="relative min-h-24 flex-1">
      <PlotGrid tile={tile} max={max} columns={count} />
      <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={tile.title}>
        {series.map((entry, index) => (
          <polyline
            key={entry.id}
            data-line={entry.id}
            fill="none"
            stroke={entry.color}
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
            points={answer.values.map((row, column) => `${x(column)},${100 - ((row[index] ?? 0) / max) * 100}`).join(" ")}
          />
        ))}
      </svg>
    </div>
  );
  return <PlotFrame axis={yAxis(tile, max)} ticks={xTicks(tile, count, name)} plot={plot} />;
}

/** The ring's drawing box: it scales to the smaller side of the room it gets. */
const RING_BOX = 100;
const RING_STROKE = 12;

function RingChart({ tile, answer, selected, onSelect }: TileChartProps) {
  const colors = useChartColors();
  const values = totals(answer);
  const total = values.reduce((sum, value) => sum + value, 0);
  const center = RING_BOX / 2;
  const radius = (RING_BOX - RING_STROKE) / 2;
  const length = 2 * Math.PI * radius;
  const starts = values.reduce<number[]>((acc, value, index) => [...acc, (acc[index] ?? 0) + value], [0]);
  const name = (index: number) => valueName(tile.x, answer.columns[index]!.key, answer.columns[index]!.label);
  return (
    <div className="flex min-h-0 flex-1 items-center gap-5">
      <div className="relative h-full min-h-24 min-w-24 flex-1">
        <svg aria-label={tile.title} className="absolute inset-0 size-full" viewBox={`0 0 ${RING_BOX} ${RING_BOX}`}>
          <g transform={`rotate(-90 ${center} ${center})`}>
            <circle r={radius} cx={center} cy={center} fill="none" stroke="var(--muted)" strokeWidth={RING_STROKE} />
            {total > 0
              ? answer.columns.map((column, index) => {
                  const dimmed = selected != null && selected.column !== index;
                  const choose = onSelect === undefined ? undefined : () => onSelect({ column: index, seriesId: null });
                  return (
                    <circle
                      key={column.key}
                      data-arc={column.key}
                      data-pickable={choose === undefined ? undefined : true}
                      role={choose === undefined ? undefined : "button"}
                      tabIndex={choose === undefined ? undefined : 0}
                      aria-label={choose === undefined ? undefined : `${name(index)}: ${formatValue(tile, values[index]!)}`}
                      className={cn(choose !== undefined && "cursor-pointer transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:[stroke-width:18]", dimmed && "opacity-30")}
                      onClick={choose}
                      onKeyDown={
                        choose === undefined
                          ? undefined
                          : (event) => {
                              if (event.key !== "Enter" && event.key !== " ") return;
                              // Space picks, it does not scroll the page.
                              event.preventDefault();
                              choose();
                            }
                      }
                      r={radius}
                      cx={center}
                      cy={center}
                      fill="none"
                      stroke={categoryColor(tile, answer, colors, column.key, index)}
                      strokeWidth={RING_STROKE}
                      strokeDasharray={`${Math.max(0, (values[index]! / total) * length - 1)} ${length}`}
                      strokeDashoffset={-((starts[index]! / total) * length)}
                    />
                  );
                })
              : null}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-base font-semibold tabular-nums text-foreground">{formatValue(tile, total)}</span>
        </div>
      </div>
      {tile.display.legend === "hidden" ? null : (
        // As wide as its longest line, the ring taking the rest.
        <ul data-ring-legend className="flex max-h-full w-max max-w-[60%] shrink-0 flex-col gap-1 overflow-y-auto">
          {answer.columns.map((column, index) => (
            <li key={column.key} className="flex items-center gap-2 text-xs">
              <Swatch color={categoryColor(tile, answer, colors, column.key, index)} />
              <span className="min-w-0 truncate text-foreground">{name(index)}</span>
              <span className="ml-auto shrink-0 pl-2 tabular-nums text-muted-foreground">{formatValue(tile, values[index]!)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ListChart({ tile, answer, nowMs, onOpenTask }: TileChartProps) {
  const inStatus = tile.sort?.by === "timeInStatus";
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
      {answer.rows.map((row) => (
        <li key={row.taskId}>
          <button type="button" onClick={() => onOpenTask(row.key)} className={ROW_CLASS}>
            <span className="max-w-[40%] shrink-0 truncate tabular-nums text-muted-foreground">{row.key}</span>
            <span className="min-w-0 flex-1 truncate text-foreground">{row.title}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {inStatus && row.sinceMs !== null ? formatDuration(nowMs - row.sinceMs) : STATUS_LABEL[row.status]}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function TableChart({ tile, answer, edges, unit }: TileChartProps) {
  const rowTotals = totals(answer);
  const columnTotals = answer.series.map((_, index) => answer.values.reduce((sum, row) => sum + (row[index] ?? 0), 0));
  const cell = (value: number) => (value === 0 ? <td className="px-1.5 py-1 text-right text-subtle-foreground">·</td> : <td className="px-1.5 py-1 text-right tabular-nums">{formatValue(tile, value)}</td>);
  const breakdown = seriesField(tile);
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="text-2xs text-muted-foreground">
            <th className="px-1.5 py-1 text-left font-normal" />
            {answer.series.map((series) => (
              <th key={series.key} className="px-1.5 py-1 text-right font-normal">
                {valueName(breakdown, series.key, series.label)}
              </th>
            ))}
            <th className="px-1.5 py-1 text-right font-normal">Total</th>
          </tr>
        </thead>
        <tbody>
          {answer.columns.map((column, index) => (
            <tr key={column.key} className="hover:bg-state-hover">
              <td className="truncate px-1.5 py-1 text-muted-foreground">{columnName(tile, answer, edges, unit, index)}</td>
              {(answer.values[index] ?? []).map((value, valueIndex) => (
                <Fragment key={valueIndex}>{cell(value)}</Fragment>
              ))}
              <td className="px-1.5 py-1 text-right tabular-nums">{formatValue(tile, rowTotals[index]!)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-medium">
            <td className="px-1.5 py-1 text-muted-foreground">Total</td>
            {columnTotals.map((value, index) => (
              <td key={index} className="px-1.5 py-1 text-right tabular-nums">
                {formatValue(tile, value)}
              </td>
            ))}
            <td className="px-1.5 py-1 text-right tabular-nums">{formatValue(tile, rowTotals.reduce((sum, value) => sum + value, 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const FIGURE_LABEL: Record<Figure, string> = {
  open: "Open",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  created: "Created",
  closed: "Closed",
  cycle: "Median cycle",
  planned: "Planned time",
  actual: "Actual time",
  budget: "Budget",
  cost: "Cost",
  limit: "Limit",
};

/** A figure's number as the figure strip printed it. */
function figureValue(figure: Figure, value: number | null | undefined): string {
  if (value == null) return "—";
  switch (figure) {
    case "cycle":
      return formatDuration(value);
    case "planned":
    case "actual":
      return formatMinutes(value);
    case "budget":
    case "cost":
    case "limit":
      return formatDollars(value);
    default:
      return String(value);
  }
}

/** The line under a figure, as the strip had it. */
function figureNote(figure: Figure, answer: TileAnswer): string | null {
  const { figures } = answer;
  switch (figure) {
    case "open":
      return `of ${answer.total}`;
    case "created":
    case "closed":
      return "this period";
    case "cycle":
      return "in progress → done";
    case "cost":
      return (figures.budget ?? 0) > 0 ? `${Math.round(((figures.cost ?? 0) / figures.budget!) * 100)}% of budget` : null;
    default:
      return null;
  }
}

function FiguresChart({ tile, answer }: TileChartProps) {
  if (tile.figures.length === 0) return <Empty>Pick figures in the chart's settings.</Empty>;
  return (
    // A narrow tile wraps its figures; whatever the row's height leaves out scrolls rather than hides.
    <div className="flex min-h-0 flex-1 flex-wrap content-start gap-x-6 gap-y-3 overflow-y-auto">
      {tile.figures.map((figure) => {
        const note = figureNote(figure, answer);
        return (
          <div key={figure} data-kpi className="min-w-20 shrink-0">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{FIGURE_LABEL[figure]}</div>
            <div data-value className="text-xl font-semibold tabular-nums text-foreground">
              {figureValue(figure, answer.figures[figure])}
            </div>
            {note === null ? null : <div className="text-2xs text-subtle-foreground">{note}</div>}
          </div>
        );
      })}
    </div>
  );
}

export { FIGURE_LABEL };

const DRAW: Record<Tile["type"], (props: TileChartProps) => ReactNode> = {
  columns: ColumnsChart,
  bars: BarsChart,
  line: LineChart,
  ring: RingChart,
  list: ListChart,
  table: TableChart,
  big: FiguresChart,
};

/** Whether an answer has anything to draw for its tile. */
export function hasContent(tile: Tile, answer: TileAnswer): boolean {
  switch (tile.type) {
    case "big":
      return true;
    case "list":
      return answer.rows.length > 0;
    case "bars":
      return tile.bars.length === "range" ? answer.rows.length > 0 : answer.columns.length > 0;
    default:
      return answer.columns.length > 0 && answer.values.some((row) => row.some((value) => value !== 0));
  }
}

export function TileChart(props: TileChartProps) {
  if (!hasContent(props.tile, props.answer)) return <Empty>No tasks match this chart's filter.</Empty>;
  const Draw = DRAW[props.tile.type];
  return <Draw {...props} />;
}
