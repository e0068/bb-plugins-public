import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { clampWidth, nextWidthFromDrag, type PaneSide } from "./geometry";

export interface ResizableWidthOptions {
  /** Starting size (px) if there's nothing in storage. */
  initial: number;
  min: number;
  max: number;
  /** localStorage key for remembering the size across sessions. */
  storageKey?: string;
  /**
   * Which side of the container the pane sits on. "right" (default) — handle
   * on the left edge, drag left — wider. "left" — handle on the right edge,
   * drag right — wider. For height panes: "left" — handle at the bottom, drag
   * down — taller; "right" — handle at the top, drag up — taller.
   */
  side?: PaneSide;
}

function readSaved(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// Shared resize core for a single axis. The axis determines which pointer
// coordinate to read (clientX/clientY) and which cursor to set; the sign and
// clamping live in the pure geometry. Width and height are two facades over it, differing only by axis.
function useResizableAxis(
  axis: "x" | "y",
  { initial, min, max, storageKey, side = "right" }: ResizableWidthOptions,
) {
  const [size, setSize] = useState(() => {
    if (storageKey) {
      const saved = readSaved(storageKey);
      if (saved != null) return clampWidth(saved, min, max);
    }
    return clampWidth(initial, min, max);
  });

  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, String(size));
    } catch {
      // private mode/quota — silently continue without remembering.
    }
  }, [storageKey, size]);

  const startResize = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault();
      const start = axis === "x" ? event.clientX : event.clientY;
      const startSize = sizeRef.current;
      const onMove = (e: PointerEvent) => {
        const current = axis === "x" ? e.clientX : e.clientY;
        setSize(nextWidthFromDrag(startSize, start, current, min, max, side));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [axis, min, max, side],
  );

  return { size, startResize, setSize };
}

/**
 * The width of a pane pinned to the right edge, with the handle on its left
 * side. Returns the current width and a handler for ResizeHandle. Dragging
 * the handle left expands the pane. The value is clamped to [min, max] and
 * (if storageKey is given) remembered in localStorage.
 */
export function useResizableWidth(options: ResizableWidthOptions) {
  const { size, startResize, setSize } = useResizableAxis("x", options);
  return { width: size, startResize, setWidth: setSize };
}

/**
 * The height of a horizontal pane with the handle on its bottom edge (side
 * "left", the default for this hook): dragging the handle down makes the
 * pane taller. Pairs with HorizontalResizeHandle. The value is clamped to
 * [min, max] and (if storageKey is given) remembered in localStorage.
 */
export function useResizableHeight(options: ResizableWidthOptions) {
  const { size, startResize, setSize } = useResizableAxis("y", { side: "left", ...options });
  return { height: size, startResize, setHeight: setSize };
}

/**
 * A vertical divider handle. A thin line in the border color, highlighted on
 * hover; the click zone is wider than the line itself thanks to invisible padding on the sides.
 */
export function ResizeHandle({
  onPointerDown,
  className,
}: {
  onPointerDown: (event: ReactPointerEvent) => void;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className={`group relative w-px shrink-0 cursor-col-resize bg-border${
        className ? ` ${className}` : ""
      }`}
    >
      {/* invisible click-zone padding on the sides of the line */}
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      <div className="absolute inset-y-0 -left-px -right-px opacity-0 transition-opacity group-hover:opacity-100 bg-primary" />
    </div>
  );
}

/**
 * A horizontal divider handle between two panes stacked on top of each other.
 * A thin line in the border color, highlighted on hover; the click zone is
 * wider than the line itself thanks to invisible padding above and below.
 */
export function HorizontalResizeHandle({
  onPointerDown,
  className,
}: {
  onPointerDown: (event: ReactPointerEvent) => void;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      onPointerDown={onPointerDown}
      className={`group relative h-px shrink-0 cursor-row-resize bg-border${
        className ? ` ${className}` : ""
      }`}
    >
      {/* invisible click-zone padding above and below the line */}
      <div className="absolute inset-x-0 -top-1.5 -bottom-1.5" />
      <div className="absolute inset-x-0 -top-px -bottom-px opacity-0 transition-opacity group-hover:opacity-100 bg-primary" />
    </div>
  );
}
