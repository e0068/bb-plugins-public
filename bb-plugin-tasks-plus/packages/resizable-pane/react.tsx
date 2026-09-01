import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { clampWidth, nextWidthFromDrag, type PaneSide } from "./geometry";

export interface ResizableWidthOptions {
  /** Стартовый размер (px), если в хранилище ничего нет. */
  initial: number;
  min: number;
  max: number;
  /** Ключ localStorage для запоминания размера между сессиями. */
  storageKey?: string;
  /**
   * С какой стороны контейнера стоит пан. "right" (по умолчанию) — ручка на
   * левом крае, тянем влево — шире. "left" — ручка на правом крае, тянем
   * вправо — шире. Для высотных панов: "left" — ручка снизу, тянем вниз —
   * выше; "right" — ручка сверху, тянем вверх — выше.
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

// Общее ядро резайза по одной оси. Ось задаёт, какую координату указателя брать
// (clientX/clientY) и какой курсор ставить; знак и зажим — в чистой геометрии.
// Ширина и высота — два фасада над ним, отличаются только осью.
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
      // приватный режим/квота — молча продолжаем без запоминания.
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
 * Ширина пана, прижатого к правому краю, с ручкой на его левой стороне.
 * Возвращает текущую ширину и обработчик для ResizeHandle. Тянем ручку влево —
 * пан расширяется. Значение зажимается в [min, max] и (если задан storageKey)
 * запоминается в localStorage.
 */
export function useResizableWidth(options: ResizableWidthOptions) {
  const { size, startResize, setSize } = useResizableAxis("x", options);
  return { width: size, startResize, setWidth: setSize };
}

/**
 * Высота горизонтального пана с ручкой на его нижнем крае (side "left",
 * по умолчанию для этого хука): тянем ручку вниз — пан выше. Пара к
 * HorizontalResizeHandle. Значение зажимается в [min, max] и (если задан
 * storageKey) запоминается в localStorage.
 */
export function useResizableHeight(options: ResizableWidthOptions) {
  const { size, startResize, setSize } = useResizableAxis("y", { side: "left", ...options });
  return { height: size, startResize, setHeight: setSize };
}

/**
 * Вертикальный разделитель-ручка. Тонкая линия по цвету border, при наведении
 * подсвечивается; клик-зона шире самой линии за счёт невидимого запаса по бокам.
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
      {/* невидимый запас клик-зоны по бокам линии */}
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      <div className="absolute inset-y-0 -left-px -right-px opacity-0 transition-opacity group-hover:opacity-100 bg-primary" />
    </div>
  );
}

/**
 * Горизонтальный разделитель-ручка между двумя панами, стоящими друг над другом.
 * Тонкая линия по цвету border, при наведении подсвечивается; клик-зона шире
 * самой линии за счёт невидимого запаса сверху и снизу.
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
      {/* невидимый запас клик-зоны сверху и снизу линии */}
      <div className="absolute inset-x-0 -top-1.5 -bottom-1.5" />
      <div className="absolute inset-x-0 -top-px -bottom-px opacity-0 transition-opacity group-hover:opacity-100 bg-primary" />
    </div>
  );
}
