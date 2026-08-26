import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { clampWidth, nextWidthFromDrag, type PaneSide } from "./geometry";

export interface ResizableWidthOptions {
  /** Стартовая ширина (px), если в хранилище ничего нет. */
  initial: number;
  min: number;
  max: number;
  /** Ключ localStorage для запоминания ширины между сессиями. */
  storageKey?: string;
  /**
   * С какой стороны контейнера стоит пан. "right" (по умолчанию) — ручка на
   * левом крае, тянем влево — шире. "left" — ручка на правом крае, тянем
   * вправо — шире.
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

/**
 * Ширина пана, прижатого к правому краю, с ручкой на его левой стороне.
 * Возвращает текущую ширину и обработчик для ResizeHandle. Тянем ручку влево —
 * пан расширяется. Значение зажимается в [min, max] и (если задан storageKey)
 * запоминается в localStorage.
 */
export function useResizableWidth({
  initial,
  min,
  max,
  storageKey,
  side = "right",
}: ResizableWidthOptions) {
  const [width, setWidth] = useState(() => {
    if (storageKey) {
      const saved = readSaved(storageKey);
      if (saved != null) return clampWidth(saved, min, max);
    }
    return clampWidth(initial, min, max);
  });

  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {
      // приватный режим/квота — молча продолжаем без запоминания.
    }
  }, [storageKey, width]);

  const startResize = useCallback(
    (event: ReactPointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = widthRef.current;
      const onMove = (e: PointerEvent) => {
        setWidth(nextWidthFromDrag(startWidth, startX, e.clientX, min, max, side));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [min, max, side],
  );

  return { width, startResize, setWidth };
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
