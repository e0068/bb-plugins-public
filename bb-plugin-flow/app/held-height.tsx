// Высота карточки брифа и итога прогона под ней прошлого показа, в localStorage
// окна по id брифа. Хост перемонтирует карточки ленты, когда перерисовывает её,
// и заново смонтированная карточка сначала ждёт бриф с сервера. Встань она на это время скелетоном ниже
// себя прежней — лента сожмётся, прокрутка упрётся в низ, хост снова прижмёт
// ленту к низу и при следующем росте докрутит её туда: владельца откинет к
// последнему сообщению. Поэтому скелетон стоит в прежнюю высоту карточки, а
// заглушка итога — в прежнюю высоту итога, и вставшие запоминают свою. Высоту
// держит сам скелетон, а не рамка вокруг: у него те же поля `my-3`, что у
// карточки, и они схлопываются с соседями одинаково — рамка с min-height
// удержала бы нижнее поле внутри себя и сдвинула ленту на его высоту.
import { useEffect, useRef, useState, type RefObject } from "react";

/** Ключ высоты карточки брифа `id`. */
export const briefHeightKey = (id: string): string => `decisions:height:${id}`;

/** Ключ высоты итога прогона под брифом `id`. */
export const summaryHeightKey = (id: string): string => `decisions:summary-height:${id}`;

// localStorage бывает недоступен или переполнен: высота — удобство, падать из-за неё нельзя.
const readHeight = (key: string): number | null => {
  try {
    const height = Number(window.localStorage.getItem(key));
    return Number.isFinite(height) && height > 0 ? height : null;
  } catch {
    return null;
  }
};

const writeHeight = (key: string, height: number): void => {
  try {
    window.localStorage.setItem(key, String(height));
  } catch {
    // Не запомнилась — в следующий раз карточка встанет без запаса, как раньше.
  }
};

/**
 * Высота прошлого показа под ключом `key` — её держит заглушка, — и рамка
 * `frame`: пока `shown`, её первый ребёнок — вставший блок, и его высота
 * запоминается на каждой смене размера. Рамка — `display: contents`, в
 * вёрстке её нет.
 */
export function useHeldHeight(key: string, shown: boolean): { held: number | null; frame: RefObject<HTMLDivElement | null> } {
  const frame = useRef<HTMLDivElement>(null);
  // Читается раз на монтирование: запас — это прошлый показ, а не то, что карточка запомнит сейчас.
  const [held] = useState(() => readHeight(key));
  // Без зависимостей: карточка меняется на месте — форма, отвеченный бриф, — и следить надо за той, что стоит сейчас.
  useEffect(() => {
    const card = shown ? frame.current?.firstElementChild : null;
    if (card == null || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      const height = Math.round(card.getBoundingClientRect().height);
      if (height > 0) writeHeight(key, height);
    });
    observer.observe(card);
    return () => observer.disconnect();
  });
  return { held, frame };
}
