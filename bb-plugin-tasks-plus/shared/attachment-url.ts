import { CALLER_THREAD_FIELD } from "./enums.js";

/**
 * Адрес вложения — одна строка на обе стороны: сервер пишет её в описание и
 * по ней же вычищает ссылки при удалении, клиент рисует по ней картинки.
 * Модуль не тянет SDK, поэтому годится и во фронтенд-бандл.
 */
const DOWNLOAD_URL = "/api/v1/plugins/tasks/http/attachments/download";
const DOWNLOAD_PREFIX = `${DOWNLOAD_URL}?`;

export function attachmentDownloadUrl(attachmentId: string): string {
  return `${DOWNLOAD_PREFIX}attachmentId=${encodeURIComponent(attachmentId)}`;
}

/** Параметры адреса вложения; у чужого адреса — null. */
function attachmentQuery(src: string): URLSearchParams | null {
  return src.startsWith(DOWNLOAD_PREFIX)
    ? new URLSearchParams(src.slice(DOWNLOAD_PREFIX.length))
    : null;
}

/**
 * Адрес для показа из поверхности треда. Картинка грузится своим запросом, а
 * не RPC, поэтому тред едет параметром: без него сервер ищет вложение только
 * в main и не находит задачу, которая пока живёт в ветке треда.
 */
export function attachmentUrlInThread(src: string, threadId: string | null): string {
  if (threadId === null) return src;
  const query = attachmentQuery(src);
  if (query === null) return src;
  query.set(CALLER_THREAD_FIELD, threadId);
  return `${DOWNLOAD_PREFIX}${query.toString()}`;
}

/** Обратная к `attachmentUrlInThread`: в текст задачи тред не попадает. */
export function attachmentUrlWithoutThread(src: string): string {
  const query = attachmentQuery(src);
  if (query === null || !query.has(CALLER_THREAD_FIELD)) return src;
  query.delete(CALLER_THREAD_FIELD);
  return `${DOWNLOAD_PREFIX}${query.toString()}`;
}
