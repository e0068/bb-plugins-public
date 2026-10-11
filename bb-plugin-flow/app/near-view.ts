// Дошла ли прокрутка ленты до элемента. Тред открывается внизу, а брифы выше
// давно отвечены: их карточки — сотни узлов, и хост пересчитывает каждый со
// стилями всех плагинов, так что переход в тред с тремя брифами тормозил на
// полсекунды. Бриф вдали от экрана ждёт, пока до него не останется экран
// прокрутки, и встаёт тогда; вставший больше не прячется.
import { useCallback, useEffect, useState, type RefCallback } from "react";

/** На сколько вперёд прокрутки бриф встаёт заранее, чтобы владелец не увидел заглушку. */
const AHEAD = "100% 0px";

/** Прокручивает вверх-вниз: обёртка с одним `overflow-x` тоже считается `overflowY: auto`, но ей прокручивать нечего. */
const scrolls = (element: Element): boolean =>
  element.scrollHeight > element.clientHeight && /(auto|scroll|overlay)/.test(getComputedStyle(element).overflowY);

/** Ближайший прокручиваемый предок, а нет его — вьюпорт: поле `rootMargin` растягивает только корень, а не обрезку ленты. */
const scrollerOf = (element: Element): Element | null => {
  for (let node = element.parentElement; node !== null; node = node.parentElement) if (scrolls(node)) return node;
  return null;
};

/** `near` — элемент на экране или в экране прокрутки от него. Без IntersectionObserver он на экране сразу. */
export function useNearView(): { ref: RefCallback<Element>; near: boolean } {
  const watchable = typeof IntersectionObserver === "function";
  const [near, setNear] = useState(!watchable);
  const [target, setTarget] = useState<Element | null>(null);
  useEffect(() => {
    if (near || target === null) return;
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && setNear(true), {
      root: scrollerOf(target),
      rootMargin: AHEAD,
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [near, target]);
  const ref = useCallback((element: Element | null) => setTarget(element), []);
  return { ref, near };
}
