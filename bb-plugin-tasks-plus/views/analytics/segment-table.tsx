// The table of a tile's segment under its chart: the tasks behind the pick —
// every task of the chart while none is picked — in the columns and the sort
// the tile keeps, the first rows of them and more on «Show N more». The
// server picks and sorts them by the chart's own cells (analyticsTileTasks);
// a cell draws as the task table's does (views/table/cells.tsx).
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";

import { TILE_TABLE_SHOWN_MAX, tileTable, type TileTable } from "../../shared/analytics-tile.js";
import type { QueryField } from "../../shared/enums.js";
import type { Task, Tile } from "../../shared/contract.js";
import { useProjects, useTasksQuery } from "../../client/data.js";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useLabels } from "../common/data.js";
import { editedTasks } from "../common/optimistic.js";
import { ROW_FIELD_LABELS } from "../common/row-field-preference.js";
import { useListTaskEdits } from "../common/use-task-edits.js";
import { TableCell, type CellContext } from "../table/cells.js";
import { defaultColumnWidth } from "../table/columns.js";
import type { TileScope } from "./default-dashboard";
import type { SegmentPick } from "./tile-charts";

type TableSort = TileTable["sort"];

/** A click on a column's header: unsorted → ascending → descending → unsorted; another column starts ascending. */
export function nextSort(sort: TableSort, column: QueryField): TableSort {
  if (sort?.column !== column) return { column, direction: "asc" };
  return sort.direction === "asc" ? { column, direction: "desc" } : null;
}

/** px the title keeps however narrow the tile: past it the table scrolls rather than squeeze the title out. */
export const TITLE_MIN_PX = 160;

/** px of a column, as the task table sets it; the title takes what the rest leave. */
const columnPx = (column: QueryField): number | undefined => (column === "title" ? undefined : defaultColumnWidth(column));

/** The table's least width: every column but the title at its width, and the title's least. */
const tableMinPx = (columns: readonly QueryField[]): number => columns.reduce((total, column) => total + (columnPx(column) ?? TITLE_MIN_PX), 0);

const ROW_HEIGHT_CLASS = { regular: "h-[34px]", compact: "h-7" } as const;

export interface SegmentTableProps {
  tile: Tile;
  /** The edges the chart's answer was asked for: the table reads the same columns. */
  edges: readonly number[];
  /** When the chart's answer was asked: a new answer — the tile set otherwise, a task changed — asks the table again. */
  asked: number;
  /** The page's projects and filters, as the chart was asked over. */
  scope: TileScope;
  /** The switch value picked on the tile; null — all of them. */
  picked: string | null;
  pick: SegmentPick | null;
  /** «All tasks» or the picked segment's name, before the count. */
  heading: ReactNode;
  /** A header was clicked: the sort the tile keeps from now on. */
  onSort: (sort: TableSort) => void;
  onOpenTask: (taskKey: string) => void;
  style?: CSSProperties;
}

export function SegmentTable({ tile, edges, asked, scope, picked, pick, heading, onSort, onOpenTask, style }: SegmentTableProps) {
  const table = tileTable(tile);
  // Rows shown: the setting's at first, more on each «Show more»; a new pick, sort or setting starts over.
  const reset = JSON.stringify([tile.id, pick, table.sort, table.rows, picked]);
  const [more, setMore] = useState({ reset, shown: table.rows });
  const shown = more.reset === reset ? more.shown : table.rows;
  const gridPick = pick === null ? null : { column: pick.column, series: pick.seriesId };

  const query = useTasksQuery(
    (rpc) =>
      rpc.call("analyticsTileTasks", {
        tile,
        edges: [...edges],
        ...scope,
        picked,
        pick: gridPick,
        sort: table.sort,
        limit: Math.min(shown, TILE_TABLE_SHOWN_MAX),
      }),
    // The chart's new answer stands for every change of the tile, the page and the boards: the table asks after it, on its edges.
    [],
    [asked, gridPick, table.sort, shown],
  );
  const [editError, setEditError] = useState<string | null>(null);
  const context = useCellContext(query.data?.tasks, setEditError);
  const total = query.data?.total ?? 0;
  const tasks = context.tasks;
  const next = Math.min(table.rows, total - tasks.length, TILE_TABLE_SHOWN_MAX - tasks.length);

  return (
    <div data-segment-contents className="flex min-h-0 flex-col gap-1" style={style}>
      <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        {heading}
        {query.data === undefined ? null : <span className="shrink-0 tabular-nums">{`· ${total}`}</span>}
      </div>
      {editError === null ? null : <p className="text-xs text-destructive">{editError}</p>}
      {query.error !== null ? (
        <p className="text-xs text-destructive">{query.error}</p>
      ) : query.data !== undefined && total === 0 ? (
        <p className="flex flex-1 items-center justify-center text-xs text-subtle-foreground">No tasks in this chart</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto border-t border-border-hairline">
          <table className="w-full table-fixed border-collapse" style={{ minWidth: tableMinPx(table.columns) }}>
            <colgroup>
              {table.columns.map((column) => (
                <col key={column} style={{ width: columnPx(column) }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-[1] bg-surface-recessed-solid">
              <tr className="h-8">
                {table.columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    aria-sort={table.sort?.column !== column ? "none" : table.sort.direction === "asc" ? "ascending" : "descending"}
                    className="border-b border-border-hairline px-2 text-left text-xs font-medium text-muted-foreground"
                  >
                    <button type="button" className="flex w-full items-center gap-1 truncate hover:text-foreground" onClick={() => onSort(nextSort(table.sort, column))}>
                      <span className="truncate">{ROW_FIELD_LABELS[column]}</span>
                      {table.sort?.column === column ? <span className="text-foreground">{table.sort.direction === "asc" ? "↑" : "↓"}</span> : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.data === undefined
                ? Array.from({ length: 4 }, (_, index) => (
                    <tr key={index} className={ROW_HEIGHT_CLASS[table.rowHeight]}>
                      <td colSpan={table.columns.length} className="border-b border-border-hairline px-2">
                        <Skeleton className="h-3 w-3/5" />
                      </td>
                    </tr>
                  ))
                : tasks.map((task) => (
                    <tr
                      key={task.id}
                      data-task-key={task.key}
                      className={cn("cursor-pointer text-sm hover:bg-state-hover", ROW_HEIGHT_CLASS[table.rowHeight], table.rowHeight === "compact" && "text-xs")}
                      onClick={(event) => {
                        // Status and priority edit in their own buttons and menus; only a click on the row itself opens the task.
                        const target = event.target as HTMLElement;
                        if (event.currentTarget.contains(target) && target.closest("button") === null) onOpenTask(task.key);
                      }}
                    >
                      {table.columns.map((column) => (
                        <td key={column} className={cn("overflow-hidden border-b border-border-hairline px-2 whitespace-nowrap", column === "key" && "text-muted-foreground tabular-nums")}>
                          <span className="flex min-w-0 items-center">
                            {column === "title" ? <span className="truncate">{task.title}</span> : <TableCell column={column} task={task} context={context.of(task)} />}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
      {next > 0 && query.data !== undefined ? (
        <div className="flex items-center justify-between gap-2 pt-1 text-2xs text-subtle-foreground">
          <span className="tabular-nums">{`${tasks.length} of ${total}`}</span>
          <Button type="button" variant="outline" size="sm" className="h-6 text-xs" onClick={() => setMore({ reset, shown: shown + next })}>
            {`Show ${next} more`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The tasks with their pending edits, and what a cell reads beyond its task: the project, the labels, the edit. */
function useCellContext(served: readonly Task[] | undefined, onError: (message: string) => void): { tasks: Task[]; of: (task: Task) => CellContext } {
  const projects = useProjects();
  const projectIds = useMemo(() => (projects.data ?? []).map((project) => project.id), [projects.data]);
  const labels = useLabels(projectIds);
  const edits = useListTaskEdits(served, onError);
  const tasks = useMemo(() => editedTasks(served ?? [], edits.entries), [served, edits.entries]);
  const projectsById = useMemo(() => new Map((projects.data ?? []).map((project) => [project.id, project])), [projects.data]);
  const labelsById = useMemo(() => new Map((labels.data ?? []).map((label) => [label.id, label])), [labels.data]);
  return {
    tasks,
    of: (task) => ({
      project: projectsById.get(task.projectId),
      labelsById,
      taskKeys: new Map(),
      activeThreads: 0,
      subtasks: { done: 0, total: 0 },
      showEmpty: false,
      onEdit: edits.edit,
    }),
  };
}
