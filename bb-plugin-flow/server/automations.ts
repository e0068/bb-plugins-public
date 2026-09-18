// Мост к плагину Automations: сервер Flow сообщает о своих событиях и запускает
// автоматизации по HTTP (формы и клиент — packages/automations-contract).
// Запрос идёт на loopback bb с origin, равным ему, — вход Automations открыт
// только локальным источникам. Нет плагина или он не ответил — Flow работает
// как раньше: событие молча пропадает, запуск отвечает причиной.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { automationsClient, type ClientResult, type RunResponse } from "../packages/automations-contract/index";

export type FlowTrigger = "flow.stage-done" | "flow.brief-answered" | "flow.criteria-approved";

export interface AutomationsBridge {
  emit(trigger: FlowTrigger, threadId: string, context?: { stageId?: string }): Promise<void>;
  run(automationId: string, threadId: string): Promise<ClientResult<RunResponse>>;
}

/** Дольше событие не ждёт: бриф и ответ владельца не должны висеть на чужом плагине. Прогон в Automations при этом идёт дальше. */
const EMIT_TIMEOUT_MS = 5_000;

/** Потолок запуска этапа: мёрдж с ожиданием GitHub длится минутами, но зависший плагин не должен держать инструмент агента вечно. */
const RUN_TIMEOUT_MS = 10 * 60_000;

export function automationsBridge(
  bb: { readonly server: Pick<BbPluginApi["server"], "loopbackBaseUrl">; readonly log: Pick<BbPluginApi["log"], "warn"> },
  fetchImpl: typeof fetch = fetch,
): AutomationsBridge {
  const client = (timeoutMs?: number) => {
    const base = bb.server.loopbackBaseUrl;
    return automationsClient(base, fetchImpl, { origin: base, ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  };
  return {
    async emit(trigger, threadId, context) {
      let result: ClientResult<null>;
      try {
        result = await client(EMIT_TIMEOUT_MS).emit({ trigger, threadId, ...(context === undefined ? {} : { context }) });
      } catch (error) {
        bb.log.warn(`automations: ${trigger} for ${threadId} not delivered (${error instanceof Error ? error.message : String(error)})`);
        return;
      }
      // Нет плагина — обычное дело, не повод для предупреждения.
      if (result.ok || result.reason === "not-installed") return;
      bb.log.warn(
        result.reason === "timeout"
          ? `automations: ${trigger} for ${threadId} got no answer in ${EMIT_TIMEOUT_MS / 1000} s — the run may still be running`
          : `automations: ${trigger} for ${threadId} not delivered (${result.reason}${result.status === undefined ? "" : ` ${result.status}`})`,
      );
    },
    run: (automationId, threadId) => client(RUN_TIMEOUT_MS).run({ threadId, automationId }),
  };
}
