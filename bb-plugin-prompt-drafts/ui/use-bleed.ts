// Слой 4 — оболочка UI: меряет выход ряда за колонку по живой раскладке.
import { useEffect, useState, type RefObject } from "react";
import { edgeBleed, type Span } from "../core/bleed";

const NONE: Span = { left: 0, right: 0 };

/** Ближайший предок, который режет выступающее вбок, — до его краёв и тянется ряд. */
function clippingAncestor(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).overflowX !== "visible") return node;
  }
  return null;
}

/**
 * Насколько ряд выходит за свою колонку с каждой стороны. Колонка — родитель
 * ряда; перемеряется, когда меняется размер её или обрезающего блока.
 */
export function useBleed(rowRef: RefObject<HTMLElement | null>, mounted: boolean): Span {
  const [bleed, setBleed] = useState<Span>(NONE);

  useEffect(() => {
    const column = rowRef.current?.parentElement ?? null;
    if (!mounted || column === null || typeof ResizeObserver === "undefined") return;
    const clip = clippingAncestor(column);

    const measure = () => {
      const clipBox =
        clip === null
          ? { left: 0, right: document.documentElement.clientWidth }
          : (() => {
              const left = clip.getBoundingClientRect().left + clip.clientLeft;
              return { left, right: left + clip.clientWidth };
            })();
      const next = edgeBleed(column.getBoundingClientRect(), clipBox);
      setBleed((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    if (clip !== null) observer.observe(clip);
    return () => observer.disconnect();
  }, [rowRef, mounted]);

  return bleed;
}
