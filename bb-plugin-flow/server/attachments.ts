// Картинки ответа — вложениями проекта треда, тем же путём, каким их грузит
// композер bb. Реплика рисует вложение только через зарегистрированные
// вложения проекта: файл, положенный в хранилище треда мимо них, агент читал,
// а в ленте он был битой иконкой. В kv картинки не пишутся — одна упёрлась бы
// в предел значения.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { markerNumbers } from "../core/image-markers";
import type { Locale } from "../lib/i18n";
import { messages } from "../lib/messages";
import type { AnswerImage, DecisionAnswer } from "../shared/contract";

const EXTENSIONS: Readonly<Record<AnswerImage["mimeType"], string>> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** `path` — путь вложения в проекте треда, как его вернула загрузка. */
export type UploadedImage = { n: number; path: string };
/** Итог загрузки: что легло вложениями и номера картинок, которые bb не принял. */
export type UploadResult = { uploaded: UploadedImage[]; failed: number[] };

/**
 * Картинки в порядке прихода, под именем `decision-<бриф>-<номер метки>.<расширение>`; bb добавляет к имени свой хвост.
 * Отказ одной картинки не роняет остальные: она уходит в `failed`, и ответ называет её несохранённой.
 */
export const uploadAttachments = async (
  sdk: Pick<BbPluginApi["sdk"], "threads" | "projects">,
  args: { threadId: string; briefId: string; images: readonly AnswerImage[] },
): Promise<UploadResult> => {
  if (args.images.length === 0) return { uploaded: [], failed: [] };
  const { projectId } = await sdk.threads.get({ threadId: args.threadId });
  const settled = await Promise.allSettled(
    args.images.map(({ mimeType, dataBase64, n }) =>
      sdk.projects.attachments.upload({
        projectId,
        clientFile: new Uint8Array(Buffer.from(dataBase64, "base64")),
        filename: `decision-${args.briefId}-${n}.${EXTENSIONS[mimeType]}`,
        mimeType,
      }),
    ),
  );
  return {
    uploaded: settled.flatMap((result, i) => (result.status === "fulfilled" ? [{ n: args.images[i]!.n, path: result.value.path }] : [])),
    failed: settled.flatMap((result, i) => (result.status === "rejected" ? [args.images[i]!.n] : [])),
  };
};

/** Номера меток «[картинка N]» в тексте, без повторов и по возрастанию; метка — в форме языка ответа. */
const markedNumbers = (text: string, locale?: Locale): number[] => markerNumbers(text, messages(locale).attachments.marker).sort((a, b) => a - b);

/** Всё, что владелец написал в ответе своими словами: метки картинок встают только туда, а не в текст брифа от агента. */
const ownerWords = (answer: DecisionAnswer): string =>
  [
    ...answer.answers.map((a) => a.own),
    ...(answer.stages ?? []).map((s) => s.note),
    ...(answer.criteria?.edited ?? []).map((e) => e.text),
    ...(answer.criteria?.added ?? []),
    answer.note,
    answer.outcome?.note,
  ].join("\n");

/**
 * Картинки, на которые владелец сослался меткой. Картинка, чью метку стёрли или чей пункт сняли, в виджете больше
 * нигде не видна, поэтому и агенту не уходит.
 */
export const referencedImages = (answer: DecisionAnswer, images: readonly AnswerImage[], locale?: Locale): AnswerImage[] => {
  const marked = new Set(markedNumbers(ownerWords(answer), locale));
  return images.filter(({ n }) => marked.has(n));
};

/**
 * Картинки, о которых агент должен узнать, что их нет: метка стоит в словах владельца, а картинка не легла
 * вложением — потерялась в виджете или bb её не принял. Без такой строки агент видит метку и угадывает, что на картинке.
 */
export const lostImages = (answer: DecisionAnswer, result: UploadResult, locale?: Locale): number[] => {
  const saved = new Set(result.uploaded.map(({ n }) => n));
  return [...new Set([...markedNumbers(ownerWords(answer), locale).filter((n) => !saved.has(n)), ...result.failed])].sort((a, b) => a - b);
};

/** Строки реплики о картинках: какая метка у какого пути и какие метки остались без картинки; без картинок и меток строк нет. */
export const attachmentsLine = (uploaded: readonly UploadedImage[], lost: readonly number[], locale?: Locale): string => {
  const m = messages(locale).attachments;
  const saved = uploaded.length === 0 ? "" : `\n${m.line(uploaded.map(({ n, path }) => `${m.marker(n)} — ${path}`).join("; "))}`;
  return lost.length === 0 ? saved : `${saved}\n${m.lost(lost.map(m.marker).join(", "))}`;
};
