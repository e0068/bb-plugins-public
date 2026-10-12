// Картинки отвеченного брифа: ответ в ленте выглядит так, как владелец его
// отправил, — метки «[картинка N]» плашками, а под текстом миниатюры, которые
// разворачиваются на весь экран. Сами картинки лежат вложениями проекта треда,
// запись ответа хранит их пути, а байты сервер отдаёт по запросу. Картинки —
// удобство: не пришли — остаются плашки, как и было.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { markerNumbers, splitMarkers } from "../core/image-markers";
import { cn } from "../lib/utils";
import type { AnswerRecord, answerImagesRpcContract } from "../shared/contract";
import { FileTile, ImageViewer, allMarkers, imageSrc, imageTag, previewable, type ShownImage } from "./attachments";
import { useMessages } from "./locale-context";

/** Номера картинок, ушедших с ответом, и прочитанные из них; `null` — ещё читаются. */
type Seen = { sent: ReadonlySet<number>; loaded: ReadonlyMap<number, ShownImage & { name?: string }> | null };

const NONE: Seen = { sent: new Set(), loaded: new Map() };
const SeenContext = createContext<Seen>(NONE);

/** Читает картинки ответа один раз на бриф; ответ без картинок сервер не спрашивает. */
export function AnsweredImagesProvider({ briefId, record, children }: { briefId: string; record: AnswerRecord; children: ReactNode }) {
  const rpc = useRpc<typeof answerImagesRpcContract>();
  const sent = record.images ?? [];
  const [loaded, setLoaded] = useState<Seen["loaded"]>(sent.length === 0 ? new Map() : null);
  const any = sent.length > 0;
  useEffect(() => {
    if (!any) return;
    let live = true;
    rpc
      .call("answerImages", { id: briefId })
      .then((result) => (result.kind === "found" ? new Map(result.images.map(({ n, ...image }) => [n, image])) : new Map()))
      .catch(() => new Map())
      .then((images) => live && setLoaded(images));
    return () => {
      live = false;
    };
    // rpc — новый объект на каждый рендер, картинки читаются один раз на бриф
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefId, any]);
  return <SeenContext.Provider value={{ sent: new Set(sent.map(({ n }) => n)), loaded }}>{children}</SeenContext.Provider>;
}

/**
 * Слова владельца в отвеченном брифе: метки картинок — плашками, как в поле при отправке, а под текстом — миниатюры
 * в порядке меток; тап разворачивает картинку на весь экран. `render` рисует куски текста между метками.
 */
export function AnsweredText({ text, render = (part) => part, imagesClassName }: { text: string; render?: (part: string) => ReactNode; imagesClassName?: string }) {
  const t = useMessages();
  const seen = useContext(SeenContext);
  const [shown, setShown] = useState<number | null>(null);
  const parts = splitMarkers(text, allMarkers(t.attachments));
  if (!parts.some((part) => part.marker)) return <>{render(text)}</>;
  // Пока картинки читаются — заглушка на каждую ушедшую; потом только те, что bb отдал.
  const numbers = markerNumbers(text, allMarkers(t.attachments)).filter((n) => (seen.loaded === null ? seen.sent.has(n) : seen.loaded.has(n)));
  const open = shown === null ? null : (seen.loaded?.get(shown) ?? null);
  return (
    <>
      <span className="whitespace-pre-wrap break-words">
        {parts.map((part, i) =>
          part.marker ? (
            <span key={i} data-image-tag className={cn(imageTag, "px-1 [box-decoration-break:clone]")}>
              {part.text.slice(1, -1)}
            </span>
          ) : (
            <span key={i}>{render(part.text)}</span>
          ),
        )}
      </span>
      {numbers.length > 0 && (
        <span className={cn("mt-1.5 flex flex-wrap gap-1.5", imagesClassName)}>
          {numbers.map((n) => {
            const image = seen.loaded?.get(n);
            return (
              <span key={n} className="relative size-14 overflow-hidden rounded-md bg-state-active">
                {image === undefined ? (
                  <span role="status" aria-label={t.attachments.reading(n)} className="block size-full animate-pulse" />
                ) : !previewable(image.mimeType) ? (
                  <FileTile name={image.name} />
                ) : (
                  <button type="button" aria-label={t.attachments.open(n)} onClick={() => setShown(n)} className="size-full cursor-zoom-in">
                    <img alt={t.attachments.alt(n)} src={imageSrc(image)} className="size-full object-cover" />
                  </button>
                )}
              </span>
            );
          })}
        </span>
      )}
      <ImageViewer image={open} label={shown === null ? "" : t.attachments.alt(shown)} onClose={() => setShown(null)} />
    </>
  );
}
