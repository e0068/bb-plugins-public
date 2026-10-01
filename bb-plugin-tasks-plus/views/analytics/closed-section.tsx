// One "closed tasks" section of the analytics dashboard: a stacked column per
// hour or day, a segment per project, a legend, and — under the chart, in all
// the height the section has left — the tasks behind the segment the owner
// clicked. The shell half of closed-model.ts: every number here comes from
// there; this file only draws and keeps the selection.
import { useMemo, useState } from "react";

import type { ClosedTask, ClosedTasks } from "../../shared/contract.js";
import { ChartCard, edgeTicks, Empty, Legend, StackedBars, Swatch } from "./bars";
import { useChartColors } from "./chart-colors";
import { closingsIn, projectSeries, type ProjectSeries, type Segment, stackRows } from "./closed-model";

export interface ClosedSectionProps {
  title: string;
  /** Column edges from hourEdges/dayEdges — the same ones the data was fetched with. */
  edges: readonly number[];
  data: ClosedTasks;
  /** Renders a column's start as a tick and a list heading. */
  formatBin: (startMs: number) => string;
  onOpenTask: (taskKey: string) => void;
  /** px; a fixed chart width. Omitted, the chart fills the section. */
  chartWidth?: number;
}

export function ClosedSection({ title, edges, data, formatBin, onOpenTask, chartWidth }: ClosedSectionProps) {
  const [selected, setSelected] = useState<Segment | null>(null);
  const binCount = edges.length - 1;
  const rows = useMemo(() => stackRows(data.closings, binCount), [data.closings, binCount]);
  const colors = useChartColors();
  const series = useMemo(() => projectSeries(data.closings, data.projects, colors.project), [data.closings, data.projects, colors]);
  const logStartsInside = data.logStartMs !== null && data.logStartMs > edges[0]! && data.logStartMs < edges[binCount]!;
  const columnLabel = (bin: number) => formatBin(edges[bin]!);

  const toggle = (bin: number, projectId: string) =>
    setSelected((current) => (current?.bin === bin && current.projectId === projectId ? null : { bin, projectId }));

  return (
    <ChartCard title={title} aside={data.closings.length}>
      {data.closings.length === 0 ? (
        <Empty>No tasks closed in this window</Empty>
      ) : (
        <>
          <StackedBars
            columns={rows.map((row) => series.map((project) => row.counts[project.id] ?? 0))}
            series={series.map((project) => ({ id: project.id, label: project.name, color: project.color }))}
            columnLabel={columnLabel}
            ticks={edgeTicks(binCount, columnLabel)}
            selected={selected === null ? null : { column: selected.bin, seriesId: selected.projectId }}
            onSelect={toggle}
            width={chartWidth}
          />
          <Legend items={series.map((project) => ({ color: project.color, label: project.name }))} />
        </>
      )}

      {logStartsInside ? (
        <p className="text-2xs text-subtle-foreground">
          Transition log starts on {formatDay(data.logStartMs!)} — earlier closings are not recorded.
        </p>
      ) : null}

      {data.closings.length > 0 ? (
        <SegmentTasks
          segment={selected}
          tasks={selected ? closingsIn(data.closings, selected) : []}
          series={series}
          heading={selected ? formatBin(edges[selected.bin]!) : ""}
          onOpenTask={onOpenTask}
        />
      ) : null}
    </ChartCard>
  );
}

interface SegmentTasksProps {
  segment: Segment | null;
  tasks: readonly ClosedTask[];
  series: readonly ProjectSeries[];
  heading: string;
  onOpenTask: (taskKey: string) => void;
}

/** The list under the chart: takes whatever height the section has left and scrolls inside it. */
function SegmentTasks({ segment, tasks, series, heading, onOpenTask }: SegmentTasksProps) {
  if (segment === null) {
    return <p className="text-2xs text-subtle-foreground">Click a segment to see the tasks closed in it.</p>;
  }
  const project = series.find((entry) => entry.id === segment.projectId);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 border-t border-border pt-2">
      <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <Swatch color={project?.color ?? "var(--muted-foreground)"} />
        <span className="text-foreground">{project?.name ?? segment.projectId}</span>
        <span>· {heading}</span>
        <span className="tabular-nums">· {tasks.length}</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {tasks.map((task) => (
          <li key={task.taskId}>
            {task.key === null ? (
              // The task is gone from the board: nothing to open.
              <div className={`${ROW_CLASS} text-muted-foreground`}>
                <TaskRowBody keyLabel="—" task={task} />
              </div>
            ) : (
              <button type="button" onClick={() => onOpenTask(task.key!)} className={`${ROW_CLASS} hover:bg-state-hover`}>
                <TaskRowBody keyLabel={task.key} task={task} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const ROW_CLASS = "flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-xs";

function TaskRowBody({ keyLabel, task }: { keyLabel: string; task: ClosedTask }) {
  return (
    <>
      {/* A task without a board number shows its slug as the key — cap it so the title keeps the room. */}
      <span className="max-w-[40%] shrink-0 truncate tabular-nums text-muted-foreground">{keyLabel}</span>
      <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{formatHour(task.atMs)}</span>
    </>
  );
}

/** A column start or a closing time as the viewer's clock shows it, e.g. "14:00". */
export function formatHour(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** A day as the viewer's calendar shows it, e.g. "Sep 24". */
export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
