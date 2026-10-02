// The Gantt of tasks, drawn over ganttRows' answer: a lane per task, the
// planned dates as an outline, the statuses the task actually stood in as
// filled stretches, or both laid over each other, and a line at each Monday.
// The analytics screen draws it with the tasks named down the left; a board
// card draws it compact, bare lanes of its sub-tasks. The geometry is pure
// and exported; the component only maps it to divs, as bars.tsx does.
import { useState, type ReactNode } from "react";
import { weekEdgesSince } from "@bb-plugins/analytics-viz/core/weeks";

import type { GanttMode, TaskStatus } from "../../shared/enums.js";
import type { GanttAnswer } from "../../shared/contract.js";
import { formatPlanDate, planDateMs, VIEWER_LOCALE } from "../../shared/plan-date.js";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/ui/tooltip";
import { StatusIcon } from "../board/icons";
import { Empty } from "./bars";
import { useChartColors } from "./chart-colors";
import { formatDay } from "./closed-model";
import { STATUS_LABEL } from "./palette";

export type GanttRowData = GanttAnswer["rows"][number];

interface Span {
  fromMs: number;
  toMs: number;
}

/** The day a plan date falls on, YYYY-MM-DD — the date without its time. */
const dayOf = (planDate: string) => planDate.slice(0, 10);

/**
 * The planned stretch on the viewer's calendar: from the start — its time,
 * or its day's midnight — or the task's creation, when only a due date is
 * set, through the due time or the end of the due day, or of the start day
 * when that is all there is. A task made after its due plans the due day
 * alone. No dates, no plan.
 */
export function planSpan(row: GanttRowData): Span | null {
  const { startDate, dueDate } = row;
  if (startDate === null && dueDate === null) return null;
  const toMs = dueDate !== null ? planDateMs(dueDate, "end") : planDateMs(dayOf(startDate!), "end");
  const fromMs = startDate !== null ? planDateMs(startDate, "start") : (row.createdMs ?? planDateMs(dayOf(dueDate!), "start"));
  return { fromMs: fromMs < toMs ? fromMs : planDateMs(dayOf((dueDate ?? startDate)!), "start"), toMs };
}

/** A stretch placed on a lane, as fractions of the lane's width. */
export interface Bar {
  left: number;
  width: number;
}

export interface GanttLine {
  row: GanttRowData;
  plan: Bar | null;
  /** Each stretch by status, placed. */
  fact: { status: TaskStatus; bar: Bar }[];
  /** Where across the lane a done task was done; null for any other, or outside the window. */
  doneAt: number | null;
}

/**
 * When a done task was done: the end of its last stretch — the server leaves
 * the done stretches out, so its line ends right there. Null for a task that
 * is not done, or that has no stretch to end.
 */
const doneMs = (row: GanttRowData): number | null =>
  row.status === "done" && row.segments.length > 0 ? row.segments.at(-1)!.toMs : null;

/**
 * What each row draws between `fromMs` and `toMs`: its plan and its stretches
 * by status as the mode asks, cut at the edges. Rows with nothing inside are
 * left out; the rest go by where they start.
 */
export function ganttLines(rows: readonly GanttRowData[], fromMs: number, toMs: number, mode: GanttMode): GanttLine[] {
  const span = toMs - fromMs;
  const place = ({ fromMs: from, toMs: to }: Span): Bar | null => {
    const left = Math.max(from, fromMs);
    const right = Math.min(to, toMs);
    return right > left ? { left: (left - fromMs) / span, width: (right - left) / span } : null;
  };
  const lines = rows.flatMap((row): GanttLine[] => {
    const plannedSpan = mode === "fact" ? null : planSpan(row);
    const plan = plannedSpan === null ? null : place(plannedSpan);
    const fact =
      mode === "plan"
        ? []
        : row.segments.flatMap((segment) => {
            const bar = place(segment);
            return bar === null ? [] : [{ status: segment.status, bar }];
          });
    const done = doneMs(row);
    const doneAt = done !== null && done >= fromMs && done < toMs ? (done - fromMs) / span : null;
    return plan === null && fact.length === 0 ? [] : [{ row, plan, fact, doneAt }];
  });
  const startOf = (line: GanttLine) => Math.min(line.plan?.left ?? 1, ...line.fact.map((entry) => entry.bar.left));
  return lines.sort((a, b) => startOf(a) - startOf(b));
}

export interface GanttWeek {
  mondayMs: number;
  /** Where the Monday falls across the lane, 0 to 1. */
  at: number;
  labelled: boolean;
}

/** A line at each Monday inside the window; at most `maxLabels` of them carry a date, spread evenly. */
export function ganttWeeks(fromMs: number, toMs: number, maxLabels: number): GanttWeek[] {
  const mondays = weekEdgesSince(fromMs, toMs).filter((mondayMs) => mondayMs > fromMs && mondayMs < toMs);
  const every = Math.max(1, Math.ceil(mondays.length / maxLabels));
  return mondays.map((mondayMs, index) => ({
    mondayMs,
    at: (mondayMs - fromMs) / (toMs - fromMs),
    labelled: index % every === 0,
  }));
}

const percent = (fraction: number) => `${fraction * 100}%`;

/** A row's plan as the tooltip spells it: "Start → Due", one end when only one is set. */
function planText(row: GanttRowData): string {
  if (row.startDate === null && row.dueDate === null) return "No plan";
  return `${row.startDate === null ? "…" : formatPlanDate(row.startDate, new Date(), VIEWER_LOCALE)} → ${row.dueDate === null ? "…" : formatPlanDate(row.dueDate, new Date(), VIEWER_LOCALE)}`;
}

/**
 * A row's name card on hover: key and title, status, plan. It stays while the
 * pointer moves onto it, and a click there opens the task. It is portalled,
 * so its pointer events are kept from the card the Gantt may sit on — they
 * would start a drag or open the card.
 */
function GanttRowTip({ row, onOpenTask, children }: { row: GanttRowData; onOpenTask?: (taskKey: string) => void; children: ReactNode }) {
  const body = (
    <>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 tabular-nums text-muted-foreground">{row.key}</span>
        <span className="truncate font-medium">{row.title}</span>
      </span>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <StatusIcon status={row.status} className="size-3" />
        {STATUS_LABEL[row.status]}
      </span>
      <span className="tabular-nums text-muted-foreground">{planText(row)}</span>
    </>
  );
  const keep = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        data-testid="gantt-row-tip"
        side="top"
        className="max-w-72 border border-border bg-popover p-0 text-popover-foreground shadow-md"
        onPointerDown={keep}
        onClick={keep}
      >
        {onOpenTask ? (
          <button
            type="button"
            className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left hover:bg-state-hover"
            onClick={() => onOpenTask(row.key)}
          >
            {body}
          </button>
        ) : (
          <span className="flex flex-col gap-0.5 px-2.5 py-1.5">{body}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
const MAX_WEEK_LABELS = 12;

export interface GanttChartProps {
  rows: readonly GanttRowData[];
  fromMs: number;
  toMs: number;
  mode: GanttMode;
  /** Bare lanes without names or week dates — a card's room. */
  compact?: boolean;
  onOpenTask?: (taskKey: string) => void;
}

export function GanttChart({ rows, fromMs, toMs, mode, compact = false, onOpenTask }: GanttChartProps) {
  const colors = useChartColors();
  // The row under the pointer, lit in the lanes and, on the analytics
  // screen, in the names down the left — hovering either lights both.
  const [hovered, setHovered] = useState<string | null>(null);
  const hover = (taskId: string) => ({
    onPointerEnter: () => setHovered(taskId),
    onPointerLeave: () => setHovered((current) => (current === taskId ? null : current)),
  });
  const lines = ganttLines(rows, fromMs, toMs, mode);
  const weeks = ganttWeeks(fromMs, toMs, MAX_WEEK_LABELS);
  if (lines.length === 0) {
    return compact ? null : <Empty>Nothing to draw for this period{mode === "fact" ? "" : " — plans need a start or due date"}</Empty>;
  }

  const rowHeight = compact ? "h-1.5" : "h-5";
  const lanes = (
    <div className="relative min-w-0 flex-1">
      {weeks.map((week) => (
        <span
          key={week.mondayMs}
          data-week-break
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-border"
          style={{ left: percent(week.at) }}
        />
      ))}
      <ul className={cn("relative flex flex-col", compact ? "gap-px" : "gap-0.5")}>
        {lines.map(({ row, plan, fact, doneAt }) => (
          <GanttRowTip key={row.taskId} row={row} onOpenTask={onOpenTask}>
            <li data-gantt-row className={cn("relative", rowHeight)} {...hover(row.taskId)}>
              {/* The row's hover, as a sub-task row lights up on the card: a
                  tint behind the bars, a little wider than the lane. */}
              {hovered === row.taskId ? (
                <span
                  data-gantt-hover
                  aria-hidden
                  className={cn("pointer-events-none absolute -inset-x-1 rounded-sm bg-state-hover", compact ? "-inset-y-px" : "inset-y-0")}
                />
              ) : null}
              {plan === null ? null : (
                <span
                  data-gantt-plan
                  className={cn("absolute rounded-sm border border-muted-foreground/70", compact ? "inset-y-0" : "inset-y-0.5")}
                  style={{ left: percent(plan.left), width: percent(plan.width) }}
                />
              )}
              {fact.map(({ status, bar }) => (
                <span
                  key={bar.left}
                  data-gantt-fact
                  className={cn("absolute rounded-sm", compact ? "inset-y-px" : plan === null ? "inset-y-1" : "inset-y-[7px]")}
                  style={{ left: percent(bar.left), width: percent(bar.width), backgroundColor: colors.status(status) }}
                />
              ))}
              {doneAt === null ? null : (
                <span
                  data-gantt-done
                  aria-label="Done"
                  className="pointer-events-none absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2"
                  style={{ left: percent(doneAt) }}
                >
                  <StatusIcon status="done" className={compact ? "size-2" : "size-3"} />
                </span>
              )}
            </li>
          </GanttRowTip>
        ))}
      </ul>
    </div>
  );
  if (compact) return <TooltipProvider delayDuration={150}>{lanes}</TooltipProvider>;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
        <div className="flex gap-2">
          <ul className="flex w-48 shrink-0 flex-col gap-0.5">
            {lines.map(({ row }) => (
              <li key={row.taskId} className="h-5" {...hover(row.taskId)}>
                <button
                  type="button"
                  className={cn(
                    "flex h-full w-full items-center gap-1.5 truncate rounded-sm px-1 text-left text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    hovered === row.taskId && "bg-state-hover",
                  )}
                  onClick={() => onOpenTask?.(row.key)}
                >
                  <span className="shrink-0 tabular-nums text-muted-foreground">{row.key}</span>
                  <span className="truncate text-foreground">{row.title}</span>
                </button>
              </li>
            ))}
          </ul>
          {lanes}
        </div>
      </div>
      {/* The week dates under the lanes, where every chart writes its dates. */}
      <div className="flex shrink-0 gap-2 pt-1">
        <span className="w-48 shrink-0" />
        <div className="relative h-3 min-w-0 flex-1 overflow-hidden">
          {weeks
            .filter((week) => week.labelled)
            .map((week) => (
              <span
                key={week.mondayMs}
                data-week-label
                className="absolute top-0 whitespace-nowrap pl-1 text-2xs leading-none text-subtle-foreground"
                style={{ left: percent(week.at) }}
              >
                {formatDay(week.mondayMs)}
              </span>
            ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
