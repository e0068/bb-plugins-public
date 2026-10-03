// Вход Центра уведомлений (bb-plugin-notifications) со стороны другого
// плагина: куда класть запись, какой она формы и клиент, который никогда не
// бросает. Сервер центра принимает эту форму, сервер Flow её шлёт. Ни одного
// импорта: пакет вшивается в оба плагина, а сторонний импорт здесь ломает
// git-установку (см. packages/layer-guard, «Сторож git-установки»).

export const NOTIFICATIONS_PLUGIN_ID = "notifications";

const PUSH_PATH = "push";

/** `/api/v1/plugins/notifications/http/push` под базой; пустая база — свой origin страницы. */
export const notificationsUrl = (baseUrl: string): string => `${baseUrl}/api/v1/plugins/${NOTIFICATIONS_PLUGIN_ID}/http/${PUSH_PATH}`;

export const NOTIFICATION_SOURCES = ["flow", "pull-request"] as const;
export type NotificationSource = (typeof NOTIFICATION_SOURCES)[number];

export const NOTIFICATION_KINDS = ["awaiting", "turn-done", "automation-done", "automation-failed", "pr-opened", "pr-merged", "pr-checks-failed"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Запись, как её присылает источник; id, время и прочитанность ставит центр. */
export interface NotificationInput {
  source: NotificationSource;
  kind: NotificationKind;
  title: string;
  threadId: string;
  /** Название треда на момент события — подпись, пока тред не виден в живом списке bb. */
  threadTitle: string | null;
  /** Куда ведёт событие помимо треда — PR; `null` — только тред. */
  url: string | null;
  /** Одно событие — одна запись: повтор того же ключа центр молча пропускает. */
  dedupeKey: string | null;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isFilled = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const isStringOrNull = (x: unknown): x is string | null => x === null || typeof x === "string";
const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (x: unknown): x is T =>
    typeof x === "string" && (values as readonly string[]).includes(x);

export const isNotificationSource = isOneOf(NOTIFICATION_SOURCES);
export const isNotificationKind = isOneOf(NOTIFICATION_KINDS);

export const isNotificationInput = (x: unknown): x is NotificationInput =>
  isRecord(x) &&
  isNotificationSource(x.source) &&
  isNotificationKind(x.kind) &&
  isFilled(x.title) &&
  isFilled(x.threadId) &&
  isStringOrNull(x.threadTitle) &&
  isStringOrNull(x.url) &&
  isStringOrNull(x.dedupeKey);

export type ClientFailure = { ok: false; reason: "not-installed" | "http" | "network" | "timeout"; status?: number };
export type ClientResult<T> = { ok: true; value: T } | ClientFailure;

export interface ClientOptions {
  /** Уходит заголовком `origin`: серверный вызов передаёт loopback bb, чтобы вход `local` его принял. */
  origin?: string;
  /** Обрывает запрос, который идёт дольше; по умолчанию без потолка. */
  timeoutMs?: number;
}

export interface NotificationsClient {
  push(input: NotificationInput): Promise<ClientResult<null>>;
}

export function notificationsClient(baseUrl: string, fetchImpl: typeof fetch, options: ClientOptions = {}): NotificationsClient {
  return {
    async push(input) {
      const headers: Record<string, string> = { "content-type": "application/json", ...(options.origin === undefined ? {} : { origin: options.origin }) };
      const init: RequestInit = { method: "POST", headers, body: JSON.stringify(input) };
      let response: Response;
      try {
        response = await fetchImpl(notificationsUrl(baseUrl), options.timeoutMs === undefined ? init : { ...init, signal: AbortSignal.timeout(options.timeoutMs) });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        return { ok: false, reason: timedOut ? "timeout" : "network" };
      }
      if (response.status === 404) return { ok: false, reason: "not-installed", status: 404 };
      if (!response.ok) return { ok: false, reason: "http", status: response.status };
      return { ok: true, value: null };
    },
  };
}

// Лента обновлений плагинов витрины. Её собирает сайт витрины на шаге
// «Publish» (packages/flow-dialog-demo/scenario/plugin-updates.ts) и кладёт
// рядом со страницами; центр на каждой машине читает её по расписанию и
// объявляет новые версии установленных плагинов.

export const PLUGIN_UPDATES_URL = "https://bb68.vercel.app/plugin-updates.json";

/** Пункт ченж-лога на двух языках. */
export interface FeedNote {
  ru: string;
  en: string;
}

/** Вышедшая версия: номер, дата выхода и её пункты. */
export interface FeedRelease {
  version: string;
  date: string;
  notes: FeedNote[];
}

/** Опубликованный плагин: id — тот, под которым его держит bb; выпуски — новые сверху. */
export interface FeedPlugin {
  id: string;
  name: string;
  version: string;
  releases: FeedRelease[];
}

export interface PluginUpdatesFeed {
  plugins: FeedPlugin[];
}

const VERSION = /^\d+\.\d+\.\d+$/;

/** Сравнение версий вида 1.2.3 по числам: плюс — `a` новее. */
export const compareVersions = (a: string, b: string): number => {
  const [x, y] = [a, b].map((version) => version.split(".").map(Number));
  const length = Math.max(x!.length, y!.length);
  return Array.from({ length }, (_, i) => (x![i] ?? 0) - (y![i] ?? 0)).find((diff) => diff !== 0) ?? 0;
};
const isVersion = (x: unknown): x is string => typeof x === "string" && VERSION.test(x);
const isArrayOf =
  <T>(item: (x: unknown) => x is T) =>
  (x: unknown): x is T[] =>
    Array.isArray(x) && x.every(item);

const isFeedNote = (x: unknown): x is FeedNote => isRecord(x) && isFilled(x.ru) && isFilled(x.en);
const isFeedRelease = (x: unknown): x is FeedRelease => isRecord(x) && isVersion(x.version) && isFilled(x.date) && isArrayOf(isFeedNote)(x.notes);
const isFeedPlugin = (x: unknown): x is FeedPlugin => isRecord(x) && isFilled(x.id) && isFilled(x.name) && isVersion(x.version) && isArrayOf(isFeedRelease)(x.releases);

/** Ответ сайта — недоверенный ввод: лента идёт дальше, только если она целиком такой формы. */
export const isPluginUpdatesFeed = (x: unknown): x is PluginUpdatesFeed => isRecord(x) && isArrayOf(isFeedPlugin)(x.plugins);
