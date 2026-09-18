// Картинки к ответу на бриф: вставка из буфера в любое поле ответа и выбор
// файлом по «+». Пул картинок один на бриф и живёт в модуле, а не в состоянии
// компонента: переживает размонтирование сообщения, как черновик. В поле,
// куда вставлено, встаёт метка «[картинка N]» — по ней агент понимает, к чему
// картинка. Сами картинки уходят с ответом с номером метки, сервер кладёт их
// файлами треда и называет агенту, какой путь у какой метки.
import { createContext, useContext, useRef, useSyncExternalStore, type ClipboardEvent, type ReactNode } from "react";

import { Icon } from "../components/ui/icon";
import type { Messages } from "../lib/messages";
import { cn } from "../lib/utils";
import type { AnswerImage } from "../shared/contract";
import { useMessages } from "./locale-context";

/** Пределы и форматы контракта `answerImagesSchema`; значения — из `shared`, куда фронт ходит только за типами. */
const MAX_IMAGES = 6;
const MAX_BASE64 = 16 * 1024 * 1024;
const TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"] satisfies readonly AnswerImage["mimeType"][];

/** Картинка пула; `dataBase64: null` — номер уже выдан и метка стоит в тексте, файл ещё читается. */
type Attachment = { n: number; mimeType: AnswerImage["mimeType"]; dataBase64: string | null; weight: number };
/** Почему картинка не приложилась; словами — на языке интерфейса при показе. */
type PoolError = { kind: "type" } | { kind: "limit" } | { kind: "read"; n: number };
type Pool = { images: readonly Attachment[]; next: number; error: PoolError | null };

const EMPTY: Pool = { images: [], next: 1, error: null };
const pools = new Map<string, Pool>();
const listeners = new Set<() => void>();

const poolOf = (briefId: string): Pool => pools.get(briefId) ?? EMPTY;
const notify = () => listeners.forEach((listener) => listener());
const update = (briefId: string, change: (pool: Pool) => Pool): void => {
  pools.set(briefId, change(poolOf(briefId)));
  notify();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Прочитанные картинки для входа `answerBrief`; без них поля нет. */
export const attachmentsPayload = (briefId: string): { images?: AnswerImage[] } => {
  const images = poolOf(briefId).images.flatMap(({ n, mimeType, dataBase64 }) => (dataBase64 === null ? [] : [{ n, mimeType, dataBase64 }]));
  return images.length === 0 ? {} : { images };
};

/** Ответ принят или уже был — картинки больше не нужны. */
export const clearAttachments = (briefId: string): void => {
  pools.delete(briefId);
  notify();
};

const readBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Длина base64 файла известна до чтения: четыре знака на каждые начатые три байта. */
const base64Length = (bytes: number): number => 4 * Math.ceil(bytes / 3);

/**
 * Номера выдаются сразу, до чтения файлов: метка встаёт в поле в момент вставки,
 * и набранное за время чтения не затирается. Номера не переиспользуются —
 * метка в тексте всегда указывает на одну картинку.
 */
const addFiles = (briefId: string, files: readonly File[]): number[] => {
  const accepted: Array<{ n: number; file: File }> = [];
  update(briefId, (pool) => {
    let { images, next } = pool;
    let error: PoolError | null = null;
    for (const file of files) {
      const weight = base64Length(file.size);
      if (!TYPES.includes(file.type)) error = { kind: "type" };
      else if (images.length >= MAX_IMAGES || images.reduce((sum, i) => sum + i.weight, 0) + weight > MAX_BASE64) error = { kind: "limit" };
      else {
        images = [...images, { n: next, mimeType: file.type as AnswerImage["mimeType"], dataBase64: null, weight }];
        accepted.push({ n: next, file });
        next += 1;
      }
    }
    return { images, next, error };
  });
  for (const { n, file } of accepted)
    readBase64(file).then(
      (dataBase64) => update(briefId, (p) => ({ ...p, images: p.images.map((i) => (i.n === n ? { ...i, dataBase64 } : i)) })),
      () => update(briefId, (p) => ({ ...p, images: p.images.filter((i) => i.n !== n), error: { kind: "read", n } })),
    );
  return accepted.map(({ n }) => n);
};

/** Поле, в которое встаёт метка картинки: текущий текст и как его заменить. */
export type AttachTarget = { value: string; onText: (text: string) => void };

type Attach = { briefId: string; pick: (target: AttachTarget) => void };
const AttachContext = createContext<Attach | null>(null);

const errorText = (error: PoolError, m: Messages["attachments"]): string =>
  error.kind === "type" ? m.wrongType : error.kind === "limit" ? m.tooMany : m.readFailed(error.n);

const withMarkers = (target: AttachTarget, numbers: readonly number[], at: number | null, m: Messages["attachments"]): void => {
  if (numbers.length === 0) return;
  const marker = numbers.map((n) => m.marker(n)).join(" ");
  const cut = at ?? target.value.length;
  target.onText(`${target.value.slice(0, cut)}${marker}${target.value.slice(cut)}`);
};

/** Пул картинок брифа и один скрытый выбор файлов на всю форму. */
export function AttachmentsProvider({ briefId, children }: { briefId: string; children: ReactNode }) {
  const t = useMessages();
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<AttachTarget | null>(null);
  const pick = (target: AttachTarget) => {
    pending.current = target;
    input.current?.click();
  };
  return (
    <AttachContext.Provider value={{ briefId, pick }}>
      {children}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          const target = pending.current;
          event.currentTarget.value = "";
          const numbers = addFiles(briefId, files);
          if (target !== null) withMarkers(target, numbers, null, t.attachments);
        }}
      />
    </AttachContext.Provider>
  );
}

/** Обработчик вставки для поля ответа; вне формы брифа — `undefined`, и поле ведёт себя как обычно. */
export function usePasteImages(target: AttachTarget): ((event: ClipboardEvent<HTMLTextAreaElement | HTMLInputElement>) => void) | undefined {
  const attach = useContext(AttachContext);
  const t = useMessages();
  if (attach === null) return undefined;
  return (event) => {
    const files = [...(event.clipboardData?.items ?? [])].filter((item) => item.type.startsWith("image/")).flatMap((item) => item.getAsFile() ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    withMarkers(target, addFiles(attach.briefId, files), event.currentTarget.selectionStart, t.attachments);
  };
}

/** «+» слева от поля: открывает выбор картинок. Вне формы брифа не рисуется. */
export function AttachButton({ target, disabled, className }: { target: AttachTarget; disabled?: boolean; className?: string }) {
  const attach = useContext(AttachContext);
  const t = useMessages();
  if (attach === null) return null;
  return (
    <button
      type="button"
      aria-label={t.attachments.attach}
      title={t.attachments.attach}
      disabled={disabled}
      onClick={() => attach.pick(target)}
      className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:cursor-default", className)}
    >
      <Icon name="Plus" className="size-4" />
    </button>
  );
}

/** Превью приложенных картинок с крестиком и строка о превышении предела. */
export function AttachmentThumbs({ className }: { className?: string }) {
  const attach = useContext(AttachContext);
  const t = useMessages();
  const pool = useSyncExternalStore(subscribe, () => (attach === null ? EMPTY : poolOf(attach.briefId)));
  if (attach === null || (pool.images.length === 0 && pool.error === null)) return null;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {pool.images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {pool.images.map((image) => (
            <div key={image.n} className="relative size-14 overflow-hidden rounded-md bg-state-active">
              {image.dataBase64 === null ? (
                <div role="status" aria-label={t.attachments.reading(image.n)} className="size-full animate-pulse" />
              ) : (
                <img alt={t.attachments.alt(image.n)} src={`data:${image.mimeType};base64,${image.dataBase64}`} className="size-full object-cover" />
              )}
              <button
                type="button"
                aria-label={t.attachments.remove(image.n)}
                onClick={() => update(attach.briefId, (p) => ({ ...p, images: p.images.filter((i) => i.n !== image.n), error: null }))}
                className="absolute right-0.5 top-0.5 flex size-[18px] items-center justify-center rounded-full bg-background/80 text-foreground"
              >
                <Icon name="X" className="size-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {pool.error !== null && (
        <span role="alert" className="text-xs text-destructive">
          {errorText(pool.error, t.attachments)}
        </span>
      )}
    </div>
  );
}
