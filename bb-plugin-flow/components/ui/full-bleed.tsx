// Растяжка на ширину ленты: bb рисует виджет внутри колонки сообщения и не даёт плагину ширины шире неё. Компонент
// меряет ближайшую прокручиваемую ленту и сдвигает себя к её краю — блок встаёт во всю ширину диалога, а соседние
// блоки остаются шириной колонки. Ленты нет — блок шириной колонки. Это готовый компонент: стиль живёт здесь, а
// интерфейс берёт его, не дописывая своего.
import { useLayoutEffect, useRef, type ReactNode } from "react";

import { cn } from "../../lib/utils";

type Box = { left: number; width: number };

/** Отступ блока от краёв ленты. */
const GUTTER = 16;

/** Сдвиг и ширина блока: от края ленты с отступом до другого её края; колонка шире этого — её ширина и без сдвига. */
export const bleedOf = (lane: Box, column: Box, gutter: number): Box => {
  const width = lane.width - gutter * 2;
  return width <= column.width ? { left: 0, width: column.width } : { left: lane.left + gutter - column.left, width };
};

const scrolls = (element: Element): boolean => /(auto|scroll)/.test(getComputedStyle(element).overflowY);

/** Ближайший прокручиваемый предок — лента треда; нет такого — `null`. */
const laneOf = (element: HTMLElement): HTMLElement | null => {
  const parent = element.parentElement;
  return parent === null ? null : scrolls(parent) ? parent : laneOf(parent);
};

export function FullBleed({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    const column = box?.parentElement;
    const lane = box === null ? null : laneOf(box);
    if (box === null || column == null || lane === null) return;
    const fit = () => {
      const laneBox = lane.getBoundingClientRect();
      const columnBox = column.getBoundingClientRect();
      const bleed = bleedOf({ left: laneBox.left, width: lane.clientWidth }, { left: columnBox.left, width: columnBox.width }, GUTTER);
      box.style.setProperty("--bleed-left", `${bleed.left}px`);
      box.style.setProperty("--bleed-width", `${bleed.width}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(lane);
    observer.observe(column);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={cn("relative ml-[var(--bleed-left,0px)] w-[var(--bleed-width,100%)] max-w-none", className)}>
      {children}
    </div>
  );
}
