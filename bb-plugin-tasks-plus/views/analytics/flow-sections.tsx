// The flow sections of the analytics screen, drawn over analytics/flow.ts's
// answer in Usage Analytics' manner: the figure strip, status changes, the
// burndown with its forecast, created against closed, work in progress,
// cycle time, estimate accuracy, spend by project, stuck tasks and closings
// by type. Numbers come from the server and flow-model.ts; this file draws.
import { useState } from "react";

import { TASK_STATUSES, TASK_TYPES, type TaskStatus } from "../../db/types.js";
import { formatDollars, formatMinutes } from "../../shared/amounts.js";
import type { FlowAnswer, TasksSnapshot } from "../../shared/contract.js";
import { cn } from "../../lib/utils";
import { ChartCard, DivergingBars, edgeTicks, Empty, Legend, StackedBars, Swatch, type BarSeries } from "./bars";
import { useChartColors, type ChartColors } from "./chart-colors";
import { OPEN_STATUSES, formatDuration, openByColumn, trendOf, wipByColumn } from "./flow-model";
import { STATUS_LABEL } from "./palette";

type Projects = FlowAnswer["projects"];
type ColumnLabel = (column: number) => string;

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const colorOf = (colors: ChartColors, projects: Projects, projectId: string) =>
  colors.project(projects.findIndex((project) => project.id === projectId));
const nameOf = (projects: Projects, projectId: string) => projects.find((project) => project.id === projectId)?.name ?? projectId;
const statusSeries = (colors: ChartColors, statuses: readonly TaskStatus[]): BarSeries[] =>
  statuses.map((status) => ({ id: status, label: STATUS_LABEL[status], color: colors.status(status) }));
const signed = (value: number, digits = 0) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;

/* ---------- figures ---------- */

function Figure({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div data-kpi className="w-27 shrink-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div data-value className="text-xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
      {note === undefined ? null : <div className="text-2xs text-subtle-foreground">{note}</div>}
    </div>
  );
}

/** The figure strip: work, the period, time and money — groups apart, every figure one width. */
export function KpiStrip({ snapshot, flow }: { snapshot: TasksSnapshot; flow: FlowAnswer }) {
  const open = sum(OPEN_STATUSES.map((status) => snapshot.byStatus[status] ?? 0));
  const spent = snapshot.budget > 0 ? `${Math.round((snapshot.cost / snapshot.budget) * 100)}% of budget` : undefined;
  return (
    <section aria-label="Figures" className="flex flex-wrap gap-x-6 gap-y-4">
      <div className="flex flex-wrap gap-y-4">
        <Figure label="Open" value={open} note={`of ${snapshot.total}`} />
        <Figure label="In progress" value={snapshot.byStatus.in_progress ?? 0} />
        <Figure label="In review" value={snapshot.byStatus.in_review ?? 0} />
        <Figure label="Done" value={snapshot.byStatus.done ?? 0} />
      </div>
      <div className="flex flex-wrap gap-y-4">
        <Figure label="Created" value={sum(flow.created)} note="this period" />
        <Figure label="Closed" value={sum(flow.closed)} note="this period" />
        <Figure label="Median cycle" value={flow.medianCycleMs === null ? "—" : formatDuration(flow.medianCycleMs)} note="in progress → done" />
      </div>
      <div className="flex flex-wrap gap-y-4">
        <Figure label="Planned time" value={formatMinutes(snapshot.plannedMinutes)} />
        <Figure label="Actual time" value={formatMinutes(snapshot.actualMinutes)} />
      </div>
      <div className="flex flex-wrap gap-y-4">
        <Figure label="Budget" value={formatDollars(snapshot.budget)} />
        <Figure label="Cost" value={formatDollars(snapshot.cost)} note={spent} />
        <Figure label="Limit" value={formatDollars(snapshot.budgetLimit)} />
      </div>
    </section>
  );
}

/* ---------- series ---------- */

export function StatusChanges({ flow, columnLabel }: { flow: FlowAnswer; columnLabel: ColumnLabel }) {
  const colors = useChartColors();
  const series = statusSeries(colors, TASK_STATUSES);
  const total = sum(flow.changes.map((counts) => sum(TASK_STATUSES.map((status) => counts[status] ?? 0))));
  return (
    <ChartCard title="Status changes" aside={`${total} moves`}>
      {total === 0 ? (
        <Empty>No status changes recorded in this period. The log starts at install — bars appear as tasks move.</Empty>
      ) : (
        <>
          <StackedBars
            columns={flow.changes.map((counts) => TASK_STATUSES.map((status) => counts[status] ?? 0))}
            series={series.map((entry) => ({ ...entry, label: `→ ${entry.label}` }))}
            columnLabel={columnLabel}
            ticks={edgeTicks(flow.changes.length, columnLabel)}
          />
          <Legend items={series} />
        </>
      )}
    </ChartCard>
  );
}

/** The project with the most open work at the end of the period. */
function busiest(flow: FlowAnswer): string | undefined {
  const open = (projectId: string) => openByColumn(flow.statusByBin, projectId).at(-1) ?? 0;
  return Object.keys(flow.statusByBin).sort((a, b) => open(b) - open(a))[0];
}

/**
 * What is left in one project, column by column, stacked by open status,
 * with a least-squares trend and — while it burns down — when it empties.
 */
export function Burndown({ flow, columnLabel, columnsPerDay }: { flow: FlowAnswer; columnLabel: ColumnLabel; columnsPerDay: number }) {
  const colors = useChartColors();
  const [picked, setPicked] = useState<string | null>(null);
  const withTasks = flow.projects.filter((project) => flow.statusByBin[project.id] !== undefined);
  const projectId = picked !== null && flow.statusByBin[picked] !== undefined ? picked : busiest(flow);
  if (projectId === undefined) {
    return (
      <ChartCard title="Burndown">
        <Empty>No tasks in the picked projects.</Empty>
      </ChartCard>
    );
  }

  const rows = flow.statusByBin[projectId]!;
  const open = openByColumn(flow.statusByBin, projectId);
  const left = open.at(-1) ?? 0;
  const trend = trendOf(open);
  const perDay = trend === null ? 0 : trend.slope * columnsPerDay;
  const max = Math.max(1, ...open);
  const lastColumn = open.length - 1;
  const trendLine =
    trend === null ? null : (
      <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line
          x1={50 / open.length}
          x2={100 - 50 / open.length}
          y1={100 - (trend.start / max) * 100}
          y2={100 - ((trend.start + trend.slope * lastColumn) / max) * 100}
          stroke="var(--foreground)"
          strokeOpacity={0.7}
          strokeWidth={1.2}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );

  return (
    <ChartCard title="Burndown" aside="open tasks">
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {withTasks.map((project) => (
          <button
            key={project.id}
            type="button"
            aria-pressed={project.id === projectId}
            onClick={() => setPicked(project.id)}
            className={cn(
              "flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-2 text-2xs text-muted-foreground hover:bg-state-hover hover:text-foreground",
              project.id === projectId && "bg-state-active text-foreground",
            )}
          >
            <Swatch color={colorOf(colors, flow.projects, project.id)} />
            {project.name}
          </button>
        ))}
      </div>
      <div className="flex items-baseline gap-3 text-xs text-muted-foreground">
        <span className="text-base font-semibold tabular-nums text-foreground">{`${left} open`}</span>
        {perDay < 0 ? <span className="text-success">{`${signed(perDay, 1)} / day`}</span> : null}
        <span className="ml-auto">{perDay < 0 ? `empty in ~${Math.ceil(left / -perDay)} days` : "not burning down"}</span>
      </div>
      <StackedBars
        columns={rows.map((counts) => OPEN_STATUSES.map((status) => counts[status]))}
        series={statusSeries(colors, OPEN_STATUSES)}
        columnLabel={(column) => `${columnLabel(column)} · ${open[column] ?? 0} open`}
        ticks={edgeTicks(rows.length, columnLabel)}
        overlay={trendLine}
      />
      <Legend items={[...statusSeries(colors, OPEN_STATUSES), ...(trendLine === null ? [] : [{ label: "Trend", color: "var(--foreground)" }])]} />
    </ChartCard>
  );
}

export function CreatedClosed({ flow, columnLabel }: { flow: FlowAnswer; columnLabel: ColumnLabel }) {
  const { createdClosed } = useChartColors();
  const net = sum(flow.created) - sum(flow.closed);
  const up = { label: "Created", color: createdClosed.created, values: flow.created };
  const down = { label: "Closed", color: createdClosed.closed, values: flow.closed };
  return (
    <ChartCard title="Created vs closed" aside={<span className={net < 0 ? "text-success" : undefined}>{`net ${signed(net)}`}</span>}>
      <DivergingBars up={up} down={down} columnLabel={columnLabel} ticks={edgeTicks(flow.created.length, columnLabel)} />
      <Legend items={[up, down]} />
    </ChartCard>
  );
}

export function WorkInProgress({ flow, columnLabel }: { flow: FlowAnswer; columnLabel: ColumnLabel }) {
  const colors = useChartColors();
  const wip = wipByColumn(flow.statusByBin, flow.created.length);
  const [progress, review] = wip.at(-1) ?? [0, 0];
  const series = statusSeries(colors, ["in_progress", "in_review"]);
  return (
    <ChartCard title="Work in progress" aside={`${progress + review} now · ${review} in review`}>
      <StackedBars columns={wip} series={series} columnLabel={columnLabel} ticks={edgeTicks(wip.length, columnLabel)} />
      <Legend items={series} />
    </ChartCard>
  );
}

/* ---------- rows ---------- */

/** A row of a list chart: a short label, a bar track, a figure on the right. */
function BarRow({ label, value, tracks, onClick, labelWidth = "w-8" }: {
  label: React.ReactNode;
  value: React.ReactNode;
  tracks: readonly { share: number; color: string }[][];
  onClick?: () => void;
  labelWidth?: string;
}) {
  const body = (
    <>
      <span className={cn("flex min-w-0 shrink-0 items-center gap-2 text-left", labelWidth)}>{label}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {tracks.map((layers, index) => (
          <span key={index} className={cn("relative block overflow-hidden rounded-full bg-muted", tracks.length > 1 ? "h-1.5" : "h-2")}>
            {layers.map((layer, layerIndex) => (
              <span
                key={layerIndex}
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${Math.min(1, layer.share) * 100}%`, backgroundColor: layer.color }}
              />
            ))}
          </span>
        ))}
      </span>
      <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">{value}</span>
    </>
  );
  const className = "flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-xs";
  return onClick === undefined ? (
    <div className={className}>{body}</div>
  ) : (
    <button type="button" onClick={onClick} className={cn(className, "hover:bg-state-hover")}>
      {body}
    </button>
  );
}

const MEDIAN_COLOR = "var(--foreground)";
const SPREAD_COLOR = "color-mix(in oklab, var(--foreground) 38%, transparent)";

export function CycleTime({ rows }: { rows: FlowAnswer["cycle"] }) {
  const max = Math.max(1, ...rows.map((row) => row.p90Ms));
  return (
    <ChartCard title="Cycle time" aside="in progress → done">
      {rows.length === 0 ? (
        <Empty>No task went from in progress to done in this period.</Empty>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {rows.map((row) => (
              <BarRow
                key={row.estimate}
                label={<span className="text-muted-foreground">{row.estimate}</span>}
                value={formatDuration(row.medianMs)}
                tracks={[[{ share: row.p90Ms / max, color: SPREAD_COLOR }, { share: row.medianMs / max, color: MEDIAN_COLOR }]]}
              />
            ))}
          </div>
          <Legend items={[{ label: "Median", color: MEDIAN_COLOR }, { label: "90% of tasks", color: SPREAD_COLOR }]} />
        </>
      )}
    </ChartCard>
  );
}

export function EstimateAccuracy({ rows }: { rows: FlowAnswer["accuracy"] }) {
  const pairs = rows.flatMap((row) => {
    const pair = row.minutes ?? row.money;
    return pair === undefined ? [] : [{ estimate: row.estimate, pair, unit: row.minutes === undefined ? "money" : "minutes" }];
  });
  const max = Math.max(1, ...pairs.flatMap(({ pair }) => [pair.planned, pair.actual]));
  return (
    <ChartCard title="Estimate vs actual" aside="median per task">
      {pairs.length === 0 ? (
        <Empty>No closed task in this period carries both a plan and a fact.</Empty>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            {pairs.map(({ estimate, pair }) => (
              <BarRow
                key={estimate}
                label={<span className="text-muted-foreground">{estimate}</span>}
                value={<span className={pair.ratio > 1.3 ? "text-foreground" : undefined}>{`×${pair.ratio.toFixed(1)}`}</span>}
                tracks={[[{ share: pair.planned / max, color: SPREAD_COLOR }], [{ share: pair.actual / max, color: MEDIAN_COLOR }]]}
              />
            ))}
          </div>
          <Legend items={[{ label: "Planned", color: SPREAD_COLOR }, { label: "Actual", color: MEDIAN_COLOR }]} />
        </>
      )}
    </ChartCard>
  );
}

const RING_SIZE = 112;
const RING_RADIUS = 44;
const RING_STROKE = 12;

/** Spend of the period's closed tasks: a ring with the total inside, a row per project — Usage Analytics' "Cost by project". */
export function CostByProject({ costs, projects }: { costs: FlowAnswer["costByProject"]; projects: Projects }) {
  const colors = useChartColors();
  const total = sum(costs.map((entry) => entry.cost));
  const circumference = 2 * Math.PI * RING_RADIUS;
  const arcs = costs.reduce<{ offset: number; arcs: { projectId: string; length: number; offset: number }[] }>(
    (acc, entry) => {
      const length = (entry.cost / total) * circumference;
      return { offset: acc.offset + length, arcs: [...acc.arcs, { projectId: entry.projectId, length, offset: acc.offset }] };
    },
    { offset: 0, arcs: [] },
  ).arcs;
  return (
    <ChartCard title="Cost by project" aside="closed this period">
      {costs.length === 0 ? (
        <Empty>No closed task in this period has a cost.</Empty>
      ) : (
        <div className="flex min-h-0 flex-1 items-center gap-5">
          <div className="relative shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }}>
            <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true">
              <g transform={`translate(${RING_SIZE / 2} ${RING_SIZE / 2}) rotate(-90)`}>
                <circle r={RING_RADIUS} fill="none" stroke="var(--border)" strokeWidth={RING_STROKE} />
                {arcs.map((arc) => (
                  <circle
                    key={arc.projectId}
                    r={RING_RADIUS}
                    fill="none"
                    stroke={colorOf(colors, projects, arc.projectId)}
                    strokeWidth={RING_STROKE}
                    strokeDasharray={`${arc.length} ${circumference - arc.length}`}
                    strokeDashoffset={-arc.offset}
                  />
                ))}
              </g>
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-base font-semibold tabular-nums text-foreground">{formatDollars(total)}</span>
            </div>
          </div>
          <ul className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto">
            {costs.map((entry) => (
              <li key={entry.projectId} className="flex items-center gap-2 text-xs">
                <Swatch color={colorOf(colors, projects, entry.projectId)} />
                <span className="min-w-0 flex-1 truncate text-foreground">{nameOf(projects, entry.projectId)}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatDollars(entry.cost)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}

export function Aging({ entries, projects, nowMs, onOpenTask }: {
  entries: FlowAnswer["aging"];
  projects: Projects;
  nowMs: number;
  onOpenTask: (taskKey: string) => void;
}) {
  const colors = useChartColors();
  const max = Math.max(1, ...entries.map((entry) => nowMs - entry.sinceMs));
  return (
    <ChartCard title="Aging" aside="open longest in their status">
      {entries.length === 0 ? (
        <Empty>Nothing waits in to do, in progress or in review.</Empty>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {entries.map((entry) => (
            <BarRow
              key={entry.taskId}
              labelWidth="w-2/5"
              onClick={() => onOpenTask(entry.key)}
              label={
                <>
                  <Swatch color={colors.status(entry.status)} />
                  <span className="shrink-0 tabular-nums text-muted-foreground">{entry.key}</span>
                  <span className="min-w-0 truncate text-foreground" title={`${entry.title} · ${nameOf(projects, entry.projectId)}`}>
                    {entry.title}
                  </span>
                </>
              }
              value={formatDuration(nowMs - entry.sinceMs)}
              tracks={[[{ share: (nowMs - entry.sinceMs) / max, color: colors.status(entry.status) }]]}
            />
          ))}
        </div>
      )}
    </ChartCard>
  );
}

const TYPE_KEYS = [...TASK_TYPES, "untyped"] as const;

export function ClosedByType({ weeks, weekLabel }: { weeks: FlowAnswer["typesByWeek"]; weekLabel: ColumnLabel }) {
  const colors = useChartColors();
  const present = TYPE_KEYS.filter((type) => weeks.some((week) => (week[type] ?? 0) > 0));
  const series = present.map((type) => ({ id: type, label: type, color: colors.type(type) }));
  return (
    <ChartCard title="Closed by type" aside="per week">
      {present.length === 0 ? (
        <Empty>No task closed in these weeks.</Empty>
      ) : (
        <>
          <StackedBars
            columns={weeks.map((week) => present.map((type) => week[type] ?? 0))}
            series={series}
            columnLabel={weekLabel}
            ticks={edgeTicks(weeks.length, weekLabel)}
          />
          <Legend items={series} />
        </>
      )}
    </ChartCard>
  );
}
