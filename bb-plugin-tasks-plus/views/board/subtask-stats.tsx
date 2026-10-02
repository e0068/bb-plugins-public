import { weekBreaks, type WeekBreak } from "@bb-plugins/analytics-viz/core/weeks";
import { ALL_TIME, type CardChartPeriod, type TaskStatus } from "../../shared/enums.js";
import type { SubtreeProgress } from "../../shared/subtree.js";
import { trendOf } from "../../analytics/trend.js";
import { formatDay } from "../analytics/closed-model.js";
import { STATUS_LABELS } from "./icons.js";

/** The bar's order, closest to done first; canceled work is not work and stays off it. */
const BAR_STATUSES = ["done", "in_review", "in_progress", "todo", "backlog"] as const satisfies readonly TaskStatus[];

/** Status colours are bb's own variables, as the status icons use them. */
const BAR_COLORS: Record<(typeof BAR_STATUSES)[number], string> = {
  done: "var(--success)",
  in_review: "var(--timeline-accent)",
  in_progress: "var(--attention)",
  todo: "color-mix(in oklch, var(--muted-foreground) 45%, transparent)",
  backlog: "color-mix(in oklch, var(--muted-foreground) 25%, transparent)",
};

/** How the tasks under a card spread over the statuses, with the share done. */
export function SubtaskStats({ progress }: { progress: SubtreeProgress }) {
  const shown = BAR_STATUSES.filter((status) => progress.byStatus[status] > 0);
  const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  return (
    <div className="flex items-center gap-2 text-2xs text-muted-foreground">
      <span
        role="img"
        aria-label={`${percent}% done`}
        title={shown.map((status) => `${STATUS_LABELS[status]} ${progress.byStatus[status]}`).join(" · ")}
        className="flex h-1 flex-1 gap-px overflow-hidden rounded-full bg-muted"
      >
        {shown.map((status) => (
          <span
            key={status}
            className="h-full"
            style={{ width: `${(progress.byStatus[status] / progress.total) * 100}%`, backgroundColor: BAR_COLORS[status] }}
          />
        ))}
      </span>
      <span className="tabular-nums">{percent}%</span>
    </div>
  );
}

const CHART = { width: 208, height: 36, pad: 2 } as const;

const DAY_MS = 86_400_000;
/** Up to this many days back the chart says "N d ago"; further back it names the first day. */
const DAYS_SPOKEN = 31;

/** Where a new week starts along the chart: day columns only — on week columns every column is a week. */
export function cardWeekBreaks(period: CardChartPeriod, ends: readonly number[]): WeekBreak[] {
  return period === ALL_TIME ? [] : weekBreaks(ends);
}

/** How far back the chart looks, in words. */
function lookBack(ends: readonly number[]): string {
  const first = ends[0] ?? 0;
  const days = Math.round(((ends[ends.length - 1] ?? first) - first) / DAY_MS);
  return days <= DAYS_SPOKEN ? `${days} d ago` : `since ${formatDay(first)}`;
}

/** Open tasks under a card at each column end, the trend dashed, each new week marked, and when it reaches zero. */
export function BurndownChart({
  open,
  ends,
  period,
  forecastDays,
}: {
  open: readonly number[];
  /** The moment each value was read at, oldest first. */
  ends: readonly number[];
  period: CardChartPeriod;
  forecastDays: number | null;
}) {
  const max = Math.max(...open, 1);
  const step = (CHART.width - 2 * CHART.pad) / Math.max(open.length - 1, 1);
  const x = (index: number) => CHART.pad + index * step;
  const y = (value: number) => CHART.height - CHART.pad - (value / max) * (CHART.height - 2 * CHART.pad);
  const line = open.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const area = `${x(0)},${y(0)} ${line} ${x(open.length - 1)},${y(0)}`;
  const last = open[open.length - 1] ?? 0;
  const trend = trendOf(open);
  const trendAt = (index: number) => Math.max(0, trend === null ? 0 : trend.start + trend.slope * index);
  // A Monday lies between two reads: placed by its time between them.
  const weeks = cardWeekBreaks(period, ends).map(({ column, mondayMs }) => {
    const from = ends[column - 1]!;
    return { mondayMs, at: x(column - 1) + ((mondayMs - from) / (ends[column]! - from)) * step };
  });
  return (
    <div className="flex flex-col gap-0.5">
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        preserveAspectRatio="none"
        aria-hidden
        className="h-9 w-full"
      >
        {weeks.map((week) => (
          <line
            key={week.mondayMs}
            data-week-break
            x1={week.at}
            y1={0}
            x2={week.at}
            y2={CHART.height}
            strokeWidth={1}
            strokeDasharray="1 2"
            vectorEffect="non-scaling-stroke"
            style={{ stroke: "var(--border)" }}
          />
        ))}
        <polygon points={area} style={{ fill: "color-mix(in oklch, var(--timeline-accent) 14%, transparent)" }} />
        <polyline
          points={line}
          fill="none"
          strokeWidth={1.4}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          style={{ stroke: "var(--timeline-accent)" }}
        />
        {trend === null ? null : (
          <line
            x1={x(0)}
            y1={y(trendAt(0))}
            x2={x(open.length - 1)}
            y2={y(trendAt(open.length - 1))}
            strokeWidth={1}
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
            style={{ stroke: "var(--muted-foreground)" }}
          />
        )}
      </svg>
      {weeks.length === 0 ? null : (
        <div aria-hidden className="relative h-3 text-[10px] leading-3 text-subtle-foreground tabular-nums">
          {weeks.map((week) => (
            <span
              key={week.mondayMs}
              data-week-label
              className="absolute -translate-x-1/2 whitespace-nowrap"
              style={{ left: `${(week.at / CHART.width) * 100}%` }}
            >
              {formatDay(week.mondayMs)}
            </span>
          ))}
        </div>
      )}
      <div className="flex justify-between text-[10px] text-subtle-foreground tabular-nums">
        <span>{lookBack(ends)}</span>
        <span>{forecastDays === null ? `${last} open` : `${last} open · ~${forecastDays} d left`}</span>
      </div>
    </div>
  );
}
