import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/ui/icon";
import { EntityIcon } from "@/components/entity-icon";
import { IconPicker } from "@/components/icon-picker";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DATE_FORMATS, type DateFormat } from "../../shared/enums.js";
import type { ColumnDisplay } from "./column-display.js";
import { ROW_FIELD_LABELS, type RowField } from "../common/row-field-preference.js";
import { dropEdge } from "./columns.js";

/** The header row's height — also the offset the table's group headers stick at, right under it. */
export const HEADER_HEIGHT_PX = 32;

/** A column's current layout and sort/pin state, as the caller (the table
 * view) computes it — this component only reads it and reports intent. */
export interface HeaderColumnState<C extends string = RowField> {
  column: C;
  /** What the header reads; a task column's own label when absent. */
  label?: string;
  /** The icon before the label — a section field's type. */
  typeIcon?: IconName;
  /** The icon chosen for the column (@bb-plugins/icon-catalog); it stands in for the type's. */
  headerIcon?: string;
  width: number;
  pinned: boolean;
  /** Left offset in px while pinned columns stick to the leading edge;
   * `undefined` for a column that doesn't stick. */
  offset: number | undefined;
  /** Trailing edge of the pinned region — its divider is drawn by the rows. */
  edge: boolean;
  sort: "asc" | "desc" | null;
  sortable: boolean;
  /** Whether the column's width has been dragged away from its default. */
  widthChanged: boolean;
  /** How a column of dates reads; null for a column with no dates. */
  dateFormat: DateFormat | null;
  /** Whether the column's icon shows; null for a column with no icon to switch. */
  icon: boolean | null;
}

const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  dateTime: "Date and time",
  date: "Date",
  relative: "Relative",
};

/** What a header can do to its column. A table that leaves out pinning, hiding or moving
 *  offers none of them in its menu, and without moving a drag moves nothing. */
export interface HeaderActions<C extends string = RowField> {
  onSort: (column: C, direction: "asc" | "desc" | null) => void;
  onPin?: (column: C, pinned: boolean) => void;
  onHide?: (column: C) => void;
  onMove?: (column: C, toIndex: number) => void;
  onResize: (column: C, width: number | null) => void;
  onDisplay: (column: C, patch: ColumnDisplay) => void;
  /** Gives the column an icon, or takes it off for null; absent where columns take no icon. */
  onHeaderIcon?: (column: C, icon: string | null) => void;
}

/** A drag (reorder) only starts once the pointer has moved this far —
 * shorter, and a plain click to open the column menu would misfire as one. */
const DRAG_THRESHOLD_PX = 4;

/** The index of the row's columnheader whose center is nearest `clientX` —
 * the insertion point a drag drops at. */
function nearestColumnIndex(row: Element | null, clientX: number): number {
  const headers = Array.from(row?.querySelectorAll('[role="columnheader"]') ?? []);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  headers.forEach((header, index) => {
    const rect = header.getBoundingClientRect();
    const distance = Math.abs(clientX - (rect.left + rect.width / 2));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

/** Sets the page's cursor and text selection for the length of a pointer
 * session — the pointer leaves the header mid-drag — and returns their restore. */
function holdPageCursor(cursor: string): () => void {
  const { style } = document.body;
  const previous = { cursor: style.cursor, userSelect: style.userSelect };
  style.cursor = cursor;
  style.userSelect = "none";
  return () => {
    style.cursor = previous.cursor;
    style.userSelect = previous.userSelect;
  };
}

/** Listens on the window for the rest of a pointer session; returns the unsubscribe. */
function listenToPointer(handlers: {
  move: (event: PointerEvent) => void;
  up: (event: PointerEvent) => void;
  cancel: () => void;
}): () => void {
  window.addEventListener("pointermove", handlers.move);
  window.addEventListener("pointerup", handlers.up);
  window.addEventListener("pointercancel", handlers.cancel);
  return () => {
    window.removeEventListener("pointermove", handlers.move);
    window.removeEventListener("pointerup", handlers.up);
    window.removeEventListener("pointercancel", handlers.cancel);
  };
}

/** Same drag, same drop target: kept as is so a pointermove that changes nothing re-renders nothing. */
function sameDrag(a: ColumnDrag | null, b: ColumnDrag | null): boolean {
  return a === b || (a !== null && b !== null && a.fromIndex === b.fromIndex && a.toIndex === b.toIndex);
}

interface ColumnDrag {
  fromIndex: number;
  toIndex: number;
}

function HeaderCell<C extends string>({
  state,
  index,
  last,
  drag,
  onDrag,
  actions,
  dragCleanupRef,
}: {
  state: HeaderColumnState<C>;
  index: number;
  /** The row's trailing column: its resize handle stays inside the table's width. */
  last: boolean;
  /** The reorder drag in progress over this row, if any. */
  drag: ColumnDrag | null;
  onDrag: (drag: ColumnDrag | null) => void;
  actions: HeaderActions<C>;
  /** Ends the pointer session in progress — a reorder drag or a resize —
   * listeners and page cursor alike. Shared across every cell so at most one
   * runs at a time, and called on unmount so none outlives the table. */
  dragCleanupRef: React.MutableRefObject<(() => void) | null>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  // Set icon… opens the picker as the menu closes: focus sent back to the header would land outside it and shut it.
  const pickingIcon = useRef(false);
  const [resizing, setResizing] = useState(false);
  // The click a finished drag ends with must not open the menu.
  const draggedRef = useRef(false);
  const label = state.label ?? ROW_FIELD_LABELS[state.column as RowField];
  const ariaSort = state.sort === "asc" ? "ascending" : state.sort === "desc" ? "descending" : "none";
  const dragging = drag?.fromIndex === index;
  const dropLine = drag?.toIndex === index ? dropEdge(drag.fromIndex, drag.toIndex) : null;

  const handleHeaderPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const { onMove } = actions;
    if (event.button !== 0 || dragCleanupRef.current || onMove === undefined) return;
    // Holds back the menu trigger's own open-on-press: the press may be the
    // start of a drag, so the menu opens on the click that completes it.
    event.preventDefault();
    draggedRef.current = false;
    const row = event.currentTarget.closest('[role="row"]');
    const startX = event.clientX;
    const startY = event.clientY;
    let restoreCursor = () => {};
    const finish = (upEvent: PointerEvent | null) => {
      dragCleanupRef.current?.();
      if (draggedRef.current && upEvent) {
        onMove(state.column, nearestColumnIndex(row, upEvent.clientX));
      }
      // The click a drag ends with fires right after this pointerup — or on
      // another header, never reaching this one: forget the drag once it has.
      setTimeout(() => {
        draggedRef.current = false;
      });
    };
    const unlisten = listenToPointer({
      move: (moveEvent) => {
        if (!draggedRef.current) {
          const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
          if (distance <= DRAG_THRESHOLD_PX) return;
          draggedRef.current = true;
          restoreCursor = holdPageCursor("grabbing");
        }
        onDrag({ fromIndex: index, toIndex: nearestColumnIndex(row, moveEvent.clientX) });
      },
      up: finish,
      cancel: () => finish(null),
    });
    dragCleanupRef.current = () => {
      unlisten();
      restoreCursor();
      onDrag(null);
      dragCleanupRef.current = null;
    };
  };

  const handleHeaderClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (draggedRef.current) {
      // Also tells the compact drawer's trigger to stay shut.
      event.preventDefault();
      return;
    }
    setMenuOpen(true);
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0 || dragCleanupRef.current) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = state.width;
    const restoreCursor = holdPageCursor("col-resize");
    setResizing(true);
    const finish = () => dragCleanupRef.current?.();
    const unlisten = listenToPointer({
      move: (moveEvent) => actions.onResize(state.column, startWidth + (moveEvent.clientX - startX)),
      up: finish,
      cancel: finish,
    });
    dragCleanupRef.current = () => {
      unlisten();
      restoreCursor();
      setResizing(false);
      dragCleanupRef.current = null;
    };
  };

  return (
    <div
      role="columnheader"
      aria-sort={ariaSort}
      data-dragging={dragging ? "" : undefined}
      className={cn(
        "flex shrink-0 items-center gap-1 border-b border-r border-border-hairline bg-background px-2 text-xs font-medium text-muted-foreground",
        // A pinned header sticks at its offset like its column's cells; the
        // rest stay relative so the resize handle and drop line have a box to sit in.
        state.pinned ? "sticky z-[2]" : "relative",
        dragging && "opacity-50",
      )}
      style={{
        width: `${state.width}px`,
        ...(state.pinned && state.offset !== undefined ? { left: `${state.offset}px` } : {}),
      }}
    >
      {state.pinned ? (
        <span title="Pinned" className="flex shrink-0 items-center text-subtle-foreground">
          <Icon name="Pin" aria-hidden className="size-3" />
        </span>
      ) : null}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            onPointerDown={handleHeaderPointerDown}
            onClick={handleHeaderClick}
            className={cn(
              "flex h-full min-w-0 flex-1 items-center gap-1.5 truncate text-left hover:text-foreground",
              actions.onMove !== undefined && "cursor-grab",
            )}
          >
            {state.headerIcon !== undefined ? (
              <EntityIcon icon={state.headerIcon} className="size-3.5" />
            ) : state.typeIcon === undefined ? null : (
              <Icon name={state.typeIcon} aria-hidden className="size-3 shrink-0" />
            )}
            <span className="truncate">{label}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          collisionPadding={8}
          mobileTitle={label}
          onCloseAutoFocus={(event) => {
            if (pickingIcon.current) event.preventDefault();
            pickingIcon.current = false;
          }}
        >
          {state.sortable ? (
            <>
              <DropdownMenuItem onSelect={() => actions.onSort(state.column, "asc")}>
                Sort ascending
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.onSort(state.column, "desc")}>
                Sort descending
              </DropdownMenuItem>
              {state.sort !== null ? (
                <DropdownMenuItem onSelect={() => actions.onSort(state.column, null)}>
                  Clear sort
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          {state.dateFormat !== null ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Format</DropdownMenuLabel>
              {/* Checked items, not a radio group: the menu's radio items draw nothing on a phone. */}
              {DATE_FORMATS.map((format) => (
                <DropdownMenuCheckboxItem
                  key={format}
                  checked={state.dateFormat === format}
                  onCheckedChange={() => actions.onDisplay(state.column, { format })}
                >
                  {DATE_FORMAT_LABELS[format]}
                </DropdownMenuCheckboxItem>
              ))}
            </>
          ) : null}
          {state.icon !== null ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={state.icon}
                onCheckedChange={(checked) => actions.onDisplay(state.column, { icon: checked === true })}
              >
                Show icon
              </DropdownMenuCheckboxItem>
            </>
          ) : null}
          {actions.onHeaderIcon === undefined ? null : (
            <>
              <DropdownMenuSeparator />
              {/* The picker opens once the menu is gone: its search field would fight the menu for the keys. */}
              <DropdownMenuItem
                onSelect={() => {
                  pickingIcon.current = true;
                  setIconOpen(true);
                }}
              >
                Set icon…
              </DropdownMenuItem>
            </>
          )}
          {actions.onPin === undefined ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => actions.onPin?.(state.column, !state.pinned)}>
                {state.pinned ? "Unpin column" : "Pin column"}
              </DropdownMenuItem>
            </>
          )}
          {state.widthChanged ? (
            <DropdownMenuItem onSelect={() => actions.onResize(state.column, null)}>
              Reset width
            </DropdownMenuItem>
          ) : null}
          {state.column !== "title" && actions.onHide !== undefined ? (
            <DropdownMenuItem onSelect={() => actions.onHide?.(state.column)}>
              Hide column
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {actions.onHeaderIcon === undefined ? null : (
        <Popover open={iconOpen} onOpenChange={setIconOpen}>
          <PopoverAnchor asChild>
            <span aria-hidden className="pointer-events-none absolute inset-0" />
          </PopoverAnchor>
          <PopoverContent align="start" collisionPadding={8} className="w-96 p-2" mobileTitle={`Icon of ${label}`}>
            <IconPicker
              value={state.headerIcon}
              onRecolor={(icon) => actions.onHeaderIcon?.(state.column, icon)}
              onPick={(icon) => {
                actions.onHeaderIcon?.(state.column, icon);
                setIconOpen(false);
              }}
              onClear={() => {
                actions.onHeaderIcon?.(state.column, null);
                setIconOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
      {dropLine !== null ? (
        <span
          data-drop-line={dropLine}
          aria-hidden
          className={cn(
            // Above the neighbouring header, below a pinned one (z-2) that a
            // scrolled column slides under.
            "pointer-events-none absolute inset-y-0 z-[1] w-0.5 bg-primary",
            dropLine === "before" ? "-left-px" : "-right-px",
          )}
        />
      ) : null}
      {/* Straddles the column's trailing border, wider than the line it
          draws, so the edge is easy to catch; the last column's stays inside
          the table so it adds no scroll. Stacked like the drop line. */}
      <span
        role="separator"
        aria-label={`Resize ${label}`}
        aria-orientation="vertical"
        onPointerDown={handleResizePointerDown}
        onDoubleClick={() => actions.onResize(state.column, null)}
        className={cn(
          "group/resize absolute inset-y-0 z-[1] flex w-2 cursor-col-resize justify-center",
          last ? "right-0" : "-right-1",
        )}
      >
        <span
          className={cn(
            "w-0.5 group-hover/resize:bg-primary/60",
            resizing && "bg-primary",
          )}
        />
      </span>
    </div>
  );
}

/** The table's header row: one {@link HeaderCell} per column, each opening
 * its own sort/pin/hide menu on a click, draggable to reorder — a line marks
 * where the column lands — and resizable at its trailing edge. */
export function TableHeader<C extends string = RowField>({
  columns,
  actions,
  trailing,
}: {
  columns: readonly HeaderColumnState<C>[];
  actions: HeaderActions<C>;
  /** Cells drawn after the regular columns — the property columns' headers, a section's "+". */
  trailing?: ReactNode;
}) {
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);
  const [drag, setDrag] = useState<ColumnDrag | null>(null);
  const onDrag = useCallback(
    (next: ColumnDrag | null) => setDrag((prev) => (sameDrag(prev, next) ? prev : next)),
    [],
  );
  return (
    <div role="row" className="flex" style={{ height: `${HEADER_HEIGHT_PX}px` }}>
      {columns.map((state, index) => (
        <HeaderCell
          key={state.column}
          state={state}
          index={index}
          // Cells after the columns take the table's end, so the last column's edge is an ordinary border.
          last={index === columns.length - 1 && trailing === undefined}
          drag={drag}
          onDrag={onDrag}
          actions={actions}
          dragCleanupRef={dragCleanupRef}
        />
      ))}
      {trailing}
    </div>
  );
}
