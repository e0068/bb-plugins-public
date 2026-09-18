// Раскрытие кнопки брифа без сдвига формы. Лента треда прижата к низу: когда
// бриф растёт, хост докручивает её вниз, и форма подскакивает. Хост отпускает
// низ только прокрутку владельца — дальше 4px от низа и в течение секунды
// после колеса, клавиши или касания; программный сдвиг без этого он не
// замечает. Поэтому перед раскрытием лента получает колесо вверх и уходит за
// порог, а после отрисовки возвращается на сдвиг нажатой кнопки: список
// открывается вниз, под композер.
import { useCallback, useLayoutEffect, useRef } from "react";

/** Порог хоста «у низа», px: ближе лента считается прижатой. */
const HOST_BOTTOM_SLACK = 4;

const scrollable = (element: HTMLElement): boolean => {
  const overflow = getComputedStyle(element).overflowY;
  return (overflow === "auto" || overflow === "scroll") && element.scrollHeight > element.clientHeight;
};

/** Ближайший прокручиваемый предок; нет — `null`. */
export const scrollParentOf = (element: Element): HTMLElement | null => {
  for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) if (scrollable(parent)) return parent;
  return null;
};

type Pending = { element: Element; scroller: HTMLElement; top: number };

const restore = ({ element, scroller, top }: Pending): void => {
  const shift = element.getBoundingClientRect().top - top;
  if (element.isConnected && Math.abs(shift) >= 1) scroller.scrollTop += shift;
};

/**
 * `anchor(element)` вызывается перед сменой состояния, которая раскрывает или сворачивает список.
 * Возврат прокрутки идёт после отрисовки и ещё в двух кадрах: хост может докрутить ленту в своём обработчике размера.
 */
export function useScrollAnchor(): (element: Element | null | undefined) => void {
  const pending = useRef<Pending | null>(null);
  useLayoutEffect(() => {
    const current = pending.current;
    if (current === null) return;
    pending.current = null;
    restore(current);
    const frame = requestAnimationFrame(() => {
      restore(current);
      requestAnimationFrame(() => restore(current));
    });
    return () => cancelAnimationFrame(frame);
  });
  return useCallback((element) => {
    if (element === null || element === undefined) return;
    const scroller = scrollParentOf(element);
    if (scroller === null) return;
    const toBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (toBottom <= HOST_BOTTOM_SLACK) {
      // Колесо открывает у хоста окно «владелец крутит сам», сдвиг за порог в этом окне снимает прижатие к низу.
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -1 }));
      scroller.scrollTop -= HOST_BOTTOM_SLACK + 1 - toBottom;
    }
    pending.current = { element, scroller, top: element.getBoundingClientRect().top };
  }, []);
}
