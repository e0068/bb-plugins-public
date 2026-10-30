import type { ReactNode } from "react";
import type { Task } from "../../shared/contract.js";
import { cn } from "@/lib/utils";
import { TitleCell } from "./cells.js";

/**
 * One family row, the line both tables draw — the task table and a section's:
 * a cell per visible column, the title with its fold arrow and indent, pinned
 * columns stuck to the leading edge. What a column holds besides the title is
 * the table's own business, handed in as `renderCell`.
 */
export function TableRowLine<Column extends string>({
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
  renderCell,
  cellClassName,
  trailing,
}: {
  task: Task;
  depth: number;
  childCount: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpen: () => void;
  columns: readonly Column[];
  pinnedSet: ReadonlySet<Column>;
  offsets: Partial<Record<Column, number>>;
  edgeColumn: Column | null;
  gridTemplate: string;
  /** The cell of every column but the title. */
  renderCell: (column: Column) => ReactNode;
  /** Extra classes of a column's cell, besides the layout the line gives it. */
  cellClassName?: (column: Column) => string | undefined;
  /** Cells after the last column, each already a grid cell. */
  trailing?: ReactNode;
}) {
  return (
    <div
      data-task-key={task.key}
      role="row"
      onClick={(event) => {
        // Status/priority editors, the fold toggle and a link are inside the
        // row; a click on one of them acts, it never opens the task.
        if ((event.target as HTMLElement).closest("button, a")) return;
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
            data-column={column}
            className={cn(
              "flex min-w-0 items-center overflow-hidden px-2",
              cellClassName?.(column),
              // A pinned cell is opaque so scrolled cells pass under it; the
              // row's hover tint is laid over it rather than lost behind it.
              pinned &&
                "sticky z-[1] bg-background before:pointer-events-none before:absolute before:inset-0 before:-z-10 group-hover:before:bg-state-hover",
              column === edgeColumn && "border-r border-border-hairline",
            )}
            style={pinned ? { left: `${offsets[column] ?? 0}px` } : undefined}
          >
            {column === "title" ? (
              <TitleCell task={task} depth={depth} childCount={childCount} collapsed={collapsed} onToggle={onToggleCollapse} onOpen={onOpen} />
            ) : (
              renderCell(column)
            )}
          </div>
        );
      })}
      {trailing}
    </div>
  );
}
