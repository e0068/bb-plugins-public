// Строка ввода брифа одного вида: «+» картинок слева, текст, микрофон и
// действия справа. Ею дописывают пункт критерия и весь бриф («Дополнить») и
// отвечают своими словами («Свой ответ») — у вопросов, и комментируют Демонстрацию.
// Метки картинок «[картинка N]» в тексте нарисованы плашками: под прозрачным
// текстом поля лежит его копия, в которой метки — теги, а курсор и правка
// остаются у самого поля.
import type { ReactNode } from "react";

import { splitMarkers, type MarkedPart } from "../core/image-markers";
import { cn } from "../lib/utils";
import { AttachButton, usePasteImages } from "./attachments";
import { useMessages } from "./locale-context";
import { useVoiceField } from "./voice";

/** Текст строки — шрифт сообщения в треде: 13 px, интерлиньяж 1.625, и отступы пункта критерия. */
export const addRowText = "min-w-0 flex-1 whitespace-pre-wrap break-words py-2 text-sm leading-relaxed";

/**
 * Копия текста поля под ним: обычный текст — своим цветом, метка — плашкой. Скобки метки прозрачны и служат плашке
 * отступами, поэтому ширина текста та же, что у поля, и строки не расходятся. Хвостовой перевод строки поле
 * показывает пустой строкой — копия держит её невидимым символом.
 */
function MarkedCopy({ parts }: { parts: readonly MarkedPart[] }) {
  return (
    <span aria-hidden="true" data-marked-copy className={cn(addRowText, "pointer-events-none [grid-area:1/1]")}>
      {parts.map((part, i) =>
        part.marker ? (
          <span key={i} data-image-tag className="rounded-md bg-state-active text-foreground ring-1 ring-inset ring-border [box-decoration-break:clone]">
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
  const parts = splitMarkers(props.value, useMessages().attachments.marker);
  const tagged = parts.some((part) => part.marker);
  const field = (
    <textarea
      ref={voice.ref}
      aria-label={props.label}
      placeholder={props.placeholder ?? props.label}
      rows={1}
      value={props.value}
      disabled={props.disabled}
      onChange={voice.onChange}
      onPaste={paste}
      onBlur={props.onBlur}
      onKeyDown={(event) => {
        if (props.onEnter === undefined || event.key !== "Enter" || event.shiftKey || props.value.trim() === "") return;
        event.preventDefault();
        props.onEnter();
      }}
      className={cn(
        addRowText,
        "resize-none bg-transparent outline-none [field-sizing:content] [grid-area:1/1] placeholder:text-muted-foreground",
        tagged && "relative text-transparent caret-foreground",
      )}
    />
  );
  return (
    <div data-item-row className={cn("flex min-h-9 w-full items-center gap-3 pl-3 pr-[11px]", props.active ? "bg-state-active" : "bg-surface-recessed-solid", props.className)}>
      <span className="flex w-3.5 shrink-0 justify-center">
        <AttachButton target={target} disabled={props.disabled} className="-mx-[7px]" />
      </span>
      {voice.phase !== null ? (
        <div className="-ml-1.5 flex min-w-0 flex-1 items-center self-stretch">{voice.strip}</div>
      ) : (
        <>
          {/* Обёртка стоит всегда: появление первой метки не пересоздаёт поле и не сбрасывает в нём курсор. */}
          <div className="grid min-w-0 flex-1">
            {tagged && <MarkedCopy parts={parts} />}
            {field}
          </div>
          <span className="flex shrink-0 items-center gap-1">
            {voice.mic}
            {props.children}
          </span>
        </>
      )}
    </div>
  );
}
