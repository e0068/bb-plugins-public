import type { TaskStatus } from "../../shared/enums.js";
import type { SubtreeProgress } from "../../shared/subtree.js";
import { trendOf } from "../../analytics/trend.js";
import { formatDay } from "../analytics/closed-model.js";
import { placeIn, type TimeWindow } from "./chart-window.js";
import { DateAxis } from "./date-axis.js";
import type { DateTick } from "./date-ticks.js";
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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Up to this many days back the chart says "N d ago"; further back it names the first day. */
const DAYS_SPOKEN = 31;

/** How far back the window looks from now, in words: minutes, hours, days, or the first day; today when it opens at now. */
function lookBack({ fromMs }: TimeWindow, nowMs: number): string {
  const backMs = nowMs - fromMs;
  if (backMs < MINUTE_MS) return "today";
  if (backMs < HOUR_MS) return `${Math.round(backMs / MINUTE_MS)} min ago`;
  if (backMs < DAY_MS) return `${Math.round(backMs / HOUR_MS)} h ago`;
  const days = Math.round(backMs / DAY_MS);
  return days <= DAYS_SPOKEN ? `${days} d ago` : `since ${formatDay(fromMs)}`;
}

/** A forecast in words, rounded up: minutes under an hour, hours under a day, days after. */
function timeLeft(ms: number): string {
  if (ms < HOUR_MS) return `${Math.ceil(ms / MINUTE_MS)} min`;
  if (ms < DAY_MS) return `${Math.ceil(ms / HOUR_MS)} h`;
  return `${Math.ceil(ms / DAY_MS)} d`;
}

/**
 * Open tasks under a card at each read, the trend dashed, and when it
 * reaches zero — drawn by time across the card's window, as the card's
 * Gantt is, so today falls at the same spot in both: a line at today when it
 * stands inside the window, the trend alone running on past it. A line
 * stands at each date, written under the chart unless the card writes its
 * dates along its bottom.
 */
export function BurndownChart({
  open,
  ends,
  window,
  nowMs,
  ticks,
  showDates,
  forecastMs,
}: {
  open: readonly number[];
  /** The moment each value was read at, oldest first; the last is now. */
  ends: readonly number[];
  /** The stretch of time the card's charts draw. */
  window: TimeWindow;
  nowMs: number;
  /** The dates across the window, each with a line. */
  ticks: readonly DateTick[];
  /** Whether the dates are written under this chart. */
  showDates: boolean;
  /** How long the trend needs to reach zero; null while it does not fall. */
  forecastMs: number | null;
}) {
  const x = (ms: number) => placeIn(window, ms) * CHART.width;
  // The reads inside the window, and the one before it, so the line enters
  // from the left edge; the svg cuts what lies outside.
  const firstRead = Math.max(0, ends.findIndex((end) => end >= window.fromMs) - 1);
  const reads = open.map((value, index) => ({ value, ms: ends[index]! })).slice(firstRead);
  const columnMs = ends.length > 1 ? ends[1]! - ends[0]! : DAY_MS;
  const trend = trendOf(open);
  // The trend is fitted to every read by its index; a moment sits that many columns past the first read.
  const trendAt = (ms: number) => Math.max(0, trend === null ? 0 : trend.start + trend.slope * ((ms - ends[0]!) / columnMs));
  const trendFromMs = Math.max(window.fromMs, ends[0] ?? window.fromMs);
  const ahead = nowMs < window.toMs;
  // Ahead of today the trend may stand above every read shown.
  const max = Math.max(...reads.map((read) => read.value), ahead ? Math.max(trendAt(trendFromMs), trendAt(window.toMs)) : 0, 1);
  const y = (value: number) => CHART.height - CHART.pad - (value / max) * (CHART.height - 2 * CHART.pad);
  const line = reads.map((read) => `${x(read.ms)},${y(read.value)}`).join(" ");
  const area = reads.length === 0 ? "" : `${x(reads[0]!.ms)},${y(0)} ${line} ${x(reads.at(-1)!.ms)},${y(0)}`;
  const last = open[open.length - 1] ?? 0;
  return (
    <div className="flex flex-col gap-0.5">
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        preserveAspectRatio="none"
        aria-hidden
        className="h-9 w-full overflow-hidden"
      >
        {ticks.map((tick) => (
          <line
            key={tick.ms}
            data-date-grid
            x1={tick.at * CHART.width}
            y1={0}
            x2={tick.at * CHART.width}
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
        {nowMs > window.fromMs && ahead ? (
          <line
            data-burndown-today
            x1={x(nowMs)}
            y1={0}
            x2={x(nowMs)}
            y2={CHART.height}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            style={{ stroke: "var(--primary)" }}
          />
        ) : null}
        {trend === null ? null : (
          <line
            data-burndown-trend
            x1={x(trendFromMs)}
            y1={y(trendAt(trendFromMs))}
            x2={x(ahead ? window.toMs : nowMs)}
            y2={y(trendAt(ahead ? window.toMs : nowMs))}
            strokeWidth={1}
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
            style={{ stroke: "var(--muted-foreground)" }}
          />
        )}
      </svg>
      {showDates ? <DateAxis ticks={ticks} /> : null}
      <div className="flex justify-between text-[10px] text-subtle-foreground tabular-nums">
        <span>{lookBack(window, nowMs)}</span>
        <span>{forecastMs === null ? `${last} open` : `${last} open · ~${timeLeft(forecastMs)} left`}</span>
      </div>
    </div>
  );
}
