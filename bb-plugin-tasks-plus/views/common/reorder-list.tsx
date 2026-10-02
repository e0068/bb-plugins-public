// A list of fields to show and order, as Display's «Fields — drag to
// reorder»: a grip that drags a row to a new place, a toggle that shows or
// hides it, the title always shown. The list keeps no fields of its own —
// the caller says which rows there are and what a toggle and a move mean.
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/**
 * The index a dragged row lands at, from an "insert before slot N" drop.
 * Once the row at `from` is taken out, everything after it shifts down one,
 * so a slot past `from` lands one lower.
 */
export function dropDestination(from: number, insertBefore: number): number {
  return insertBefore > from ? insertBefore - 1 : insertBefore;
}

export interface ReorderRow {
  id: string;
  label: string;
  visible: boolean;
  /** Always shown: it only moves, so it has no toggle. */
  locked: boolean;
}

interface DragState {
  from: number;
  /** Slot the row would drop before (0..length; length = past the end). */
  insertBefore: number;
}

function RowToggle({ label, visible, onToggle }: { label: string; visible: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={visible}
      onClick={onToggle}
      className="flex flex-1 items-center gap-2 rounded-sm px-1.5 py-1 text-left text-sm hover:bg-state-hover"
    >
      <span className={cn("flex-1 truncate", !visible && "text-muted-foreground")}>{label}</span>
      <span className="flex size-4 shrink-0 items-center justify-center">
        {visible ? <Icon name="Check" className="size-3.5" /> : null}
      </span>
    </button>
  );
}

export function ReorderList({
  label,
  rows,
  onToggle,
  onMove,
  trailing,
}: {
  label: string;
  rows: readonly ReorderRow[];
  onToggle: (id: string) => void;
  /** A row dragged from `from` to land at `to`. */
  onMove: (from: number, to: number) => void;
  /** What stands after a row — Display's pin. */
  trailing?: (row: ReorderRow) => ReactNode;
}) {
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);

  const beginDrag = (event: ReactPointerEvent, from: number) => {
    // The grip owns the gesture; keep it off the row's toggle click.
    event.preventDefault();
    event.stopPropagation();
    let insertBefore = from;
    const onPointerMove = (moveEvent: PointerEvent) => {
      const slot = rowRefs.current.slice(0, rows.length).findIndex((element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return moveEvent.clientY < rect.top + rect.height / 2;
      });
      insertBefore = slot < 0 ? rows.length : slot;
      setDrag({ from, insertBefore });
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setDrag(null);
      onMove(from, dropDestination(from, insertBefore));
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    setDrag({ from, insertBefore: from });
  };

  return (
    <div role="group" aria-label={label} className="flex flex-col">
      {rows.map((row, index) => (
        <div
          key={row.id}
          ref={(element) => {
            rowRefs.current[index] = element;
          }}
          className={cn("relative flex items-center gap-1 rounded-sm", drag?.from === index && "opacity-40")}
        >
          {drag !== null && drag.insertBefore === index ? (
            <div className="pointer-events-none absolute inset-x-1 -top-px h-0.5 rounded-full bg-primary" />
          ) : null}
          <button
            type="button"
            aria-label={`Reorder ${row.label}`}
            onPointerDown={(event) => beginDrag(event, index)}
            className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center text-subtle-foreground hover:text-foreground"
          >
            <Icon name="DragDropVertical" className="size-3.5" />
          </button>
          {row.locked ? (
            <span className="flex flex-1 items-center gap-2 px-1.5 py-1 text-sm">
              <span className="flex-1 truncate">{row.label}</span>
              <span className="text-xs text-subtle-foreground">always shown</span>
            </span>
          ) : (
            <RowToggle label={row.label} visible={row.visible} onToggle={() => onToggle(row.id)} />
          )}
          {trailing?.(row)}
        </div>
      ))}
    </div>
  );
}
