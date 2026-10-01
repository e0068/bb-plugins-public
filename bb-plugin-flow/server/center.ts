// Мост к плагину Центр уведомлений: сервер Flow кладёт туда свои записи по
// HTTP (форма и клиент — packages/notifications-contract). Запрос идёт на
// loopback bb с origin, равным ему, — вход центра открыт только локальным
// источникам. Нет центра или он не ответил — запись молча пропадает: Flow
// работает как раньше, тост показывается.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { notificationsClient, type NotificationInput } from "@bb-plugins/notifications-contract/index";

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
