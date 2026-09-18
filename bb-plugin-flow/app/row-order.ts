// Ряды кнопок в flex-контейнере с переносом: после раскладки и на каждое
// изменение ширины кнопки группируются по верхнему краю. Кнопка получает
// чётный `order`, раскрытый список — `order` последней кнопки своего ряда
// плюс один и встаёт строкой сразу под этим рядом.
import { useLayoutEffect, useState, type RefObject } from "react";

import { rowEnds } from "../core/wrap";

/** Селектор кнопок ряда внутри контейнера; списки его не несут. */
export const ROW_CELL = "[data-row-cell]";

const sameList = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** Для каждой кнопки — номер последней кнопки её ряда; до раскладки все в одном ряду. */
export function useRowEnds(container: RefObject<HTMLElement | null>, count: number): number[] {
  const [ends, setEnds] = useState<number[]>(() => Array.from({ length: count }, () => count - 1));
  useLayoutEffect(() => {
    const element = container.current;
    if (element === null) return;
    const measure = () => {
      const tops = [...element.querySelectorAll<HTMLElement>(ROW_CELL)].map((cell) => cell.offsetTop);
      const next = rowEnds(tops);
      setEnds((current) => (sameList(current, next) ? current : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [container, count]);
  return ends.length === count ? ends : Array.from({ length: count }, () => count - 1);
}

export const cellOrder = (index: number): number => index * 2;

export const panelOrder = (ends: readonly number[], index: number): number => (ends[index] ?? index) * 2 + 1;
