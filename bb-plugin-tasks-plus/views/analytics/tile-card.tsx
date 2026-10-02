// One tile of the analytics screen: filled like a task card on the board, its
// title, the switch as a segmented control and its figure in the header,
// three dots on hover for Edit chart, Duplicate and Delete, the chart, and
// the legend where the tile says. With segment contents on, a divider the
// owner drags splits the tile into the chart and the tasks of the segment
// picked on it — every task of the chart while none is. The chart itself is
// tile-charts.tsx; the header doubles as the handle the row board moves the
// tile by.
import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { weekBreaks } from "@bb-plugins/analytics-viz/core/weeks";

import { Button } from "../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Icon } from "../../components/ui/icon";
import { CELL_KEYS_MAX, CONTENTS_SHARE, readsSetting } from "../../shared/analytics-tile.js";
import type { Tile, TileAnswer } from "../../shared/contract.js";
import { cn } from "../../lib/utils";
import { Legend, Swatch, WeekBreaksScope } from "./bars";
import { useChartColors } from "./chart-colors";
import { formatDay } from "./closed-model";
import type { ColumnUnit } from "./default-dashboard";
import { columnName, formatValue, ROW_CLASS, segmentIsCut, segmentKeys, tileLegend, TileChart, tileSeries, trendAside, type SegmentPick } from "./tile-charts";

export interface TileCardProps {
  tile: Tile;
  /** Undefined while the first answer is on its way. */
  answer: TileAnswer | undefined;
  error: string | null;
  edges: readonly number[];
  unit: ColumnUnit;
  nowMs: number;
  /** The switch value picked; null — All. */
  picked: string | null;
  /** The tile is open in the settings panel. */
  editing: boolean;
  onPick: (key: string | null) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpenTask: (taskKey: string) => void;
  /** The divider let go: the chart's new share of the height. Absent, nothing keeps it. */
  onSplit?: (share: number) => void;
}

const ALL = "__all";

/** px the «+N» segment takes. */
const MORE_PX = 40;

/** How many segments, first ones first, fit beside a «+N» one — all of them when they fit outright. */
export function fitting(widths: readonly number[], room: number): number {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= room) return widths.length;
  const ends = widths.reduce<number[]>((acc, width) => [...acc, (acc.at(-1) ?? 0) + width], []);
  return Math.max(1, ends.filter((end) => end + MORE_PX <= room).length);
}

const SEGMENT_CLASS = "flex h-6 shrink-0 items-center justify-center gap-1.5 rounded-sm px-2 text-2xs whitespace-nowrap";

/**
 * The switch: All and the field's values as a segmented control, the way
 * Display's Table/Board switch looks; values that do not fit go under «+N»,
 * and one picked from there stands in the last place that fits.
 */
function SegmentSwitch({ tile, answer, picked, onPick }: { tile: Tile; answer: TileAnswer; picked: string | null; onPick: (key: string | null) => void }) {
  const colors = useChartColors();
  const rowRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const values = [{ key: ALL, label: "All" }, ...answer.switchValues];
  const [shown, setShown] = useState(values.length);
  const measure = useCallback(() => {
    const row = rowRef.current;
    const ruler = measureRef.current;
    if (row === null || ruler === null) return;
    const widths = (Array.from(ruler.children) as HTMLElement[]).map((child) => child.offsetWidth);
    setShown(fitting(widths, row.offsetWidth));
  }, []);
  const signature = values.map((value) => value.label).join("|");
  useLayoutEffect(() => {
    measure();
    const row = rowRef.current;
    if (row === null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure, signature]);

  const current = picked ?? ALL;
  const fits = values.slice(0, shown);
  const hidden = values.slice(shown);
  const pickedHidden = hidden.find((value) => value.key === current);
  const visible = pickedHidden === undefined ? fits : [...fits.slice(0, -1), pickedHidden];
  const folded = values.filter((value) => !visible.includes(value));
  // Not even one segment beside a «+N» fits: the picked value alone, a chevron opening every value.
  const collapsed = shown <= 1 && values.length > 1;
  const currentValue = values.find((value) => value.key === current) ?? values[0]!;
  const menuItems = (entries: readonly { key: string; label: string }[]) =>
    entries.map((value) => (
      <DropdownMenuItem key={value.key} onSelect={() => onPick(value.key === ALL ? null : value.key)}>
        {swatch(value.key)}
        {value.label}
      </DropdownMenuItem>
    ));
  const swatch = (key: string) =>
    tile.switch === "project" && key !== ALL ? <Swatch color={colors.project(answer.projects.findIndex((project) => project.id === key))} /> : null;
  const segment = (value: { key: string; label: string }) => (
    <button
      key={value.key}
      type="button"
      data-segment-key={value.key}
      aria-pressed={value.key === current}
      onClick={() => onPick(value.key === ALL ? null : value.key)}
      className={cn(SEGMENT_CLASS, value.key === current ? "bg-background text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground")}
    >
      {swatch(value.key)}
      {value.label}
    </button>
  );

  return (
    <div ref={rowRef} data-switch-row className="relative ml-auto flex min-w-0 flex-1 justify-end">
      <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute flex">
        {values.map((value) => (
          <span key={value.key} data-segment-key={value.key} className={SEGMENT_CLASS}>
            {swatch(value.key)}
            {value.label}
          </span>
        ))}
      </div>
      <div role="group" aria-label={`Switch ${tile.title}`} className="flex min-w-0 rounded-md bg-muted p-0.5">
        {collapsed ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={`${currentValue.label}, pick another`} className={cn(SEGMENT_CLASS, "min-w-0 bg-background text-foreground shadow-2xs")}>
                {swatch(currentValue.key)}
                <span className="truncate">{currentValue.label}</span>
                <Icon name="ChevronDown" className="size-3 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" collisionPadding={8} mobileTitle={tile.title}>
              {menuItems(values)}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <>
            {visible.map(segment)}
            {folded.length === 0 ? null : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={cn(SEGMENT_CLASS, "text-muted-foreground hover:text-foreground")}>{`+${folded.length}`}</button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" collisionPadding={8} mobileTitle={tile.title}>
                  {menuItems(folded)}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Measures that read the transition log, which starts at install. */
const LOGGED: ReadonlySet<Tile["y"]["metric"]> = new Set(["moves", "closed", "createdClosed", "sum", "avg", "cycle", "accuracy"]);

/** The figure in the header: the trend's word, the net of created against closed, or the tile's total. */
function asideOf(tile: Tile, answer: TileAnswer, unit: ColumnUnit): string | null {
  const trend = trendAside(tile, answer, unit);
  if (trend !== null) return trend;
  if (tile.type === "big" || tile.type === "list" || (tile.type === "bars" && tile.bars.length === "range")) return null;
  if (tile.y.metric === "createdClosed") {
    const net = answer.values.reduce((sum, row) => sum + (row[0] ?? 0) - (row[1] ?? 0), 0);
    return `net ${net > 0 ? "+" : net < 0 ? "−" : ""}${Math.abs(net)}`;
  }
  if (tile.y.metric === "cycle" || tile.y.metric === "accuracy" || tile.y.metric === "avg") return null;
  return formatValue(tile, answer.values.flat().reduce((sum, value) => sum + value, 0));
}

/** How far one arrow key moves the divider. */
const SPLIT_STEP = 0.05;

/** A share held inside the divider's bounds, to the hundredth. */
const clampShare = (share: number): number => Math.round(Math.min(CONTENTS_SHARE.max, Math.max(CONTENTS_SHARE.min, share)) * 100) / 100;

/** The chart's share of the height while segment contents are on; null when the tile has none to list. */
function contentsShare(tile: Tile): number | null {
  const share = tile.display.contents;
  return share === undefined || !readsSetting(tile.type, tile.bars.length, "contents") ? null : share;
}

/** The tasks of the picked segment, or of the whole chart while none is picked. */
function SegmentContents({ tile, answer, edges, unit, pick, style, onOpenTask }: Pick<TileCardProps, "tile" | "edges" | "unit" | "onOpenTask"> & { answer: TileAnswer; pick: SegmentPick | null; style: CSSProperties }) {
  const colors = useChartColors();
  const keys = segmentKeys(answer, pick);
  const cut = segmentIsCut(answer, pick);
  const series = pick?.seriesId == null ? undefined : tileSeries(tile, answer, colors).find((entry) => entry.id === pick.seriesId);
  const heading = pick === null ? "All tasks" : [series?.label, columnName(tile, answer, edges, unit, pick.column)].filter(Boolean).join(" · ");
  return (
    <div data-segment-contents className="flex min-h-0 flex-col gap-1" style={style}>
      <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        {series === undefined ? null : <Swatch color={series.color} />}
        <span className="truncate text-foreground">{heading}</span>
        <span className="shrink-0 tabular-nums">{`· ${keys.length}${cut ? "+" : ""}`}</span>
      </div>
      {cut ? <p className="text-2xs text-subtle-foreground">{`Each segment lists its first ${CELL_KEYS_MAX} tasks`}</p> : null}
      <ul className="min-h-0 flex-1 overflow-auto">
        {keys.map((key) => (
          <li key={key} data-task-key={key}>
            <button type="button" onClick={() => onOpenTask(key)} className={ROW_CLASS}>
              <span className="max-w-[40%] shrink-0 truncate tabular-nums text-muted-foreground">{key}</span>
              <span className="min-w-0 flex-1 truncate text-foreground">{answer.titles[key] ?? key}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The pick on the chart: dropped with a new answer, whose columns may stand elsewhere. */
function usePick(answer: TileAnswer | undefined): [SegmentPick | null, (pick: SegmentPick | null) => void] {
  const [held, setHeld] = useState<{ answer: TileAnswer | undefined; pick: SegmentPick | null }>({ answer, pick: null });
  return [held.answer === answer ? held.pick : null, (pick) => setHeld({ answer, pick })];
}

/** The divider's share while it is dragged, and the handlers that drag it or move it by the arrows. */
function useDivider(share: number, onSplit: (share: number) => void) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  // Only a share that moved is saved: a click on the divider or a press at its bound asks nothing of the server.
  const keep = (next: number) => (next === share ? undefined : onSplit(next));
  const follow = (event: PointerEvent) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (box !== undefined && box.height > 0) setDragged(clampShare((event.clientY - box.top) / box.height));
  };
  const handlers = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      // The divider is not the row board's handle: the tile stays where it stands.
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDragged(share);
    },
    onPointerMove: (event: PointerEvent) => (dragged === null ? undefined : follow(event)),
    onPointerUp: () => {
      if (dragged !== null) keep(dragged);
      setDragged(null);
    },
    // A touch the browser took over leaves no pointerup: the drag ends with the capture.
    onLostPointerCapture: () => setDragged(null),
    onKeyDown: (event: KeyboardEvent) => {
      const step = event.key === "ArrowUp" ? -SPLIT_STEP : event.key === "ArrowDown" ? SPLIT_STEP : 0;
      if (step === 0) return;
      event.preventDefault();
      keep(clampShare(share + step));
    },
  };
  return { boxRef, share: dragged ?? share, handlers };
}

export function TileCard(props: TileCardProps) {
  const { tile, answer, error, edges, unit, editing } = props;
  const colors = useChartColors();
  const legend = answer === undefined || tile.display.legend === "hidden" ? [] : tileLegend(tile, answer, colors);
  const aside = answer === undefined ? null : asideOf(tile, answer, unit);
  const breaks = unit === "day" ? weekBreaks(edges.slice(0, -1)).map(({ column }) => ({ column })) : [];
  const logStart = answer?.logStartMs ?? null;
  const logStartsInside = LOGGED.has(tile.y.metric) && logStart !== null && logStart > (edges[0] ?? 0) && logStart < (edges.at(-1) ?? 0);
  const listed = contentsShare(tile);
  const [pick, setPick] = usePick(answer);
  const divider = useDivider(listed ?? CONTENTS_SHARE.start, (share) => props.onSplit?.(share));
  const select = listed === null ? undefined : (next: SegmentPick) => setPick(pick?.column === next.column && pick.seriesId === next.seriesId ? null : next);
  // A click on the chart that lands on no segment drops the pick.
  const clickAside = (event: MouseEvent) => {
    if (!(event.target instanceof Element && event.target.closest("[data-pickable]") !== null)) setPick(null);
  };
  const body =
    error !== null ? (
      <p className="text-xs text-destructive">{error}</p>
    ) : answer === undefined ? (
      <div className="min-h-0 flex-1 animate-pulse rounded-md bg-muted/40" />
    ) : (
      <WeekBreaksScope breaks={tile.x === "time" ? breaks : []}>
        <TileChart tile={tile} answer={answer} edges={edges} unit={unit} nowMs={props.nowMs} onOpenTask={props.onOpenTask} selected={listed === null ? null : pick} onSelect={select} />
      </WeekBreaksScope>
    );

  const chartWithLegend =
    legend.length > 0 && tile.display.legend === "right" ? (
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">{body}</div>
        {/* As wide as its longest name, half the tile at most. */}
        <div data-legend="right" className="w-max max-w-[50%] shrink-0 overflow-y-auto">
          <ul className="flex flex-col gap-1 text-2xs text-muted-foreground">
            {legend.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5">
                <Swatch color={item.color} />
                <span className="truncate">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    ) : (
      <>
        {body}
        {legend.length > 0 ? (
          <div data-legend="bottom">
            <Legend items={legend} />
          </div>
        ) : null}
      </>
    );

  return (
    <section
      aria-label={tile.title}
      data-tile={tile.id}
      // Filled like a task card on the board, no border; hover lays part of
      // the host's hover tint over the fill, behind the content.
      className={cn(
        "group relative isolate flex h-full w-full min-w-0 flex-col gap-2 overflow-hidden rounded-lg bg-surface-recessed-solid px-3 py-2.5",
        "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-state-hover before:opacity-0 hover:before:opacity-40",
        editing && "ring-1 ring-foreground before:opacity-40",
      )}
    >
      <header
        data-tile-handle
        className="flex min-h-6 cursor-grab items-center gap-3 text-xs text-muted-foreground active:cursor-grabbing"
      >
        {/* The three dots show right after the title. */}
        <div className="flex max-w-[45%] min-w-0 shrink-0 items-center">
          <h2 className="min-w-0 truncate text-xs font-medium text-foreground">{tile.title}</h2>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Chart actions"
                // No room taken until the card is hovered, the menu is open or the pointer is a finger.
                className="ml-0.5 h-6 w-0 shrink-0 overflow-hidden text-muted-foreground opacity-0 group-hover:w-6 group-hover:opacity-100 hover:text-foreground focus-visible:w-6 focus-visible:opacity-100 data-[state=open]:w-6 data-[state=open]:opacity-100 pointer-coarse:w-6 pointer-coarse:opacity-100"
              >
                <Icon name="MoreHorizontal" className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" collisionPadding={8} mobileTitle={tile.title}>
              <DropdownMenuItem onSelect={props.onEdit}>
                <Icon name="SlidersHorizontal" className="size-3" />
                Edit chart
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={props.onDuplicate}>
                <Icon name="Copy" className="size-3" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={props.onDelete} className="text-destructive focus:text-destructive">
                <Icon name="Trash2" className="size-3" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {tile.switch !== null && answer !== undefined ? <SegmentSwitch tile={tile} answer={answer} picked={props.picked} onPick={props.onPick} /> : null}
        {aside === null ? null : <span className={cn("shrink-0 truncate tabular-nums", tile.switch === null && "ml-auto")}>{aside}</span>}
      </header>
      {listed === null || answer === undefined ? (
        <div data-chart-pane className="flex min-h-0 flex-1 flex-col gap-2">
          {chartWithLegend}
        </div>
      ) : (
        <div ref={divider.boxRef} className="flex min-h-0 flex-1 flex-col">
          <div data-chart-pane className="flex min-h-0 flex-col gap-2 pb-1.5" style={{ flex: `${divider.share} 1 0px` }} onClick={clickAside}>
            {chartWithLegend}
          </div>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Chart and contents"
            aria-valuemin={CONTENTS_SHARE.min * 100}
            aria-valuemax={CONTENTS_SHARE.max * 100}
            aria-valuenow={Math.round(divider.share * 100)}
            tabIndex={0}
            className="group/divider flex h-2.5 shrink-0 cursor-row-resize touch-none items-center focus-visible:outline-none"
            {...divider.handlers}
          >
            <div className="h-px w-full bg-border group-hover/divider:h-0.5 group-hover/divider:bg-foreground/40 group-focus-visible/divider:h-0.5 group-focus-visible/divider:bg-ring" />
          </div>
          <SegmentContents tile={tile} answer={answer} edges={edges} unit={unit} pick={pick} style={{ flex: `${1 - divider.share} 1 0px` }} onOpenTask={props.onOpenTask} />
        </div>
      )}
      {logStartsInside ? <p className="text-2xs text-subtle-foreground">Transition log starts on {formatDay(logStart!)} — earlier moves are not recorded.</p> : null}
    </section>
  );
}
