// Картинки к ответу на бриф: вставка из буфера в любое поле ответа и выбор
// файлом по «+». Пул картинок один на бриф и живёт в модуле, а не в состоянии
// компонента: переживает размонтирование сообщения, как черновик. В поле,
// куда вставлено, встаёт метка «[картинка N]» — по ней агент понимает, к чему
// картинка, — а внизу рамки поля миниатюра с номером в углу: клик по номеру ставит метку ещё раз, на место каретки. Сами картинки уходят с ответом с номером метки, сервер кладёт их
// файлами треда и называет агенту, какой путь у какой метки. Прочитанные
// картинки копируются в IndexedDB: метки в черновике переживают перезагрузку
// плагина, и картинки должны пережить её вместе с ними.
import * as Dialog from "@radix-ui/react-dialog";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type ReactNode } from "react";

import { Icon } from "../components/ui/icon";
import { markerNumbers, withoutMarker } from "../core/image-markers";
import type { Messages } from "../lib/messages";
import { usePortalScopeProps } from "../lib/portal-scope";
import { cn } from "../lib/utils";
import type { AnswerImage } from "../shared/contract";
import { dropPool, loadPool, savePool } from "./attachment-store";
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
/** Чтения файлов в работе по брифам: отправка ждёт их, чтобы недочитанная картинка не выпала из ответа. */
const reading = new Map<string, Set<Promise<unknown>>>();
/** Подъём пула из IndexedDB — один раз на бриф за жизнь модуля. */
const restored = new Map<string, Promise<void>>();

const poolOf = (briefId: string): Pool => pools.get(briefId) ?? EMPTY;
const notify = () => listeners.forEach((listener) => listener());
const persist = (briefId: string, { images, next }: Pool): void =>
  void savePool(briefId, { next, images: images.flatMap(({ dataBase64, ...rest }) => (dataBase64 === null ? [] : [{ ...rest, dataBase64 }])) });
/** Пул на диск — только когда сменились картинки или номер: смена одной ошибки 16 МБ не переписывает. */
const update = (briefId: string, change: (pool: Pool) => Pool): void => {
  const before = poolOf(briefId);
  const pool = change(before);
  pools.set(briefId, pool);
  if (pool.images !== before.images || pool.next !== before.next) persist(briefId, pool);
  notify();
};

/** Пул, сохранённый до перезагрузки, поднимается до первой вставки: номера новых меток продолжают сохранённые. */
const restore = (briefId: string): Promise<void> => {
  const known = restored.get(briefId);
  if (known !== undefined) return known;
  const loading = loadPool(briefId).then((stored) => {
    if (stored === null || stored.images.length === 0) return;
    // Вставка ждёт подъёма, поэтому до него пул пуст и номера не пересекаются. Мимо `update`: прочитанное с диска туда не пишется.
    pools.set(briefId, { ...poolOf(briefId), images: stored.images, next: stored.next });
    notify();
  });
  restored.set(briefId, loading);
  return loading;
};

const track = (briefId: string, read: Promise<unknown>): void => {
  const set = reading.get(briefId) ?? new Set();
  reading.set(briefId, set.add(read));
  void read.finally(() => set.delete(read));
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/**
 * Картинки для входа `answerBrief`; без них поля нет. Ждёт подъёма пула из IndexedDB и чтения
 * вставленных файлов: отправка сразу после вставки иначе ушла бы с меткой без картинки.
 */
export const attachmentsPayload = async (briefId: string): Promise<{ images?: AnswerImage[] }> => {
  await restore(briefId);
  await Promise.allSettled([...(reading.get(briefId) ?? [])]);
  const images = poolOf(briefId).images.flatMap(({ n, mimeType, dataBase64 }) => (dataBase64 === null ? [] : [{ n, mimeType, dataBase64 }]));
  return images.length === 0 ? {} : { images };
};

/** Ответ принят или уже был — картинки больше не нужны. */
export const clearAttachments = (briefId: string): void => {
  pools.delete(briefId);
  void dropPool(briefId);
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
    track(briefId, readBase64(file).then(
      (dataBase64) => update(briefId, (p) => ({ ...p, images: p.images.map((i) => (i.n === n ? { ...i, dataBase64 } : i)) })),
      () => update(briefId, (p) => ({ ...p, images: p.images.filter((i) => i.n !== n), error: { kind: "read", n } })),
    ));
  return accepted.map(({ n }) => n);
};

/**
 * Номера выдаются после подъёма пула из IndexedDB: вставка сразу после перезагрузки иначе взяла бы номер
 * сохранённой картинки. Пул обычно уже поднят провайдером, и ожидание — одна микрозадача.
 */
const attachFiles = (briefId: string, files: readonly File[], place: (numbers: number[]) => void): void =>
  void restore(briefId).then(() => place(addFiles(briefId, files)));

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
  useEffect(() => void restore(briefId), [briefId]);
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
          attachFiles(briefId, files, (numbers) => {
            if (target !== null) withMarkers(target, numbers, null, t.attachments);
          });
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
    const at = event.currentTarget.selectionStart;
    attachFiles(attach.briefId, files, (numbers) => withMarkers(target, numbers, at, t.attachments));
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

/** Плашка метки картинки в тексте поля. */
export const imageTag = "rounded-md bg-state-active text-foreground ring-1 ring-inset ring-border";

/** Кнопка поверх миниатюры — крестик в правом верхнем углу и номер в левом нижнем. */
const overThumb = "absolute flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-background/80 text-foreground";

/**
 * Миниатюры картинок поля внизу его рамки, в порядке меток в тексте. Тап по миниатюре разворачивает картинку на весь
 * экран, крестик убирает и картинку, и её метку, номер в левом нижнем углу ставит её метку на место каретки поля.
 * Поле миниатюры ищут у себя в рамке: каретка есть, только пока поле в фокусе, и номер не забирает фокус нажатием;
 * поле не в фокусе — метка встаёт в конец текста.
 */
export function FieldImages({ target, className }: { target: AttachTarget; className?: string }) {
  const attach = useContext(AttachContext);
  const t = useMessages();
  const pool = useSyncExternalStore(subscribe, () => (attach === null ? EMPTY : poolOf(attach.briefId)));
  const [shown, setShown] = useState<Attachment | null>(null);
  const root = useRef<HTMLDivElement>(null);
  if (attach === null) return null;
  const images = markerNumbers(target.value, t.attachments.marker).flatMap((n) => pool.images.filter((image) => image.n === n));
  if (images.length === 0) return null;
  const remove = (n: number) => {
    update(attach.briefId, (p) => ({ ...p, images: p.images.filter((i) => i.n !== n), error: null }));
    target.onText(withoutMarker(target.value, n, t.attachments.marker));
  };
  const insert = (n: number) => {
    const field = [...(root.current?.parentElement?.querySelectorAll("textarea") ?? [])].find((el) => el === el.ownerDocument.activeElement);
    const at = field?.selectionStart ?? null;
    withMarkers(target, [n], at, t.attachments);
    if (field === undefined || at === null) return;
    const caret = at + t.attachments.marker(n).length;
    requestAnimationFrame(() => field.setSelectionRange(caret, caret));
  };
  return (
    <div ref={root} className={cn("flex flex-wrap gap-1.5", className)}>
      {images.map((image) => (
        <div key={image.n} data-field-image>
          <div className="relative size-14 overflow-hidden rounded-md bg-state-active">
            {image.dataBase64 === null ? (
              <div role="status" aria-label={t.attachments.reading(image.n)} className="size-full animate-pulse" />
            ) : (
              <button type="button" aria-label={t.attachments.open(image.n)} onClick={() => setShown(image)} className="size-full cursor-zoom-in">
                <img alt={t.attachments.alt(image.n)} src={imageSrc(image)} className="size-full object-cover" />
              </button>
            )}
            <button
              type="button"
              aria-label={t.attachments.remove(image.n)}
              onClick={() => remove(image.n)}
              className={cn(overThumb, "right-0.5 top-0.5")}
            >
              <Icon name="X" className="size-2.5" />
            </button>
            <button
              type="button"
              aria-label={t.attachments.insert(image.n)}
              title={t.attachments.insert(image.n)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insert(image.n)}
              className={cn(overThumb, "bottom-0.5 left-0.5 px-1 text-[11px] leading-none tabular-nums")}
            >
              {image.n}
            </button>
          </div>
        </div>
      ))}
      <ImageViewer image={shown} label={shown === null ? "" : t.attachments.alt(shown.n)} onClose={() => setShown(null)} />
    </div>
  );
}

const imageSrc = (image: Attachment): string => `data:${image.mimeType};base64,${image.dataBase64 ?? ""}`;

/** Картинка во весь экран поверх bb; закрывается тапом в любом месте и Esc. */
function ImageViewer({ image, label, onClose }: { image: Attachment | null; label: string; onClose: () => void }) {
  const scope = usePortalScopeProps();
  return (
    <Dialog.Root open={image !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay {...scope} className="fixed inset-0 z-50 bg-black/80" />
        <Dialog.Content
          {...scope}
          aria-describedby={undefined}
          onClick={onClose}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center p-4 outline-none"
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          {image !== null && <img alt={label} src={imageSrc(image)} className="max-h-full max-w-full rounded-md object-contain" />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Строка о картинке, которая не приложилась: не тот формат, превышен предел, файл не прочитался. */
export function AttachmentError({ className }: { className?: string }) {
  const attach = useContext(AttachContext);
  const t = useMessages();
  const pool = useSyncExternalStore(subscribe, () => (attach === null ? EMPTY : poolOf(attach.briefId)));
  if (attach === null || pool.error === null) return null;
  return (
    <span role="alert" className={cn("text-xs text-destructive", className)}>
      {errorText(pool.error, t.attachments)}
    </span>
  );
}
