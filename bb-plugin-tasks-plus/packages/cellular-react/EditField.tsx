// Слой 2 — одиночный редактор ячейки: текстовый input kit (vendor/input.js,
// inputPlain), а не голое поле. Каретка по клику, выделение всего значения и
// стиль плашки .cinp уже в компоненте — оболочка только подставляет начальное
// значение, ставит фокус и переводит Enter/Escape/blur в коммит и отмену через
// задокументированную ручку поля `_input`. Массовую сетку через kit не монтируют
// (README, «Как пользоваться»), но редактируемая ячейка одна за раз — ровно один
// элемент на экран, поэтому здесь монтаж уместен.
import { useLayoutEffect, useRef, type CSSProperties } from "react";

import { input, type TextInputElement } from "../cellular-kit";

export type EditFieldProps = {
  /** Начальное значение — дальше полем владеет kit (uncontrolled). */
  value: string;
  placeholder?: string;
  /** Enter: текущий текст поля. */
  onCommit: (value: string) => void;
  /** Escape или потеря фокуса: закрыть без записи. */
  onCancel: () => void;
};

/** Хост не участвует в раскладке: плашка input — прямой ребёнок родителя. */
const HOST_STYLE: CSSProperties = { display: "contents" };

export function EditField({ value, placeholder, onCommit, onCancel }: EditFieldProps) {
  const host = useRef<HTMLSpanElement>(null);
  // Колбэки берём через ref: поле монтируется один раз, их свежесть не требует ремонтажа.
  const commit = useRef(onCommit);
  commit.current = onCommit;
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useLayoutEffect(() => {
    const target = host.current;
    if (target === null) return;
    const el = input({ placeholder: placeholder ?? "", valueAlign: "left" }) as TextInputElement;
    const field = el._input;
    target.replaceChildren(el);
    field.value = value;
    field.focus();
    field.select();
    // settled: Enter/Escape уже решили судьбу правки — blur при размонтировании
    // не должен повторно звать onCancel поверх состоявшегося коммита.
    let settled = false;
    const onBlur = (): void => {
      if (settled) return;
      settled = true;
      cancel.current();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Enter") {
        event.preventDefault();
        settled = true;
        commit.current(field.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        settled = true;
        cancel.current();
      }
    };
    field.addEventListener("keydown", onKeyDown);
    field.addEventListener("blur", onBlur);
    return () => {
      field.removeEventListener("keydown", onKeyDown);
      field.removeEventListener("blur", onBlur);
      el.remove();
    };
    // Монтируется один раз: value — начальное, колбэки идут через ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <span ref={host} style={HOST_STYLE} onClick={(event) => event.stopPropagation()} />;
}
