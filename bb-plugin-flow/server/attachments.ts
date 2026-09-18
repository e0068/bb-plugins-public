// Картинки ответа — файлами в хранилище треда. Так же вложения кладёт композер
// bb: агент получает путь частью `localImage` и читает файл, как любое
// вложение. В kv картинки не пишутся — одна упёрлась бы в предел значения.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import type { Locale } from "../lib/i18n";
import { messages } from "../lib/messages";
import type { AnswerImage } from "../shared/contract";

const EXTENSIONS: Readonly<Record<AnswerImage["mimeType"], string>> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export type WrittenImage = { n: number; path: string };

/** Картинки в порядке прихода: `<хранилище треда>/Attachments/decision-<бриф>-<номер метки>.<расширение>`. */
export const writeAttachments = async (
  sdk: Pick<BbPluginApi["sdk"], "threads">,
  args: { threadId: string; briefId: string; images: readonly AnswerImage[] },
): Promise<WrittenImage[]> => {
  if (args.images.length === 0) return [];
  const { storageRootPath } = await sdk.threads.storageLocation({ threadId: args.threadId });
  const dir = join(storageRootPath, "Attachments");
  await mkdir(dir, { recursive: true });
  return Promise.all(
    args.images.map(async ({ n, mimeType, dataBase64 }) => {
      const path = join(dir, `decision-${args.briefId}-${n}.${EXTENSIONS[mimeType]}`);
      await writeFile(path, Buffer.from(dataBase64, "base64"));
      return { n, path };
    }),
  );
};

/** Строка реплики, связывающая метки в тексте ответа с приложенными файлами; без картинок строки нет. */
export const attachmentsLine = (written: readonly WrittenImage[], locale?: Locale): string => {
  const m = messages(locale).attachments;
  return written.length === 0 ? "" : `\n${m.line(written.map(({ n, path }) => `${m.marker(n)} — ${path}`).join("; "))}`;
};
