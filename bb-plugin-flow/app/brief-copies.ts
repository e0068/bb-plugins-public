// Строка одного брифа может стоять в нескольких сообщениях ленты: стоп-хук
// требует повторить её, фоновая задача будит агента. Карточку рисует только
// последняя по ленте копия, остальные молчат — двух карточек одного брифа и
// второго ответа на него нет. Копия отмечается якорем в DOM, порядок копий —
// порядок якорей в документе. Всё решается в layout-эффекте, до отрисовки:
// карточка не мигает пустым кадром.
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

const anchors = new Map<string, Set<Element>>();
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

const follows = (earlier: Element, later: Element) => (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

const lastInDocument = (elements: Iterable<Element>): Element | undefined =>
  [...elements].reduce<Element | undefined>((last, element) => (last === undefined || follows(last, element) ? element : last), undefined);

/** Якорь копии и признак, что она последняя в ленте среди копий того же брифа. */
export function useLatestCopy(briefId: string): { anchor: RefObject<HTMLSpanElement | null>; latest: boolean } {
  const anchor = useRef<HTMLSpanElement>(null);
  const [latest, setLatest] = useState(false);
  useLayoutEffect(() => {
    const element = anchor.current;
    if (element === null) return undefined;
    const copies = anchors.get(briefId) ?? new Set<Element>();
    anchors.set(briefId, copies.add(element));
    const check = () => setLatest(lastInDocument(copies) === element);
    listeners.add(check);
    notify();
    return () => {
      listeners.delete(check);
      copies.delete(element);
      if (copies.size === 0) anchors.delete(briefId);
      notify();
    };
  }, [briefId]);
  return { anchor, latest };
}
