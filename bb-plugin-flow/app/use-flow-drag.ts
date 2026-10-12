// Перетаскивание строк списка flow за ручку: строка стоит на месте, под указателем подсвечивается стык, куда она встанет
// (`dropSeam`), на отпускании новый порядок пишется в настройки. Где встанет строка, считает `placeAmong` по серединам строк.
import { useEffect, useRef, useState, type RefObject } from "react";

import { moveFlow } from "../core/flows";
import { dropSeam, placeAmong } from "../core/reorder";
import { updateFlowSettings } from "./stage-settings-store";

const ROWS = "[data-flow-row]";

/** Середины строк flow сверху вниз. */
const rowMiddles = (list: HTMLElement | null): number[] =>
  [...(list?.querySelectorAll<HTMLElement>(ROWS) ?? [])].map((row) => {
    const { top, bottom } = row.getBoundingClientRect();
    return (top + bottom) / 2;
  });

/** Стык под несомой строкой: id строки, у которой он, и с какой стороны. */
export type FlowSeam = { id: string; side: "before" | "after" };

export function useFlowDrag(list: RefObject<HTMLElement | null>, ids: readonly string[]): { grab: (id: string) => void; grabbed: string | null; seam: FlowSeam | null } {
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const latest = useRef(ids);
  latest.current = ids;
  useEffect(() => {
    if (grabbed === null) return;
    let last: number | null = null;
    const onMove = (event: PointerEvent) => {
      last = placeAmong(rowMiddles(list.current), latest.current.indexOf(grabbed), event.clientY);
      setTo(last);
    };
    const onUp = () => {
      setGrabbed(null);
      setTo(null);
      if (last !== null && last !== latest.current.indexOf(grabbed)) updateFlowSettings((settings) => moveFlow(settings, grabbed, last!));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [grabbed, list]);
  return { grab: setGrabbed, grabbed, seam: grabbed === null || to === null ? null : dropSeam(ids, grabbed, to) };
}
