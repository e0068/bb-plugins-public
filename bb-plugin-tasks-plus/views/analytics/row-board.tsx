// The analytics screen's layout: rows of tiles. Sizes change by the
// splitters — the one between two tiles of a row, dragged sideways, and the
// one under a row, dragged up and down; a tile moves when its header (the
// element marked data-tile-handle) is dragged: into another place of a row,
// or into a row of its own between rows. While a splitter or a tile is held
// the change lives here; on release it goes out once through `onChange`.
// The model is row-layout.ts.
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { dropTarget, moveCell, resizeCells, resizeRow, type CellTarget, type RowBox, type RowLayout } from "./row-layout";

/** px a pressed header travels before the press becomes a move — a click stays a click. */
const MOVE_SLOP_PX = 4;

/** Presses that belong to a control inside the header, not to the move. */
const CONTROLS = "button, a, input, select, textarea, [role=group], [role=menu]";

interface Moving {
  cellId: string;
  startX: number;
  startY: number;
  /** Where the tile would land now; null until the press became a move. */
  target: CellTarget | null;
}

/** The rows and cells inside `root` as they lie on screen. */
function boxesOf(root: HTMLElement): RowBox[] {
  return (Array.from(root.querySelectorAll("[data-row]")) as HTMLElement[]).map((row) => {
    const box = row.getBoundingClientRect();
    return {
      id: row.dataset.row!,
      top: box.top,
      bottom: box.bottom,
      cells: (Array.from(row.querySelectorAll("[data-cell]")) as HTMLElement[]).map((cell) => {
        const rect = cell.getBoundingClientRect();
        return { id: cell.dataset.cell!, left: rect.left, right: rect.right };
      }),
    };
  });
}

/** px; the splitter's own width or height — the gap between sections. */
const SPLITTER_PX = 12;

export interface RowBoardProps {
  layout: RowLayout;
  renderCell: (id: string) => ReactNode;
  onChange: (next: RowLayout) => void;
  /** Narrow screen: each row's sections stack in one column, and only heights resize. */
  stacked: boolean;
}

type Drag =
  | { kind: "width"; rowId: string; index: number; startX: number; rowWidth: number }
  | { kind: "height"; rowId: string; startY: number; startHeight: number };

const CURSOR: Record<Drag["kind"], string> = { width: "col-resize", height: "row-resize" };

/** A splitter's visible line: shown on hover and while held. */
const LINE =
  "after:absolute after:rounded-full after:bg-transparent after:transition-colors hover:after:bg-border data-[active=true]:after:bg-muted-foreground";

export function RowBoard({ layout, renderCell, onChange, stacked }: RowBoardProps) {
  const [draft, setDraft] = useState<RowLayout | null>(null);
  const drag = useRef<Drag | null>(null);
  const shown = draft ?? layout;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  const movingRef = useRef<Moving | null>(null);
  movingRef.current = moving;

  // A held tile follows the pointer anywhere on the page until it is let go.
  useEffect(() => {
    if (moving === null) return;
    const onMove = (event: PointerEvent) => {
      const held = movingRef.current;
      if (held === null || rootRef.current === null) return;
      const far = Math.abs(event.clientX - held.startX) + Math.abs(event.clientY - held.startY) > MOVE_SLOP_PX;
      if (held.target === null && !far) return;
      setMoving({ ...held, target: dropTarget(boxesOf(rootRef.current), event.clientX, event.clientY) });
    };
    const onUp = () => {
      const held = movingRef.current;
      setMoving(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (held?.target != null) onChange(moveCell(layout, held.cellId, held.target));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [moving !== null, layout, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const startMove = (cellId: string) => (event: React.PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("[data-tile-handle]") === null || target.closest(CONTROLS) !== null) return;
    document.body.style.userSelect = "none";
    setMoving({ cellId, startX: event.clientX, startY: event.clientY, target: null });
  };
  const target = moving?.target ?? null;

  const start = (event: React.PointerEvent<HTMLElement>, next: Drag) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = next;
    document.body.style.cursor = CURSOR[next.kind];
    document.body.style.userSelect = "none";
    setDraft(layout);
  };

  /** The layout a held splitter makes at the pointer's position. */
  const resized = (held: Drag, event: React.PointerEvent<HTMLElement>) =>
    held.kind === "width"
      ? resizeCells(layout, held.rowId, held.index, (event.clientX - held.startX) / held.rowWidth)
      : resizeRow(layout, held.rowId, held.startHeight + event.clientY - held.startY);

  const move = (event: React.PointerEvent<HTMLElement>) => {
    if (drag.current !== null) setDraft(resized(drag.current, event));
  };

  const release = () => {
    const held = drag.current;
    drag.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    setDraft(null);
    return held;
  };

  const end = (event: React.PointerEvent<HTMLElement>) => {
    const held = release();
    if (held !== null) onChange(resized(held, event));
  };

  // A drag the system cancels (a gesture took over) keeps the sizes it started with.
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: release };

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {target?.kind === "newRow" && target.afterRowId === null ? <NewRowMark /> : null}
      {shown.rows.map((row, rowIndex) => {
        const last = rowIndex === shown.rows.length - 1;
        return (
          <Fragment key={row.id}>
            <div
              data-row={row.id}
              className={cn("flex min-h-0", stacked ? "flex-col gap-3" : "flex-row")}
              // The last row also stretches into the room left below it, but from its own height, so a long tile scrolls inside rather than growing the row.
              style={stacked ? undefined : last ? { flex: `1 0 ${row.height}px`, height: row.height } : { height: row.height, flexShrink: 0 }}
            >
              {row.cells.map((cell, cellIndex) => (
                <Fragment key={cell.id}>
                  {target?.kind === "row" && target.rowId === row.id && target.index === cellIndex ? <PlaceMark /> : null}
                  {cellIndex > 0 && !stacked ? (
                    <div
                      data-splitter="width"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Resize sections"
                      data-active={draft !== null && drag.current?.kind === "width" && drag.current.rowId === row.id && drag.current.index === cellIndex}
                      className={cn("relative shrink-0 cursor-col-resize touch-none after:inset-y-2 after:left-[5px] after:w-0.5", LINE)}
                      style={{ width: SPLITTER_PX }}
                      onPointerDown={(event) => {
                        const rowElement = event.currentTarget.parentElement!;
                        start(event, {
                          kind: "width",
                          rowId: row.id,
                          index: cellIndex,
                          startX: event.clientX,
                          rowWidth: Math.max(1, rowElement.getBoundingClientRect().width - (row.cells.length - 1) * SPLITTER_PX),
                        });
                      }}
                      {...handlers}
                    />
                  ) : null}
                  <div
                    data-cell={cell.id}
                    className={cn("relative flex min-h-0 min-w-0 overflow-hidden", moving?.cellId === cell.id && moving.target !== null && "opacity-50")}
                    style={stacked ? { height: row.height } : { flex: `${cell.weight} 1 0` }}
                    onPointerDown={startMove(cell.id)}
                  >
                    {renderCell(cell.id)}
                  </div>
                </Fragment>
              ))}
              {target?.kind === "row" && target.rowId === row.id && target.index === row.cells.length ? <PlaceMark /> : null}
            </div>
            <div
              data-splitter="height"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize row"
              data-active={draft !== null && drag.current?.kind === "height" && drag.current.rowId === row.id}
              className={cn("relative shrink-0 cursor-row-resize touch-none after:inset-x-2 after:top-[5px] after:h-0.5", LINE)}
              style={{ height: SPLITTER_PX }}
              onPointerDown={(event) => {
                const rowElement = event.currentTarget.previousElementSibling as HTMLElement;
                start(event, {
                  kind: "height",
                  rowId: row.id,
                  startY: event.clientY,
                  // The last row is drawn stretched to the bottom; its own height is what the splitter moves.
                  startHeight: stacked || last ? row.height : rowElement.getBoundingClientRect().height,
                });
              }}
              {...handlers}
            />
            {target?.kind === "newRow" && target.afterRowId === row.id ? <NewRowMark /> : null}
          </Fragment>
        );
      })}
    </div>
  );
}

/** Where a held tile would land inside a row: a line between tiles. */
function PlaceMark() {
  return <div aria-hidden data-drop-mark="place" className="w-0.5 shrink-0 self-stretch rounded-full bg-primary" />;
}

/** Where a held tile would open a row of its own: a line across. */
function NewRowMark() {
  return <div aria-hidden data-drop-mark="row" className="mb-3 h-0.5 shrink-0 rounded-full bg-primary" />;
}
