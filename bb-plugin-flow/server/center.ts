// Мост к плагину Центр уведомлений: сервер Flow кладёт туда свои записи по
// HTTP (форма и клиент — packages/notifications-contract). Запрос идёт на
// loopback bb с origin, равным ему, — вход центра открыт только локальным
// источникам. Нет центра или он не ответил — запись молча пропадает: Flow
// работает дальше, только итогов автоматизаций сбоку никто не покажет.
// Обратно центр приходит HTTP-входом notification-action — кнопками тоста.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { notificationsClient, type CallbackAnswer, type NotificationInput } from "@bb-plugins/notifications-contract/index";
import { NOTICE_ACTION_PATH, type NoticeActionRequest } from "../core/center-notice";
import { ru } from "../lib/messages/ru";
import type { StepAnswer } from "../shared/contract";
import type { AutomationRunner } from "./automation-runner";

/** Дольше запись не ждёт: конец хода и итог автоматизации не должны висеть на чужом плагине. */
const PUSH_TIMEOUT_MS = 5_000;

export interface CenterBridge {
  push(input: NotificationInput): Promise<void>;
}

export function centerBridge(
  bb: { readonly server: Pick<BbPluginApi["server"], "loopbackBaseUrl">; readonly log: Pick<BbPluginApi["log"], "warn"> },
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): CenterBridge {
  return {
    async push(input) {
      const base = bb.server.loopbackBaseUrl;
      const result = await notificationsClient(base, fetchImpl, { origin: base, timeoutMs: PUSH_TIMEOUT_MS }).push(input);
      // Нет плагина — обычное дело, не повод для предупреждения.
      if (!result.ok && result.reason !== "not-installed") bb.log.warn(`notifications: ${input.kind} for ${input.threadId} not delivered (${result.reason}${result.status === undefined ? "" : ` ${result.status}`})`);
    },
  };
}

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
