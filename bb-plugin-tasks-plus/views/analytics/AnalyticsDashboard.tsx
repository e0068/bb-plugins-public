// The analytics dashboard screen (BBPL-259): the customisable grid shell (1c)
// laid out with the chart primitives (1b), fed by the analytics RPC (2b).
// Filters by rolling window; the layout the user drags/resizes is remembered in
// panel state. This file is the imperative shell — every pure piece (default
// layout, window resolution) lives in ./default-dashboard, and the aggregation
// on the server.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TimeBin } from "../../packages/analytics-viz/core/binning";
import { WINDOWS } from "../../packages/analytics-viz/core/time-window";
import { LaneTimeline } from "../../packages/analytics-viz/react/lane-timeline";
import { DashboardGrid } from "./dashboard-grid";
import { type DashboardConfig, type DashboardSection, parseDashboard, serializeDashboard } from "./dashboard-layout";
import { TimeBarChart } from "./time-bar-chart";
import { TASK_STATUSES, type TaskStatus } from "../../db/types.js";
import type { StatusSeries, TasksSnapshot } from "../../shared/contract.js";
import { formatDollars, formatMinutes } from "../../shared/amounts.js";
import { useTasksQuery } from "../../client/data";
import {
  type AnalyticsFilter,
  DEFAULT_FILTER,
  defaultAnalyticsDashboard,
  seriesWindowFor,
} from "./default-dashboard";

const LAYOUT_KEY = "bb-plugins:tasks-plus:analytics:dashboard";

// Layout persistence is a convenience, not the feature: a private-mode / storage-off
// browser (or a stored value the schema no longer accepts) just falls back to the
// default rather than throwing. Reading is parsing through the zod schema, not casting.
function readSavedLayout(): DashboardConfig | null {
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (raw === null) return null;
    const parsed = parseDashboard(raw);
    return parsed.ok ? parsed.config : null;
  } catch {
    return null;
  }
}

function writeSavedLayout(config: DashboardConfig): void {
  const serialized = serializeDashboard(config);
  if (!serialized.ok) return; // fail closed: never persist a malformed layout
  try {
    window.localStorage.setItem(LAYOUT_KEY, serialized.json);
  } catch {
    // best-effort — remembering the layout is not essential
  }
}

// bb design-system tokens are full colours (e.g. `--primary: #2e6f95`), used
// exactly as the rest of the plugin does — `var(--x)`, never wrapped in hsl().
const STATUS_COLOR: Record<TaskStatus, string> = {
  backlog: "var(--muted-foreground)",
  todo: "var(--chart-1)",
  in_progress: "var(--primary)",
  in_review: "var(--ring)",
  done: "var(--success)",
  canceled: "var(--destructive)",
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  canceled: "Canceled",
};

/** Width of an element, tracked live — react-grid-layout and LaneTimeline need px, not a percentage. */
function useMeasuredWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function loadSavedDashboard(): DashboardConfig {
  return readSavedLayout() ?? defaultAnalyticsDashboard();
}

type AnalyticsData = { snapshot: TasksSnapshot; series: StatusSeries };

export function AnalyticsDashboard() {
  const [filter, setFilter] = useState<AnalyticsFilter>(DEFAULT_FILTER);
  const [dashboard, setDashboard] = useState<DashboardConfig>(loadSavedDashboard);
  const [gridRef, gridWidth] = useMeasuredWidth();

  const query = useTasksQuery<AnalyticsData>(
    async (rpc) => {
      const window = seriesWindowFor(filter, Date.now());
      const [snapshot, series] = await Promise.all([
        rpc.call("analyticsSnapshot", { projectId: filter.projectId }),
        rpc.call("analyticsSeries", { fromMs: window.fromMs, toMs: window.toMs, binMs: window.binMs, projectId: filter.projectId }),
      ]);
      return { snapshot, series } as AnalyticsData;
    },
    ["tasks:changed"],
    [filter.window, filter.projectId],
  );

  const onLayoutChange = useCallback((next: DashboardConfig) => {
    setDashboard(next);
    writeSavedLayout(next);
  }, []);

  const renderSection = useCallback(
    (section: DashboardSection) => <SectionBody kind={section.kind} data={query.data} />,
    [query.data],
  );

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-sm font-medium text-foreground">Analytics</h1>
        <WindowSwitch value={filter.window} onChange={(window) => setFilter((prev) => ({ ...prev, window }))} />
      </div>

      {query.error ? <p className="text-xs text-destructive">{query.error}</p> : null}

      <div ref={gridRef} className="min-h-0 flex-1 overflow-auto">
        {gridWidth > 0 ? (
          <DashboardGrid
            config={dashboard}
            width={gridWidth}
            rowHeight={40}
            onChange={onLayoutChange}
            renderSection={renderSection}
          />
        ) : null}
      </div>
    </div>
  );
}

function WindowSwitch({ value, onChange }: { value: AnalyticsFilter["window"]; onChange: (window: AnalyticsFilter["window"]) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
      {WINDOWS.map((window) => (
        <button
          key={window}
          type="button"
          onClick={() => onChange(window)}
          className={`rounded px-2 py-0.5 text-xs capitalize ${
            window === value ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {window}
        </button>
      ))}
    </div>
  );
}

function SectionBody({ kind, data }: { kind: string; data: AnalyticsData | undefined }) {
  if (data === undefined) return <div className="h-full w-full animate-pulse rounded-md bg-muted/40" />;
  switch (kind) {
    case "status-snapshot":
      return <StatusSnapshot data={data} />;
    case "throughput":
      return <ThroughputChart data={data} />;
    case "status-distribution":
      return <StatusDistribution data={data} />;
    default:
      return <div className="p-2 text-xs text-muted-foreground">Unknown section: {kind}</div>;
  }
}

function StatusSnapshot({ data }: { data: AnalyticsData }) {
  return (
    <div className="flex h-full flex-wrap items-center gap-2 overflow-auto rounded-md border border-border p-2">
      <Tile label="Total" value={data.snapshot.total} />
      {TASK_STATUSES.map((status) => (
        <Tile key={status} label={STATUS_LABEL[status]} value={data.snapshot.byStatus[status] ?? 0} />
      ))}
      <Tile label="Planned Time" value={formatMinutes(data.snapshot.plannedMinutes)} />
      <Tile label="Actual Time" value={formatMinutes(data.snapshot.actualMinutes)} />
      <Tile label="Budget" value={formatDollars(data.snapshot.budget)} />
      <Tile label="Limit" value={formatDollars(data.snapshot.budgetLimit)} />
      <Tile label="Cost" value={formatDollars(data.snapshot.cost)} />
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-[72px] rounded-md bg-muted/40 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="tabular-nums text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function ThroughputChart({ data }: { data: AnalyticsData }) {
  const bins: TimeBin[] = data.series.bins.map((startMs, index) => ({ startMs, value: data.series.total[index] ?? 0 }));
  const hasChanges = bins.some((bin) => bin.value > 0);
  return (
    <div className="h-full w-full rounded-md border border-border p-2 text-primary">
      <div className="mb-1 text-xs text-muted-foreground">Status changes over time</div>
      {hasChanges ? (
        <TimeBarChart bins={bins} height={140} formatTime={formatBinTime} formatValue={(value) => String(value)} />
      ) : (
        // The transition log starts at install and is not backfilled, so a fresh
        // install legitimately has nothing to draw — say so instead of showing
        // an empty axis that reads as broken.
        <p className="py-6 text-center text-xs text-muted-foreground">
          No status changes recorded in this window yet. The log starts at install — bars appear as tasks change status.
        </p>
      )}
    </div>
  );
}

function StatusDistribution({ data }: { data: AnalyticsData }) {
  const [ref, width] = useMeasuredWidth();
  const items = TASK_STATUSES.map((status) => ({
    key: status,
    weight: data.snapshot.byStatus[status] ?? 0,
    color: STATUS_COLOR[status],
    label: `${STATUS_LABEL[status]}: ${data.snapshot.byStatus[status] ?? 0}`,
  }));
  return (
    <div className="flex h-full flex-col gap-2 rounded-md border border-border p-2">
      <div className="text-xs text-muted-foreground">Status distribution</div>
      <div ref={ref} className="w-full">
        {width > 0 ? <LaneTimeline items={items} width={width} height={16} ariaLabel="Status distribution" /> : null}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {TASK_STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-1">
            <span className="inline-block size-2 rounded-sm" style={{ backgroundColor: STATUS_COLOR[status] }} />
            {STATUS_LABEL[status]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatBinTime(startMs: number): string {
  return new Date(startMs).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
}
