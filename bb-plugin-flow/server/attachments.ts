// Картинки ответа — вложениями проекта треда, тем же путём, каким их грузит
// композер bb. Реплика рисует вложение только через зарегистрированные
// вложения проекта: файл, положенный в хранилище треда мимо них, агент читал,
// а в ленте он был битой иконкой. В kv картинки не пишутся — одна упёрлась бы
// в предел значения.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { Locale } from "../lib/i18n";
import { messages } from "../lib/messages";
import type { AnswerImage } from "../shared/contract";

const EXTENSIONS: Readonly<Record<AnswerImage["mimeType"], string>> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

/** `path` — путь вложения в проекте треда, как его вернула загрузка. */
export type UploadedImage = { n: number; path: string };

/** Картинки в порядке прихода, под именем `decision-<бриф>-<номер метки>.<расширение>`; bb добавляет к имени свой хвост. */
export const uploadAttachments = async (
  sdk: Pick<BbPluginApi["sdk"], "threads" | "projects">,
  args: { threadId: string; briefId: string; images: readonly AnswerImage[] },
): Promise<UploadedImage[]> => {
  if (args.images.length === 0) return [];
  const { projectId } = await sdk.threads.get({ threadId: args.threadId });
  return Promise.all(
    args.images.map(async ({ n, mimeType, dataBase64 }) => {
      const uploaded = await sdk.projects.attachments.upload({
        projectId,
        clientFile: new Uint8Array(Buffer.from(dataBase64, "base64")),
        filename: `decision-${args.briefId}-${n}.${EXTENSIONS[mimeType]}`,
        mimeType,
      });
      return { n, path: uploaded.path };
    }),
  );
};

/** Строка реплики, связывающая метки в тексте ответа с приложенными картинками; без картинок строки нет. */
export const attachmentsLine = (uploaded: readonly UploadedImage[], locale?: Locale): string => {
  const m = messages(locale).attachments;
  return uploaded.length === 0 ? "" : `\n${m.line(uploaded.map(({ n, path }) => `${m.marker(n)} — ${path}`).join("; "))}`;
};
