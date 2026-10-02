// Текст агента в брифе со ссылками: `[текст](цель)` — ссылка bb, та же, что у
// результатов этапа, остальное — текст как есть. Корни файлов треда кладёт
// загрузчик брифа в контекст, чтобы не тянуть их пропсом через каждую строку.
import { createContext, useContext, type MouseEvent } from "react";

import { textParts } from "../core/inline-links";
import { textBlocks, type Block } from "../core/text-blocks";
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
  return textParts(text).map((part, i) => {
    const shown =
      part.kind === "text" ? (
        part.text
      ) : (
        <ResultAnchor key={i} target={part.target} line={part.line} roots={roots} className="underline underline-offset-2 hover:text-primary">
          {part.label}
        </ResultAnchor>
      );
    return part.strong ? <strong key={i}>{shown}</strong> : shown;
  });
}

const LIST_CLASS = { ordered: "list-decimal", bullet: "list-disc" } as const;

function Blocks({ blocks }: { blocks: readonly Block[] }) {
  return blocks.map((block, i) =>
    block.kind === "paragraph" ? (
      <span key={i} className="block">
        <LinkedText text={block.text} />
      </span>
    ) : (
      // Спаны с ролями, а не ul/li: текст стоит и внутри кнопки варианта, где блочные теги недопустимы.
      <span key={i} role="list" className={`block pl-4 ${block.ordered ? LIST_CLASS.ordered : LIST_CLASS.bullet}`}>
        {block.items.map((item, j) => (
          <span key={j} role="listitem" className="list-item">
            <LinkedText text={item.text} />
            <Blocks blocks={item.children} />
          </span>
        ))}
      </span>
    ),
  );
}

/** Текст агента с абзацами и многоуровневыми списками; строка без них рисуется ровно как `LinkedText`. */
export function RichText({ text }: { text: string }) {
  const blocks = textBlocks(text);
  return blocks.length === 1 && blocks[0]!.kind === "paragraph" && !text.includes("\n") ? <LinkedText text={text} /> : <Blocks blocks={blocks} />;
}
