// Мост к плагину Центр уведомлений: сервер Flow кладёт туда свои записи по
// HTTP (форма и клиент — packages/notifications-contract). Запрос идёт на
// loopback bb с origin, равным ему, — вход центра открыт только локальным
// источникам. Нет центра или он не ответил — запись молча пропадает: Flow
// работает дальше, только итогов автоматизаций сбоку никто не покажет.
// Обратно центр приходит HTTP-входом notification-action — кнопками тоста.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { notificationsClient, type CallbackAnswer, type NotificationInput } from "@bb-plugins/notifications-contract/index";
import { isStageAwaitingId } from "../core/awaiting";
import { awaitingKey, NOTICE_ACTION_PATH, type NoticeActionRequest } from "../core/center-notice";
import { ru } from "../lib/messages/ru";
import type { StepAnswer } from "../shared/contract";
import type { AutomationRunner } from "./automation-runner";
import type { DecisionStore } from "./store";

/** Дольше запись не ждёт: конец хода и итог автоматизации не должны висеть на чужом плагине. */
const PUSH_TIMEOUT_MS = 5_000;

export interface CenterBridge {
  push(input: NotificationInput): Promise<void>;
  /** Событие записи Flow кончилось: центр закрывает её карточку во всех окнах, журнал остаётся. */
  retract(dedupeKey: string): Promise<void>;
}

export function centerBridge(
  bb: { readonly server: Pick<BbPluginApi["server"], "loopbackBaseUrl">; readonly log: Pick<BbPluginApi["log"], "warn"> },
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): CenterBridge {
  // Нет плагина — обычное дело, не повод для предупреждения.
  const warnUndelivered = (what: string, result: { ok: boolean; reason?: string; status?: number }): void => {
    if (!result.ok && result.reason !== "not-installed") bb.log.warn(`notifications: ${what} not delivered (${result.reason}${result.status === undefined ? "" : ` ${result.status}`})`);
  };
  return {
    async push(input) {
      const base = bb.server.loopbackBaseUrl;
      warnUndelivered(`${input.kind} for ${input.threadId}`, await notificationsClient(base, fetchImpl, { origin: base, timeoutMs: PUSH_TIMEOUT_MS }).push(input));
    },
    async retract(dedupeKey) {
      const base = bb.server.loopbackBaseUrl;
      warnUndelivered(`retract ${dedupeKey}`, await notificationsClient(base, fetchImpl, { origin: base, timeoutMs: PUSH_TIMEOUT_MS }).retract({ source: "flow", dedupeKey }));
    },
  };
}

/**
 * Хранилище, чьё снятие ожидания заодно отзывает карточку «Ждёт ответа» брифа. Снимает ожидание одна точка
 * хранилища — ответ кнопкой, ответ группой, возврат брифа сообщением и чистка устаревших, — поэтому карточка
 * не переживёт ни один из путей. Отзыв идёт по виду id, а не по текущему ожиданию треда: упавшая автоматизация или
 * следующий бриф могли уже заменить ожидание, а ответ на прежний бриф всё равно принимается. У ожидания этапа
 * автоматизации или Action карточки «Ждёт ответа» нет — его id не отзывается; отзыв ключа, которого в журнале нет,
 * безвреден. Центра отзыв не ждёт: он не должен держать ответ владельцу.
 */
export const retractOnSettle = <S extends Pick<DecisionStore, "clearAwaiting">>(store: S, center: Pick<CenterBridge, "retract">): S => ({
  ...store,
  async clearAwaiting(threadId, briefId) {
    await store.clearAwaiting(threadId, briefId);
    if (!isStageAwaitingId(briefId)) void center.retract(awaitingKey(briefId)).catch(() => undefined);
  },
});

const isRequest = (x: unknown): x is NoticeActionRequest => {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  const filled = (v: unknown): v is string => typeof v === "string" && v.length > 0;
  return (r.action === "retry" || r.action === "skip") && filled(r.threadId) && filled(r.stage) && typeof r.stageName === "string";
};

/** Что сказать владельцу на ответ исполнителя: начат — ничего; иначе — те же слова, что у полосы прогона. */
const answerOf = ({ started, busy }: StepAnswer, stageName: string): CallbackAnswer => ({
  message: started ? null : busy === true ? ru.notice.busy(stageName) : ru.notice.notWaiting(stageName),
});

/** Вход кнопок тоста центра: «Повторить» и «Пропустить» идут в тот же исполнитель, что кнопки полосы прогона. */
export function registerNoticeActions(bb: Pick<BbPluginApi, "http">, runner: Pick<AutomationRunner, "retry" | "skip">): void {
  bb.http.route(
    "POST",
    NOTICE_ACTION_PATH,
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "the body is not JSON" }, 400);
      }
      if (!isRequest(body)) return c.json({ error: "the body is not a notice action" }, 400);
      const { action, threadId, stage, stageName } = body;
      try {
        const answer = action === "retry" ? await runner.retry(threadId, stage) : await runner.skip(threadId, stage);
        return c.json(answerOf(answer, stageName));
      } catch (error) {
        // Как у полосы прогона: упавший вызов владелец видит текстом ошибки, а не «плагин не ответил».
        return c.json({ message: error instanceof Error ? error.message : String(error) } satisfies CallbackAnswer);
      }
    },
    { auth: "local" },
  );
}
