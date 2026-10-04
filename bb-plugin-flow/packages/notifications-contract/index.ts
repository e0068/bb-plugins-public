// Вход Центра уведомлений (bb-plugin-notifications) со стороны другого
// плагина: куда класть запись, какой она формы и клиент, который никогда не
// бросает. Сервер центра принимает эту форму от любого плагина. Ни одного
// импорта: пакет вшивается в оба плагина, а сторонний импорт здесь ломает
// git-установку (см. packages/layer-guard, «Сторож git-установки»).

export const NOTIFICATIONS_PLUGIN_ID = "notifications";

const PUSH_PATH = "push";

/** `/api/v1/plugins/notifications/http/push` под базой; пустая база — свой origin страницы. */
export const notificationsUrl = (baseUrl: string): string => `${baseUrl}/api/v1/plugins/${NOTIFICATIONS_PLUGIN_ID}/http/${PUSH_PATH}`;

/** Виды событий собственных источников центра — Flow и PR; у них свои значки в журнале. */
export const NOTIFICATION_KINDS = ["awaiting", "turn-done", "automation-done", "automation-failed", "pr-opened", "pr-merged", "pr-checks-failed"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Вид, занятый записями об обновлениях плагинов: журнал различает по нему два рода записей. */
export const RESERVED_KIND = "plugin-update";

export const NOTIFICATION_TONES = ["info", "success", "error"] as const;
export type NotificationTone = (typeof NOTIFICATION_TONES)[number];

/** Кусок заголовка или строки тоста: текст или ссылка — на тред, на адрес снаружи, на страницу bb (`/plugins/<id>/…`). */
export type NotificationSegment =
  | { kind: "text"; text: string }
  | { kind: "thread"; threadId: string; text: string }
  | { kind: "url"; url: string; text: string }
  | { kind: "route"; route: string; text: string };

/** Куда ведёт кнопка; `callback` — `POST` в HTTP-вход плагина-источника `path` с телом `payload`, ответ — {@link CallbackAnswer}. */
export type NotificationTarget =
  | { kind: "url"; url: string }
  | { kind: "thread"; threadId: string }
  | { kind: "route"; route: string }
  | { kind: "callback"; path: string; payload: unknown };

export const NOTIFICATION_ICONS = ["link", "github", "thread", "retry", "skip"] as const;
export type NotificationIcon = (typeof NOTIFICATION_ICONS)[number];

export interface NotificationAction {
  label: string;
  icon: NotificationIcon;
  target: NotificationTarget;
}

/** Карточка тоста; новая карточка с тем же `key` заменяет показанную, `null` — у карточки своё место. */
export interface NotificationToast {
  key: string | null;
  title: NotificationSegment[];
  lines: NotificationSegment[][];
  actions: NotificationAction[];
}

/** Ответ HTTP-входа источника на кнопку `callback`: не `null` — центр показывает текст тостом. */
export interface CallbackAnswer {
  message: string | null;
}

/** Запись, как её присылает источник; id, время и прочитанность ставит центр. */
export interface NotificationInput {
  /** Id плагина-источника. */
  source: string;
  /** Подпись плагина в настройках центра; нет — id. */
  sourceName?: string;
  /** Вид события: по паре «источник, вид» владелец решает, всплывать ли записи. */
  kind: string;
  /** Подпись вида в настройках центра; нет — сам вид. */
  kindLabel?: string;
  title: string;
  threadId: string;
  /** Название треда на момент события — подпись, пока тред не виден в живом списке bb. */
  threadTitle: string | null;
  /** Куда ведёт событие помимо треда — PR; `null` — только тред. */
  url: string | null;
  /** Одно событие — одна запись: повтор того же ключа центр молча пропускает. */
  dedupeKey: string | null;
  /** Нет — `info`. */
  tone?: NotificationTone;
  /** Карточка тоста; нет — центр соберёт её из заголовка и треда. */
  toast?: NotificationToast | null;
  /** Всплывает ли вид, пока владелец его не переключил; нет — всплывает. */
  toastByDefault?: boolean;
}

/** Запись после разбора: умолчания заполнены. */
export type AcceptedNotification = Required<Omit<NotificationInput, "toast">> & { toast: NotificationToast | null };

/** Id плагина-источника — он же сегмент адреса его HTTP-входа. */
export const PLUGIN_ID = /^[a-z0-9][a-z0-9-]*$/;
/** Путь входа источника: со слэша, сегменты без точек — дальше `/api/v1/plugins/<источник>/http` он не уйдёт. */
export const CALLBACK_PATH = /^(\/[A-Za-z0-9_-]+)+$/;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isFilled = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const isStringOrNull = (x: unknown): x is string | null => x === null || typeof x === "string";
const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (x: unknown): x is T =>
    typeof x === "string" && (values as readonly string[]).includes(x);
const isArrayOf =
  <T>(item: (x: unknown) => x is T) =>
  (x: unknown): x is T[] =>
    Array.isArray(x) && x.every(item);
/** Необязательное поле: нет его — годится, есть — проверяется. */
const isAbsentOr =
  <T>(check: (x: unknown) => x is T) =>
  (x: unknown): x is T | undefined =>
    x === undefined || check(x);

export const isNotificationKind = isOneOf(NOTIFICATION_KINDS);
export const isNotificationTone = isOneOf(NOTIFICATION_TONES);
const isIcon = isOneOf(NOTIFICATION_ICONS);

const isSegment = (x: unknown): x is NotificationSegment => {
  if (!isRecord(x) || typeof x.text !== "string") return false;
  switch (x.kind) {
    case "text":
      return true;
    case "thread":
      return isFilled(x.threadId);
    case "url":
      return isFilled(x.url);
    case "route":
      return isFilled(x.route);
    default:
      return false;
  }
};

const isTarget = (x: unknown): x is NotificationTarget => {
  if (!isRecord(x)) return false;
  switch (x.kind) {
    case "url":
      return isFilled(x.url);
    case "thread":
      return isFilled(x.threadId);
    case "route":
      return isFilled(x.route);
    case "callback":
      return typeof x.path === "string" && CALLBACK_PATH.test(x.path) && "payload" in x;
    default:
      return false;
  }
};

const isAction = (x: unknown): x is NotificationAction => isRecord(x) && isFilled(x.label) && isIcon(x.icon) && isTarget(x.target);

export const isNotificationToast = (x: unknown): x is NotificationToast =>
  isRecord(x) && isStringOrNull(x.key) && isArrayOf(isSegment)(x.title) && isArrayOf(isArrayOf(isSegment))(x.lines) && isArrayOf(isAction)(x.actions);

/** Ответ входа источника — недоверенный ввод: годится только `{ message: string | null }`. */
export const isCallbackAnswer = (x: unknown): x is CallbackAnswer => isRecord(x) && isStringOrNull(x.message);

const isSource = (x: unknown): x is string => typeof x === "string" && PLUGIN_ID.test(x);
const isKind = (x: unknown): x is string => isFilled(x) && x !== RESERVED_KIND;

export const isNotificationInput = (x: unknown): x is NotificationInput =>
  isRecord(x) &&
  isSource(x.source) &&
  isAbsentOr(isFilled)(x.sourceName) &&
  isKind(x.kind) &&
  isAbsentOr(isFilled)(x.kindLabel) &&
  isFilled(x.title) &&
  isFilled(x.threadId) &&
  isStringOrNull(x.threadTitle) &&
  isStringOrNull(x.url) &&
  isStringOrNull(x.dedupeKey) &&
  isAbsentOr(isNotificationTone)(x.tone) &&
  (x.toast === undefined || x.toast === null || isNotificationToast(x.toast)) &&
  isAbsentOr((v): v is boolean => typeof v === "boolean")(x.toastByDefault);

export const acceptedOf = (input: NotificationInput): AcceptedNotification => ({
  ...input,
  sourceName: input.sourceName ?? input.source,
  kindLabel: input.kindLabel ?? input.kind,
  tone: input.tone ?? "info",
  toast: input.toast ?? null,
  toastByDefault: input.toastByDefault ?? true,
});

/** Карточка тоста записи: приложенная или собранная из заголовка, треда и ссылки. */
export const toastCardOf = (n: AcceptedNotification): NotificationToast =>
  n.toast ?? {
    key: null,
    title: [{ kind: "text", text: n.title }],
    lines: [[{ kind: "thread", threadId: n.threadId, text: n.threadTitle ?? n.threadId }]],
    actions: [
      ...(n.url === null ? [] : [{ label: "Открыть", icon: "link" as const, target: { kind: "url" as const, url: n.url } }]),
      { label: "К треду", icon: "thread", target: { kind: "thread", threadId: n.threadId } },
    ],
  };

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
const isFeedNote = (x: unknown): x is FeedNote => isRecord(x) && isFilled(x.ru) && isFilled(x.en);
const isFeedRelease = (x: unknown): x is FeedRelease => isRecord(x) && isVersion(x.version) && isFilled(x.date) && isArrayOf(isFeedNote)(x.notes);
const isFeedPlugin = (x: unknown): x is FeedPlugin => isRecord(x) && isFilled(x.id) && isFilled(x.name) && isVersion(x.version) && isArrayOf(isFeedRelease)(x.releases);

/** Ответ сайта — недоверенный ввод: лента идёт дальше, только если она целиком такой формы. */
export const isPluginUpdatesFeed = (x: unknown): x is PluginUpdatesFeed => isRecord(x) && isArrayOf(isFeedPlugin)(x.plugins);
