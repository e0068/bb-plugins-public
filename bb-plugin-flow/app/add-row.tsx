// Строка ввода брифа одного вида: «+» картинок слева, текст, микрофон и
// действия справа. Ею дописывают пункт критерия и весь бриф («Дополнить») и
// отвечают своими словами («Свой ответ») — у вопросов, и комментируют Демонстрацию.
import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { AttachButton, usePasteImages } from "./attachments";
import { useVoiceField } from "./voice";

/** Текст строки — размер и отступы пункта критерия. */
export const addRowText = "min-w-0 flex-1 whitespace-pre-wrap break-words py-2 text-[13px] leading-snug";

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
  return (
    <div data-item-row className={cn("flex min-h-9 w-full items-center gap-3 pl-3 pr-[11px]", props.active ? "bg-state-active" : "bg-surface-recessed-solid", props.className)}>
      <span className="flex w-3.5 shrink-0 justify-center">
        <AttachButton target={target} disabled={props.disabled} className="-mx-[7px]" />
      </span>
      {voice.phase !== null ? (
        <div className="-ml-1.5 flex min-w-0 flex-1 items-center self-stretch">{voice.strip}</div>
      ) : (
        <>
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
            className={cn(addRowText, "resize-none bg-transparent outline-none [field-sizing:content] placeholder:text-muted-foreground")}
          />
          <span className="flex shrink-0 items-center gap-1">
            {voice.mic}
            {props.children}
          </span>
        </>
      )}
    </div>
  );
}
