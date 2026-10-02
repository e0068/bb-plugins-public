import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { GanttMode, TaskStatus } from "../../shared/enums.js";
import {
  ALL_KEY,
  boardColumns,
  canReorder,
  columnWidth,
  dropPatch,
  fillsWidth,
  gridColumnsOf,
  placedBefore,
  withColumnWidth,
  withDrop,
  type BoardColumn,
  type DropChange,
} from "./grouping.js";
import { scopeBoardKey, setBoardLayout, useBoardLayout } from "./board-preference.js";
import {
  DAY_MS,
  fetchScopeBoard,
  fetchScopeBurndowns,
  fetchScopeGantt,
  scopeProjectId,
  type BoardData,
  type BoardGantt,
  type TaskBurndown,
} from "./scope-data.js";
import type { ListPreferenceScope } from "../common/list-preference.js";
import { EMPTY_FILTERS, hasActiveFilters } from "../common/filter-state.js";
import type { Label, Project, Task, TaskCardMeta, TaskThread } from "../../shared/contract.js";
import {
  listTaskCardMeta,
  useProjects,
  useTasksQuery,
  useTasksRpc,
  type TasksRpc,
} from "../../client/data.js";
import { useOpenTask } from "../../client/task-opening.js";
import { NewTaskDialog } from "../manage/index.js";
import {
  BOARD_STATUSES,
  dropIndexForPointer,
  dropNeighborsForIndex,
  gridDropIndex,
  type BoardDropNeighbors,
  type CardRect,
} from "./drop-position.js";
import { PriorityIcon, STATUS_LABELS, StatusIcon } from "./icons.js";
import { GroupIcon } from "./group-icon.js";
import { visibleBoardColumns } from "./narrow-layout.js";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { boardCardMeta, type BoardCardMeta } from "./card-meta.js";
import { SubtaskList, type AddSubtaskOutcome } from "./subtask-list.js";
import { BurndownChart, SubtaskStats } from "./subtask-stats.js";
import { DEFAULT_CHART_PREFERENCE, useChartPreference, type ChartPreference } from "./chart-preference.js";
import { chartWindow, type TimeWindow } from "./chart-window.js";
import { DateAxis } from "./date-axis.js";
import { dateTicks, type DateTick } from "./date-ticks.js";
import {
  DEFAULT_CARD_TEXT,
  DESCRIPTION_SIZE_CLASS,
  TITLE_SIZE_CLASS,
  useCardText,
  type CardTextPreference,
} from "./card-text-preference.js";
import { GanttChart, ganttLines, planEndMs, type GanttRowData } from "../analytics/gantt-chart.js";
import { progressOf, subtasksInScope, type Descendant } from "../../shared/subtree.js";
import { slugOf } from "../../shared/format.js";
import { firstParagraph } from "../../shared/first-paragraph.js";
import { formatTakenAgo, type TakenBy } from "../../shared/task-claim.js";
import { factsOf } from "../../shared/task-fields.js";
import { Button } from "@/components/ui/button";
import { DelayedLoading } from "../../components/delayed-loading.js";
import { useTakenRefusal } from "../../components/task-taken-dialog.js";
import { SourceBanner } from "./source-banner.js";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ROW_FIELD_LABELS,
  subtaskScopeOf,
  taskOpeningOf,
  useFieldDisplay,
  type FieldDisplayConfig,
  type RowField,
} from "../common/row-field-preference.js";
import { AmountChip } from "../common/amount-chip.js";
import { labelFill } from "../common/label-fill.js";
import { planRowFields, type FieldPlanCell } from "../common/field-plan.js";
import { cardSections, type CardBlockField } from "./card-sections.js";
import {
  formatDueDate,
  formatTimestamp,
  PRIORITY_LABELS,
} from "../common/lib.js";
import {
  describeWorktreeOrigin,
  EstimateIcon,
  TYPE_ICONS,
  TYPE_LABELS,
} from "../../components/task-meta.js";

const DRAG_THRESHOLD_PX = 5;

export type { BoardData };

const EMPTY_META: BoardCardMeta = {
  workingThreads: [],
  attachmentCount: 0,
  parent: null,
  family: { descendants: [] },
  progress: progressOf([]),
};

/**
 * A single project's board data. The toolbar's column picker and the display
 * panel's field preview call this directly for one project, outside any
 * screen's scope; `BoardView` itself reads through `fetchScopeBoard`.
 */
export function fetchBoard(rpc: TasksRpc, projectId: string): Promise<BoardData> {
  return fetchScopeBoard(rpc, `project:${projectId}`);
}

/** A card's Gantt: its sub-tasks' rows and what it draws of them. */
interface CardGantt {
  rows: readonly GanttRowData[];
  mode: GanttMode;
}

/** What every chart on a card draws over: one window, today in it, and the dates across it. */
interface CardChartFrame {
  window: TimeWindow;
  nowMs: number;
  ticks: readonly DateTick[];
  /** Whether each chart writes the dates under itself. */
  datesUnderCharts: boolean;
}

/** Where the latest plan among a card's sub-tasks ends; null without plans. */
function latestPlanMsOf(plans: readonly { startDate: string | null; dueDate: string | null }[]): number | null {
  const ends = plans.flatMap((plan) => planEndMs(plan) ?? []);
  return ends.length === 0 ? null : Math.max(...ends);
}

/** The one window a card's charts draw over the board's period, today in its place — all time opening at the card's oldest sub-task. */
function cardWindowOf(descendants: readonly Descendant<Task>[], charts: ChartPreference, nowMs: number): TimeWindow {
  const tasks = descendants.map(({ task }) => task);
  return chartWindow({
    period: charts.period,
    unit: charts.unit,
    today: charts.today,
    nowMs,
    oldestMs: Math.min(nowMs - DAY_MS, ...tasks.map((task) => Date.parse(task.createdAt)).filter(Number.isFinite)),
    latestPlanMs: latestPlanMsOf(tasks),
  });
}

/**
 * A card's chart frame: its window, now, and the dates across it, written
 * under each chart or along the card's bottom — with dates off, neither the
 * dates nor their lines.
 */
function cardFrameOf(descendants: readonly Descendant<Task>[], charts: ChartPreference, nowMs: number): CardChartFrame {
  const window = cardWindowOf(descendants, charts, nowMs);
  const ticks = charts.dates === "off" ? [] : dateTicks(window, charts.dateDensity);
  return { window, nowMs, ticks, datesUnderCharts: charts.dates === "charts" };
}

/** The frame of every card with something under it — a card with none draws no chart. */
function cardFramesOf(metaByTaskId: ReadonlyMap<string, BoardCardMeta>, charts: ChartPreference, nowMs: number): Map<string, CardChartFrame> {
  return new Map(
    [...metaByTaskId].flatMap(([taskId, meta]) =>
      meta.family.descendants.length === 0 ? [] : [[taskId, cardFrameOf(meta.family.descendants, charts, nowMs)] as const],
    ),
  );
}

/** The Gantt of every card that has something to draw in its frame's window — a card left out draws no block. */
function cardGanttsOf(
  gantt: BoardGantt,
  metaByTaskId: ReadonlyMap<string, BoardCardMeta>,
  frames: ReadonlyMap<string, CardChartFrame>,
  mode: GanttMode,
): Map<string, CardGantt> {
  return new Map(
    [...frames].flatMap(([taskId, { window, nowMs }]) => {
      const descendants = metaByTaskId.get(taskId)?.family.descendants ?? [];
      const rows = descendants.flatMap(({ task }) => gantt.rows.get(task.id) ?? []);
      return ganttLines(rows, window.fromMs, window.toMs, mode, nowMs).length > 0 ? [[taskId, { rows, mode }] as const] : [];
    }),
  );
}

/** Attachment counts and threads for the cards on screen, one request for
 *  all of them; a failure leaves the cards without chips. */
function fetchCards(rpc: TasksRpc, taskIds: readonly string[]): Promise<TaskCardMeta[]> {
  return listTaskCardMeta(rpc, taskIds).catch(() => []);
}

interface DragState {
  taskId: string;
  /** The column the card was picked up from — a card with two labels sits in two. */
  fromKey: string;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  overKey: string | null;
  dropIndex: number;
}

/** A column edge being dragged: which column and how wide it is right now. */
interface ResizeState {
  key: string;
  width: number;
}

/** Small marker for a task whose latest content came from an active
 *  worktree rather than the linked project's main checkout — see
 *  shared/contract.ts's fileTaskOriginSchema and filesync/fs-boards.ts for when
 *  that's the case. */
function WorktreeSourceMark({ task }: { task: Task }) {
  if (task.source?.origin.kind !== "worktree") return null;
  const { identity, detail } = describeWorktreeOrigin(task.source.origin);
  return (
    <span
      data-worktree-mark
      className="flex shrink-0 items-center text-muted-foreground"
      title={`Not merged into main — synced from ${identity}${
        detail ? ` (${detail})` : ""
      }`}
    >
      <Icon name="FolderGit" className="size-3" />
    </span>
  );
}

function WorkingAgentsChip({ threads }: { threads: TaskThread[] }) {
  if (threads.length === 0) return null;
  return (
    <span className="flex min-w-0 items-center gap-1 text-2xs font-medium text-success">
      <span
        aria-hidden
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-success"
      />
      <span className="truncate">
        {threads.length === 1
          ? threads[0]!.presetName
          : `${threads.length} agents`}
      </span>
    </span>
  );
}

/** Board footer chip — compact (2xs) sibling of the list rail's pill. */
const CARD_CHIP_CLASS =
  "flex items-center gap-1 rounded-md border border-border px-1.5 text-2xs text-muted-foreground";
const CARD_GLYPH_CLASS = "flex items-center text-muted-foreground";
/** A tag on the card: a chip of the same size, filled with the tag's colour instead of outlined. */
const CARD_LABEL_CLASS = "flex items-center rounded-md px-1.5 text-2xs font-medium";

/** The tooltip of the Taken by chip: the machine, the thread when the mark has one, and how long ago. */
function takenByTitle(takenBy: TakenBy): string {
  const thread = takenBy.threadId === null ? "" : ` · thread ${takenBy.threadId}`;
  return `Taken on ${takenBy.machine}${thread} · ${formatTakenAgo(takenBy.at, new Date())}`;
}

/** One planned task field on a card; empties are handled by the caller. */
function CardFieldValue({
  field,
  task,
  meta,
  labels,
  project,
}: {
  field: RowField;
  task: Task;
  meta: BoardCardMeta;
  labels: readonly Label[];
  project: Project | undefined;
}) {
  switch (field) {
    case "key":
      return (
        <span title={`Key: ${task.key}`} className="text-2xs text-muted-foreground tabular-nums">
          {task.key}
        </span>
      );
    case "priority":
      return (
        <span title={PRIORITY_LABELS[task.priority]} className={CARD_GLYPH_CLASS}>
          <PriorityIcon priority={task.priority} />
        </span>
      );
    case "status":
      return (
        <span title={`Status: ${STATUS_LABELS[task.status]}`} className={CARD_GLYPH_CLASS}>
          <StatusIcon status={task.status} className="size-3" />
        </span>
      );
    case "subtasks":
      return (
        <span
          title={`${meta.progress.done} of ${meta.progress.total} sub-tasks done`}
          className="flex items-center gap-0.5 text-2xs text-muted-foreground tabular-nums"
        >
          <Icon name="GitBranch" className="size-3" />
          {meta.progress.done}/{meta.progress.total}
        </span>
      );
    case "slug": {
      const slug = slugOf(task.id);
      return (
        // Takes the rest of the row, 80 to 160 px, so it wraps only when less than 80 px is left.
        <span title={`Slug: ${slug}`} className="min-w-20 max-w-40 flex-1 truncate text-2xs text-subtle-foreground">
          {slug}
        </span>
      );
    }
    case "parent":
      return meta.parent ? (
        <span
          title={`Parent: ${meta.parent.key} ${meta.parent.title}`}
          // Shrinks to the row, the key truncated: a parent without a key shows its long slug.
          className="flex min-w-0 max-w-full items-center gap-0.5 text-2xs text-subtle-foreground tabular-nums"
        >
          <Icon name="ArrowUp" className="size-3 shrink-0" />
          <span className="truncate">{meta.parent.key}</span>
        </span>
      ) : null;
    case "attachments":
      return (
        <Icon
          name="Paperclip"
          className="size-3 text-muted-foreground"
          aria-label={`${meta.attachmentCount} attachments`}
        />
      );
    case "worktree":
      return <WorktreeSourceMark task={task} />;
    case "title":
    case "description":
    case "subtaskList":
    case "subtaskStats":
    case "burndown":
    case "gantt":
      // Blocks, drawn full width on their own, not chips.
      return null;
    case "active":
      return <WorkingAgentsChip threads={meta.workingThreads} />;
    case "assignee":
      return task.assignee ? (
        <span title={`Assignee: ${task.assignee}`} className={`${CARD_CHIP_CLASS} max-w-32`}>
          <Icon name="UserRound" className="size-3 shrink-0" />
          <span className="truncate">{task.assignee}</span>
        </span>
      ) : null;
    case "flow":
      return task.flow ? (
        <span title={`Flow: ${task.flow.name}`} className={`${CARD_CHIP_CLASS} max-w-32`}>
          <Icon name="Workflow" className="size-3 shrink-0" />
          <span className="truncate">{task.flow.name}</span>
        </span>
      ) : null;
    case "takenBy":
      return task.takenBy ? (
        <span title={takenByTitle(task.takenBy)} className={`${CARD_CHIP_CLASS} max-w-32`}>
          <Icon name="Laptop" className="size-3 shrink-0" />
          <span className="truncate">{task.takenBy.machine}</span>
        </span>
      ) : null;
    case "type":
      return task.type !== null ? (
        <span title={TYPE_LABELS[task.type]} className={CARD_GLYPH_CLASS}>
          <Icon name={TYPE_ICONS[task.type]} className="size-3 shrink-0" />
        </span>
      ) : null;
    case "estimate":
      return task.estimate !== null ? (
        <span title={`Estimate: ${task.estimate.toUpperCase()}`} className={CARD_GLYPH_CLASS}>
          <EstimateIcon estimate={task.estimate} />
        </span>
      ) : null;
    case "labels":
      return (
        <>
          {labels.map((label) => (
            <span key={label.id} className={CARD_LABEL_CLASS} style={labelFill(label.color)}>
              {label.name}
            </span>
          ))}
        </>
      );
    case "plannedMinutes":
    case "actualMinutes":
    case "budget":
    case "budgetLimit":
    case "cost": {
      const value = task[field];
      return value !== null ? (
        <AmountChip field={field} value={value} className={CARD_CHIP_CLASS} />
      ) : null;
    }
    case "dueDate":
      return task.dueDate !== null ? (
        <span className={`${CARD_CHIP_CLASS} tabular-nums`} title={`Due ${formatDueDate(task.dueDate)}`}>
          <Icon name="Clock" className="size-3 shrink-0" />
          {formatDueDate(task.dueDate)}
        </span>
      ) : null;
    case "startDate":
      return task.startDate !== null ? (
        <span className={`${CARD_CHIP_CLASS} tabular-nums`} title={`Start ${formatDueDate(task.startDate)}`}>
          <Icon name="Calendar" className="size-3 shrink-0" />
          {formatDueDate(task.startDate)}
        </span>
      ) : null;
    case "createdAt":
      return (
        <span className={`${CARD_CHIP_CLASS} tabular-nums`} title={`Created ${formatTimestamp(task.createdAt)}`}>
          <Icon name="Calendar" className="size-3 shrink-0" />
          {formatTimestamp(task.createdAt)}
        </span>
      );
    case "updatedAt":
      return (
        <span className={`${CARD_CHIP_CLASS} tabular-nums`} title={`Edited ${formatTimestamp(task.updatedAt)}`}>
          <Icon name="Edit" className="size-3 shrink-0" />
          {formatTimestamp(task.updatedAt)}
        </span>
      );
    case "project":
      return project ? (
        <span
          aria-hidden
          title={project.name}
          className="size-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: project.color }}
        />
      ) : null;
  }
}

/** A row of chips on a card; its place among the blocks follows the Display menu. */
function CardChipRow({ children }: { children: ReactNode }) {
  return (
    <div data-card-section="chips" className="mt-1.5 flex flex-wrap items-center gap-1.5 first-of-type:mt-0">
      {children}
    </div>
  );
}

/** One chip of a row: the field's value, or a dash when show-empty keeps an empty field. */
function CardChip({
  cell,
  task,
  meta,
  labels,
  project,
}: {
  cell: FieldPlanCell;
  task: Task;
  meta: BoardCardMeta;
  labels: readonly Label[];
  project: Project | undefined;
}) {
  return cell.mode === "placeholder" ? (
    <span title={`${ROW_FIELD_LABELS[cell.field]}: —`} className="text-2xs text-subtle-foreground/60">
      —
    </span>
  ) : (
    <CardFieldValue field={cell.field} task={task} meta={meta} labels={labels} project={project} />
  );
}

/** The room above each block of a card; the first section of a card has none. */
const BLOCK_GAP: Record<CardBlockField, string> = {
  title: "mt-1",
  description: "mt-1",
  subtaskList: "mt-2",
  subtaskStats: "mt-2",
  burndown: "mt-1.5",
  gantt: "mt-1.5",
};

/**
 * One full-width block of a card. The card places only blocks that have
 * something to draw; the checks for a burndown and an opener below are there
 * for the types, not a second rule.
 */
function CardBlock({
  field,
  task,
  meta,
  burndown,
  frame,
  gantt,
  listedSubtasks,
  onOpenTask,
  onAddSubtask,
  text,
}: {
  field: CardBlockField;
  task: Task;
  meta: BoardCardMeta;
  text: CardTextPreference;
  burndown: TaskBurndown | undefined;
  frame: CardChartFrame | undefined;
  gantt: CardGantt | undefined;
  listedSubtasks: readonly Descendant<Task>[];
  onOpenTask: ((taskKey: string) => void) | undefined;
  onAddSubtask: ((title: string) => Promise<AddSubtaskOutcome>) | undefined;
}) {
  switch (field) {
    case "title":
      return <div className={cn("line-clamp-2 font-medium", TITLE_SIZE_CLASS[text.title], "leading-snug")}>{task.title}</div>;
    case "description": {
      const description = firstParagraph(task.description);
      return (
        <div title={description} className={cn("line-clamp-4 text-subtle-foreground", DESCRIPTION_SIZE_CLASS[text.description], "leading-snug")}>
          {description}
        </div>
      );
    }
    case "subtaskStats":
      return (
        <div className="border-t border-border pt-1.5">
          <SubtaskStats progress={meta.progress} />
        </div>
      );
    case "burndown":
      return burndown && frame ? (
        <div>
          <BurndownChart
            open={burndown.open}
            ends={burndown.ends}
            window={frame.window}
            nowMs={frame.nowMs}
            ticks={frame.ticks}
            showDates={frame.datesUnderCharts}
            forecastMs={burndown.forecastMs}
          />
        </div>
      ) : null;
    case "gantt":
      return gantt && frame ? (
        <div className="flex flex-col gap-0.5">
          <GanttChart
            rows={gantt.rows}
            fromMs={frame.window.fromMs}
            toMs={frame.window.toMs}
            todayMs={frame.nowMs}
            mode={gantt.mode}
            compact
            ticks={frame.ticks}
            onOpenTask={onOpenTask}
          />
          {frame.datesUnderCharts ? <DateAxis ticks={frame.ticks} /> : null}
        </div>
      ) : null;
    case "subtaskList":
      return onOpenTask && onAddSubtask ? (
        <SubtaskList
          descendants={listedSubtasks}
          onOpen={(child) => onOpenTask(child.key)}
          onAdd={onAddSubtask}
          textClassName={DESCRIPTION_SIZE_CLASS[text.subtasks]}
        />
      ) : null;
  }
}

interface TaskCardProps {
  task: Task;
  labelsById: Map<string, Label>;
  meta: BoardCardMeta;
  /** The task's project, resolved once by the caller; undefined while
   *  projects are still loading. */
  project?: Project;
  /** The board draws a project swatch — a cross-project screen's board only;
   *  a project's own board never shows it. */
  showProject?: boolean;
  config: FieldDisplayConfig;
  ghost?: boolean;
  dragging?: boolean;
  cardRef?: (element: HTMLDivElement | null) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onClick?: () => void;
  /** Opens a task, by its key, from the card's sub-task list or its Gantt. */
  onOpenTask?: (taskKey: string) => void;
  /** Adds a sub-task, by its title, under the card from its sub-task list. */
  onAddSubtask?: (title: string) => Promise<AddSubtaskOutcome>;
  /** The card's burndown, once loaded. */
  burndown?: TaskBurndown;
  /** The board's period the card charts cover, where today stands in it, and where the dates go. */
  charts?: ChartPreference;
  /** The one window the card's charts draw over, and the dates across it. */
  frame?: CardChartFrame;
  /** The card's Gantt, once loaded and when it has something to draw. */
  gantt?: CardGantt;
  /** Where a card being dragged over the ungrouped grid would land: a line
   *  on this card's left or right edge. */
  dropMark?: "before" | "after";
  /** The board's type sizes for the title, the description and the sub-task list. */
  text?: CardTextPreference;
}

function TaskCard({
  task,
  labelsById,
  meta,
  project,
  showProject = false,
  config,
  ghost = false,
  dragging = false,
  cardRef,
  onPointerDown,
  onClick,
  onOpenTask,
  onAddSubtask,
  burndown,
  charts = DEFAULT_CHART_PREFERENCE,
  frame,
  gantt,
  dropMark,
  text = DEFAULT_CARD_TEXT,
}: TaskCardProps) {
  const labels = task.labelIds
    .map((labelId) => labelsById.get(labelId))
    .filter((label): label is Label => label !== undefined);
  const cells = planRowFields(config, task, {
    activeCount: meta.workingThreads.length,
    showProject,
    hasProject: project !== undefined,
    descendantCount: meta.progress.total,
    attachmentCount: meta.attachmentCount,
  });
  const listedSubtasks = subtasksInScope(meta.family.descendants, subtaskScopeOf(config));
  // A block with nothing to draw yet — a burndown still loading, a list on a
  // ghost card that can neither open nor add — is left out before the layout,
  // so it splits no row. A list with no sub-task in scope still draws: its
  // Add sub-task gives the card its first.
  const drawable = (cell: FieldPlanCell) =>
    (cell.field !== "burndown" || (burndown !== undefined && frame !== undefined)) &&
    (cell.field !== "gantt" || (gantt !== undefined && frame !== undefined)) &&
    (cell.field !== "subtaskList" || (onOpenTask !== undefined && onAddSubtask !== undefined));
  const sections = cardSections(cells.filter(drawable));
  const drawsChart = sections.some((section) => section.kind === "block" && (section.field === "burndown" || section.field === "gantt"));
  return (
    <div
      ref={cardRef}
      data-task-key={task.key}
      onPointerDown={onPointerDown}
      onClick={onClick}
      // Filled like an option in a Flow brief, no border; hover lays part of
      // the host's hover tint over the fill (an overlay behind the text), so
      // the fill stays and the card only lightens a little.
      className={cn(
        "relative isolate shrink-0 rounded-lg bg-surface-recessed-solid px-2.5 py-2 select-none",
        ghost
          ? "rotate-2 shadow-md"
          : "cursor-pointer touch-none before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-[inherit] before:bg-state-hover before:opacity-0 hover:before:opacity-40",
        dragging && "opacity-40",
      )}
    >
      {dropMark ? (
        <span
          aria-hidden
          data-drop-mark={dropMark}
          className={cn(
            "absolute inset-y-0 w-0.5 rounded-full bg-primary",
            dropMark === "before" ? "-left-[5px]" : "-right-[5px]",
          )}
        />
      ) : null}
      {sections.map((section, index) =>
        section.kind === "chips" ? (
          <CardChipRow key={`chips-${index}`}>
            {section.cells.map((cell) => (
              <CardChip key={cell.field} cell={cell} task={task} meta={meta} labels={labels} project={project} />
            ))}
          </CardChipRow>
        ) : (
          <div key={section.field} data-card-section={section.field} className={cn(BLOCK_GAP[section.field], "first-of-type:mt-0")}>
            <CardBlock
              field={section.field}
              task={task}
              meta={meta}
              burndown={burndown}
              frame={frame}
              gantt={gantt}
              listedSubtasks={listedSubtasks}
              onOpenTask={onOpenTask}
              onAddSubtask={onAddSubtask}
              text={text}
            />
          </div>
        ),
      )}
      {/* The card's dates along its bottom, under everything, when the board writes them there. */}
      {frame !== undefined && charts.dates === "card" && drawsChart ? (
        <div data-card-dates className="mt-1.5">
          <DateAxis ticks={frame.ticks} />
        </div>
      ) : null}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <DelayedLoading>
      <div className="flex h-full items-start gap-3 overflow-x-auto p-4">
        {BOARD_STATUSES.map((status) => (
          <div
            key={status}
            className="flex w-[230px] shrink-0 flex-col gap-2 p-1"
          >
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </DelayedLoading>
  );
}

export interface BoardViewProps {
  /** Which screen's board this is: a project's own, or a cross-project surface. */
  scope: ListPreferenceScope;
  /** A saved view opened on this board: it keeps a layout of its own. */
  viewId?: string;
}

const NO_NEIGHBORS: BoardDropNeighbors = { beforeTaskId: null, afterTaskId: null };

/** A card not on screen: never the nearest to a pointer. */
const OFF_SCREEN: CardRect = {
  left: Number.POSITIVE_INFINITY,
  top: Number.POSITIVE_INFINITY,
  width: 0,
  height: 0,
};

export function BoardView({ scope, viewId }: BoardViewProps) {
  const singleProjectId = scopeProjectId(scope);
  // A cross-project screen shows which project a card belongs to; a
  // project's own board never needs to, as every card is already its project.
  const showProject = singleProjectId === null;
  const rpc = useTasksRpc();
  const refusal = useTakenRefusal();
  const key = scopeBoardKey(scope, viewId ?? null);
  const fieldConfig = useFieldDisplay(key);
  const projects = useProjects();
  const projectsById = useMemo(
    () => new Map((projects.data ?? []).map((project) => [project.id, project])),
    [projects.data],
  );
  const openTaskByKey = useOpenTask(taskOpeningOf(fieldConfig));
  const layout = useBoardLayout(key);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const board = useTasksQuery(
    (queryRpc) => fetchScopeBoard(queryRpc, scope),
    ["tasks:changed", "projects:changed"],
    [scope],
  );
  // Sorted: a drag reorders the cards, not the set of them, and must not
  // ask for the chips again.
  const cardTaskIds = useMemo(
    () => (board.data?.tasks ?? []).map((task) => task.id).sort(),
    [board.data],
  );
  const cards = useTasksQuery(
    (queryRpc) => fetchCards(queryRpc, cardTaskIds),
    ["tasks:changed", "threads:changed"],
    [cardTaskIds.join()],
  );
  const metaByTaskId = useMemo(
    () => boardCardMeta(board.data?.tasks ?? [], cards.data),
    [board.data, cards.data],
  );
  // Asked for only while a card shows it, after the columns are drawn.
  const charts = useChartPreference(key);
  const cardText = useCardText(key);
  // The board's own project, or every project its tasks came from — a screen
  // with no tasks yet asks no project for charts either.
  const boardProjectIds = useMemo(
    () =>
      singleProjectId !== null
        ? [singleProjectId]
        : [...new Set((board.data?.tasks ?? []).map((task) => task.projectId))],
    [singleProjectId, board.data],
  );
  const showsBurndown = fieldConfig.fields.some((entry) => entry.field === "burndown" && entry.visible);
  const burndowns = useTasksQuery(
    async (queryRpc) =>
      showsBurndown ? fetchScopeBurndowns(queryRpc, boardProjectIds, charts.period, charts.unit) : new Map<string, TaskBurndown>(),
    ["tasks:changed"],
    [boardProjectIds.join(), showsBurndown, charts.period, charts.unit],
  );
  const showsGantt = fieldConfig.fields.some((entry) => entry.field === "gantt" && entry.visible);
  const gantt = useTasksQuery(
    async (queryRpc) => (showsGantt ? fetchScopeGantt(queryRpc, boardProjectIds, charts.period, charts.unit) : undefined),
    ["tasks:changed"],
    [boardProjectIds.join(), showsGantt, charts.period, charts.unit],
  );
  // One now for every chart on the board, so today stands at the same spot on
  // a card's burndown and Gantt: the Gantt's read, or the burndowns' answer.
  const chartNowMs = useMemo(
    () => gantt.data?.nowMs ?? Math.max(0, ...[...(burndowns.data?.values() ?? [])].map((entry) => entry.ends.at(-1) ?? 0)),
    [gantt.data, burndowns.data],
  );
  // Each card's window and dates once per answer, not per render: a drag re-renders the board on every move.
  const cardFrames = useMemo(() => cardFramesOf(metaByTaskId, charts, chartNowMs), [metaByTaskId, charts, chartNowMs]);
  // Once per answer, not per render: a drag re-renders the board on every move.
  const cardGantts = useMemo(
    () => (gantt.data === undefined ? new Map<string, CardGantt>() : cardGanttsOf(gantt.data, metaByTaskId, cardFrames, charts.ganttMode)),
    [gantt.data, metaByTaskId, cardFrames, charts.ganttMode],
  );

  // Local tasks render a drop instantly; realtime refetches replace them with
  // the server's authoritative state.
  const [tasks, setTasks] = useState<Task[] | undefined>(undefined);
  useEffect(() => {
    setTasks(undefined);
  }, [scope]);
  useEffect(() => {
    if (board.data) setTasks(board.data.tasks);
  }, [board.data]);
  const labels = useMemo(() => board.data?.labels ?? [], [board.data]);
  // What a filter or a sort reads that the task does not carry: names of
  // projects, labels and other tasks, and the cards' counts.
  const facts = useMemo(
    () =>
      factsOf({
        projectNames: new Map([...projectsById].map(([id, project]) => [id, project.name])),
        taskKeys: new Map((board.data?.tasks ?? []).map((task) => [task.id, task.key])),
        labelNames: new Map(labels.map((label) => [label.id, label.name])),
        activeCounts: new Map([...metaByTaskId].map(([id, meta]) => [id, meta.workingThreads.length])),
        attachmentCounts: new Map([...metaByTaskId].map(([id, meta]) => [id, meta.attachmentCount])),
        descendantCounts: new Map([...metaByTaskId].map(([id, meta]) => [id, meta.progress.total])),
      }),
    [projectsById, board.data, labels, metaByTaskId],
  );
  const columns = useMemo(
    () => (tasks === undefined ? undefined : boardColumns(tasks, layout, labels, facts)),
    [tasks, layout, labels, facts],
  );
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const groupBy = layout.grouping.groupBy;
  const gridColumns = gridColumnsOf(layout.grouping);
  const fillWidth = fillsWidth(layout.grouping);
  // Manual order is a project's own hand-set order; a cross-project screen's
  // columns mix several projects' orders, so a drop there never reorders.
  const reorder = singleProjectId !== null && canReorder(groupBy, layout.sort);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);
  const [quickAddStatus, setQuickAddStatus] = useState<TaskStatus | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const isNarrow = useIsCompactViewport();
  // Which column the narrow board shows. Null until the owner picks one —
  // `visibleBoardColumns` then falls back to the first column.
  const [narrowKey, setNarrowKey] = useState<string | null>(null);
  const columnRefs = useRef(new Map<string, HTMLDivElement>());
  // Keyed by column and task: a card with two labels sits in two columns.
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const suppressClickRef = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const cardRefKey = (columnKey: string, taskId: string) => `${columnKey}\u0000${taskId}`;

  const findDropTarget = (
    x: number,
    y: number,
    draggedTaskId: string,
  ): { key: string; index: number } | null => {
    const current = columnsRef.current;
    if (!current) return null;
    // Each column's drop zone is its full-height strip of the board, so a
    // pointer below a short column's last card still targets that column.
    const boardRect = boardRef.current?.getBoundingClientRect();
    if (
      boardRect &&
      (y < boardRect.top - 24 ||
        y > boardRect.bottom + 24 ||
        x < boardRect.left ||
        x > boardRect.right)
    ) {
      return null;
    }
    if (groupBy === "none") {
      const cards = current
        .find((column) => column.key === ALL_KEY)
        ?.tasks.filter((task) => task.id !== draggedTaskId)
        .map((task): CardRect => cardRefs.current.get(cardRefKey(ALL_KEY, task.id))?.getBoundingClientRect() ?? OFF_SCREEN);
      return cards ? { key: ALL_KEY, index: gridDropIndex(cards, x, y) } : null;
    }
    for (const column of current) {
      const columnElement = columnRefs.current.get(column.key);
      if (!columnElement) continue;
      const rect = columnElement.getBoundingClientRect();
      if (x < rect.left - 6 || x > rect.right + 6) continue;
      const centers = column.tasks
        .filter((task) => task.id !== draggedTaskId)
        .map((task) => {
          const cardElement = cardRefs.current.get(cardRefKey(column.key, task.id));
          if (!cardElement) return Number.NEGATIVE_INFINITY;
          const cardRect = cardElement.getBoundingClientRect();
          return cardRect.top + cardRect.height / 2;
        });
      return { key: column.key, index: dropIndexForPointer(centers, y) };
    }
    return null;
  };

  const send = (task: Task, change: DropChange, neighbors: BoardDropNeighbors) => {
    if (change.kind === "none") return;
    // boardMove keeps a project's manual order (before/after neighbors); a
    // cross-project screen has none to keep, so its status drops are a plain
    // update, same as any other property.
    const request =
      change.kind === "status" && singleProjectId !== null
        ? rpc.call("boardMove", {
            taskId: task.id,
            status: change.status,
            ...(change.status === task.status ? {} : { fromStatus: task.status }),
            beforeTaskId: neighbors.beforeTaskId,
            afterTaskId: neighbors.afterTaskId,
            authorName: "You",
          })
        : change.kind === "status"
          ? rpc.call("updateTask", { taskId: task.id, status: change.status })
          : rpc.call("updateTask", { taskId: task.id, ...change.patch });
    void request.then(
      (result) => {
        if (result.ok) return;
        // A refused take tells the owner why; the board is read again either way.
        refusal.handle(result, task.key);
        board.refresh();
      },
      () => board.refresh(),
    );
  };

  /**
   * A drop into another column sets the grouped property to that column's
   * value; a drop inside its own column reorders it, where order is the
   * owner's to set (status columns, manual sort) — elsewhere it does nothing.
   */
  const commitDrop = (task: Task, fromKey: string, toKey: string, dropIndex: number) => {
    const current = columnsRef.current;
    const all = tasksRef.current;
    if (!current || !all) return;
    const sameColumn = fromKey === toKey;
    if (sameColumn && !reorder) return;
    const change: DropChange = sameColumn
      ? { kind: "status", status: task.status }
      : dropPatch(task, groupBy, fromKey, toKey, labels);
    if (change.kind === "none") return;
    const target = current.find((column) => column.key === toKey);
    const neighbors =
      reorder && target
        ? dropNeighborsForIndex(target.tasks.map((entry) => entry.id), task.id, dropIndex)
        : NO_NEIGHBORS;
    const changed = withDrop(all, task.id, change);
    setTasks(reorder ? placedBefore(changed, task.id, neighbors.afterTaskId) : changed);
    send(task, change, neighbors);
  };

  const handleCardPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    task: Task,
    fromKey: string,
  ) => {
    if (event.button !== 0 || dragCleanupRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const start = {
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
    };
    let active = false;

    const updateDrag = (moveEvent: PointerEvent) => {
      const target = findDropTarget(moveEvent.clientX, moveEvent.clientY, task.id);
      setDrag({
        taskId: task.id,
        fromKey,
        x: moveEvent.clientX,
        y: moveEvent.clientY,
        offsetX: start.offsetX,
        offsetY: start.offsetY,
        width: start.width,
        overKey: target?.key ?? null,
        dropIndex: target?.index ?? 0,
      });
    };

    const onMove = (moveEvent: PointerEvent) => {
      if (!active) {
        const distance = Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y);
        if (distance < DRAG_THRESHOLD_PX) return;
        active = true;
      }
      moveEvent.preventDefault();
      updateDrag(moveEvent);
    };
    const finish = (upEvent: PointerEvent | null) => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      if (!active) return;
      if (upEvent) {
        const target = findDropTarget(upEvent.clientX, upEvent.clientY, task.id);
        if (target) commitDrop(task, fromKey, target.key, target.index);
      }
      setDrag(null);
      // The click event fires right after pointerup; swallow that one only.
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };
    const onUp = (upEvent: PointerEvent) => finish(upEvent);
    const onCancel = () => finish(null);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    dragCleanupRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  };

  /** Dragging a column's right edge; the width is stored once, on release. */
  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>, columnKey: string) => {
    if (event.button !== 0 || dragCleanupRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidth(layoutRef.current.grouping, columnKey);
    const widthAt = (clientX: number) =>
      columnWidth(withColumnWidth(layoutRef.current.grouping, columnKey, startWidth + clientX - startX), columnKey);
    const onMove = (moveEvent: PointerEvent) =>
      setResize({ key: columnKey, width: widthAt(moveEvent.clientX) });
    const onUp = (upEvent: PointerEvent) => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      const current = layoutRef.current;
      setBoardLayout(key, {
        ...current,
        grouping: withColumnWidth(current.grouping, columnKey, widthAt(upEvent.clientX)),
      });
      setResize(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    dragCleanupRef.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  };

  const openTask = (task: Task) => {
    if (suppressClickRef.current) return;
    openTaskByKey(task.key);
  };

  // The board refetches at once rather than waiting on the realtime event, so
  // the new sub-task lands in the card's list as soon as it is made.
  const addSubtask =
    (parent: Task) =>
    (title: string): Promise<AddSubtaskOutcome> =>
      rpc.call("createTask", { projectId: parent.projectId, title, parentTaskId: parent.id, status: "todo" }).then(
        (result) => {
          if (!result.ok) return { ok: false, message: result.error.message };
          board.refresh();
          return { ok: true };
        },
        (error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }),
      );

  if (columns === undefined) {
    if (board.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
          <p>Failed to load the board: {board.error}</p>
          <Button variant="outline" size="sm" onClick={board.refresh}>
            Retry
          </Button>
        </div>
      );
    }
    return <BoardSkeleton />;
  }

  const labelsById = board.data?.labelsById ?? new Map<string, Label>();
  const newTaskDialog = (
    <NewTaskDialog
      open={quickAddStatus !== null}
      onOpenChange={(open) => {
        if (!open) setQuickAddStatus(null);
      }}
      projectId={singleProjectId}
      defaultStatus={quickAddStatus ?? undefined}
    />
  );
  // Above the columns (or the grid): a database board that lost its connection says so.
  const withBanner = (content: ReactNode) => (
    <div className="flex h-full min-h-0 flex-col">
      <SourceBanner projectIds={boardProjectIds} />
      <div className="min-h-0 flex-1">{content}</div>
    </div>
  );
  const card = (task: Task, columnKey: string, draggable: boolean, dropMark?: "before" | "after") => (
    <TaskCard
      key={task.id}
      dropMark={dropMark}
      task={task}
      labelsById={labelsById}
      meta={metaByTaskId.get(task.id) ?? EMPTY_META}
      project={projectsById.get(task.projectId)}
      showProject={showProject}
      config={fieldConfig}
      dragging={drag?.taskId === task.id}
      cardRef={(element) => {
        const refKey = cardRefKey(columnKey, task.id);
        if (element) cardRefs.current.set(refKey, element);
        else cardRefs.current.delete(refKey);
      }}
      onPointerDown={draggable ? (event) => handleCardPointerDown(event, task, columnKey) : undefined}
      onClick={() => openTask(task)}
      onOpenTask={openTaskByKey}
      onAddSubtask={addSubtask(task)}
      burndown={burndowns.data?.get(task.id)}
      charts={charts}
      frame={cardFrames.get(task.id)}
      gantt={cardGantts.get(task.id)}
      text={cardText}
    />
  );

  if (hasActiveFilters(layout.filters) && columns.every((column) => column.tasks.length === 0)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
        <p>No tasks match these filters</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setBoardLayout(key, { ...layoutRef.current, filters: EMPTY_FILTERS })}
        >
          Clear filters
        </Button>
      </div>
    );
  }

  const ghostTask = drag
    ? columns.flatMap((column) => column.tasks).find((task) => task.id === drag.taskId)
    : undefined;
  const ghost =
    drag && ghostTask ? (
      <div
        className="pointer-events-none fixed z-50"
        style={{
          left: drag.x - drag.offsetX,
          top: drag.y - drag.offsetY,
          width: drag.width,
        }}
      >
        <TaskCard
          task={ghostTask}
          labelsById={labelsById}
          meta={metaByTaskId.get(ghostTask.id) ?? EMPTY_META}
          project={projectsById.get(ghostTask.projectId)}
          showProject={showProject}
          config={fieldConfig}
          text={cardText}
          ghost
        />
      </div>
    ) : null;

  // Nothing groups the board: its cards lie in one grid, reordered by hand
  // under the manual sort, with no column to drop into.
  if (groupBy === "none") {
    const gridTasks = columns.find((column) => column.key === ALL_KEY)?.tasks ?? [];
    const remaining = drag ? gridTasks.filter((task) => task.id !== drag.taskId) : gridTasks;
    const landing = drag !== null && drag.overKey === ALL_KEY && reorder ? drag.dropIndex : null;
    // The line stands before the card the dropped one would push aside, or
    // after the last card when it would land at the end.
    const markOf = (task: Task): "before" | "after" | undefined => {
      if (landing === null) return undefined;
      if (remaining[landing]?.id === task.id) return "before";
      return landing >= remaining.length && remaining.at(-1)?.id === task.id ? "after" : undefined;
    };
    return withBanner(
      <>
        <div
          ref={boardRef}
          data-board-grid
          className={cn(
            "grid h-full grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] content-start gap-2 overflow-y-auto p-4",
            drag !== null && "cursor-grabbing select-none",
          )}
          style={gridColumns === "auto" ? undefined : { gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
        >
          {gridTasks.map((task) => card(task, ALL_KEY, reorder, markOf(task)))}
          {newTaskDialog}
        </div>
        {ghost}
      </>,
    );
  }

  const renderColumn = (column: BoardColumn) => {
    const isDragOver = drag !== null && drag.overKey === column.key;
    // The insertion line shows only where the drop keeps the owner's order;
    // elsewhere the whole column lights up and the sort places the card.
    const showsIndicator = isDragOver && reorder;
    const remaining = drag ? column.tasks.filter((task) => task.id !== drag.taskId) : column.tasks;
    const indicatorBeforeTaskId = showsIndicator ? (remaining[drag.dropIndex]?.id ?? null) : undefined;
    const indicator = <div key="drop-indicator" className="h-0.5 shrink-0 rounded-full bg-primary" />;
    const children: ReactNode[] = [];
    for (const task of column.tasks) {
      if (task.id === indicatorBeforeTaskId) children.push(indicator);
      children.push(card(task, column.key, true));
    }
    if (indicatorBeforeTaskId === null) children.push(indicator);
    const width = resize?.key === column.key ? resize.width : columnWidth(layout.grouping, column.key);

    return (
      <div
        key={column.key}
        className={cn("relative flex max-h-full flex-col", isNarrow ? "w-full" : !fillWidth && "shrink-0")}
        // Fill width fits the columns to the board: each grows by an equal share
        // of the spare room, or shrinks by its width's share of the shortfall.
        style={isNarrow ? undefined : fillWidth ? { flexGrow: 1, flexShrink: 1, flexBasis: width, minWidth: 0 } : { width }}
      >
        <div className="flex items-center gap-1.5 px-1 pb-2 text-sm font-semibold">
          <GroupIcon groupBy={groupBy} groupKey={column.key} labels={labels} />
          <span className="truncate">{column.label}</span>
          <span className="font-normal text-muted-foreground">{column.tasks.length}</span>
          {groupBy === "status" ? (
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto size-6 text-muted-foreground"
              aria-label={`New ${column.label} task`}
              onClick={() => setQuickAddStatus(column.key as TaskStatus)}
            >
              <Icon name="Plus" className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <div
          ref={(element) => {
            if (element) columnRefs.current.set(column.key, element);
            else columnRefs.current.delete(column.key);
          }}
          data-board-column={column.key}
          className={cn(
            "flex min-h-16 flex-col gap-2 overflow-y-auto rounded-lg p-1",
            isDragOver && "bg-surface-selected outline-2 outline-dashed outline-input",
          )}
        >
          {children}
        </div>
        {isNarrow ? null : (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${column.label} column`}
            onPointerDown={(event) => handleResizePointerDown(event, column.key)}
            className={cn(
              "absolute inset-y-0 -right-2 w-1.5 cursor-col-resize rounded-full hover:bg-primary/40",
              resize?.key === column.key && "bg-primary/60",
            )}
          />
        )}
      </div>
    );
  };

  // Nothing picked yet: open on the first column that has cards, so a narrow
  // board does not greet the owner with an empty first column.
  const columnKeys = columns.map((column) => column.key);
  const firstFilled = columns.find((column) => column.tasks.length > 0)?.key ?? null;
  const shownKeys = visibleBoardColumns(isNarrow, columnKeys, narrowKey ?? firstFilled);

  return withBanner(
    <div
      ref={boardRef}
      className={cn(
        "flex h-full p-4",
        isNarrow ? "flex-col gap-2" : "items-start gap-3 overflow-x-auto",
        (drag !== null || resize !== null) && "cursor-grabbing select-none",
      )}
    >
      {isNarrow && columns.length > 1 ? (
        <div
          role="group"
          aria-label="Board column"
          className="flex shrink-0 items-center gap-0.5 overflow-x-auto rounded-md bg-muted p-0.5"
        >
          {columns.map((column) => (
            <button
              key={column.key}
              type="button"
              onClick={() => setNarrowKey(column.key)}
              aria-pressed={shownKeys.includes(column.key)}
              className={cn(
                "shrink-0 rounded-sm px-2.5 py-1 text-xs",
                shownKeys.includes(column.key)
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {column.label}
            </button>
          ))}
        </div>
      ) : null}
      {columns.filter((column) => shownKeys.includes(column.key)).map(renderColumn)}
      {ghost}
      {newTaskDialog}
    </div>,
  );
}
