import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Task } from "../../shared/contract.js";
import { TASK_STATUSES } from "../../shared/enums.js";
import { useProjects } from "../../client/data.js";
import { useOpenTask } from "../../client/task-opening.js";
import { NewTaskDialog } from "../manage/index.js";
import { DetailToasts, useDetailToasts } from "../detail/toast.js";
import { idsUnder, openCountsOf } from "../../shared/subtree.js";
import type { TaskFacts } from "../../shared/task-fields.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { DelayedLoading } from "../../components/delayed-loading.js";
import { cn } from "@/lib/utils";
import {
  narrowsOnServer,
  useLabels,
  useListTasks,
  useTaskListMeta,
  useTreeTasks,
} from "../common/data.js";
import { useListTaskEdits } from "../common/use-task-edits.js";
import { editedTasks, matchesFilters } from "../common/optimistic.js";
import { labelFilterOptions, selectedLabelIds } from "../common/lib.js";
import {
  useListPreference,
  type ListPreferenceScope,
} from "../common/list-preference.js";
import {
  listFieldScope,
  moveField,
  taskOpeningOf,
  toggleFieldVisible,
  useFieldDisplay,
  type RowField,
} from "../common/row-field-preference.js";
import {
  listScrollScopeKey,
  useListScrollRestoration,
} from "../common/scroll-restoration.js";
import { newTaskSeed } from "../common/new-task-seed.js";
import { surfaceOf } from "../common/view-state.js";
import { usePublishNewTaskSeed } from "../common/new-task-seed-context.js";
import {
  clampColumnWidth,
  defaultColumnWidth,
  moveColumn,
  orderedColumns,
  pinOffsets,
  sortableColumn,
  type TableColumn,
} from "./columns.js";
import { tableRows, type TableGroup } from "./rows.js";
import { GroupIcon } from "../board/group-icon.js";
import { TableCell, TitleCell } from "./cells.js";
import {
  HEADER_HEIGHT_PX,
  TableHeader,
  type HeaderActions,
  type HeaderColumnState,
} from "./header.js";
import { setTableSettings, useTableSettings } from "./table-preference.js";
import { dateFormatOf, hasIconChoice, iconShownOf, isDateColumn, withColumnDisplay } from "./column-display.js";

export interface TableViewProps {
  /** The screen this table draws — the same scope its list preference lives under. */
  scope: ListPreferenceScope;
}

/** Pinned columns together may not outweigh this share of a measured, narrow container. */
const PINNED_WIDTH_SHARE = 0.6;

/** Direct children of every task, keyed by parent id — the tree a sub-task count walks. */
function childrenByParent(tasks: readonly Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.parentTaskId === null) continue;
    const bucket = map.get(task.parentTaskId);
    if (bucket === undefined) map.set(task.parentTaskId, [task]);
    else bucket.push(task);
  }
  return map;
}

/** How many of a task's descendants (any depth) are done, and how many there are. */
function subtaskStatsOf(
  taskId: string,
  byParent: ReadonlyMap<string, Task[]>,
): { done: number; total: number } {
  const children = byParent.get(taskId) ?? [];
  return children.reduce(
    (acc, child) => {
      const nested = subtaskStatsOf(child.id, byParent);
      return {
        done: acc.done + nested.done + (child.status === "done" ? 1 : 0),
        total: acc.total + nested.total + 1,
      };
    },
    { done: 0, total: 0 },
  );
}

function toggled(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}

/**
 * The pinned columns a container this narrow can actually stick, leading
 * columns first: once their running width would cross the share, the rest
 * draw unpinned rather than crowd the screen. Skipped until the container's
 * width is known (a first paint of 0 must not unstick everything).
 */
function cappedPinned(
  columns: readonly TableColumn[],
  pinned: readonly TableColumn[],
  widths: Partial<Record<TableColumn, number>>,
  containerWidth: number,
): readonly TableColumn[] {
  if (containerWidth <= 0) return pinned;
  const cap = containerWidth * PINNED_WIDTH_SHARE;
  const pinnedSet = new Set(pinned);
  let running = 0;
  const kept: TableColumn[] = [];
  for (const column of columns) {
    if (!pinnedSet.has(column)) continue;
    const width = widths[column] ?? defaultColumnWidth(column);
    if (running + width > cap) break;
    running += width;
    kept.push(column);
  }
  return kept;
}

/**
 * Where a column dropped at `toIndex` among the visible columns lands in the
 * *full* field order (hidden fields included) that `moveField` edits: right
 * before whichever field now follows it there, or the end when it is last.
 */
function fullMoveTarget(
  fullFields: readonly RowField[],
  visibleAfterMove: readonly TableColumn[],
  moved: TableColumn,
): number {
  const fromIndex = fullFields.indexOf(moved);
  const after = visibleAfterMove[visibleAfterMove.indexOf(moved) + 1];
  if (after === undefined) return fullFields.length - 1;
  const afterIndex = fullFields.indexOf(after);
  // Removing `moved` shifts everything after it down by one; `moveField`
  // reads `to` against the array with `moved` already taken out.
  return afterIndex > fromIndex ? afterIndex - 1 : afterIndex;
}

const isTaskStatus = (value: string): value is Task["status"] =>
  (TASK_STATUSES as readonly string[]).includes(value);

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        <Icon name={icon} className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

function LoadingRows() {
  return (
    <DelayedLoading>
      <div className="px-3.5 pt-3">
        <Skeleton className="mb-3 h-4 w-28" />
        {Array.from({ length: 7 }, (_, index) => (
          <div
            key={index}
            className="flex h-[34px] items-center gap-2 border-b border-border-hairline"
          >
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        ))}
      </div>
    </DelayedLoading>
  );
}

/** One family row: the title (or a plain cell) per visible column, pinned ones stuck to the leading edge. */
function TableRowLine({
  task,
  depth,
  childCount,
  collapsed,
  onToggleCollapse,
  onOpen,
  columns,
  pinnedSet,
  offsets,
  edgeColumn,
  gridTemplate,
  cellContext,
}: {
  task: Task;
  depth: number;
  childCount: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpen: () => void;
  columns: readonly TableColumn[];
  pinnedSet: ReadonlySet<TableColumn>;
  offsets: Partial<Record<TableColumn, number>>;
  edgeColumn: TableColumn | null;
  gridTemplate: string;
  cellContext: Parameters<typeof TableCell>[0]["context"];
}) {
  return (
    <div
      data-task-key={task.key}
      role="row"
      onClick={(event) => {
        // Status/priority editors and the fold toggle are buttons inside the
        // row; a click on one of them edits or folds, it never opens the task.
        if ((event.target as HTMLElement).closest("button")) return;
        onOpen();
      }}
      className="group grid h-[34px] cursor-pointer items-stretch border-b border-border-hairline text-sm hover:bg-state-hover"
      // Off the screen the browser skips the row's styling and layout: a long
      // table restyled whole on every change of the page took over half a
      // second each time — the toolbar's menus opened seconds late.
      style={{ gridTemplateColumns: gridTemplate, contentVisibility: "auto", containIntrinsicSize: "auto 34px" }}
    >
      {columns.map((column) => {
        const pinned = pinnedSet.has(column);
        return (
          <div
            key={column}
            className={cn(
              "flex min-w-0 items-center overflow-hidden px-2",
              // A pinned cell is opaque so scrolled cells pass under it; the
              // row's hover tint is laid over it rather than lost behind it.
              pinned &&
                "sticky z-[1] bg-background before:pointer-events-none before:absolute before:inset-0 before:-z-10 group-hover:before:bg-state-hover",
              column === edgeColumn && "border-r border-border-hairline",
            )}
            style={pinned ? { left: `${offsets[column] ?? 0}px` } : undefined}
          >
            {column === "title" ? (
              <TitleCell
                task={task}
                depth={depth}
                childCount={childCount}
                collapsed={collapsed}
                onToggle={onToggleCollapse}
                onOpen={onOpen}
              />
            ) : (
              <TableCell column={column} task={task} context={cellContext} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Its own accessible name: the topbar's New task button keeps "New task" to itself. */
function NewTaskRow({ group, onOpen }: { group: string | null; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label={group === null ? "Add a task" : `Add a task to ${group}`}
      onClick={onOpen}
      className="flex h-[34px] w-full items-center border-b border-border-hairline text-left text-sm text-subtle-foreground hover:bg-state-hover hover:text-foreground"
    >
      {/* Stays at the leading edge while the table scrolls sideways. */}
      <span className="sticky left-0 flex items-center gap-1.5 px-3.5">
        <Icon name="Plus" className="size-3.5" />
        New task
      </span>
    </button>
  );
}

export function TableView({ scope }: TableViewProps) {
  const { projectId, listScope } = surfaceOf(scope);
  const fieldScope = listFieldScope(projectId, listScope);
  const fieldConfig = useFieldDisplay(fieldScope);
  const openTask = useOpenTask(taskOpeningOf(fieldConfig));
  const settings = useTableSettings(scope);
  // Relative dates count from the render's own moment, the same for every row.
  const now = new Date();
  const preference = useListPreference(scope);
  const { filters } = preference;

  const projects = useProjects();
  const labelProjectIds = useMemo(
    () => (projectId !== null ? [projectId] : (projects.data ?? []).map((project) => project.id)),
    [projectId, projects.data],
  );
  const labels = useLabels(labelProjectIds);
  const { toasts, push, dismiss } = useDetailToasts();

  // Labels filter by name, resolved against the catalog once it is known:
  // until then no label filter, after — the names' ids, none for stale names.
  const labelOptions = useMemo(() => labelFilterOptions(labels.data ?? []), [labels.data]);
  const labelIds = useMemo((): readonly string[] | null => {
    if (filters.labelNames.length === 0 || labels.data === undefined) return null;
    return selectedLabelIds(labelOptions, filters.labelNames);
  }, [filters.labelNames, labelOptions, labels.data]);
  const serverFilters = { statuses: filters.statuses, priorities: filters.priorities, labelIds };
  const tasksQuery = useListTasks(projectId, listScope, serverFilters);
  const treeQuery = useTreeTasks(projectId, narrowsOnServer(listScope, serverFilters));
  const meta = useTaskListMeta(tasksQuery.data);
  const edits = useListTaskEdits(tasksQuery.data, (message) => push("error", message));

  const treeTasks = useMemo(
    () => editedTasks(treeQuery.data ?? tasksQuery.data ?? [], edits.entries),
    [treeQuery.data, tasksQuery.data, edits.entries],
  );
  const underParents = useMemo(() => idsUnder(treeTasks, filters.parents), [treeTasks, filters.parents]);

  const projectsById = useMemo(
    () => new Map((projects.data ?? []).map((project) => [project.id, project])),
    [projects.data],
  );
  const projectNames = useMemo(
    () => new Map((projects.data ?? []).map((project) => [project.id, project.name])),
    [projects.data],
  );
  const labelsById = useMemo(
    () => new Map((labels.data ?? []).map((label) => [label.id, label])),
    [labels.data],
  );
  // The epic/parent a row points at may itself sit outside the filtered
  // rows; keys resolve against the whole scope's tree, not just what's shown.
  const taskKeys = useMemo(
    () => new Map(treeTasks.map((task) => [task.id, task.key])),
    [treeTasks],
  );
  const byParent = useMemo(() => childrenByParent(treeTasks), [treeTasks]);

  const [collapsedTasks, setCollapsedTasks] = useState<readonly string[]>([]);
  const toggleTaskCollapsed = (taskId: string) =>
    setCollapsedTasks((prev) => toggled(prev, taskId));
  const toggleGroupCollapsed = (key: string) =>
    setTableSettings(scope, { collapsedGroups: toggled(settings.collapsedGroups, key) });

  // Everything a filter or a sort reads that the task does not carry: the
  // names of projects, labels and other tasks, and the row meta's counts.
  const openCounts = useMemo(() => openCountsOf(treeTasks), [treeTasks]);
  const sortContext: TaskFacts = useMemo(
    () => ({
      projectNames,
      taskKeys,
      labelNames: new Map((labels.data ?? []).map((label) => [label.id, label.name])),
      activeCounts: new Map([...(meta.data ?? [])].map(([id, row]) => [id, row.activeThreads.length])),
      attachmentCounts: new Map([...(meta.data ?? [])].map(([id, row]) => [id, row.attachmentCount])),
      descendantCounts: new Map(treeTasks.map((task) => [task.id, subtaskStatsOf(task.id, byParent).total])),
      openCounts,
    }),
    [projectNames, taskKeys, labels.data, meta.data, treeTasks, byParent, openCounts],
  );
  const displayTasks = useMemo(() => {
    if (tasksQuery.data === undefined) return undefined;
    return editedTasks(tasksQuery.data, edits.entries).filter((task) =>
      matchesFilters(task, filters, labelIds ?? [], underParents, sortContext),
    );
  }, [tasksQuery.data, edits.entries, filters, labelIds, underParents, sortContext]);
  const groups: TableGroup[] = useMemo(
    () =>
      displayTasks === undefined
        ? []
        : tableRows(displayTasks, {
            groupBy: settings.groupBy,
            sort: settings.sort,
            context: sortContext,
            collapsedGroups: settings.collapsedGroups,
            collapsedTasks,
            labels: labels.data ?? [],
          }),
    [displayTasks, settings.groupBy, settings.sort, sortContext, settings.collapsedGroups, collapsedTasks, labels.data],
  );

  // The draft a New task row opens with: the table's own filters, so the
  // created task lands back in this screen.
  const seed = useMemo(() => newTaskSeed(projectId, filters), [projectId, filters]);
  usePublishNewTaskSeed(seed);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskGroup, setNewTaskGroup] = useState<TableGroup | null>(null);
  const openNewTask = (group: TableGroup | null) => {
    setNewTaskGroup(group);
    setNewTaskOpen(true);
  };

  const visibleColumns = useMemo(
    () => orderedColumns(fieldConfig.fields, settings.pinned),
    [fieldConfig.fields, settings.pinned],
  );
  const widthOf = (column: TableColumn) => settings.widths[column] ?? defaultColumnWidth(column);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    // Unmeasured width means no narrow cap: the 60% rule needs a real width.
    if (el === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setContainerWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const effectivePinned = useMemo(
    () => cappedPinned(visibleColumns, settings.pinned, settings.widths, containerWidth),
    [visibleColumns, settings.pinned, settings.widths, containerWidth],
  );
  const pinnedSet = useMemo(() => new Set(effectivePinned), [effectivePinned]);
  const { offsets, edge } = pinOffsets(visibleColumns, effectivePinned, settings.widths);
  const gridTemplate = visibleColumns.map((column) => `${widthOf(column)}px`).join(" ");
  const totalWidth = visibleColumns.reduce((sum, column) => sum + widthOf(column), 0);

  const headerColumns: HeaderColumnState[] = visibleColumns.map((column) => ({
    column,
    width: widthOf(column),
    pinned: pinnedSet.has(column),
    offset: offsets[column],
    edge: column === edge,
    sort: settings.sort !== null && settings.sort.column === column ? settings.sort.direction : null,
    sortable: sortableColumn(column),
    widthChanged: settings.widths[column] !== undefined,
    dateFormat: isDateColumn(column) ? dateFormatOf(settings.columns, column) : null,
    icon: hasIconChoice(column) ? iconShownOf(settings.columns, column) : null,
  }));

  const actions: HeaderActions = {
    onSort: (column, direction) =>
      setTableSettings(scope, { sort: direction === null ? null : { column, direction } }),
    onPin: (column, pin) =>
      setTableSettings(scope, {
        pinned: pin ? [...settings.pinned, column] : settings.pinned.filter((entry) => entry !== column),
      }),
    onHide: (column) => toggleFieldVisible(fieldScope, column),
    onMove: (column, toIndex) => {
      const moved = moveColumn(visibleColumns, settings.pinned, column, toIndex);
      setTableSettings(scope, { pinned: moved.pinned });
      const fullFields = fieldConfig.fields.map((entry) => entry.field);
      const fromIndex = fullFields.indexOf(column);
      if (fromIndex === -1) return;
      moveField(fieldScope, fromIndex, fullMoveTarget(fullFields, moved.columns, column));
    },
    onResize: (column, width) => {
      if (width === null) {
        const { [column]: _removed, ...rest } = settings.widths;
        setTableSettings(scope, { widths: rest });
        return;
      }
      setTableSettings(scope, { widths: { ...settings.widths, [column]: clampColumnWidth(width) } });
    },
    onDisplay: (column, patch) =>
      setTableSettings(scope, { columns: withColumnDisplay(settings.columns, column, patch) }),
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const scopeKey = listScrollScopeKey({ projectId, listScope, filters, sort: preference.sort });
  useListScrollRestoration(scrollRef, scopeKey, {
    contentReady: displayTasks !== undefined && displayTasks.length > 0,
    loading: tasksQuery.isLoading,
    revision: displayTasks?.length ?? 0,
  });

  let body: ReactNode;
  if (tasksQuery.data === undefined || displayTasks === undefined) {
    body = tasksQuery.error !== null ? (
      <EmptyState icon="AlertCircle" title="Couldn't load tasks" description={tasksQuery.error} />
    ) : (
      <LoadingRows />
    );
  } else if (displayTasks.length === 0) {
    body = (
      <EmptyState
        icon="ListTodo"
        title="No tasks yet"
        description="Create the first task to start tracking work."
        action={
          <Button size="sm" onClick={() => openNewTask(null)}>
            <Icon name="Plus" className="size-3.5" />
            New task
          </Button>
        }
      />
    );
  } else {
    body = (
      <div style={{ minWidth: `${totalWidth}px` }}>
        <div className="sticky top-0 z-20 bg-background">
          <TableHeader columns={headerColumns} actions={actions} />
        </div>
        {groups.map((group) => (
          <div key={group.key}>
            {settings.groupBy !== "none" ? (
              <div
                data-table-group={group.key}
                className="sticky z-10 flex items-center border-b border-border-hairline bg-background text-sm font-semibold"
                style={{ top: `${HEADER_HEIGHT_PX}px` }}
              >
                {/* Stays at the leading edge while the table scrolls sideways. */}
                <button
                  type="button"
                  aria-expanded={!group.collapsed}
                  onClick={() => toggleGroupCollapsed(group.key)}
                  className="sticky left-0 flex items-center gap-2 px-3 py-1.5"
                >
                  <span
                    aria-hidden
                    data-group-chevron={group.collapsed ? "collapsed" : "expanded"}
                    className="flex shrink-0 text-subtle-foreground"
                  >
                    <Icon name={group.collapsed ? "ChevronRight" : "ChevronDown"} className="size-3.5" />
                  </span>
                  <GroupIcon groupBy={settings.groupBy} groupKey={group.key} labels={labels.data ?? []} />
                  {group.label}
                  <span className="text-xs font-normal tabular-nums text-subtle-foreground">
                    {group.count}
                  </span>
                </button>
              </div>
            ) : null}
            {group.rows.map((row) => (
              <TableRowLine
                key={row.task.id}
                task={row.task}
                depth={row.depth}
                childCount={row.childCount}
                collapsed={collapsedTasks.includes(row.task.id)}
                onToggleCollapse={() => toggleTaskCollapsed(row.task.id)}
                onOpen={() => openTask(row.task.key)}
                columns={visibleColumns}
                pinnedSet={pinnedSet}
                offsets={offsets}
                edgeColumn={edge}
                gridTemplate={gridTemplate}
                cellContext={{
                  project: projectsById.get(row.task.projectId),
                  labelsById,
                  taskKeys,
                  activeThreads: meta.data?.get(row.task.id)?.activeThreads.length ?? 0,
                  subtasks: subtaskStatsOf(row.task.id, byParent),
                  showEmpty: fieldConfig.showEmpty,
                  onEdit: edits.edit,
                  displays: settings.columns,
                  now,
                }}
              />
            ))}
            <NewTaskRow group={group.label} onOpen={() => openNewTask(group)} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={(node) => {
          containerRef.current = node;
          scrollRef.current = node;
        }}
        className="min-h-0 flex-1 overflow-auto"
      >
        {body}
      </div>
      <NewTaskDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        projectId={projectId}
        seed={seed}
        defaultStatus={
          settings.groupBy === "status" && newTaskGroup !== null && isTaskStatus(newTaskGroup.key)
            ? newTaskGroup.key
            : undefined
        }
      />
      <DetailToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
