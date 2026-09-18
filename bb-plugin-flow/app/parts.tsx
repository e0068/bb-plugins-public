// Общее у брифа прежнего и нового вида: рамка, заголовки, звёздочка
// рекомендации и отправка ответа.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Icon, type IconName } from "../components/ui/icon";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";
import type { AnswerRecord, DecisionBrief } from "../shared/contract";
import { emptyDraft, type Draft } from "./draft";
import { readStoredDraft, storeDraft } from "./draft-storage";
import { AttachButton, usePasteImages } from "./attachments";
import { useMessages } from "./locale-context";
import { useVoiceField } from "./voice";

export function Frame(props: {
  label: string;
  icon: IconName;
  heading: string;
  aside?: ReactNode;
  busy?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={props.label}
      aria-busy={props.busy || undefined}
      onKeyDown={props.onKeyDown}
      className="@container my-3 overflow-hidden rounded-lg border border-border bg-card shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-border/70 bg-surface-recessed-solid px-3 py-2 text-muted-foreground">
        <Icon name={props.icon} className="size-3.5" />
        <span className="text-xs font-medium">{props.heading}</span>
        {props.aside !== undefined && <span className="ml-auto text-xs">{props.aside}</span>}
      </div>
      {props.children}
    </div>
  );
}

export function Titles({ brief, subtitle }: { brief: DecisionBrief; subtitle?: ReactNode }) {
  const second = subtitle ?? brief.intro;
  return (
    <>
      <div className={cn("break-words px-3 pt-2.5 text-sm font-medium leading-snug", second === undefined && "pb-2")}>
        {brief.title}
      </div>
      {second !== undefined && <div className="break-words px-3 pb-2 pt-0.5 text-xs text-muted-foreground">{second}</div>}
    </>
  );
}

export function RecommendedStar() {
  const t = useMessages();
  return (
    <>
      <span aria-hidden="true" className="text-[9.5px] leading-none text-primary">
        ✦
      </span>
      <span className="sr-only">{t.common.recommendationHint}</span>
    </>
  );
}

/**
 * «Добавить своё» ко всему брифу: растёт по тексту, микрофон в правом верхнем углу,
 * на время записи — полоса в той же ячейке. Вид ячейки задаёт бриф; ошибку записи
 * он показывает сам — `VoiceErrorLine` с областью `note`.
 */
export function NoteField(props: { value: string; disabled: boolean; onChange: (text: string) => void; className: string; stripClassName: string }) {
  const t = useMessages();
  const voice = useVoiceField({ id: "note", label: t.common.noteLabel, value: props.value, disabled: props.disabled, onChange: props.onChange });
  const target = { value: props.value, onText: props.onChange };
  const paste = usePasteImages(target);
  return voice.phase !== null ? (
    <div className={cn("flex items-center", props.stripClassName)}>{voice.strip}</div>
  ) : (
    <div className="relative flex flex-col">
      <Textarea
        ref={voice.ref}
        aria-label={t.common.noteLabel}
        placeholder={t.common.notePlaceholder}
        rows={1}
        value={props.value}
        disabled={props.disabled}
        onChange={voice.onChange}
        onPaste={paste}
        className={cn(props.className, "pr-9", paste !== undefined && "pl-10")}
      />
      <span className="absolute left-1.5 top-1.5">
        <AttachButton target={target} disabled={props.disabled} />
      </span>
      <span className="absolute right-1 top-1">{voice.mic}</span>
    </div>
  );
}

/** Черновик брифа, который переживает размонтирование: читается из хранилища окна, каждая правка пишется туда же. */
export function useStoredDraft(briefId: string, initial: () => Draft = emptyDraft) {
  const [draft, setDraft] = useState<Draft>(() => readStoredDraft(briefId) ?? initial());
  const opened = useRef(draft);
  useEffect(() => {
    // Открытие брифа без правок ничего не пишет: хранилище не копит пустые черновики.
    if (draft !== opened.current) storeDraft(briefId, draft);
  }, [briefId, draft]);
  return [draft, setDraft] as const;
}

export type Sender = (draft: Draft) => Promise<
  | { kind: "accepted"; record: AnswerRecord }
  | { kind: "already_answered"; record: AnswerRecord }
  | { kind: "not_found" }
  | { kind: "incomplete"; questionIds: string[] }
>;

export type FormProps = { brief: DecisionBrief; send: Sender; onResult: (result: Awaited<ReturnType<Sender>>) => void };

export function useSubmit({ send, onResult }: Omit<FormProps, "brief">) {
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(false);

  const submit = async (draft: Draft) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setFailed(false);
    try {
      const result = await send(draft);
      if (result.kind === "incomplete") setMissing(new Set(result.questionIds));
      onResult(result);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  const touch = (questionId: string) =>
    setMissing((current) => {
      if (!current.has(questionId)) return current;
      const next = new Set(current);
      next.delete(questionId);
      return next;
    });
  return { sending, failed, missing, touch, submit };
}

export const answeredAt = (iso: string, dateLocale = "ru-RU"): string =>
  new Intl.DateTimeFormat(dateLocale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
