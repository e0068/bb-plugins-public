// Список поля таблицы этапов — навыки, исполнители, шаги автоматизации.
// На широком экране он всплывает под полем, на узком поднимается нижней шторой:
// всплывашка шириной в поле на телефоне вылезает за край экрана, а палец не
// попадает в строку высотой 28px. Штора тут та же, что открывает выбор flow в
// композере (./responsive-overlay), и живёт порталом вне корня поля — поэтому
// закрытие по нажатию мимо поля остаётся только широкому экрану.
import { useEffect, useRef, type ReactNode } from "react";

import { useIsCompactViewport } from "./hooks/use-compact-viewport.js";
import { ResponsiveDrawerShell } from "./responsive-overlay.js";
import { cn } from "../../lib/utils.js";

/** Всплывашка поля: прижата к его левому краю, не уже поля и не шире 22rem. */
const POPOVER = "absolute left-0 top-full z-20 mt-1 max-h-80 w-max min-w-full max-w-[22rem] overflow-auto rounded-lg border border-border bg-card p-1 shadow-lg";

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
    <div id={id} role={role} aria-label={label} className={cn(POPOVER, className)}>
      {children}
    </div>
  ) : null;
}
