// Строка ввода брифа одного вида: «+» картинок слева, текст, микрофон и
// действия справа. Ею дописывают пункт критерия и весь бриф («Дополнить») и
// отвечают своими словами («Свой ответ») — у вопросов, и комментируют Демонстрацию.
// Метки картинок «[картинка N]» в тексте нарисованы плашками: под прозрачным
// текстом поля лежит его копия, в которой метки — теги, а курсор и правка
// остаются у самого поля. Миниатюры картинок строки — под текстом, в той же рамке.
import type { ReactNode } from "react";

import { splitMarkers, type MarkedPart } from "../core/image-markers";
import { cn } from "../lib/utils";
import { AttachButton, FieldImages, imageTag, usePasteImages } from "./attachments";
import { useMessages } from "./locale-context";
import { useMentions } from "./mentions";
import { useVoiceField } from "./voice";

/** Текст строки — шрифт сообщения в треде: 13 px, интерлиньяж 1.625, и отступы пункта критерия. */
export const addRowText = "min-w-0 flex-1 whitespace-pre-wrap break-words py-2 text-sm leading-relaxed";

/** Текст поля кусками, если в нём есть метка картинки; без меток — `null`, и копия под полем не нужна. */
export function useMarkedParts(value: string): readonly MarkedPart[] | null {
  const parts = splitMarkers(value, useMessages().attachments.marker);
  return parts.some((part) => part.marker) ? parts : null;
}

/** Поле поверх копии: текст прозрачен, курсор виден, а плашки рисует копия. */
export const overCopy = "relative bg-transparent text-transparent caret-foreground";

/**
 * Копия текста поля под ним: обычный текст — своим цветом, метка — плашкой. Скобки метки прозрачны и служат плашке
 * отступами, поэтому ширина текста та же, что у поля, и строки не расходятся. Хвостовой перевод строки поле
 * показывает пустой строкой — копия держит её невидимым символом. `className` — тот же текст, что у поля.
 */
export function MarkedCopy({ parts, className }: { parts: readonly MarkedPart[]; className: string }) {
  return (
    <span aria-hidden="true" data-marked-copy className={cn(className, "pointer-events-none [grid-area:1/1]")}>
      {parts.map((part, i) =>
        part.marker ? (
          <span key={i} data-image-tag className={cn(imageTag, "[box-decoration-break:clone]")}>
            <span className="opacity-0">{part.text.slice(0, 1)}</span>
            {part.text.slice(1, -1)}
            <span className="opacity-0">{part.text.slice(-1)}</span>
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
      {"\u200b"}
    </span>
  );
}

export function AddRow(props: {
  label: string;
  /** Подпись в пустом поле, если она короче имени поля. */
  placeholder?: string;
  value: string;
  onText: (text: string) => void;
  disabled: boolean;
  /** Область голосового ввода; `null` — без микрофона. */
  voiceId: string | null;
  /** Строка с ответом подсвечена, как выбранный вариант. */
  active?: boolean;
  className?: string;
  onEnter?: () => void;
  onBlur?: () => void;
  /** Действия справа от микрофона — крест добавленного пункта. */
  children?: ReactNode;
}) {
  const voice = useVoiceField({ id: props.voiceId, label: props.label, value: props.value, disabled: props.disabled, onChange: props.onText });
  const target = { value: props.value, onText: props.onText };
  const paste = usePasteImages(target);
  const parts = useMarkedParts(props.value);
  const mentions = useMentions({ value: props.value, onText: props.onText, disabled: props.disabled });
  const field = (
    <textarea
      {...mentions.field<HTMLTextAreaElement>({
        ref: voice.ref,
        onBlur: props.onBlur,
        onKeyDown: (event) => {
          if (props.onEnter === undefined || event.key !== "Enter" || event.shiftKey || props.value.trim() === "") return;
          event.preventDefault();
          props.onEnter();
        },
      })}
      aria-label={props.label}
      placeholder={props.placeholder ?? props.label}
      rows={1}
      value={props.value}
      disabled={props.disabled}
      onChange={voice.onChange}
      onPaste={paste}
      className={cn(
        addRowText,
        "resize-none bg-transparent outline-none [field-sizing:content] [grid-area:1/1] placeholder:text-muted-foreground",
        parts !== null && overCopy,
      )}
    />
  );
  return (
    <div data-item-row className={cn("flex min-h-9 w-full flex-wrap items-center gap-x-3 pl-3 pr-[11px]", props.active ? "bg-state-active" : "bg-surface-recessed-solid", props.className)}>
      <span className="flex w-3.5 shrink-0 justify-center">
        <AttachButton target={target} disabled={props.disabled} className="-mx-[7px]" />
      </span>
      {voice.phase !== null ? (
        <div className="-ml-1.5 flex min-w-0 flex-1 items-center self-stretch">{voice.strip}</div>
      ) : (
        <>
          {/* Обёртка стоит всегда: появление первой метки не пересоздаёт поле и не сбрасывает в нём курсор. */}
          <div className="grid min-w-0 flex-1">
            {parts !== null && <MarkedCopy parts={parts} className={addRowText} />}
            {field}
          </div>
          <span className="flex shrink-0 items-center gap-1">
            {voice.mic}
            {props.children}
          </span>
        </>
      )}
      {/* Список по `/` и `@` — с новой строки рамки, под текстом, с отступом колонки «+». */}
      {mentions.list !== null && <div className="basis-full pb-2 pl-[26px]">{mentions.list}</div>}
      {/* Ряд миниатюр — с новой строки рамки, под текстом, с отступом колонки «+». */}
      <FieldImages target={target} className="basis-full pb-2 pl-[26px]" />
    </div>
  );
}
