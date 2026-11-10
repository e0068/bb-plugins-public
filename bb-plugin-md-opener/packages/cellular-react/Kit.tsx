// Слой 2 — оболочка: фабрика kit внутри React-дерева. Kit не переписывает
// разметку kit: он один раз создаёт элемент фабрикой и дальше держит его в
// согласии с пропсами React. Фабрика замыкается на мешок пропсов (props-bag.ts):
// колбэки и объекты в нём всегда свежие, значения копируются. Когда меняются
// значения, элемент с `_refresh` (кнопка, числовое поле) перечитывает мешок; у
// фабрики без `_refresh` (сегмент, переключатель, текстовое поле) элемент
// пересоздаётся — только при реальной смене значений, поэтому фокус в поле и
// открытое меню переживают обычный ререндер.
import { useLayoutEffect, useRef, type CSSProperties } from "react";

import type { KitElement } from "../cellular-kit";
import { signatureOf, syncBag, type Bag } from "./props-bag";

export type KitProps<P extends object> = {
  /** Фабрика kit в форме пропсов: button, input, segment, toggle, uiCell. Читается на каждом рендере, стабильность ссылки не требуется. */
  make: (props: P) => HTMLElement;
  props: P;
  className?: string;
};

/** Хост не участвует в раскладке: элемент kit — прямой flex-ребёнок родителя. */
const HOST_STYLE: CSSProperties = { display: "contents" };

// Меню kit висит на document.body; ручку меню kit наружу не отдаёт. Закрывается
// оно двумя путями (kit/menu.js): меню поля — по blur поля, которое его держит
// фокусом; меню кнопки — по pointerdown снаружи. Отсюда две уборки. Снять фокус
// со своего элемента — точечно и безопасно, делается и при уборке, и при
// пересоздании. Изобразить «клик снаружи» — глобально (закроет все меню kit),
// поэтому только при уборке и только когда меню kit действительно открыто.
// Событие идёт с хоста Kit, а не с документа: для меню kit хост снаружи якоря,
// а слой Radix, внутри которого стоит Kit, видит цель внутри себя и не
// закрывается. Хост в момент уборки ещё в документе — React снимает узел после
// эффектов детей.
const blurOwn = (el: HTMLElement): void => {
  const active = document.activeElement;
  if (active instanceof HTMLElement && el.contains(active)) active.blur();
};
const hasOpenKitMenu = (): boolean => document.body.querySelector(":scope > .lfomenu") !== null;
const closeKitMenus = (from: HTMLElement | null): void => {
  if (hasOpenKitMenu()) (from ?? document).dispatchEvent(new Event("pointerdown", { bubbles: true }));
};

export function Kit<P extends object>({ make, props, className }: KitProps<P>) {
  const host = useRef<HTMLSpanElement>(null);
  const latest = useRef<Bag>(props as Bag);
  latest.current = props as Bag;
  const makeRef = useRef(make);
  makeRef.current = make;
  const bag = useRef<Bag>({});
  const element = useRef<KitElement | null>(null);
  const signature = useRef<string | null>(null);

  const mount = (): void => {
    const target = host.current;
    if (target === null) return;
    const el = makeRef.current(bag.current as P) as KitElement;
    element.current = el;
    target.replaceChildren(el);
  };

  useLayoutEffect(() => {
    syncBag(bag.current, latest);
    signature.current = signatureOf(latest.current);
    mount();
    return () => {
      const el = element.current;
      if (el !== null) blurOwn(el);
      closeKitMenus(host.current);
      el?.remove();
      element.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- создание один раз; пропсы догоняет эффект ниже
  }, []);

  useLayoutEffect(() => {
    syncBag(bag.current, latest);
    const next = signatureOf(latest.current);
    if (next === signature.current) return;
    signature.current = next;
    const el = element.current;
    if (el?._refresh !== undefined) {
      el._refresh();
      return;
    }
    if (el !== null) {
      blurOwn(el);
      el.remove();
    }
    mount();
  });

  return <span ref={host} className={className} style={HOST_STYLE} />;
}
