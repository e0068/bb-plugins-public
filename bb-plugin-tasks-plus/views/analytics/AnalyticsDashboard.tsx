// The analytics screen: header with the project filter and the D/W/M/All cut,
// the figure strip, then rows of sections that stay where they are — only
// the splitters between and under them resize (row-board.tsx), and the sizes
// are remembered. Laid out after Usage Analytics. This file is the shell:
// it asks the server, keeps the filter and the sizes, and hands numbers to
// the sections; every pure piece lives in the modules it imports.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { weekBreaks } from "@bb-plugins/analytics-viz/core/weeks";
import { Button } from "../../components/ui/button";
import type { ClosedTasks, ClosedWindows, FlowAnswer, GanttAnswer, TasksSnapshot } from "../../shared/contract.js";
import { GANTT_MODES, type GanttMode } from "../../shared/enums.js";
import { useTasksQuery } from "../../client/data";
import { useTasksNavigation } from "../../client/routes.js";
import { ChartCard, Swatch, WeekBreaksScope, type ColumnWeekBreak } from "./bars";
import { ChartColorsScope, useChartColors } from "./chart-colors";
import { dayEdges, hourEdges } from "./closed-model";
import { ClosedSection, formatDay, formatHour } from "./closed-section";
import {
  ANALYTICS_WINDOWS,
  type AnalyticsFilter,
  type AnalyticsWindow,
  columnDays,
  DEFAULT_FILTER,
  defaultAnalyticsRows,
  type SectionKind,
  weekBreaksOf,
  weekEdges,
  windowEdges,
} from "./default-dashboard";
import {
  Aging,
  Burndown,
  ClosedByType,
  CostByProject,
  CreatedClosed,
  CycleTime,
  EstimateAccuracy,
  KpiStrip,
  StatusChanges,
  WorkInProgress,
} from "./flow-sections";
import { GanttChart } from "./gantt-chart";
import { RowBoard } from "./row-board";
import { useSavedLayout } from "./saved-layout";

const LAYOUT_KEY = "bb-plugins:tasks-plus:analytics:rows";

const DEFAULT_ROWS = defaultAnalyticsRows();

/** Below this width the rows stack into one column. */
const STACK_BELOW_PX = 768;

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

const HOUR_CHECK_MS = 60_000;

/** Start of the viewer's current local hour — the last column of the hourly charts. */
const currentHourStart = () => hourEdges(Date.now())[23]!;

/** The current local hour, re-read every minute — the charts refetch when it rolls over. */
function useCurrentHour(): number {
  const [hour, setHour] = useState(currentHourStart);
  useEffect(() => {
    const timer = window.setInterval(() => setHour(currentHourStart()), HOUR_CHECK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return hour;
}

/** Closed tasks of one chart, with the column edges they were fetched for. */
type ClosedWindow = { edges: number[]; data: ClosedTasks };

interface AnalyticsData {
  nowMs: number;
  edges: number[];
  weeks: number[];
  snapshot: TasksSnapshot;
  flow: FlowAnswer;
  hourly: ClosedWindow;
  daily: ClosedWindow;
  gantt: GanttAnswer;
}

const WINDOW_TITLE: Record<AnalyticsWindow, string> = { day: "Day", week: "Week", month: "Month", all: "All time" };

/** A project chip's swatch — the project's colour on the charts, Reduced Colors applied. */
function ProjectSwatch({ index }: { index: number }) {
  return <Swatch color={useChartColors().project(index)} />;
}

export function AnalyticsDashboard() {
  const [filter, setFilter] = useState<AnalyticsFilter>(DEFAULT_FILTER);
  const [layout, setLayout] = useSavedLayout(LAYOUT_KEY, DEFAULT_ROWS);
  const [pageRef, pageWidth] = useMeasuredWidth();
  const navigation = useTasksNavigation();
  const hour = useCurrentHour();

  const query = useTasksQuery<AnalyticsData>(
    async (rpc) => {
      const nowMs = Date.now();
      const projectIds = [...filter.projectIds];
      // All time opens at the first task, which only the server knows.
      const firstMs = filter.window === "all" ? ((await rpc.call("analyticsSpan", { projectIds })).firstCreatedMs ?? nowMs) : nowMs;
      const edges = windowEdges(filter.window, nowMs, firstMs);
      const weeks = weekEdges(nowMs);
      const closedEdges = [hourEdges(nowMs), dayEdges(nowMs)];
      const [snapshot, flow, closed, gantt] = await Promise.all([
        rpc.call("analyticsSnapshot", { projectIds }),
        rpc.call("analyticsFlow", { edges, weekEdges: weeks, projectIds }),
        rpc.call("analyticsClosed", { windows: closedEdges, projectIds }),
        rpc.call("ganttRows", { fromMs: edges[0]!, projectIds }),
      ]);
      const answer = closed as ClosedWindows;
      const chart = (index: number): ClosedWindow => ({
        edges: closedEdges[index]!,
        data: { closings: answer.windows[index]?.closings ?? [], projects: answer.projects, logStartMs: answer.logStartMs },
      });
      return { nowMs, edges, weeks, snapshot, flow, hourly: chart(0), daily: chart(1), gantt } as AnalyticsData;
    },
    ["tasks:changed"],
    [filter.window, filter.projectIds, hour],
  );

  const openTask = useCallback((taskKey: string) => navigation.go({ kind: "task", taskKey }), [navigation]);

  const toggleProject = (projectId: string) =>
    setFilter((current) => ({
      ...current,
      projectIds: current.projectIds.includes(projectId)
        ? current.projectIds.filter((id) => id !== projectId)
        : [...current.projectIds, projectId],
    }));

  const data = query.data;
  const projects = data?.flow.projects ?? [];

  return (
    <ChartColorsScope boardProjects={projects.length}>
      <div ref={pageRef} className="h-full overflow-y-auto">
        <div className="flex min-h-full flex-col gap-6 px-6 py-8">
          <header className="space-y-1">
            <h1 className="text-lg font-semibold text-foreground">Analytics</h1>
            <p className="text-sm text-muted-foreground">Tasks across your boards — how statuses move, what is left and what got closed</p>
          </header>

          <section className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-4">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Projects">
              <Button
                type="button"
                size="sm"
                variant={filter.projectIds.length === 0 ? "default" : "outline"}
                aria-pressed={filter.projectIds.length === 0}
                onClick={() => setFilter((current) => ({ ...current, projectIds: [] }))}
              >
                All projects
              </Button>
              {projects.map((project, index) => (
                <Button
                  key={project.id}
                  type="button"
                  size="sm"
                  variant={filter.projectIds.includes(project.id) ? "default" : "outline"}
                  aria-pressed={filter.projectIds.includes(project.id)}
                  onClick={() => toggleProject(project.id)}
                >
                  <ProjectSwatch index={index} />
                  {project.name}
                </Button>
              ))}
            </div>
            <div className="ml-auto flex gap-1" role="group" aria-label="Period">
              {ANALYTICS_WINDOWS.map((window) => (
                <Button
                  key={window}
                  type="button"
                  size="sm"
                  variant={filter.window === window ? "default" : "outline"}
                  aria-pressed={filter.window === window}
                  onClick={() => setFilter((current) => ({ ...current, window }))}
                >
                  {WINDOW_TITLE[window]}
                </Button>
              ))}
            </div>
          </section>

          {query.error ? <p className="text-xs text-destructive">{query.error}</p> : null}

          {data === undefined ? <div className="h-14 animate-pulse rounded-md bg-muted/40" /> : <KpiStrip snapshot={data.snapshot} flow={data.flow} />}

          {pageWidth > 0 ? (
            <RowBoard
              layout={layout}
              stacked={pageWidth < STACK_BELOW_PX}
              onChange={setLayout}
              renderCell={(id) => (data === undefined ? <Pulse /> : <Section kind={id as SectionKind} data={data} window={filter.window} onOpenTask={openTask} />)}
            />
          ) : null}
        </div>
      </div>
    </ChartColorsScope>
  );
}

function Pulse() {
  return <div className="h-full w-full animate-pulse rounded-md bg-muted/40" />;
}

interface SectionProps {
  kind: SectionKind;
  data: AnalyticsData;
  window: AnalyticsWindow;
  onOpenTask: (taskKey: string) => void;
}

/** Week breaks of a chart's columns, labelled by their Monday. */
const labelled = (breaks: readonly { column: number; mondayMs: number }[]): ColumnWeekBreak[] =>
  breaks.map(({ column, mondayMs }) => ({ column, label: formatDay(mondayMs) }));

function Section({ kind, data, window, onOpenTask }: SectionProps): ReactNode {
  const columnLabel = (column: number) => {
    const start = data.edges[column]!;
    switch (window) {
      case "day":
        return formatHour(start);
      case "week":
      case "month":
        return formatDay(start);
      case "all":
        return `Week of ${formatDay(start)}`;
    }
  };
  const weekLabel = (week: number) => `Week of ${formatDay(data.weeks[week]!)}`;
  const windowBreaks = labelled(weekBreaksOf(window, data.edges));
  const inWeeks = (chart: ReactNode) => <WeekBreaksScope breaks={windowBreaks}>{chart}</WeekBreaksScope>;
  switch (kind) {
    case "changes":
      return inWeeks(<StatusChanges flow={data.flow} columnLabel={columnLabel} />);
    case "burndown":
      return inWeeks(<Burndown flow={data.flow} columnLabel={columnLabel} columnsPerDay={1 / columnDays(window)} />);
    case "closed-hourly":
    case "closed-daily": {
      const hourly = kind === "closed-hourly";
      const chart = hourly ? data.hourly : data.daily;
      return (
        // Keyed by the first column: when the window rolls over, a picked
        // segment would point at a different hour or day, so the pick resets.
        // Days mark their weeks; hours are too fine for it.
        <WeekBreaksScope breaks={hourly ? [] : labelled(weekBreaks(chart.edges.slice(0, -1)))}>
          <ClosedSection
            key={chart.edges[0]}
            title={hourly ? "Closed — last 24 hours" : "Closed — last 30 days"}
            edges={chart.edges}
            data={chart.data}
            formatBin={hourly ? formatHour : formatDay}
            onOpenTask={onOpenTask}
          />
        </WeekBreaksScope>
      );
    }
    case "created-closed":
      return inWeeks(<CreatedClosed flow={data.flow} columnLabel={columnLabel} />);
    case "wip":
      return inWeeks(<WorkInProgress flow={data.flow} columnLabel={columnLabel} />);
    case "cycle":
      return <CycleTime rows={data.flow.cycle} />;
    case "accuracy":
      return <EstimateAccuracy rows={data.flow.accuracy} />;
    case "cost":
      return <CostByProject costs={data.flow.costByProject} projects={data.flow.projects} />;
    case "aging":
      return <Aging entries={data.flow.aging} projects={data.flow.projects} nowMs={data.nowMs} onOpenTask={onOpenTask} />;
    case "types":
      return <ClosedByType weeks={data.flow.typesByWeek} weekLabel={weekLabel} />;
    case "gantt":
      return <GanttSection rows={data.gantt.rows} fromMs={data.edges[0]!} toMs={data.nowMs} onOpenTask={onOpenTask} />;
  }
}

const GANTT_MODE_TITLE: Record<GanttMode, string> = { plan: "Plan", fact: "Fact", both: "Both" };

/** The tasks of the period on a Gantt, the plan, the facts or both at the owner's pick. */
function GanttSection({
  rows,
  fromMs,
  toMs,
  onOpenTask,
}: {
  rows: GanttAnswer["rows"];
  fromMs: number;
  toMs: number;
  onOpenTask: (taskKey: string) => void;
}) {
  const [mode, setMode] = useState<GanttMode>("fact");
  return (
    <ChartCard
      title="Gantt"
      aside={
        <span className="inline-flex gap-1" role="group" aria-label="Gantt shows">
          {GANTT_MODES.map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              className="h-6 px-2"
              variant={mode === option ? "default" : "outline"}
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
            >
              {GANTT_MODE_TITLE[option]}
            </Button>
          ))}
        </span>
      }
    >
      <GanttChart rows={rows} fromMs={fromMs} toMs={toMs} mode={mode} onOpenTask={onOpenTask} />
    </ChartCard>
  );
}
