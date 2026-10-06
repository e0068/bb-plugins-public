// Список поля таблицы этапов — навыки, исполнители, шаги автоматизации.
// На широком экране он всплывает под полем, на узком поднимается нижней шторой:
// всплывашка шириной в поле на телефоне вылезает за край экрана, а палец не
// попадает в строку высотой 28px. Штора тут та же, что открывает выбор flow в
// композере (./responsive-overlay), и живёт порталом вне корня поля — поэтому
// закрытие по нажатию мимо поля остаётся только широкому экрану.
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from "react";

import { useIsCompactViewport } from "./hooks/use-compact-viewport.js";
import { popoverPlace, visibleTop, type Ancestor, type PopoverPlace } from "./popover-place.js";
import { ResponsiveDrawerShell } from "./responsive-overlay.js";
import { cn } from "../../lib/utils.js";

/** Всплывашка поля: от его левого края, не уже поля и не шире 22rem; сторону, сдвиг и высоту задаёт `usePopoverPlace`. */
const POPOVER = "absolute left-0 z-20 w-max min-w-full max-w-[22rem] overflow-auto rounded-lg border border-border bg-card p-1 shadow-lg";

/** Предки элемента снизу вверх — для `visibleTop`. */
const ancestorsOf = (el: HTMLElement | null): Ancestor[] =>
  el === null ? [] : [{ clips: getComputedStyle(el).overflowY !== "visible", top: el.getBoundingClientRect().top }, ...ancestorsOf(el.parentElement)];

const samePlace = (a: PopoverPlace | null, b: PopoverPlace): boolean => a !== null && a.up === b.up && a.dx === b.dx && a.maxHeight === b.maxHeight;

/**
 * Место открытой всплывашки в окне: после каждой отрисовки меряет поле — её родителя, — полную высоту содержимого и верх
 * видимой части под шапкой и до кадра браузера ставит её вверх или вниз, сдвигает внутрь окна и ограничивает по высоте. Смена размера окна
 * пересчитывает место.
 */
function usePopoverPlace(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<PopoverPlace | null>(null);
  const [, remeasure] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", remeasure);
    return () => window.removeEventListener("resize", remeasure);
  }, [open]);
  useLayoutEffect(() => {
    const popover = ref.current;
    const field = popover?.parentElement;
    if (!open || popover === null || field === null || field === undefined) return;
    const box = field.getBoundingClientRect();
    // Высота — всего содержимого, а не урезанной всплывашки: иначе потолок, раз поставленный, держал бы сам себя.
    const next = popoverPlace(box, { width: popover.offsetWidth, height: popover.scrollHeight + 2 }, { width: window.innerWidth, height: window.innerHeight, top: visibleTop(ancestorsOf(field.parentElement)) });
    setPlace((current) => (samePlace(current, next) ? current : next));
  });
  return { ref, place };
}

/** Строка списка — одна и во всплывашке, и в шторе. */
export const overlayItem = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-state-hover";

/**
 * Корень поля со списком и его закрытие. Всплывашка закрывается нажатием мимо
 * корня; штора закрывает себя сама — подложкой, Esc и смахиванием вниз, — и то
 * же нажатие закрыло бы её сразу, едва палец коснулся её тела.
 */
export function useFieldOverlay(open: boolean, close: () => void) {
  const compact = useIsCompactViewport();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || compact) return;
    const onDown = (event: PointerEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, compact, close]);
  return { root, compact };
}

export interface FieldOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Список значений — `listbox`, набор команд — `menu`. */
  role: "listbox" | "menu";
  label: string;
  /** Адрес списка для `aria-controls` поля. */
  id?: string;
  /** Ширина всплывашки сверх общей; шторы это не касается — она во весь экран. */
  className?: string;
  children: ReactNode;
}

export function FieldOverlay({ open, onClose, role, label, id, className, children }: FieldOverlayProps) {
  const compact = useIsCompactViewport();
  const { ref, place } = usePopoverPlace(open && !compact);
  if (compact)
    return (
      <ResponsiveDrawerShell open={open} onOpenChange={(next) => !next && onClose()} srLabel={label}>
        {/* `[&_button]:min-h-11` — строка списка под палец: в шторе их рисуют те же кнопки, что и во всплывашке. */}
        <div id={id} role={role} aria-label={label} className="max-h-[70dvh] overflow-auto p-2 pb-8 [&_button]:min-h-11">
          {children}
        </div>
      </ResponsiveDrawerShell>
    );
  return open ? (
    <div
      ref={ref}
      id={id}
      role={role}
      aria-label={label}
      // До первого замера — вниз и не выше 70% окна; дальше место по замеру.
      style={place === null ? { maxHeight: "70vh" } : { maxHeight: place.maxHeight, left: place.dx }}
      className={cn(POPOVER, place?.up === true ? "bottom-full mb-1" : "top-full mt-1", className)}
    >
      {children}
    </div>
  ) : null;
}
