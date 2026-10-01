// Текст агента в брифе со ссылками: `[текст](цель)` — ссылка bb, та же, что у
// результатов этапа, остальное — текст как есть. Корни файлов треда кладёт
// загрузчик брифа в контекст, чтобы не тянуть их пропсом через каждую строку.
import { createContext, useContext, type MouseEvent } from "react";

import { textParts } from "../core/inline-links";
import type { FileRoots } from "../core/result-link";
import { ResultAnchor } from "./cells";

export const FileRootsContext = createContext<FileRoots | null>(null);

/**
 * Клик пришёл по ссылке: ссылка стоит и внутри кнопки варианта, и в поле пункта, и открывает файл, а не выбирает
 * вариант. Всплытие не гасится — Cmd/Ctrl-клик по ссылке ловит корень плагина у хоста.
 */
export const onLink = (event: MouseEvent): boolean => event.target instanceof Element && event.target.closest("a[href]") !== null;

export function LinkedText({ text }: { text: string }) {
  const roots = useContext(FileRootsContext);
  return textParts(text).map((part, i) =>
    part.kind === "text" ? (
      part.text
    ) : (
      <ResultAnchor key={i} target={part.target} line={part.line} roots={roots} className="underline underline-offset-2 hover:text-primary">
        {part.label}
      </ResultAnchor>
    ),
  );
}
