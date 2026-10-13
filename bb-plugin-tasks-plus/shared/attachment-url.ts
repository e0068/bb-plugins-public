import { CALLER_THREAD_FIELD } from "./enums.js";
import { TASKS_PLUGIN_ID } from "./plugin-id.js";

/**
 * Адрес вложения — одна строка на обе стороны: сервер пишет её в описание и
 * по ней же вычищает ссылки при удалении, клиент рисует по ней картинки.
 * Модуль не тянет SDK, поэтому годится и во фронтенд-бандл.
 */
/** Где бэкенд плагина принимает запросы: по id, под которым bb его поставил. */
export const PLUGIN_API = `/api/v1/plugins/${TASKS_PLUGIN_ID}`;
const DOWNLOAD_PREFIX = `${PLUGIN_API}/http/attachments/download?`;
/** Адрес из описаний, написанных, пока плагин стоял под id «tasks»: картинка по нему читается новым адресом. */
const LEGACY_DOWNLOAD_PREFIX = "/api/v1/plugins/tasks/http/attachments/download?";

export function attachmentDownloadUrl(attachmentId: string): string {
  return `${DOWNLOAD_PREFIX}attachmentId=${encodeURIComponent(attachmentId)}`;
}

/** Параметры адреса вложения; у чужого адреса — null. */
function attachmentQuery(src: string): URLSearchParams | null {
  const prefix = [DOWNLOAD_PREFIX, LEGACY_DOWNLOAD_PREFIX].find((candidate) => src.startsWith(candidate));
  return prefix === undefined ? null : new URLSearchParams(src.slice(prefix.length));
}

/** Все адреса, которыми описание может ссылаться на вложение, — нынешний и прежний. */
export function attachmentDownloadUrls(attachmentId: string): readonly string[] {
  const query = `attachmentId=${encodeURIComponent(attachmentId)}`;
  return [DOWNLOAD_PREFIX + query, LEGACY_DOWNLOAD_PREFIX + query];
}

/**
 * Адрес для показа из поверхности треда. Картинка грузится своим запросом, а
 * не RPC, поэтому тред едет параметром: без него сервер ищет вложение только
 * в main и не находит задачу, которая пока живёт в ветке треда.
 */
export function attachmentUrlInThread(src: string, threadId: string | null): string {
  const query = attachmentQuery(src);
  if (query === null) return src;
  if (threadId !== null) query.set(CALLER_THREAD_FIELD, threadId);
  return `${DOWNLOAD_PREFIX}${query.toString()}`;
}

/** Обратная к `attachmentUrlInThread`: в текст задачи тред не попадает. */
export function attachmentUrlWithoutThread(src: string): string {
  const query = attachmentQuery(src);
  if (query === null || !query.has(CALLER_THREAD_FIELD)) return src;
  query.delete(CALLER_THREAD_FIELD);
  return `${DOWNLOAD_PREFIX}${query.toString()}`;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The description without the images of a removed attachment, under either of its addresses. */
export function removeAttachmentDescriptionReferences(markdown: string, attachmentId: string): string {
  const urls = attachmentDownloadUrls(attachmentId).map(escapeRegExp).join("|");
  return markdown.replace(new RegExp(`!\\[[^\\]]*\\]\\((?:${urls})\\)`, "g"), "");
}
