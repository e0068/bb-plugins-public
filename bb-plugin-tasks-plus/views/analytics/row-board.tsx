// The analytics screen's layout: rows of sections in a fixed order. Nothing
// moves when a section is pressed — sizes change only by the splitters: the
// one between two sections of a row, dragged sideways, and the one under a
// row, dragged up and down. While a splitter is held the new sizes live here;
// on release they go out once through `onChange`. The model is row-layout.ts.
import { Fragment, useRef, useState, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { resizeCells, resizeRow, type RowLayout } from "./row-layout";

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
    <div className="flex min-h-0 flex-1 flex-col">
      {shown.rows.map((row, rowIndex) => {
        const last = rowIndex === shown.rows.length - 1;
        return (
          <Fragment key={row.id}>
            <div
              data-row={row.id}
              className={cn("flex min-h-0", stacked ? "flex-col gap-3" : "flex-row", last && "flex-1")}
              style={stacked ? undefined : last ? { minHeight: row.height } : { height: row.height, flexShrink: 0 }}
            >
              {row.cells.map((cell, cellIndex) => (
                <Fragment key={cell.id}>
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
                    className="flex min-h-0 min-w-0 overflow-hidden"
                    style={stacked ? { height: row.height } : { flex: `${cell.weight} 1 0` }}
                  >
                    {renderCell(cell.id)}
                  </div>
                </Fragment>
              ))}
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
          </Fragment>
        );
      })}
    </div>
  );
}
